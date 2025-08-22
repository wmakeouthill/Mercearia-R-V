package com.example.backendspring.admin;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.PathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
@RequiredArgsConstructor
public class AdminService {

    private static final Logger log = LoggerFactory.getLogger(AdminService.class);

    private final JdbcTemplate jdbcTemplate;

    @Value("${app.backupDir:backups}")
    private String backupDirConfig;

    @Value("${app.pgDumpPath:pg_dump}")
    private String pgDumpPath;

    @Value("${app.pgRestorePath:pg_restore}")
    private String pgRestorePath;

    @Value("${spring.datasource.url:}")
    private String datasourceUrl;

    @Value("${spring.datasource.username:}")
    private String datasourceUser;

    @Value("${spring.datasource.password:}")
    private String datasourcePass;

    @Value("${app.enableDatabaseReset:false}")
    private boolean enableDatabaseReset;

    private Path backupDir;

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC);

    @EventListener(ApplicationReadyEvent.class)
    public void init() throws IOException {
        backupDir = Paths.get(backupDirConfig).toAbsolutePath();
        Files.createDirectories(backupDir);
        log.info("AdminService backups directory: {}", backupDir.toAbsolutePath());
    }

    public Map<String, Object> createBackup(String format) throws IOException, InterruptedException {
        // Resolve effective pg_dump/pg_restore paths (prefers configured property,
        // then repo stubs, then system binaries)
        resolvePgBinPaths();

        // Sempre usar o DataSource (embedded) para determinar a URL do DB
        String effectiveUrl = resolveEffectiveJdbcUrl();

        // determinar nome do banco a partir da URL jdbc:postgresql://host:port/dbname
        String dbName = extractDatabaseName(effectiveUrl);
        if (dbName == null)
            throw new IllegalStateException("Não foi possível extrair o nome do banco da URL");

        String ts = TS.format(Instant.now());
        String filename = String.format("db-%s.%s", ts, "dump");
        Path out = backupDir.resolve(filename);

        // format: 'custom' -> -F c ; 'plain' -> -F p
        String formatFlag = "c".equalsIgnoreCase(format) || "custom".equalsIgnoreCase(format) ? "c" : "p";

        List<String> cmd = new ArrayList<>();
        cmd.add(pgDumpPath);
        cmd.add("-F");
        cmd.add(formatFlag);
        cmd.add("-b");
        cmd.add("-v");
        cmd.add("-f");
        cmd.add(out.toString());
        cmd.add(dbName);

        // build ProcessBuilder; on Windows, execute .bat via cmd /c to ensure
        // batch files run correctly
        ProcessBuilder pb;
        boolean isWindows = System.getProperty("os.name").toLowerCase().contains("win");
        if (isWindows && pgDumpPath.toLowerCase().endsWith(".bat")) {
            // Build a single command string for cmd /c and ensure full quoting of the
            // batch path (handles spaces in paths like OneDrive folders).
            StringBuilder sb = new StringBuilder();
            // quote batch path if necessary
            if (pgDumpPath.contains(" "))
                sb.append('"').append(pgDumpPath).append('"');
            else
                sb.append(pgDumpPath);
            // append remaining args (skip first which is batch path in cmd invocation)
            for (int i = 1; i < cmd.size(); i++) {
                sb.append(' ');
                String a = cmd.get(i);
                if (a.contains(" ")) {
                    sb.append('"').append(a.replace("\"", "\\\"")).append('"');
                } else {
                    sb.append(a);
                }
            }
            String joined = sb.toString();
            pb = new ProcessBuilder("cmd", "/c", joined);
        } else {
            pb = new ProcessBuilder(cmd);
        }
        Map<String, String> env = pb.environment();
        // extrair host/port e usar variáveis de ambiente para credenciais
        Map<String, String> conn = parseJdbcUrl(effectiveUrl);
        if (conn.containsKey("host"))
            env.put("PGHOST", conn.get("host"));
        if (conn.containsKey("port"))
            env.put("PGPORT", conn.get("port"));
        if (datasourceUser != null && !datasourceUser.isBlank())
            env.put("PGUSER", datasourceUser);
        if (datasourcePass != null && !datasourcePass.isBlank())
            env.put("PGPASSWORD", datasourcePass);

        pb.redirectErrorStream(true);
        log.info("Executando pg_dump: {} -> {}", dbName, out.toAbsolutePath());
        Process p = pb.start();
        int code = p.waitFor();
        String procOut = "";
        try {
            procOut = new String(p.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            log.debug("pg_dump output: {}", procOut);
        } catch (Exception e) {
            log.debug("Falha ao ler output do pg_dump: {}", e.getMessage());
        }
        if (code != 0) {
            String msg = String.format("pg_dump retornou código %d", code);
            log.error("{} -- output: {}", msg, procOut);
            throw new IllegalStateException(msg + "\npg_dump output:\n" + procOut);
        }

        // Garantir que o arquivo foi criado. Alguns stubs/FS podem retornar 0
        // mas não materializar imediatamente o arquivo; vamos checar a existência
        // com retries curtos.
        boolean exists = false;
        for (int i = 0; i < 5; i++) {
            if (Files.exists(out) && Files.isRegularFile(out)) {
                exists = true;
                break;
            }
            try {
                Thread.sleep(150);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }
        }
        if (!exists) {
            // Se detectamos que estamos usando o stub de desenvolvimento, tentar
            // criar o arquivo como fallback para permitir testes rápidos em dev.
            if (procOut != null && procOut.contains("pg_dump (stub)")) {
                try {
                    Files.createDirectories(out.getParent());
                    Files.createFile(out);
                    log.warn("Dev fallback: criei arquivo de backup manualmente: {}", out.toAbsolutePath());
                    exists = true;
                } catch (Exception e) {
                    log.error("Falha ao criar arquivo de fallback do backup: {}", e.getMessage());
                }
            }
        }

        if (!exists) {
            String msg = "Backup não encontrado após execução do pg_dump: " + out.toAbsolutePath().toString();
            log.error("{} -- pg_dump output: {}", msg, procOut);
            try {
                Files.deleteIfExists(out);
            } catch (Exception ignored) {
            }
            throw new IllegalStateException(msg + "\npg_dump output:\n" + procOut);
        }

        return Map.of("filename", out.getFileName().toString(), "path", out.toString());
    }

    public void recordAdminAction(String username, String action, String observation, String filename) {
        try {
            var now = java.time.OffsetDateTime.now();
            jdbcTemplate.update(
                    "INSERT INTO admin_actions (username, action, observation, filename, created_at) VALUES (?,?,?,?,?)",
                    username, action, observation, filename, now);
        } catch (Exception e) {
            log.warn("Failed to record admin action: {}", e.getMessage());
        }
    }

    public List<Map<String, Object>> listAdminActions() {
        try {
            return jdbcTemplate.queryForList(
                    "SELECT id, username, action, observation, filename, created_at FROM admin_actions ORDER BY created_at DESC LIMIT 100");
        } catch (Exception e) {
            log.warn("Failed to list admin actions: {}", e.getMessage());
            return List.of();
        }
    }

    public boolean deleteBackupFile(String name) {
        try {
            Path p = getBackupPathSanitized(name);
            return Files.deleteIfExists(p);
        } catch (Exception e) {
            log.warn("Failed to delete backup {}: {}", name, e.getMessage());
            return false;
        }
    }

    public Map<String, Object> checkToolStatus() {
        Map<String, Object> out = new HashMap<>();
        boolean dumpOk = false;
        boolean restoreOk = false;
        try {
            ProcessBuilder pb = new ProcessBuilder(pgDumpPath, "--version");
            pb.redirectErrorStream(true);
            Process p = pb.start();
            try {
                int code = p.waitFor();
                dumpOk = code == 0;
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                dumpOk = false;
            }
        } catch (Exception e) {
            dumpOk = false;
        }
        try {
            ProcessBuilder pb2 = new ProcessBuilder(pgRestorePath, "--version");
            pb2.redirectErrorStream(true);
            Process p2 = pb2.start();
            try {
                int code2 = p2.waitFor();
                restoreOk = code2 == 0;
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                restoreOk = false;
            }
        } catch (Exception e) {
            restoreOk = false;
        }
        boolean backupDirWritable = false;
        try {
            backupDirWritable = Files.isWritable(backupDir);
        } catch (Exception e) {
            backupDirWritable = false;
        }
        out.put("pgDump", dumpOk);
        out.put("pgRestore", restoreOk);
        out.put("backupDirWritable", backupDirWritable);
        out.put("backupDir", backupDir.toString());
        return out;
    }

    public List<Map<String, Object>> listBackups() throws IOException {
        if (!Files.exists(backupDir))
            return List.of();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(backupDir)) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Path p : ds) {
                if (!Files.isRegularFile(p))
                    continue;
                BasicFileAttributes attr = Files.readAttributes(p, BasicFileAttributes.class);
                out.add(Map.of("name", p.getFileName().toString(), "createdAt", attr.creationTime().toString()));
            }
            out.sort(Comparator.comparing(m -> (String) m.get("name"), Comparator.reverseOrder()));
            return out;
        }
    }

    public Path getBackupPathSanitized(String name) {
        String safe = Paths.get(name).getFileName().toString();
        return backupDir.resolve(safe);
    }

    public PathResource getBackupResource(String name) {
        Path p = getBackupPathSanitized(name);
        if (!Files.exists(p))
            throw new IllegalArgumentException("Backup não encontrado");
        return new PathResource(p);
    }

    public boolean isResetEnabled() {
        return enableDatabaseReset;
    }

    public void restoreBackup(String name) throws IOException, InterruptedException {
        Path p = getBackupPathSanitized(name);
        if (!Files.exists(p))
            throw new IllegalArgumentException("Backup não encontrado");
        // mesma lógica do createBackup: quando usamos embedded, tentar obter URL via
        // DataSource
        String effectiveUrl = datasourceUrl;
        if (effectiveUrl == null || effectiveUrl.isBlank()) {
            try {
                var ds = jdbcTemplate.getDataSource();
                if (ds != null) {
                    try (var connc = ds.getConnection()) {
                        effectiveUrl = connc.getMetaData().getURL();
                    }
                }
            } catch (Exception e) {
                log.debug("Não foi possível obter URL do DataSource via metadata: {}", e.getMessage());
            }
        }

        if (effectiveUrl == null || effectiveUrl.isBlank())
            throw new IllegalStateException("Datasource URL não configurada; não é possível restaurar backup");

        String dbName = extractDatabaseName(effectiveUrl);
        Map<String, String> conn = parseJdbcUrl(effectiveUrl);

        List<String> cmd = new ArrayList<>();
        cmd.add(pgRestorePath);
        cmd.add("-d");
        cmd.add(dbName);
        cmd.add(p.toString());

        ProcessBuilder pb = new ProcessBuilder(cmd);
        Map<String, String> env = pb.environment();
        if (conn.containsKey("host"))
            env.put("PGHOST", conn.get("host"));
        if (conn.containsKey("port"))
            env.put("PGPORT", conn.get("port"));
        if (datasourceUser != null && !datasourceUser.isBlank())
            env.put("PGUSER", datasourceUser);
        if (datasourcePass != null && !datasourcePass.isBlank())
            env.put("PGPASSWORD", datasourcePass);

        pb.redirectErrorStream(true);
        log.info("Executando pg_restore: {}", p.toAbsolutePath());
        Process pr = pb.start();
        int code = pr.waitFor();
        if (code != 0)
            throw new IllegalStateException("pg_restore retornou codigo " + code);
    }

    @Transactional
    public void resetDatabase(boolean exceptProducts) {
        if (!enableDatabaseReset) {
            throw new IllegalStateException("Database reset is disabled on this instance");
        }
        // Buscar todas as tabelas do schema public
        List<String> tables = jdbcTemplate.queryForList(
                "select table_name from information_schema.tables where table_schema = 'public' and table_type='BASE TABLE'",
                String.class);
        // tabelas a excluir do truncate
        Set<String> excluded = new HashSet<>(List.of("databasechangelog", "databasechangeloglock"));
        if (exceptProducts)
            excluded.add("produtos");

        List<String> toTruncate = new ArrayList<>();
        for (String t : tables) {
            if (!excluded.contains(t.toLowerCase())) {
                toTruncate.add("\"" + t + "\"");
            }
        }

        if (toTruncate.isEmpty())
            return;

        String sql = "TRUNCATE " + String.join(", ", toTruncate) + " RESTART IDENTITY CASCADE";
        log.info("Executando reset de banco (truncate): {}", sql);
        jdbcTemplate.execute(sql);
    }

    private String resolveEffectiveJdbcUrl() {
        try {
            if (datasourceUrl != null && !datasourceUrl.isBlank())
                return datasourceUrl;
            var ds = jdbcTemplate.getDataSource();
            if (ds != null) {
                try (var conn = ds.getConnection()) {
                    String url = conn.getMetaData().getURL();
                    if (url != null && !url.isBlank())
                        return url;
                }
            }
        } catch (Exception e) {
            log.debug("Falha ao obter URL efetiva do DataSource: {}", e.getMessage());
        }
        throw new IllegalStateException("Datasource URL não configurada; não é possível criar backup");
    }

    private void resolvePgBinPaths() {
        try {
            // If user configured explicit paths via properties, keep them
            if (pgDumpPath != null && !pgDumpPath.equalsIgnoreCase("pg_dump")) {
                // If running packaged, ensure the configured path exists
                String packaged = System.getenv("APP_PACKAGED");
                if (packaged != null && packaged.equalsIgnoreCase("true")) {
                    Path p = Paths.get(pgDumpPath);
                    if (!Files.exists(p)) {
                        throw new IllegalStateException("pg_dump empacotado não encontrado: " + pgDumpPath);
                    }
                }
                return;
            }
            String os = System.getProperty("os.name").toLowerCase();
            String platform = os.contains("win") ? "win" : (os.contains("mac") ? "mac" : "linux");
            Path repoPgDir = Paths.get("pg").toAbsolutePath();
            Path candidateDump = repoPgDir.resolve(platform).resolve(os.contains("win") ? "pg_dump.bat" : "pg_dump");
            Path candidateRestore = repoPgDir.resolve(platform)
                    .resolve(os.contains("win") ? "pg_restore.bat" : "pg_restore");
            if (Files.exists(candidateDump) && Files.exists(candidateRestore)) {
                pgDumpPath = candidateDump.toAbsolutePath().toString();
                pgRestorePath = candidateRestore.toAbsolutePath().toString();
                log.info("Dev: Using repo stubs for pg_dump/pg_restore: {} {}", pgDumpPath, pgRestorePath);
                return;
            }
            // fallback: leave defaults (pg_dump/pg_restore) so system PATH is used
        } catch (Exception e) {
            // ignore
        }
    }

    private String extractDatabaseName(String jdbcUrl) {
        try {
            String u = jdbcUrl;
            if (u.startsWith("jdbc:"))
                u = u.substring(5);
            // agora postgres://host:port/dbname
            int slash = u.indexOf('/', u.indexOf("://") + 3);
            if (slash < 0)
                return null;
            String after = u.substring(slash + 1);
            int q = after.indexOf('?');
            if (q >= 0)
                after = after.substring(0, q);
            return after;
        } catch (Exception e) {
            log.warn("Falha ao extrair nome do DB da URL: {} -> {}", jdbcUrl, e.getMessage());
            return null;
        }
    }

    private Map<String, String> parseJdbcUrl(String jdbcUrl) {
        Map<String, String> out = new HashMap<>();
        try {
            String u = jdbcUrl;
            if (u.startsWith("jdbc:"))
                u = u.substring(5);
            // postgres://host:port/db
            int p1 = u.indexOf("://");
            if (p1 >= 0) {
                String hostPortAndRest = u.substring(p1 + 3);
                int slash = hostPortAndRest.indexOf('/');
                String hostPort = slash >= 0 ? hostPortAndRest.substring(0, slash) : hostPortAndRest;
                if (hostPort.contains(":")) {
                    String[] parts = hostPort.split(":", 2);
                    out.put("host", parts[0]);
                    out.put("port", parts[1]);
                } else {
                    out.put("host", hostPort);
                }
            }
        } catch (Exception e) {
            log.debug("parseJdbcUrl falhou: {}", e.getMessage());
        }
        return out;
    }
}
