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
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.time.Duration;

@Configuration
@AutoConfigureBefore(LiquibaseAutoConfiguration.class)
public class PostgresEmbeddedConfig {

    private static final Logger log = LoggerFactory.getLogger(PostgresEmbeddedConfig.class);
    private static final String POSTGRES_USER = "postgres";
    private static final String POSTGRES_DB = "postgres";

    // Constantes para comandos e arquivos PostgreSQL
    private static final String POSTMASTER_PID_FILE = "postmaster.pid";
    private static final String EPG_LOCK_FILE = "epg-lock";
    private static final String POSTGRES_EXE = "postgres.exe";
    private static final String TASKLIST_CMD = "tasklist";
    private static final String IMAGENAME_FILTER = "IMAGENAME eq postgres.exe";

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

        // Criar arquivo de lock global para evitar múltiplas instâncias
        Path globalLockFile = dataDir.getParent().resolve("postgres-global.lock");
        if (Files.exists(globalLockFile)) {
            handleExistingGlobalLock(globalLockFile);
        }

        createNewGlobalLock(globalLockFile);

        // OTIMIZAÇÃO: Pular limpeza de diretórios temporários para inicialização mais
        // rápida
        // Em PCs lentos, essa operação pode demorar muito
        // cleanOldEmbeddedTempDirs(); - DESABILITADO para inicialização rápida

        // Reduzir tentativas para detectar problemas mais rapidamente
        EmbeddedPostgres result = startEmbeddedPostgresWithRetries(dataDir, persist, 5); // Reduzido de 25 para 5

        // Limpar lock global após sucesso
        try {
            Files.deleteIfExists(globalLockFile);
            log.info("Lock global removido após inicialização bem-sucedida");
        } catch (Exception e) {
            log.debug("Erro ao remover lock global: {}", e.getMessage());
        }

