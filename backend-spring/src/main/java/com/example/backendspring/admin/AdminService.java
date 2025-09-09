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
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
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

    @Value("${app.excludeUsersOnRestore:true}")
    private boolean excludeUsersOnRestore;

    private Path backupDir;

    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC);

    @EventListener(ApplicationReadyEvent.class)
    public void init() throws IOException {
        backupDir = Paths.get(backupDirConfig).toAbsolutePath();
        Files.createDirectories(backupDir);
        log.info("AdminService backups directory: {}", backupDir.toAbsolutePath());
    }

    private boolean waitForTcpConnect(String host, int port, int attempts, long millisBetween) {
        for (int i = 0; i < attempts; i++) {
            try (java.net.Socket s = new java.net.Socket()) {
                s.connect(new java.net.InetSocketAddress(host, port), (int) millisBetween);
                return true;
            } catch (Exception e) {
                try {
                    Thread.sleep(millisBetween);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return false;
                }
            }
        }
        return false;
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

        // build ProcessBuilder using the resolved pg_dump path directly (Windows-only)
        ProcessBuilder pb = new ProcessBuilder(cmd);
        Map<String, String> env = pb.environment();
        // extrair host/port e usar variáveis de ambiente para credenciais
        Map<String, String> conn = parseJdbcUrl(effectiveUrl);
        if (conn.containsKey("host"))
            env.put("PGHOST", conn.get("host"));
        if (conn.containsKey("port"))
            env.put("PGPORT", conn.get("port"));

        // Wait for the Postgres process to be actually accepting TCP connections
        if (conn.containsKey("host") && conn.containsKey("port")) {
            try {
                String host = conn.get("host");
                int port = Integer.parseInt(conn.get("port"));
                boolean ok = waitForTcpConnect(host, port, 8, 250);
                if (!ok) {
                    String msg = String.format("Timeout waiting for Postgres to accept connections at %s:%d", host,
                            port);
                    log.error(msg);
                    throw new IllegalStateException(msg);
                }
            } catch (NumberFormatException nfe) {
                log.debug("Invalid port number parsed from JDBC URL: {}", conn.get("port"));
            }
        }
        if (datasourceUser != null && !datasourceUser.isBlank())
            env.put("PGUSER", datasourceUser);
        else
            // When running with embedded Postgres, datasourceUser may be empty; default to
            // 'postgres'
            env.put("PGUSER", "postgres");
        if (datasourcePass != null && !datasourcePass.isBlank())
            env.put("PGPASSWORD", datasourcePass);

        // 🔧 CORREÇÃO: Configurar variáveis de ambiente para PostgreSQL embedded
        // Estas variáveis devem ser idênticas às usadas no servidor PostgreSQL
        try {
            Path pgDumpParent = Paths.get(pgDumpPath).getParent(); // pg/win/bin -> pg/win
            if (pgDumpParent != null) {
                Path shareDir = pgDumpParent.resolve("share");
                Path pgRoot = pgDumpParent.getParent(); // pg/win -> pg

                if (Files.exists(shareDir)) {
                    env.put("PGSYSCONFDIR", shareDir.toString());
                    env.put("PGSYSDIR", shareDir.toString());
                    env.put("PGSHARE", shareDir.toString());
                    env.put("PGLIBDIR", pgDumpParent.toString());
                    env.put("PGHOME", pgRoot != null ? pgRoot.toString() : pgDumpParent.toString());

                    log.debug("🔧 Configuradas variáveis de ambiente para pg_dump:");
                    log.debug("   PGSYSDIR: {}", shareDir);
                    log.debug("   PGLIBDIR: {}", pgDumpParent);
                    log.debug("   PGHOME: {}", pgRoot);

                    // 🔧 CORREÇÃO ADICIONAL: Configurar working directory para pg/win
                    // para que paths relativos funcionem corretamente
                    pb.directory(pgDumpParent.toFile());
                    log.debug("🔧 Working directory configurado: {}", pgDumpParent);
                }
            }
        } catch (Exception e) {
            log.warn("⚠️ Falha ao configurar variáveis de ambiente para pg_dump: {}", e.getMessage());
        }

        pb.redirectErrorStream(true);
        // Log connection info just before running pg_dump to help debugging races
        String dbgHost = env.getOrDefault("PGHOST", "");
        String dbgPort = env.getOrDefault("PGPORT", "");
        String dbgUser = env.getOrDefault("PGUSER", "");
        log.info("Executando pg_dump: {} -> {} (effectiveUrl={} host={} port={} user={})", dbName,
                out.toAbsolutePath(), effectiveUrl, dbgHost, dbgPort, dbgUser);
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

    public boolean deleteAdminAction(long id) {
        try {
            int updated = jdbcTemplate.update("DELETE FROM admin_actions WHERE id = ?", id);
            return updated > 0;
        } catch (Exception e) {
            log.warn("Failed to delete admin action {}: {}", id, e.getMessage());
            return false;
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
            throw new IllegalArgumentException("Backup não encontrado: " + p.toAbsolutePath());

        log.info("🔄 Iniciando restore do backup: {}", p.toAbsolutePath());

        // mesma lógica do createBackup: quando usamos embedded, tentar obter URL via
        // DataSource
        // Ensure pg binaries resolved (prefer system, then repo stubs)
        try {
            resolvePgBinPaths();
            log.debug("✅ pg_restore path resolvido: {}", pgRestorePath);
        } catch (Exception e) {
            log.error("❌ Falha ao resolver pg_restore: {}", e.getMessage());
            throw new IllegalStateException("Falha ao encontrar pg_restore: " + e.getMessage());
        }

        // Usar a mesma lógica do createBackup para resolver URL
        String effectiveUrl = resolveEffectiveJdbcUrl();
        log.debug("✅ URL efetiva obtida: {}", effectiveUrl);

        String dbName = extractDatabaseName(effectiveUrl);
        if (dbName == null || dbName.isBlank()) {
            throw new IllegalStateException("Não foi possível extrair nome do banco da URL: " + effectiveUrl);
        }
        log.debug("✅ Nome do banco extraído: {}", dbName);

        Map<String, String> conn = parseJdbcUrl(effectiveUrl);
        log.debug("✅ Parâmetros de conexão: host={}, port={}", conn.get("host"), conn.get("port"));

        List<String> cmd = new ArrayList<>();
        cmd.add(pgRestorePath);
        // Prefer cleaning existing objects and avoid owner/privileges issues when
        // restoring
        cmd.add("--clean");
        cmd.add("--if-exists");
        cmd.add("--no-owner");
        cmd.add("--no-privileges");
        // force operations to run as postgres role inside the target DB
        cmd.add("--role=postgres");
        // 🔧 CORREÇÃO: Configurações para restaurar em PostgreSQL embedded
        // Ignorar comentários de extensões para evitar problemas com adminpack
        cmd.add("--no-comments");
        cmd.add("-d");
        cmd.add(dbName);
        cmd.add(p.toString());

        log.info("🔧 Comando pg_restore: {}", String.join(" ", cmd));

        // build ProcessBuilder using the resolved pg_restore path directly
        // (Windows-only)
        ProcessBuilder pb = new ProcessBuilder(cmd);
        Map<String, String> env = pb.environment();
        if (conn.containsKey("host"))
            env.put("PGHOST", conn.get("host"));
        if (conn.containsKey("port"))
            env.put("PGPORT", conn.get("port"));
        if (datasourceUser != null && !datasourceUser.isBlank())
            env.put("PGUSER", datasourceUser);
        else
            // default to postgres when embedded is used like in createBackup
            env.put("PGUSER", "postgres");
        if (datasourcePass != null && !datasourcePass.isBlank())
            env.put("PGPASSWORD", datasourcePass);

        log.debug("🔧 Variáveis de ambiente: PGHOST={}, PGPORT={}, PGUSER={}",
                env.get("PGHOST"), env.get("PGPORT"), env.get("PGUSER"));

        // 🔧 CORREÇÃO: Configurar variáveis de ambiente para PostgreSQL embedded
        // Estas variáveis devem ser idênticas às usadas no servidor PostgreSQL
        try {
            Path pgRestoreParent = Paths.get(pgRestorePath).getParent(); // pg/win/bin -> pg/win
            if (pgRestoreParent != null) {
                Path shareDir = pgRestoreParent.resolve("share");
                Path pgRoot = pgRestoreParent.getParent(); // pg/win -> pg

                if (Files.exists(shareDir)) {
                    env.put("PGSYSCONFDIR", shareDir.toString());
                    env.put("PGSYSDIR", shareDir.toString());
                    env.put("PGSHARE", shareDir.toString());
                    env.put("PGLIBDIR", pgRestoreParent.toString());
                    env.put("PGHOME", pgRoot != null ? pgRoot.toString() : pgRestoreParent.toString());

                    log.debug("🔧 Configuradas variáveis de ambiente para pg_restore:");
                    log.debug("   PGSYSDIR: {}", shareDir);
                    log.debug("   PGLIBDIR: {}", pgRestoreParent);
                    log.debug("   PGHOME: {}", pgRoot);

                    // 🔧 CORREÇÃO ADICIONAL: Configurar working directory para pg/win
                    // para que paths relativos funcionem corretamente
                    pb.directory(pgRestoreParent.toFile());
                    log.debug("🔧 Working directory configurado: {}", pgRestoreParent);
                }
            }
        } catch (Exception e) {
            log.warn("⚠️ Falha ao configurar variáveis de ambiente para pg_restore: {}", e.getMessage());
        }

        // Wait for Postgres to accept TCP connections before attempting restore
        if (conn.containsKey("host") && conn.containsKey("port")) {
            try {
                String host = conn.get("host");
                int port = Integer.parseInt(conn.get("port"));
                boolean ok = waitForTcpConnect(host, port, 8, 250);
                if (!ok) {
                    String msg = String.format("Timeout waiting for Postgres to accept connections at %s:%d", host,
                            port);
                    log.error(msg);
                    throw new IllegalStateException(msg);
                }
            } catch (NumberFormatException nfe) {
                log.debug("Invalid port number parsed from JDBC URL: {}", conn.get("port"));
            }
        }

        pb.redirectErrorStream(true);
        log.info("▶️  Executando pg_restore: {}", p.toAbsolutePath());

        Process pr = pb.start();
        String procOut = "";
        try {
            procOut = new String(pr.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            log.debug("📋 pg_restore output: {}", procOut);
        } catch (Exception e) {
            log.debug("⚠️  Falha ao ler output do pg_restore: {}", e.getMessage());
        }

        int code = pr.waitFor();
        log.info("🏁 pg_restore finalizado com código: {}", code);

        if (code != 0) {
            String msg = "pg_restore retornou código " + code;
            log.error("❌ {} -- output: {}", msg, procOut);

            // 🔧 CORREÇÃO: Aceitar código 1 se são apenas warnings de extensões
            boolean onlyExtensionWarnings = code == 1 &&
                    procOut.toLowerCase().contains("warning: errors ignored on restore") &&
                    (procOut.toLowerCase().contains("adminpack") ||
                            procOut.toLowerCase().contains("extension"));

            if (onlyExtensionWarnings) {
                log.warn("⚠️ pg_restore teve warnings de extensões, mas continuando (código {})", code);
                log.warn("📋 Detalhes: {}", procOut);
                log.info("✅ Restore do backup concluído com warnings de extensões");
                return;
            }

            // Analisar tipos comuns de erro para dar feedback melhor
            String errorType = "restore_failed";
            String userMessage = msg;

            if (procOut.toLowerCase().contains("authentication failed") ||
                    procOut.toLowerCase().contains("password authentication failed")) {
                errorType = "authentication_error";
                userMessage = "Falha na autenticação com o banco de dados";
            } else if (procOut.toLowerCase().contains("connection refused") ||
                    procOut.toLowerCase().contains("could not connect")) {
                errorType = "connection_error";
                userMessage = "Não foi possível conectar ao banco de dados";
            } else if (procOut.toLowerCase().contains("permission denied") ||
                    procOut.toLowerCase().contains("access denied")) {
                errorType = "permission_error";
                userMessage = "Permissões insuficientes para restaurar o backup";
            } else if (procOut.toLowerCase().contains("database") &&
                    procOut.toLowerCase().contains("does not exist")) {
                errorType = "database_not_found";
                userMessage = "Banco de dados de destino não encontrado";
            }

            log.error("🔍 Tipo de erro identificado: {} - {}", errorType, userMessage);
            throw new IllegalStateException(userMessage + "\n\nDetalhes técnicos:\n" + procOut);
        }

        log.info("✅ Restore do backup concluído com sucesso");
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
        // tabelas a excluir do truncate (não queremos apagar changelogs, usuários
        // nem o log de admin actions)
        Set<String> excluded = new HashSet<>(
                List.of("databasechangelog", "databasechangeloglock", "usuarios", "admin_actions"));
        if (exceptProducts) {
            excluded.add("produtos");
        }

        // Carregar todas as FKs do schema public para análise de dependências
        List<Map<String, Object>> fkRows = jdbcTemplate.queryForList(
                "select tc.table_name as child_table, ccu.table_name as parent_table "
                        + "from information_schema.table_constraints tc "
                        + "join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema "
                        + "join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema "
                        + "where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'");

        // Expandir exclusões transitivamente: se uma tabela excluída referencia outra,
        // também
        // devemos excluí-la para impedir que um TRUNCATE ... CASCADE acabe afetando a
        // tabela
        // que queremos proteger. Fazemos isso por closure sobre os pares FK.
        Set<String> excludedLower = new HashSet<>();
        for (String e : excluded)
            excludedLower.add(e.toLowerCase());

        boolean changed = true;
        while (changed) {
            changed = false;
            for (Map<String, Object> r : fkRows) {
                String child = (r.get("child_table") == null) ? "" : r.get("child_table").toString().toLowerCase();
                String parent = (r.get("parent_table") == null) ? "" : r.get("parent_table").toString().toLowerCase();
                if (excludedLower.contains(child) && !excludedLower.contains(parent)) {
                    excludedLower.add(parent);
                    changed = true;
                }
            }
        }

        // Construir conjunto de tabelas que serão truncadas (mantendo nomes originais)
        Set<String> truncateSet = new HashSet<>();
        for (String t : tables) {
            if (!excludedLower.contains(t.toLowerCase())) {
                truncateSet.add(t);
            }
        }

        if (truncateSet.isEmpty())
            return;

        // Construir grafo de dependências (aresta: child -> parent) apenas entre
        // tabelas a truncar
        Map<String, List<String>> adj = new HashMap<>();
        Map<String, Integer> indeg = new HashMap<>();
        for (String t : truncateSet) {
            adj.put(t, new ArrayList<>());
            indeg.put(t, 0);
        }

        for (Map<String, Object> r : fkRows) {
            String child = (r.get("child_table") == null) ? "" : r.get("child_table").toString();
            String parent = (r.get("parent_table") == null) ? "" : r.get("parent_table").toString();
            if (truncateSet.contains(child) && truncateSet.contains(parent)) {
                // edge child -> parent (queremos truncar child antes de parent)
                adj.get(child).add(parent);
                indeg.put(parent, indeg.get(parent) + 1);
            }
        }

        // Kahn topological sort to produce an order child-before-parent
        Deque<String> q = new ArrayDeque<>();
        for (Map.Entry<String, Integer> e : indeg.entrySet()) {
            if (e.getValue() == 0)
                q.add(e.getKey());
        }

        List<String> ordered = new ArrayList<>();
        while (!q.isEmpty()) {
            String n = q.removeFirst();
            ordered.add(n);
            for (String nb : adj.get(n)) {
                indeg.put(nb, indeg.get(nb) - 1);
                if (indeg.get(nb) == 0)
                    q.add(nb);
            }
        }

        // Se houver ciclos, os nós restantes em truncateSet mas não em 'ordered'
        // pertencem a ciclos
        Set<String> orderedSet = new HashSet<>(ordered);
        List<String> cyc = new ArrayList<>();
        for (String t : truncateSet) {
            if (!orderedSet.contains(t))
                cyc.add(t);
        }

        // Executar truncates em ordem topológica sem CASCADE (protege tabelas
        // excluídas).
        if (!ordered.isEmpty()) {
            List<String> quoted = new ArrayList<>();
            for (String t : ordered)
                quoted.add('"' + t + '"');
            String sql = "TRUNCATE " + String.join(", ", quoted) + " RESTART IDENTITY";
            log.info("Executando reset de banco (truncate ordered, sem CASCADE): {}", sql);
            jdbcTemplate.execute(sql);
        }

        // Para ciclos complexos, truncar com CASCADE como fallback (essas tabelas
        // não possuem uma ordenação acíclica entre si). Como já expandimos a
        // lista de excluídos transitivamente, esse CASCADE não deve afetar
        // tabelas que queremos preservar.
        if (!cyc.isEmpty()) {
            List<String> quotedC = new ArrayList<>();
            for (String t : cyc)
                quotedC.add('"' + t + '"');
            String sqlc = "TRUNCATE " + String.join(", ", quotedC) + " RESTART IDENTITY CASCADE";
            log.info("Executando reset de banco (truncate cyclic, com CASCADE fallback): {}", sqlc);
            jdbcTemplate.execute(sqlc);
        }

        // Garantir que exista ao menos um usuário admin após o reset. Se não
        // existir, criar o admin padrão (username=admin,
        // senha=DEFAULT_ADMIN_PASSWORD||admin123).
        try {
            Integer adminCount = jdbcTemplate.queryForObject(
                    "select count(*) from usuarios where role = 'admin'", Integer.class);
            if (adminCount == null || adminCount == 0) {
                String defaultPass = System.getenv().getOrDefault("DEFAULT_ADMIN_PASSWORD", "admin123");
                BCryptPasswordEncoder enc = new BCryptPasswordEncoder();
                String hash = enc.encode(defaultPass);
                jdbcTemplate.update(
                        "insert into usuarios (username, password, role, pode_controlar_caixa) values (?, ?, ?, ?)",
                        "admin", hash, "admin", true);
                log.info("Admin default criado após reset (username=admin)");
            }
        } catch (Exception e) {
            log.warn("Falha ao garantir admin pós-reset: {}", e.getMessage());
        }
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
            // If user configured explicit paths via properties and it's not the default
            // keep them (but still allow packaged checks).
            if (pgDumpPath != null && !pgDumpPath.equalsIgnoreCase("pg_dump")) {
                String packaged = System.getenv("APP_PACKAGED");
                if (packaged != null && packaged.equalsIgnoreCase("true")) {
                    Path p = Paths.get(pgDumpPath);
                    if (!Files.exists(p)) {
                        throw new IllegalStateException("pg_dump empacotado não encontrado: " + pgDumpPath);
                    }
                }
                return;
            }

            // Prefer actual system-installed pg_dump/pg_restore on PATH when available
            boolean dumpOnPath = false;
            boolean restoreOnPath = false;
            try {
                ProcessBuilder pb = new ProcessBuilder("pg_dump", "--version");
                pb.redirectErrorStream(true);
                Process p = pb.start();
                int code = p.waitFor();
                dumpOnPath = code == 0;
            } catch (Exception ignored) {
                dumpOnPath = false;
            }
            try {
                ProcessBuilder pb2 = new ProcessBuilder("pg_restore", "--version");
                pb2.redirectErrorStream(true);
                Process p2 = pb2.start();
                int code2 = p2.waitFor();
                restoreOnPath = code2 == 0;
            } catch (Exception ignored) {
                restoreOnPath = false;
            }

            if (dumpOnPath && restoreOnPath) {
                pgDumpPath = "pg_dump";
                pgRestorePath = "pg_restore";
                log.info("Using system pg_dump/pg_restore from PATH");
                return;
            }

            // If system binaries not found, fall back to repo stubs if present
            String os = System.getProperty("os.name").toLowerCase();
            String platform = os.contains("win") ? "win" : (os.contains("mac") ? "mac" : "linux");
            Path repoPgDir = Paths.get("pg").toAbsolutePath();
            // Prefer actual executables in the repo pg/<platform> when available (avoid
            // quoting issues with .bat). On Windows require .exe or system PATH to be
            // present
            Path candidateDumpExe = repoPgDir.resolve(platform).resolve("pg_dump.exe");
            Path candidateRestoreExe = repoPgDir.resolve(platform).resolve("pg_restore.exe");
            if (os.contains("win")) {
                if (Files.exists(candidateDumpExe) && Files.exists(candidateRestoreExe)) {
                    pgDumpPath = candidateDumpExe.toAbsolutePath().toString();
                    pgRestorePath = candidateRestoreExe.toAbsolutePath().toString();
                    log.info("Dev: Using repo pg executables for pg_dump/pg_restore: {} {}", pgDumpPath, pgRestorePath);
                    return;
                }
                // If system binaries are on PATH, use them
                if (dumpOnPath && restoreOnPath) {
                    pgDumpPath = "pg_dump";
                    pgRestorePath = "pg_restore";
                    log.info("Using system pg_dump/pg_restore from PATH (Windows)");
                    return;
                }
                // no suitable windows binaries found: fail fast to avoid running .bat quoting
                // issues
                throw new IllegalStateException(
                        "pg_dump/pg_restore not found. Place Windows pg_dump.exe and pg_restore.exe in backend-spring/pg/win/");
            } else {
                // non-windows behavior (legacy)
                Path candidateDump = repoPgDir.resolve(platform)
                        .resolve(os.contains("win") ? "pg_dump.bat" : "pg_dump");
                Path candidateRestore = repoPgDir.resolve(platform)
                        .resolve(os.contains("win") ? "pg_restore.bat" : "pg_restore");
                if (Files.exists(candidateDump) && Files.exists(candidateRestore)) {
                    pgDumpPath = candidateDump.toAbsolutePath().toString();
                    pgRestorePath = candidateRestore.toAbsolutePath().toString();
                    log.info("Dev: Using repo stubs for pg_dump/pg_restore: {} {}", pgDumpPath, pgRestorePath);
                    return;
                }
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
