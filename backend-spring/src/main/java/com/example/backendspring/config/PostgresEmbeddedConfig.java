package com.example.backendspring.config;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import org.springframework.jdbc.datasource.SimpleDriverDataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.Comparator;
import java.time.Instant;
import java.time.Duration;
import java.nio.file.attribute.BasicFileAttributes;

@Configuration
public class PostgresEmbeddedConfig {

    private static final Logger log = LoggerFactory.getLogger(PostgresEmbeddedConfig.class);
    private static final String POSTGRES_USER = "postgres";
    private static final String POSTGRES_DB = "postgres";
    private static final String TEMP_DIR_PREFIX = "embedded-pg-";
    private static final String LOG_READ_FAIL = "Falha ao ler log {}: {}";

    @Value("${spring.datasource.url}")
    private String configuredUrl;

    @Value("${spring.datasource.username}")
    private String configuredUser;

    @Value("${spring.datasource.password}")
    private String configuredPass;

    @Bean(destroyMethod = "close")
    @ConditionalOnExpression("'${spring.datasource.url:}' == ''")
    public EmbeddedPostgres embeddedPostgres() throws IOException {
        boolean persist = shouldPersistData();
        Path dataDir = resolveInitialDataDirectory(persist);
        log.info("Embedded Postgres data directory: {} (persist={})", dataDir, persist);
        // Limpar antigos diretórios temporários do embedded postgres para evitar
        // confusão
        try {
            cleanOldEmbeddedTempDirs();
        } catch (Exception e) {
            log.debug("Falha ao limpar temp dirs antigos: {}", e.getMessage());
        }
        // aumentar tentativas para melhorar resiliência em ambientes Windows onde
        // travamentos ocorrem
        return startEmbeddedPostgresWithRetries(dataDir, persist, 8);
    }

    private boolean shouldPersistData() {
        return !"false".equalsIgnoreCase(System.getenv("PERSIST_EMBEDDED_PG"));
    }

    private Path resolveInitialDataDirectory(boolean persist) throws IOException {
        if (!persist) {
            return createTempDataDirectory();
        }
        Path persistentDir = resolvePersistentDataDirectoryFromEnv();
        ensureDirectory(persistentDir);
        if (!handleStaleLockIfPresent(persistentDir)) {
            return createTempDataDirectory();
        }
        return persistentDir;
    }

    private Path resolvePersistentDataDirectoryFromEnv() {
        String pgDataDirEnv = System.getenv("PG_DATA_DIR");
        return (pgDataDirEnv != null && !pgDataDirEnv.isBlank())
                ? Paths.get(pgDataDirEnv).toAbsolutePath()
                : Paths.get("data", "pg").toAbsolutePath();
    }

    private void ensureDirectory(Path dir) {
        try {
            Files.createDirectories(dir);
        } catch (IOException ignored) {
            log.debug("Ignorando falha ao garantir diretório {}: {}", dir, ignored.getMessage());
        }
    }

    private boolean handleStaleLockIfPresent(Path persistentDir) {
        Path lockFile = persistentDir.resolve("postmaster.pid");
        if (!Files.exists(lockFile)) {
            return true;
        }
        log.warn("Lock do Postgres encontrado em {}. Tentando identificar/encerrar processo antigo...", lockFile);
        try {
            Optional<Long> pidOpt = readPidFromLockFile(lockFile);
            if (pidOpt.isPresent()) {
                long pid = pidOpt.get();
                log.info("PID detectado no lock: {}", pid);
                tryTerminateProcess(pid);
            } else {
                log.info("PID não encontrado ou inválido no arquivo {}. Removendo lock...", lockFile);
            }
            Files.deleteIfExists(lockFile);
            log.info("Lock removido com sucesso. Prosseguindo com diretório persistente.");
            return true;
        } catch (IOException e) {
            log.warn("Falha ao processar lock {} ({}). Será usado diretório temporário nesta execução.", lockFile,
                    e.getMessage());
            return false;
        }
    }

    private Optional<Long> readPidFromLockFile(Path lockFile) {
        try {
            String content = Files.readString(lockFile);
            String[] lines = content.split("\\R");
            if (lines.length > 0 && !lines[0].isBlank()) {
                return parsePid(lines[0]);
            }
        } catch (IOException ignored) {
            // fall through
        }
        return Optional.empty();
    }

    private Optional<Long> parsePid(String line) {
        try {
            return Optional.of(Long.parseLong(line.trim()));
        } catch (NumberFormatException ignored) {
            return Optional.empty();
        }
    }