        return result;
    }

    private boolean shouldPersistData() {
        return !"false".equalsIgnoreCase(System.getenv("PERSIST_EMBEDDED_PG"));
    }

    private void handleExistingGlobalLock(Path globalLockFile) {
        try {
            String lockContent = Files.readString(globalLockFile);
            log.warn("Lock global detectado: {}. Verificando se processo ainda existe...", lockContent);

            boolean shouldWait = checkIfShouldWaitForProcess(lockContent);

            // Se não deve aguardar ou já aguardou, remover lock órfão
            if (!shouldWait || Files.exists(globalLockFile)) {
                Files.deleteIfExists(globalLockFile);
                log.info("Lock global órfão removido");
            }
        } catch (Exception e) {
            log.debug("Erro ao processar lock global: {}", e.getMessage());
            removeOrphanedLock(globalLockFile);
        }
    }

    private boolean checkIfShouldWaitForProcess(String lockContent) {
        if (!lockContent.contains("PID-")) {
            return false;
        }

        try {
            String pidStr = lockContent.substring(lockContent.lastIndexOf("PID-") + 4);
            long pid = Long.parseLong(pidStr);
            Optional<ProcessHandle> process = ProcessHandle.of(pid);
            if (process.isPresent() && process.get().isAlive()) {
                log.warn("Processo {} ainda ativo. Aguardando 10s apenas...", pid);
                safeSleepMillis(10000); // Reduzido de 60s para 10s
                return true;
            } else {
                log.info("Processo {} não encontrado/morto. Lock é órfão.", pid);
                return false;
            }
        } catch (Exception e) {
            log.debug("Erro ao verificar PID do lock: {}", e.getMessage());
            return false;
        }
    }

    private void removeOrphanedLock(Path globalLockFile) {
        try {
            Files.deleteIfExists(globalLockFile);
            log.info("Lock global removido devido a erro de leitura");
        } catch (Exception ignored) {
            // Ignorado intencionalmente - erro na remoção de lock é esperado
        }
    }

    private void createNewGlobalLock(Path globalLockFile) {
        try {
            String lockInfo = "PostgreSQL-" + java.time.Instant.now() + "-PID-" + ProcessHandle.current().pid();
            Files.writeString(globalLockFile, lockInfo);
            log.info("Lock global criado: {}", lockInfo);
        } catch (Exception e) {
            log.warn("Não foi possível criar lock global: {}", e.getMessage());
        }
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
        Path pidLock = persistentDir.resolve(POSTMASTER_PID_FILE);
        Path epgLock = persistentDir.resolve(EPG_LOCK_FILE);
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

    private void safeSleepMillis(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.warn("Sleep interrompido ao aguardar nova tentativa do Embedded Postgres: {}", ie.getMessage());
        }
    }

    private void terminateOrphanedPostgresProcesses() {
        try {
            log.info("Verificando processos PostgreSQL órfãos...");
            java.util.List<Long> pids = findOrphanedPostgresPids();

            // Terminar todos os processos detectados
            for (Long pid : pids) {
                tryTerminateProcess(pid);
            }

            // Aguardar um pouco para os processos serem terminados
            if (!pids.isEmpty()) {
                safeSleepMillis(5000); // Aumentado para PCs lentos
                forceTerminateRemainingPostgresProcesses();
            }

        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.warn("Interrompido ao verificar processos PostgreSQL órfãos: {}", ie.getMessage());
        } catch (Exception e) {
            log.warn("Erro ao verificar/terminar processos PostgreSQL órfãos: {}", e.getMessage());
        }
    }

    private java.util.List<Long> findOrphanedPostgresPids() throws InterruptedException, IOException {
        java.util.List<Long> pids = new java.util.ArrayList<>();
        ProcessBuilder pb = new ProcessBuilder(TASKLIST_CMD, "/FI", IMAGENAME_FILTER, "/FO", "CSV");
        Process process = pb.start();

        try (java.io.BufferedReader reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.contains(POSTGRES_EXE)) {
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
        return pids;
    }

    private void forceTerminateRemainingPostgresProcesses() {
        // Verificar se ainda há processos ativos
        boolean stillHasProcesses = checkForRemainingPostgresProcesses();
        if (stillHasProcesses) {
            log.info("Ainda há processos PostgreSQL ativos. Usando taskkill para forçar término...");
            try {
                ProcessBuilder killBuilder = new ProcessBuilder("taskkill", "/F", "/IM", POSTGRES_EXE);
                Process killProcess = killBuilder.start();
                killProcess.waitFor();
                log.info("Comando taskkill executado");

                // Aguardar mais tempo após taskkill em PCs lentos
                safeSleepMillis(8000); // Aumentado para PCs extremamente lentos
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                log.warn("Falha ao executar taskkill: {}", e.getMessage());
            } catch (Exception e) {
                log.warn("Falha ao executar taskkill: {}", e.getMessage());
            }
        }
    }

    private boolean checkForRemainingPostgresProcesses() {
        try {
            ProcessBuilder pb = new ProcessBuilder(TASKLIST_CMD, "/FI", IMAGENAME_FILTER, "/FO", "CSV");
            Process process = pb.start();

            boolean hasProcesses = false;
            try (java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.contains(POSTGRES_EXE)) {
                        String[] parts = line.split(",");
                        if (parts.length >= 2) {
                            String pidStr = parts[1].replace("\"", "").trim();
                            if (validateAndLogActivePid(pidStr)) {
                                hasProcesses = true;
                            }
                        }
                    }
                }
            }

            process.waitFor();
            return hasProcesses;

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("Interrompido ao verificar processos PostgreSQL restantes: {}", e.getMessage());
            return false;
        } catch (Exception e) {
            log.warn("Erro ao verificar processos PostgreSQL restantes: {}", e.getMessage());
            return false; // Assumir que não há processos em caso de erro
        }
    }

    private boolean validateAndLogActivePid(String pidStr) {
        try {
            Long.parseLong(pidStr); // Só para validar se é um PID válido
            log.debug("Processo PostgreSQL ainda ativo: PID {}", pidStr);
            return true;
        } catch (NumberFormatException ignored) {
            // ignore invalid PID
            return false;
        }
    }

    private void performAdditionalCleanup(Path persistentDir) {
        try {
            // Remover arquivos de socket Unix se existirem (podem causar problemas)
            Path[] socketsToRemove = {
                    persistentDir.resolve(".s.PGSQL.5432"),
                    persistentDir.resolve(".s.PGSQL.5432.lock"),
                    persistentDir.resolve(POSTMASTER_PID_FILE),
                    persistentDir.resolve(EPG_LOCK_FILE)
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

                prepareRetryAttempt(attempt, dataDir);

                EmbeddedPostgres.Builder builder = createOptimizedPostgresBuilder(dataDir, persist, attempt);

                // Implementação de wrapper customizado para PCs lentos
                // Em vez de depender só do timeout da biblioteca, vamos monitorar o processo
                // manualmente
                return attemptPostgresStart(builder, attempt, maxAttempts);
            } catch (Exception ex) {
                // Converter qualquer Exception para IOException para compatibilidade
                if (ex instanceof IOException ioexception) {
                    lastError = ioexception;
                } else {
                    lastError = new IOException("Erro ao iniciar PostgreSQL: " + ex.getMessage(), ex);
                }

                log.warn("Falha ao iniciar Embedded Postgres (tentativa {}/{}): {} - Classe: {}",
                        attempt, maxAttempts, ex.getMessage(), ex.getClass().getSimpleName());

                handlePostgresStartupError(ex, attempt, dataDir);
            }
        }
        throw lastError != null ? lastError
                : new IOException(
                        "Falha desconhecida ao iniciar Embedded Postgres após " + maxAttempts + " tentativas");
    }

    private EmbeddedPostgres attemptPostgresStart(EmbeddedPostgres.Builder builder, int attempt, int maxAttempts)
            throws IOException {
        try {
            return executePostgresStart(builder, attempt, maxAttempts);
        } catch (IOException startException) {
            handleStartTimeout(startException);
            // Relançar a exceção original para que o retry funcione
            throw startException;
        }
    }

    private void prepareRetryAttempt(int attempt, Path dataDir) {
        // Limpeza preventiva SIMPLIFICADA antes de cada tentativa
        if (attempt == 1) {
            log.info("Primeira tentativa: verificação rápida de processos PostgreSQL...");
            // Verificação rápida sem limpeza agressiva
            checkForRemainingPostgresProcesses();
        } else {
            // Apenas limpeza básica nas tentativas subsequentes
            handleStaleLockIfPresent(dataDir);
        }

        // Backoff REDUZIDO para detectar problemas mais rapidamente
        if (attempt > 1) {
            long backoffMs = Math.min(10000, 1000L * attempt); // Máximo 10s, crescimento linear
            log.info("Aguardando {} ms antes da tentativa {} (backoff reduzido)", backoffMs, attempt);
            safeSleepMillis(backoffMs);
        }
    }

    private EmbeddedPostgres executePostgresStart(EmbeddedPostgres.Builder builder, int attempt, int maxAttempts)
            throws IOException {
        log.info("Tentando iniciar PostgreSQL na tentativa {}/{} (timeout: {}s)...",
                attempt, maxAttempts, attempt == 1 ? 60 : Math.min(180, 60 + (attempt * 30)));

        // DIAGNÓSTICO: Verificar estado do sistema antes de iniciar (apenas na primeira
        // tentativa)
        if (attempt == 1) {
            logSystemDiagnostics();
        }

        EmbeddedPostgres postgres = configureAndStartPostgres(builder);

        // Se chegou aqui, o PostgreSQL iniciou com sucesso
        log.info("PostgreSQL embedded iniciado com sucesso na tentativa {}/{}", attempt, maxAttempts);
        return postgres;
    }

    private void handleStartTimeout(IOException startException) {
        // Se falhou no start(), verificar se é timeout e aguardar um pouco mais
        String errorMsg = startException.getMessage() != null ? startException.getMessage().toLowerCase() : "";

        if (errorMsg.contains("gave up waiting") || errorMsg.contains("timeout")) {
            log.warn("PostgreSQL demorou mais que o timeout (PC extremamente lento). Aguardando mais 60s...");

            // Aguardar mais 60 segundos adicionais para PostgreSQL se estabilizar em PCs
            // lentos
            safeSleepMillis(60000);
            log.info("Aguarde adicional concluído. Prosseguindo para próxima tentativa.");
        }
    }

    private EmbeddedPostgres.Builder createOptimizedPostgresBuilder(Path dataDir, boolean persist, int attempt) {
        return EmbeddedPostgres.builder()
                .setDataDirectory(dataDir)
                .setCleanDataDirectory(!persist)
                // Timeout agressivo: iniciar com 30s e aumentar gradualmente
                .setPGStartupWait(Duration.ofSeconds(attempt == 1 ? 30 : Math.min(120, 30 + (attempt * 15))));
    }

    private EmbeddedPostgres configureAndStartPostgres(EmbeddedPostgres.Builder builder) throws IOException {
        return builder
                // NÃO fixar porta - deixar a biblioteca escolher uma porta disponível
                // .setPort(5432) - removido para evitar conflitos
                // Configurações MÍNIMAS para inicialização rápida
                .setServerConfig("shared_preload_libraries", "")
                .setServerConfig("max_connections", "10")
                .setServerConfig("shared_buffers", "2MB")
                .setServerConfig("wal_buffers", "64kB")
                .setServerConfig("max_wal_size", "64MB")
                .setServerConfig("min_wal_size", "32MB")
                .setServerConfig("synchronous_commit", "off")
                .setServerConfig("fsync", "off")
                .setServerConfig("effective_io_concurrency", "0") // Windows compatibility
                .setServerConfig("maintenance_io_concurrency", "0") // Windows compatibility
                .setServerConfig("wal_sync_method", "fsync_writethrough") // Windows optimal
                .setServerConfig("wal_level", "minimal") // Minimal for embedded
                .setServerConfig("archive_mode", "off")
                .setServerConfig("max_wal_senders", "0")
                .setServerConfig("hot_standby", "off")
                .setServerConfig("log_min_messages", "warning")
                .setServerConfig("logging_collector", "off")
                .start();
    }

    private void handlePostgresStartupError(Exception ex, int attempt, Path dataDir) {
        // Verificar se é OverlappingFileLockException diretamente
        boolean isLockException = ex instanceof java.nio.channels.OverlappingFileLockException ||
                ex.getCause() instanceof java.nio.channels.OverlappingFileLockException ||
                (ex.getMessage() != null
                        && ex.getMessage().toLowerCase().contains("overlappingfilelockexception"));

        // Se falha por OverlappingFileLockException ou contém "lock", fazer limpeza
        // mais agressiva
        String errorMsg = ex.getMessage() != null ? ex.getMessage().toLowerCase() : "";
        if (isLockException ||
                errorMsg.contains("lock") ||
                errorMsg.contains("arquivo já está sendo usado")) {

            // Se for OverlappingFileLockException, aguardar menos tempo
            if (isLockException) {
                long waitTime = 5000L + (attempt * 2000L); // 5s, 7s, 9s, 11s... (muito reduzido)
                log.info("OverlappingFileLockException - aguardando {}ms (tempo reduzido)...", waitTime);
                safeSleepMillis(waitTime);
                return; // Pular limpeza e tentar novamente
            }

            performAggressiveCleanup(dataDir);

            // Para outros problemas de lock, aguardar tempo menor
            long waitTime = 3000L + (attempt * 1000L); // 3s, 4s, 5s... (muito reduzido)
            log.info("Aguardando {}ms antes da próxima tentativa devido a problema de lock...", waitTime);
            safeSleepMillis(waitTime);
        } else if (errorMsg.contains("gave up waiting") || errorMsg.contains("timeout")) {
            // Para problemas de timeout (PCs lentos), aguardar mais tempo
            long waitTime = 30000L + (attempt * 15000L); // 30s, 45s, 60s... para PCs extremamente lentos
            log.info("Detectado timeout em PC lento. Aguardando {}ms antes da próxima tentativa...", waitTime);
            safeSleepMillis(waitTime);
        } else {
            // Para outros tipos de erro, aguardar tempo padrão
            safeSleepMillis(8000L + (attempt * 2000L)); // 8s, 10s, 12s...
        }
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
            // Aguardar para handles serem liberados pelo SO
            safeSleepMillis(2000);

            // Remover todos os arquivos de lock e estado com retry
            for (int retry = 0; retry < 3; retry++) {
                if (tryPerformAdditionalCleanup(dataDir, retry)) {
                    break; // Se sucesso, sair do loop
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

    private boolean tryPerformAdditionalCleanup(Path dataDir, int retry) {
        try {
            performAdditionalCleanup(dataDir);
            return true; // Sucesso
        } catch (Exception e) {
            log.warn("Tentativa {} de limpeza adicional falhou: {}", retry + 1, e.getMessage());
            if (retry < 2) {
                safeSleepMillis(2000);
            }
            return false; // Falha
        }
    }

    private void forceRemoveLockFiles(Path dataDir) {
        if (!Files.exists(dataDir)) {
            return;
        }

        try {
            String[] lockFiles = {
                    EPG_LOCK_FILE, POSTMASTER_PID_FILE, ".s.PGSQL.5432", ".s.PGSQL.5432.lock"
            };

            for (String lockFile : lockFiles) {
                Path lockPath = dataDir.resolve(lockFile);
                tryRemoveLockFileWithRetries(lockPath, lockFile);
            }
        } catch (Exception e) {
            log.warn("Erro ao forçar remoção de arquivos de lock: {}", e.getMessage());
        }
    }

    private void tryRemoveLockFileWithRetries(Path lockPath, String lockFile) {
        for (int attempt = 0; attempt < 5; attempt++) {
            try {
                if (Files.exists(lockPath)) {
                    // Tentar alterar permissões antes de deletar
                    adjustFilePermissions(lockPath, lockFile);

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

    private void adjustFilePermissions(Path lockPath, String lockFile) {
        try {
            boolean writableSet = lockPath.toFile().setWritable(true);
            boolean readableSet = lockPath.toFile().setReadable(true);
            log.debug("Permissões alteradas para {}: writable={}, readable={}",
                    lockFile, writableSet, readableSet);
        } catch (Exception ignored) {
            // Ignorado - falha ao alterar permissões não é crítica
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

    /**
     * Diagnostica problemas comuns que podem causar PostgreSQL a demorar muito para
     * iniciar
     */
    private void logSystemDiagnostics() {
        try {
            log.info("=== DIAGNÓSTICO DO SISTEMA ===");

            // 1. Verificar espaço em disco
            File dataDir = new File("../data").getAbsoluteFile();
            if (dataDir.exists()) {
                long totalSpace = dataDir.getTotalSpace() / (1024 * 1024 * 1024); // GB
                long freeSpace = dataDir.getFreeSpace() / (1024 * 1024 * 1024); // GB
                log.info("Espaço em disco: {} GB livre de {} GB total", freeSpace, totalSpace);

                if (freeSpace < 1) {
                    log.warn("PROBLEMA: Pouco espaço em disco (< 1GB livre)!");
                }
            }

            // 2. Verificar memória disponível
            Runtime runtime = Runtime.getRuntime();
            long maxMemory = runtime.maxMemory() / (1024 * 1024); // MB
            long totalMemory = runtime.totalMemory() / (1024 * 1024); // MB
            long freeMemory = runtime.freeMemory() / (1024 * 1024); // MB
            long usedMemory = totalMemory - freeMemory;

            log.info("Memória JVM: {} MB usada, {} MB livre, {} MB max", usedMemory, freeMemory, maxMemory);

            if (maxMemory < 256) {
                log.warn("PROBLEMA: Pouca memória JVM (< 256MB)!");
            }

            // 3. Verificar processos PostgreSQL existentes
            int postgresProcesses = countPostgresProcesses();
            log.info("Processos PostgreSQL rodando: {}", postgresProcesses);

            if (postgresProcesses > 0) {
                log.warn("PROBLEMA: PostgreSQL já rodando - possível conflito!");
            }

            // 4. Verificar antivírus (heurística)
            boolean possibleAntivirus = checkForAntivirusInterference();
            if (possibleAntivirus) {
                log.warn("PROBLEMA: Possível interferência de antivírus detectada!");
            }

            // 5. Verificar permissões do diretório
            File pgDataDir = new File("../data/pg").getAbsoluteFile();
            boolean canWrite = pgDataDir.canWrite() || pgDataDir.getParentFile().canWrite();
            log.info("Permissões diretório PostgreSQL: canWrite={}", canWrite);

            if (!canWrite) {
                log.warn("PROBLEMA: Sem permissão de escrita no diretório de dados!");
            }

            log.info("=== FIM DIAGNÓSTICO ===");

        } catch (Exception e) {
            log.debug("Erro no diagnóstico: {}", e.getMessage());
        }
    }

    private int countPostgresProcesses() {
        try {
            ProcessBuilder pb = new ProcessBuilder(TASKLIST_CMD, "/FI", IMAGENAME_FILTER, "/FO", "CSV");
            Process process = pb.start();

            int count = 0;
            try (java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.toLowerCase().contains(POSTGRES_EXE)) {
                        count++;
                    }
                }
            }
            process.waitFor();
            return count;
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.warn("Interrompido ao contar processos PostgreSQL: {}", ie.getMessage());
            return -1;
        } catch (Exception e) {
            return -1; // Erro na verificação
        }
    }

    private boolean checkForAntivirusInterference() {
        try {
            // Verificar se há produtos de segurança conhecidos rodando
            ProcessBuilder pb = new ProcessBuilder("wmic", "product", "get", "name");
            Process process = pb.start();

            try (java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    String lowerLine = line.toLowerCase();
                    if (lowerLine.contains("antivirus") ||
                            lowerLine.contains("defender") ||
                            lowerLine.contains("norton") ||
                            lowerLine.contains("mcafee") ||
                            lowerLine.contains("kaspersky") ||
                            lowerLine.contains("avast") ||
                            lowerLine.contains("avg")) {
                        return true;
                    }
                }
            }
            process.waitFor();
            return false;
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.warn("Interrompido ao verificar antivírus: {}", ie.getMessage());
            return false;
        } catch (Exception e) {
            return false; // Erro na verificação
        }
    }
}
