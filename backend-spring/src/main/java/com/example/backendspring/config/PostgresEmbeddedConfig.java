package com.example.backendspring.config;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.AutoConfigureBefore;
import org.springframework.boot.autoconfigure.liquibase.LiquibaseAutoConfiguration;
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
@AutoConfigureBefore(LiquibaseAutoConfiguration.class)
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
    public EmbeddedPostgres embeddedPostgres() throws IOException {
        boolean persist = shouldPersistData();
        Path dataDir = resolveInitialDataDirectory();
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

    private Path resolveInitialDataDirectory() {
        // Em modo empacotado/produção, NÃO usar diretórios temporários: a única
        // fonte de verdade do banco é resources/data/pg.
        // Mesmo que persist seja falso, continuaremos usando o diretório persistente.
        Path persistentDir = resolvePersistentDataDirectoryFromEnv();
        ensureDirectory(persistentDir);

        // Verificar se o banco de dados está corrompido antes de tentar usar
        if (isDatabaseCorrupted(persistentDir)) {
            log.warn("Banco de dados PostgreSQL corrompido detectado em {}. Limpando para recriação...", persistentDir);
            cleanupCorruptedDatabase(persistentDir);
        }

        // Não migrar para TEMP: apenas limpar locks e seguir usando o diretório
        // persistente para não criar bancos novos.
        handleStaleLockIfPresent(persistentDir);
        return persistentDir;
    }

    private Path resolvePersistentDataDirectoryFromEnv() {
        // When packaged, the installer copies development data folder
        // "backend-spring/data"
        // into Electron resources as "resources/data" (sibling of backend-spring).
        // The backend runs with CWD = resources/backend-spring, so prefer ../data/pg.
        String packaged = System.getenv("APP_PACKAGED");
        if (packaged != null && packaged.equalsIgnoreCase("true")) {
            Path packagedDir = Paths.get("..", "data", "pg").toAbsolutePath().normalize();
            log.info("Packaged mode: using embedded Postgres data directory (../data/pg): {}", packagedDir);
            return packagedDir;
        }

        // Otherwise force single data directory inside the repo/app working folder
        Path forced = Paths.get("data", "pg").toAbsolutePath();
        log.info("Forcing Embedded Postgres data directory to: {}", forced);
        return forced;
    }

    private void ensureDirectory(Path dir) {
        try {
            Files.createDirectories(dir);
        } catch (IOException ignored) {
            log.debug("Ignorando falha ao garantir diretório {}: {}", dir, ignored.getMessage());
        }
    }

    private boolean handleStaleLockIfPresent(Path persistentDir) {
        // Verificar tanto postmaster.pid quanto epg-lock (usado pelo zonky/embedded-pg)
        Path pidLock = persistentDir.resolve("postmaster.pid");
        Path epgLock = persistentDir.resolve("epg-lock");
        if (!Files.exists(pidLock) && !Files.exists(epgLock)) {
            return true;
        }

        // Em produção, se o banco parece estar funcionando, use limpeza rápida
        boolean isProduction = "production".equals(System.getenv("NODE_ENV"));
        boolean hasHealthyDatabase = isDatabaseHealthy(persistentDir);

        if (isProduction && hasHealthyDatabase) {
            log.info("Produção: banco aparenta estar saudável. Usando limpeza rápida de locks...");
            try {
                Files.deleteIfExists(pidLock);
                Files.deleteIfExists(epgLock);
                performAdditionalCleanup(persistentDir);
                log.info("Locks removidos rapidamente em modo produção.");
                return true;
            } catch (IOException e) {
                log.warn("Falha na limpeza rápida. Voltando para limpeza completa: {}", e.getMessage());
            }
        }

        log.warn("Lock do Postgres encontrado em {} ou {}. Tentando identificar/encerrar processo antigo...",
                pidLock, epgLock);
        try {
            // Terminar processos PostgreSQL órfãos antes de remover locks
            terminateOrphanedPostgresProcesses();

            // Aguardar um pouco para que os processos sejam finalizados
            safeSleepMillis(2000);

            // Preferir ler PID do postmaster.pid quando disponível
            if (Files.exists(pidLock)) {
                Optional<Long> pidOpt = readPidFromLockFile(pidLock);
                if (pidOpt.isPresent()) {
                    long pid = pidOpt.get();
                    log.info("PID detectado no postmaster.pid: {}", pid);
                    tryTerminateProcess(pid);
                } else {
                    log.info("PID não encontrado ou inválido em {}. Removendo...", pidLock);
                }
                Files.deleteIfExists(pidLock);
            }

            // Remover epg-lock se existir (arquivo de lock utilizado pela lib)
            if (Files.exists(epgLock)) {
                removeEpgLockIfPresent(epgLock);
            }

            // Forçar limpeza adicional de arquivos de estado inconsistente
            performAdditionalCleanup(persistentDir);

            log.info("Locks processados/removidos. Prosseguindo com diretório persistente.");
            return true;
        } catch (IOException e) {
            log.warn("Falha ao processar locks em {} ({}). Será usado diretório temporário nesta execução.",
                    persistentDir,
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

    private Optional<String> readEpgLockContent(Path epgLock) {
        try {
            return Optional.ofNullable(Files.readString(epgLock));
        } catch (Exception ignored) {
            return Optional.empty();
        }
    }

    private void removeEpgLockIfPresent(Path epgLock) {
        try {
            if (!Files.exists(epgLock))
                return;
            Optional<String> contentOpt = readEpgLockContent(epgLock);
            contentOpt.ifPresent(c -> log.info("epg-lock contents: {}", c.replaceAll("\\r?\\n", " ")));
            Files.deleteIfExists(epgLock);
            log.info("epg-lock removido com sucesso: {}", epgLock);
        } catch (Exception ex) {
            log.warn("Falha ao remover epg-lock {}: {}", epgLock, ex.getMessage());
        }
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

    private void terminateOrphanedPostgresProcesses() {
        try {
            log.info("Verificando processos PostgreSQL órfãos...");

            // Primeiro, tentar via tasklist
            java.util.List<Long> pids = new java.util.ArrayList<>();
            ProcessBuilder pb = new ProcessBuilder("tasklist", "/FI", "IMAGENAME eq postgres.exe", "/FO", "CSV");
            Process process = pb.start();

            try (java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.contains("postgres.exe")) {
                        // Parse CSV output: "ImageName","PID","SessionName","SessionNumber","MemUsage"
                        String[] parts = line.split(",");
                        if (parts.length >= 2) {
                            String pidStr = parts[1].replace("\"", "").trim();
                            try {
                                long pid = Long.parseLong(pidStr);
                                pids.add(pid);
                                log.info("PostgreSQL órfão detectado (PID {}). Tentando terminar...", pid);
                            } catch (NumberFormatException ignored) {
                                // ignore invalid PID
                            }
                        }
                    }
                }
            }
            process.waitFor();

            // Terminar todos os processos detectados
            for (Long pid : pids) {
                tryTerminateProcess(pid);
            }

            // Aguardar um pouco para os processos serem terminados
            if (!pids.isEmpty()) {
                safeSleepMillis(3000);

                // Verificar se ainda há processos ativos
                boolean stillHasProcesses = checkForRemainingPostgresProcesses();
                if (stillHasProcesses) {
                    log.info("Ainda há processos PostgreSQL ativos. Usando taskkill para forçar término...");
                    try {
                        ProcessBuilder killBuilder = new ProcessBuilder("taskkill", "/F", "/IM", "postgres.exe");
                        Process killProcess = killBuilder.start();
                        killProcess.waitFor();
                        log.info("Comando taskkill executado");

                        // Aguardar mais tempo após taskkill
                        safeSleepMillis(3000);
                    } catch (Exception e) {
                        log.warn("Falha ao executar taskkill: {}", e.getMessage());
                    }
                }
            }

        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.warn("Interrompido ao verificar processos PostgreSQL órfãos: {}", ie.getMessage());
        } catch (Exception e) {
            log.warn("Erro ao verificar/terminar processos PostgreSQL órfãos: {}", e.getMessage());
        }
    }

    private boolean checkForRemainingPostgresProcesses() {
        try {
            ProcessBuilder pb = new ProcessBuilder("tasklist", "/FI", "IMAGENAME eq postgres.exe", "/FO", "CSV");
            Process process = pb.start();

            boolean hasProcesses = false;
            try (java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.contains("postgres.exe")) {
                        String[] parts = line.split(",");
                        if (parts.length >= 2) {
                            String pidStr = parts[1].replace("\"", "").trim();
                            try {
                                Long.parseLong(pidStr); // Só para validar se é um PID válido
                                hasProcesses = true;
                                log.debug("Processo PostgreSQL ainda ativo: PID {}", pidStr);
                            } catch (NumberFormatException ignored) {
                                // ignore invalid PID
                            }
                        }
                    }
                }
            }

            process.waitFor();
            return hasProcesses;

        } catch (Exception e) {
            log.warn("Erro ao verificar processos PostgreSQL restantes: {}", e.getMessage());
            return false; // Assumir que não há processos em caso de erro
        }
    }

    private void performAdditionalCleanup(Path persistentDir) {
        try {
            // Remover arquivos de socket Unix se existirem (podem causar problemas)
            Path[] socketsToRemove = {
                    persistentDir.resolve(".s.PGSQL.5432"),
                    persistentDir.resolve(".s.PGSQL.5432.lock"),
                    persistentDir.resolve("postmaster.pid"),
                    persistentDir.resolve("epg-lock")
            };

            for (Path socket : socketsToRemove) {
                if (Files.exists(socket)) {
                    Files.deleteIfExists(socket);
                    log.info("Removido arquivo de estado: {}", socket);
                }
            }

            // Limpar diretório pg_stat_tmp se existir (pode conter estados inconsistentes)
            Path statTmpDir = persistentDir.resolve("pg_stat_tmp");
            if (Files.exists(statTmpDir)) {
                try (java.util.stream.Stream<Path> files = Files.list(statTmpDir)) {
                    files.forEach(file -> {
                        try {
                            Files.deleteIfExists(file);
                        } catch (IOException ignored) {
                            // ignore
                        }
                    });
                }
                log.info("Limpo diretório pg_stat_tmp");
            }
        } catch (Exception e) {
            log.warn("Erro durante limpeza adicional: {}", e.getMessage());
        }
    }

    private EmbeddedPostgres startEmbeddedPostgresWithRetries(Path dataDir, boolean persist, int maxAttempts)
            throws IOException {
        IOException lastError = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                log.info("Iniciando Embedded Postgres (tentativa {}/{})...", attempt, maxAttempts);

                // Limpeza preventiva antes de cada tentativa (exceto a primeira)
                if (attempt > 1) {
                    handleStaleLockIfPresent(dataDir);
                    // Aguardar tempo adicional após limpeza
                    safeSleepMillis(2000);
                }

                // Implementar backoff exponencial para locks
                if (attempt > 1) {
                    long backoffMs = Math.min(10000, 1000L * (attempt - 1) * (attempt - 1));
                    log.info("Aguardando {} ms antes da tentativa {} (backoff exponencial)", backoffMs, attempt);
                    safeSleepMillis(backoffMs);
                }

                return EmbeddedPostgres.builder()
                        .setDataDirectory(dataDir)
                        .setCleanDataDirectory(!persist)
                        // NÃO fixar porta - deixar a biblioteca escolher uma porta disponível
                        // .setPort(5432) - removido para evitar conflitos
                        // Configurações compatíveis com PostgreSQL 9.5+ (moderna)
                        .setServerConfig("shared_preload_libraries", "")
                        .setServerConfig("max_connections", "50")
                        .setServerConfig("shared_buffers", "16MB")
                        .setServerConfig("wal_buffers", "1MB")
                        // Configurações WAL otimizadas (min_wal_size deve ser >= 2x wal_segment_size)
                        .setServerConfig("max_wal_size", "96MB")
                        .setServerConfig("min_wal_size", "32MB")
                        .setServerConfig("checkpoint_completion_target", "0.7")
                        .setServerConfig("wal_writer_delay", "200ms")
                        .setServerConfig("synchronous_commit", "off")
                        .setServerConfig("fsync", "off") // Para desenvolvimento/embedded - melhora performance
                        // Configurações adicionais para melhor compatibilidade Windows
                        .setServerConfig("logging_collector", "off")
                        .setServerConfig("log_destination", "stderr")
                        .setServerConfig("log_min_messages", "warning")
                        .start();
            } catch (IOException ex) {
                lastError = ex;
                log.warn("Falha ao iniciar Embedded Postgres (tentativa {}/{}): {}", attempt, maxAttempts,
                        ex.getMessage());

                // Se falha por OverlappingFileLockException ou contém "lock", fazer limpeza
                // mais agressiva
                String errorMsg = ex.getMessage() != null ? ex.getMessage().toLowerCase() : "";
                if (errorMsg.contains("overlappingfilelockexception") ||
                        errorMsg.contains("lock") ||
                        errorMsg.contains("arquivo já está sendo usado")) {

                    log.info("Detectado problema de lock ({}). Executando limpeza agressiva...", errorMsg);
                    performAggressiveCleanup(dataDir);

                    // Para problemas de lock, aguardar ainda mais tempo
                    safeSleepMillis(8000);
                } else {
                    // Para outros tipos de erro, aguardar menos
                    safeSleepMillis(3000);
                }
            }
        }
        throw lastError != null ? lastError
                : new IOException(
                        "Falha desconhecida ao iniciar Embedded Postgres após " + maxAttempts + " tentativas");
    }

    private void performAggressiveCleanup(Path dataDir) {
        try {
            log.info("Executando limpeza agressiva do diretório de dados...");

            // Terminar todos os processos PostgreSQL múltiplas vezes se necessário
            for (int i = 0; i < 3; i++) {
                terminateOrphanedPostgresProcesses();
                safeSleepMillis(1000);
            }

            // Aguardar processos terminarem completamente
            safeSleepMillis(5000);

            // Forçar limpeza de todos os handles de arquivo
            try {
                // Tentar forçar liberação de recursos
                Runtime.getRuntime().runFinalization();
                safeSleepMillis(2000);
            } catch (Exception ignored) {
            }

            // Remover todos os arquivos de lock e estado com retry
            for (int retry = 0; retry < 3; retry++) {
                try {
                    performAdditionalCleanup(dataDir);
                    break; // Se sucesso, sair do loop
                } catch (Exception e) {
                    log.warn("Tentativa {} de limpeza adicional falhou: {}", retry + 1, e.getMessage());
                    if (retry < 2) {
                        safeSleepMillis(2000);
                    }
                }
            }

            // Tentar remover forçadamente arquivos problemáticos
            forceRemoveLockFiles(dataDir);

            // Aguardar para dar tempo aos handles de arquivo serem liberados
            safeSleepMillis(3000);

        } catch (Exception e) {
            log.warn("Erro durante limpeza agressiva: {}", e.getMessage());
        }
    }

    private void forceRemoveLockFiles(Path dataDir) {
        if (!Files.exists(dataDir)) {
            return;
        }

        try {
            String[] lockFiles = {
                    "epg-lock", "postmaster.pid", ".s.PGSQL.5432", ".s.PGSQL.5432.lock"
            };

            for (String lockFile : lockFiles) {
                Path lockPath = dataDir.resolve(lockFile);
                for (int attempt = 0; attempt < 5; attempt++) {
                    try {
                        if (Files.exists(lockPath)) {
                            // Tentar alterar permissões antes de deletar
                            try {
                                lockPath.toFile().setWritable(true);
                                lockPath.toFile().setReadable(true);
                            } catch (Exception ignored) {
                            }

                            Files.deleteIfExists(lockPath);
                            log.info("Arquivo de lock removido forçadamente: {}", lockFile);
                            break;
                        }
                    } catch (Exception e) {
                        if (attempt < 4) {
                            log.debug("Tentativa {} falhou ao remover {}: {}", attempt + 1, lockFile, e.getMessage());
                            safeSleepMillis(1000);
                        } else {
                            log.warn("Não foi possível remover arquivo de lock {} após 5 tentativas: {}", lockFile,
                                    e.getMessage());
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Erro ao forçar remoção de arquivos de lock: {}", e.getMessage());
        }
    }

    private boolean isDatabaseCorrupted(Path dataDir) {
        if (!Files.exists(dataDir)) {
            return false; // Não existe ainda, será criado
        }

        try {
            // Verificar se diretórios essenciais do PostgreSQL existem
            String[] requiredDirs = {
                    "pg_notify", "pg_serial", "pg_snapshots", "pg_stat_tmp",
                    "pg_multixact", "pg_wal", "base"
            };

            for (String requiredDir : requiredDirs) {
                Path dirPath = dataDir.resolve(requiredDir);
                if (!Files.exists(dirPath)) {
                    log.warn("Diretório PostgreSQL essencial ausente: {}", requiredDir);
                    return true;
                }
            }

            // Verificar se arquivo de controle existe
            Path pgControl = dataDir.resolve("global/pg_control");
            if (!Files.exists(pgControl)) {
                log.warn("Arquivo pg_control ausente - banco corrompido");
                return true;
            }

            // Verificar se arquivo de versão existe
            Path pgVersion = dataDir.resolve("PG_VERSION");
            if (!Files.exists(pgVersion)) {
                log.warn("Arquivo PG_VERSION ausente - banco corrompido");
                return true;
            }

            return false;
        } catch (Exception e) {
            log.warn("Erro ao verificar integridade do banco: {}", e.getMessage());
            return true; // Considerar corrompido em caso de erro
        }
    }

    private boolean isDatabaseHealthy(Path dataDir) {
        if (!Files.exists(dataDir) || !Files.isDirectory(dataDir)) {
            return false;
        }

        // Verificar se estruturas básicas do PostgreSQL existem
        Path baseDir = dataDir.resolve("base");
        Path globalDir = dataDir.resolve("global");
        Path pgVersion = dataDir.resolve("PG_VERSION");
        Path pgControl = globalDir.resolve("pg_control");

        // Se os diretórios e arquivos essenciais existem, provavelmente está saudável
        return Files.exists(baseDir) && Files.isDirectory(baseDir) &&
                Files.exists(globalDir) && Files.isDirectory(globalDir) &&
                Files.exists(pgVersion) && Files.exists(pgControl);
    }

    private void cleanupCorruptedDatabase(Path dataDir) {
        try {
            // Primeiro, terminar qualquer processo PostgreSQL
            terminateOrphanedPostgresProcesses();
            safeSleepMillis(3000);

            // Remover completamente o diretório corrompido
            if (Files.exists(dataDir)) {
                log.info("Removendo diretório de banco corrompido: {}", dataDir);
                try (java.util.stream.Stream<Path> walk = Files.walk(dataDir)) {
                    walk.sorted(java.util.Comparator.reverseOrder())
                            .forEach(path -> {
                                try {
                                    Files.deleteIfExists(path);
                                } catch (IOException e) {
                                    log.debug("Falha ao remover {}: {}", path, e.getMessage());
                                }
                            });
                }
            }

            // Recriar diretório vazio
            ensureDirectory(dataDir);
            log.info("Diretório limpo e recriado: {}", dataDir);

        } catch (Exception e) {
            log.warn("Erro ao limpar banco corrompido: {}", e.getMessage());
        }
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
        // Forçar uso exclusivo do EmbeddedPostgres. Não permitir fallback para URL
        // externa.
        if (pg == null) {
            throw new IllegalStateException(
                    "EmbeddedPostgres não está disponível; inicialização abortada (fallback para URL proibido)");
        }
        String url = pg.getJdbcUrl(POSTGRES_DB, POSTGRES_USER);
        return new SimpleDriverDataSource(new org.postgresql.Driver(), url, POSTGRES_USER, "");
    }
}