    private void tryTerminateProcess(long pid) {
        try {
            Optional<ProcessHandle> phOpt = ProcessHandle.of(pid);
            if (phOpt.isPresent()) {
                ProcessHandle ph = phOpt.get();
                if (ph.isAlive()) {
                    log.warn("Processo Postgres detectado com PID {}. Tentando terminar...", pid);
                    ph.destroy(); // graceful
                    waitForProcessExitOrForce(ph, pid, 5);
                }
            }
        } catch (Exception e) {
            log.warn("Erro ao tentar terminar processo {}: {}", pid, e.getMessage());
        }
    }

    private void waitForProcessExitOrForce(ProcessHandle ph, long pid, long timeoutSeconds) {
        try {
            ph.onExit().get(timeoutSeconds, TimeUnit.SECONDS);
            log.info("Processo {} terminou após tentativa graciosa.", pid);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.warn("Thread interrompida ao aguardar término do processo {}: {}. Forçando kill...", pid,
                    ie.getMessage());
            try {
                ph.destroyForcibly();
            } catch (Exception t) {
                log.warn("Falha ao forçar término do processo {}: {}", pid, t.getMessage());
            }
        } catch (java.util.concurrent.TimeoutException te) {
            log.warn("Timeout ao aguardar término do processo {}: {}. Forçando kill...", pid, te.getMessage());
            try {
                ph.destroyForcibly();
            } catch (Exception t) {
                log.warn("Falha ao forçar término do processo {}: {}", pid, t.getMessage());
            }
        } catch (Exception e) {
            log.warn("Erro ao aguardar/forçar término do processo {}: {}", pid, e.getMessage());
        }
    }

    private Path createTempDataDirectory() throws IOException {
        return Files.createTempDirectory(TEMP_DIR_PREFIX);
    }

    private Path tryCreateTempDataDirectorySafe() {
        try {
            return createTempDataDirectory();
        } catch (IOException e) {
            log.warn("Não foi possível criar diretório temporário: {}", e.getMessage());
            return null;
        }
    }

    private void safeSleepMillis(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.warn("Sleep interrompido ao aguardar nova tentativa do Embedded Postgres: {}", ie.getMessage());
        }
    }

    private void cleanOldEmbeddedTempDirs() {
        try {
            String tmp = System.getProperty("java.io.tmpdir");
            if (tmp == null)
                return;
            Path tmpDir = Paths.get(tmp);
            Instant cutoff = Instant.now().minus(Duration.ofDays(1)); // older than 1 day
            try (java.util.stream.Stream<Path> stream = Files.list(tmpDir)) {
                stream.filter(Files::isDirectory)
                        .filter(p -> p.getFileName().toString().startsWith(TEMP_DIR_PREFIX))
                        .forEach(p -> removeTempDirIfOlder(p, cutoff));
            }
        } catch (Exception e) {
            log.debug("Erro em cleanOldEmbeddedTempDirs: {}", e.getMessage());
        }
    }

    private void removeTempDirIfOlder(Path p, Instant cutoff) {
        try {
            BasicFileAttributes attrs = Files.readAttributes(p, BasicFileAttributes.class);
            Instant modified = attrs.lastModifiedTime().toInstant();
            if (modified.isBefore(cutoff)) {
                log.info("Removendo temp embedded-pg antigo: {}", p);
                try (java.util.stream.Stream<Path> walk = Files.walk(p)) {
                    walk.sorted(Comparator.reverseOrder()).forEach(q -> {
                        try {
                            Files.deleteIfExists(q);
                        } catch (Exception ex) {
                            // ignore
                        }
                    });
                }
            }
        } catch (Exception e) {
            log.debug("Falha ao avaliar/remover temp dir {}: {}", p, e.getMessage());
        }
    }

    private void movePersistentDirToBackup(Path persistentDir) {
        try {
            if (persistentDir == null || !Files.exists(persistentDir))
                return;
            String backupName = persistentDir.toString() + ".backup-" + System.currentTimeMillis();
            Path backupPath = Paths.get(backupName);
            Files.move(persistentDir, backupPath);
            log.warn("Diretório persistente movido para backup {} devido a repetidos erros ao iniciar Postgres",
                    backupPath);
        } catch (Exception e) {
            log.warn("Falha ao mover diretório persistente para backup: {}", e.getMessage());
        }
    }

    private EmbeddedPostgres startEmbeddedPostgresWithRetries(Path dataDir, boolean persist, int maxAttempts)
            throws IOException {
        IOException lastError = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                log.info("Iniciando Embedded Postgres (tentativa {}/{})...", attempt, maxAttempts);
                return EmbeddedPostgres.builder()
                        .setDataDirectory(dataDir)
                        .setCleanDataDirectory(!persist)
                        .start();
            } catch (IOException ex) {
                lastError = ex;
                log.warn("Falha ao iniciar Embedded Postgres (tentativa {}/{}): {}", attempt, maxAttempts,
                        ex.getMessage());
                // delegar tratamento da falha para reduzir complexidade
                dataDir = handleStartFailure(attempt, maxAttempts, persist, dataDir);
            }
        }
        throw lastError != null ? lastError : new IOException("Falha desconhecida ao iniciar Embedded Postgres");
    }

    private void collectPostgresLogsForDebug(Path dataDir, int tailLines) {
        try {
            if (dataDir == null)
                return;
            log.info("Tentando coletar logs do Postgres em {} para debug...", dataDir);
            // Possíveis locais: dataDir/log, dataDir/pg_log, dataDir/postgresql.log,
            // dataDir/logfile
            Path[] candidates = new Path[] {
                    dataDir.resolve("log"),
                    dataDir.resolve("pg_log"),
                    dataDir.resolve("postgresql.log"),
                    dataDir.resolve("postmaster.log"),
                    dataDir.resolve("logfile")
            };
            for (Path cand : candidates) {
                processCandidateLog(cand, tailLines);
            }
            // também tentar varrer o diretório em busca de *.log
            scanLogsInDataDir(dataDir, tailLines);
        } catch (Exception e) {
            log.debug("Erro ao coletar logs do Postgres: {}", e.getMessage());
        }
    }

    private Path handleStartFailure(int attempt, int maxAttempts, boolean persist, Path dataDir) {
        // coletar logs do Postgres para ajudar no diagnóstico
        try {
            collectPostgresLogsForDebug(dataDir, 200);
        } catch (Exception ignored) {
            log.debug("Falha ao coletar logs do Postgres para debug: {}", ignored.getMessage());
        }

        // se este é um diretório persistente e estamos na penúltima tentativa,
        // mover o persistente para backup e usar um fresh temp dir
        if (persist && attempt == maxAttempts - 1) {
            try {
                movePersistentDirToBackup(dataDir);
            } catch (Exception e) {
                log.debug("Falha ao mover persist dir para backup: {}", e.getMessage());
            }
        }

        Path tmp = tryCreateTempDataDirectorySafe();
        if (tmp != null) {
            dataDir = tmp;
            log.info("Usando diretório temporário para próxima tentativa: {}", dataDir);
        }
        safeSleepMillis(1500);
        return dataDir;
    }

    private void processCandidateLog(Path cand, int tailLines) {
        try {
            if (!Files.exists(cand))
                return;
            if (Files.isDirectory(cand)) {
                listAndProcessFiles(cand, tailLines);
            } else {
                processLogFile(cand, tailLines);
            }
        } catch (Exception e) {
            log.debug("Erro ao processar candidate log {}: {}", cand, e.getMessage());
        }
    }

    private void listAndProcessFiles(Path dir, int tailLines) {
        try (java.util.stream.Stream<Path> ps = Files.list(dir)) {
            ps.filter(Files::isRegularFile).forEach(p -> processLogFile(p, tailLines));
        } catch (IOException ioe) {
            log.debug("Erro listando diretório de logs {}: {}", dir, ioe.getMessage());
        }
    }

    private void processLogFile(Path p, int tailLines) {
        try {
            String tail = tailFileLines(p, tailLines);
            log.info("--- Postgres log: {} ---\n{}", p, tail);
        } catch (Exception e) {
            log.debug(LOG_READ_FAIL, p, e.getMessage());
        }
    }

    private void scanLogsInDataDir(Path dataDir, int tailLines) {
        try (java.util.stream.Stream<Path> stream = Files.walk(dataDir, 3)) {
            stream.filter(p -> Files.isRegularFile(p) && p.getFileName().toString().toLowerCase().contains("log"))
                    .forEach(p -> processLogFile(p, tailLines));
        } catch (IOException ignored) {
            // ignoring scan errors
        }
    }

    private String tailFileLines(Path file, int maxLines) throws IOException {
        java.util.List<String> all = Files.readAllLines(file);
        int from = Math.max(0, all.size() - maxLines);
        StringBuilder sb = new StringBuilder();
        for (int i = from; i < all.size(); i++) {
            sb.append(all.get(i)).append(System.lineSeparator());
        }
        return sb.toString();
    }

    @Bean
    public DataSource dataSource(@Autowired(required = false) EmbeddedPostgres pg) {
        // Se variáveis de ambiente/arquivo definirem URL, usa elas; senão, usa embedded
        if (configuredUrl != null && !configuredUrl.isBlank()) {
            return new SimpleDriverDataSource(new org.postgresql.Driver(), configuredUrl, configuredUser,
                    configuredPass);
        }
        if (pg == null) {
            throw new IllegalStateException(
                    "EmbeddedPostgres não está disponível e nenhuma URL externa foi configurada");
        }
        String url = pg.getJdbcUrl(POSTGRES_DB, POSTGRES_USER);
        return new SimpleDriverDataSource(new org.postgresql.Driver(), url, POSTGRES_USER, "");
    }
}
