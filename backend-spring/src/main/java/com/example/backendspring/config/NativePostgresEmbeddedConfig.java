package com.example.backendspring.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
import java.util.concurrent.TimeUnit;
import java.net.ServerSocket;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

/**
 * SOLUÇÃO NATIVA: PostgreSQL Embarcado SEM zonky
 * Usa DIRETAMENTE os binários da pasta pg/win/
 */
@Configuration
@AutoConfigureBefore(LiquibaseAutoConfiguration.class)
public class NativePostgresEmbeddedConfig {

    private static final Logger log = LoggerFactory.getLogger(NativePostgresEmbeddedConfig.class);
    private static final String POSTGRES_USER = "postgres";
    private static final String POSTGRES_DB = "postgres";
    private static final String POSTGRES_EXE = "postgres.exe";
    private static final String SHARE_DIR = "share";
    private static final String PGSQL_DIR = "pgsql";

    private Process postgresProcess;
    private int postgresPort = 0;
    private Path dataDirectory;
    private Path binariesDirectory;

    @Bean(destroyMethod = "shutdown")
    public NativeEmbeddedPostgres nativeEmbeddedPostgres() throws IOException {
        return new NativeEmbeddedPostgres();
    }

    @Bean
    public DataSource dataSource(NativeEmbeddedPostgres postgres) {
        String jdbcUrl = postgres.getJdbcUrl();
        log.info("🎯 Conectando ao PostgreSQL nativo: {}", jdbcUrl);

        SimpleDriverDataSource dataSource = new SimpleDriverDataSource();
        dataSource.setDriverClass(org.postgresql.Driver.class);
        dataSource.setUrl(jdbcUrl);
        dataSource.setUsername(POSTGRES_USER);
        dataSource.setPassword("");

        return dataSource;
    }

    /**
     * Implementação nativa do PostgreSQL embarcado
     */
    public class NativeEmbeddedPostgres {

        public NativeEmbeddedPostgres() throws IOException {
            initializeNativePostgres();
        }

        private void initializeNativePostgres() throws IOException {
            log.info("🚀 INICIALIZANDO PostgreSQL NATIVO (sem zonky)");

            // 1. Localizar binários locais
            findLocalPostgresBinaries();

            // 2. Preparar diretório de dados
            setupDataDirectory();

            // 3. Encontrar porta disponível
            postgresPort = findAvailablePort();

            // 4. Inicializar banco se necessário
            initializeDatabase();

            // 5. Iniciar servidor PostgreSQL
            startPostgresServer();

            // 6. Aguardar servidor ficar pronto
            waitForServerReady();

            log.info("✅ PostgreSQL nativo iniciado com sucesso na porta {}", postgresPort);
        }

        private void findLocalPostgresBinaries() throws IOException {
            // Usar distribuição completa do PostgreSQL em pgsql/bin/
            binariesDirectory = Paths.get(PGSQL_DIR, "bin").toAbsolutePath();

            // Se não existir, tentar pasta pg/win como fallback
            if (!Files.exists(binariesDirectory.resolve(POSTGRES_EXE))) {
                log.warn("⚠️ Distribuição completa não encontrada em: {}", binariesDirectory);
                binariesDirectory = Paths.get("pg", "win").toAbsolutePath();

                if (!Files.exists(binariesDirectory.resolve(POSTGRES_EXE))) {
                    throw new IOException("❌ postgres.exe não encontrado nem em pgsql/bin nem em pg/win");
                }
            }

            log.info("✅ Binários PostgreSQL encontrados: {}", binariesDirectory);

            // Verificar DLLs essenciais
            String[] essentialDlls = { "libpq.dll", "vcruntime140.dll", "msvcp140.dll" };
            for (String dll : essentialDlls) {
                if (Files.exists(binariesDirectory.resolve(dll))) {
                    log.info("✅ DLL essencial: {}", dll);
                } else {
                    log.warn("⚠️ DLL ausente: {}", dll);
                }
            }

            // Verificar arquivos de suporte necessários para pg/win
            if (!binariesDirectory.toString().contains(PGSQL_DIR)) {
                Path shareDir = binariesDirectory.resolve(SHARE_DIR);
                Path postgresConfigFile = shareDir.resolve("postgres.bki");
                Path timezoneDir = shareDir.resolve("timezone");

                log.info("🔍 Verificando arquivos de suporte pg/win:");
                log.info("   Diretório share: {} (existe: {})", shareDir, Files.exists(shareDir));
                log.info("   postgres.bki: {} (existe: {})", postgresConfigFile, Files.exists(postgresConfigFile));
                log.info("   timezone: {} (existe: {})", timezoneDir, Files.exists(timezoneDir));

                if (!Files.exists(shareDir)) {
                    log.error("❌ Diretório share não encontrado! PostgreSQL falhará ao iniciar.");
                }
                if (!Files.exists(postgresConfigFile)) {
                    log.error("❌ Arquivo postgres.bki não encontrado! PostgreSQL falhará ao iniciar.");
                }
            }
        }

        private void setupDataDirectory() throws IOException {
            // Usar diretório de dados relativo (como no código original)
            String packaged = System.getenv("APP_PACKAGED");
            if ("true".equalsIgnoreCase(packaged)) {
                dataDirectory = Paths.get("..", "data", "pg").toAbsolutePath().normalize();
                log.info("📁 Modo produção: {}", dataDirectory);
            } else {
                dataDirectory = Paths.get("data", "pg").toAbsolutePath();
                log.info("📁 Modo desenvolvimento: {}", dataDirectory);
            }

            Files.createDirectories(dataDirectory);

            // Limpar locks órfãos
            cleanupStaleFiles();
        }

        private void cleanupStaleFiles() {
            try {
                Path pidFile = dataDirectory.resolve("postmaster.pid");
                Path lockFile = dataDirectory.resolve("postgresql.lock");

                Files.deleteIfExists(pidFile);
                Files.deleteIfExists(lockFile);

                log.info("🧹 Arquivos de lock limpos");
            } catch (Exception e) {
                log.warn("⚠️ Falha na limpeza: {}", e.getMessage());
            }
        }

        private int findAvailablePort() throws IOException {
            try (ServerSocket socket = new ServerSocket(0)) {
                int port = socket.getLocalPort();
                log.info("🔌 Porta disponível encontrada: {}", port);
                return port;
            }
        }

        private void initializeDatabase() throws IOException {
            Path pgVersionFile = dataDirectory.resolve("PG_VERSION");

            if (Files.exists(pgVersionFile)) {
                log.info("📊 Banco de dados já existe, pulando initdb");
                return;
            }

            log.info("🏗️ Inicializando novo banco de dados...");

            Path initdbExe = binariesDirectory.resolve("initdb.exe");
            if (!Files.exists(initdbExe)) {
                throw new IOException("initdb.exe não encontrado: " + initdbExe);
            }

            List<String> initdbCommand = new ArrayList<>();
            initdbCommand.add(initdbExe.toString());
            initdbCommand.add("-D");
            initdbCommand.add(dataDirectory.toString());
            initdbCommand.add("-U");
            initdbCommand.add(POSTGRES_USER);
            initdbCommand.add("--auth=trust");
            initdbCommand.add("--encoding=UTF8");
            initdbCommand.add("--locale=C");
            ProcessBuilder pb = new ProcessBuilder(initdbCommand);
            // Configurar variáveis de ambiente essenciais para PostgreSQL
            pb.environment().put("PATH", binariesDirectory.toString() + ";" + System.getenv("PATH"));
            pb.environment().put("PGDATA", dataDirectory.toString());

            // Se estivermos usando a distribuição completa (pgsql/bin),
            // o PostgreSQL encontrará automaticamente os arquivos share
            if (binariesDirectory.toString().contains(PGSQL_DIR)) {
                log.info("✅ Usando distribuição completa do PostgreSQL - configuração automática");
            } else {
                // Para pg/win, especificar share explicitamente
                initdbCommand.add("-L");
                initdbCommand.add(binariesDirectory.resolve(SHARE_DIR).toString());
                pb.environment().put("PGSYSCONFDIR", binariesDirectory.resolve(SHARE_DIR).toString());
            }
            pb.redirectErrorStream(true);

            Process initdbProcess = pb.start();

            try {
                boolean finished = initdbProcess.waitFor(60, TimeUnit.SECONDS);
                if (!finished || initdbProcess.exitValue() != 0) {
                    throw new IOException("Falha no initdb (timeout ou erro)");
                }
                log.info("✅ Banco inicializado com sucesso");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("initdb interrompido", e);
            }
        }

        private void startPostgresServer() throws IOException {
            log.info("🔥 Iniciando servidor PostgreSQL...");

            Path postgresExe = binariesDirectory.resolve(POSTGRES_EXE);

            // Primeiro, testar se o PostgreSQL consegue mostrar a versão
            testPostgresExecutable(postgresExe);

            List<String> postgresCommand = new ArrayList<>();
            postgresCommand.add(postgresExe.toString());
            postgresCommand.add("-D");
            postgresCommand.add(dataDirectory.toString());
            postgresCommand.add("-p");
            postgresCommand.add(String.valueOf(postgresPort));
            postgresCommand.add("-F"); // Don't run in background

            // Permitir execução com privilégios administrativos
            postgresCommand.add("-c");
            postgresCommand.add("logging_collector=off");
            postgresCommand.add("-c");
            postgresCommand.add("shared_preload_libraries=");
            postgresCommand.add("-c");
            postgresCommand.add("dynamic_shared_memory_type=none");

            // Permitir execução como administrador/superuser
            postgresCommand.add("--allow-superuser");

            ProcessBuilder pb = new ProcessBuilder(postgresCommand);
            // Configurar variáveis de ambiente essenciais para PostgreSQL
            pb.environment().put("PATH", binariesDirectory.toString() + ";" + System.getenv("PATH"));
            pb.environment().put("PGDATA", dataDirectory.toString());
            pb.environment().put("PGTZ", "UTC"); // Força timezone UTC para evitar erro

            // Permitir execução com privilégios administrativos
            pb.environment().put("PGUSER", POSTGRES_USER); // Define usuário postgres
            pb.environment().put("POSTGRES_ALLOW_SUPERUSER", "1"); // Permite superuser

            // Para pg/win, configurar PGSYSCONFDIR explicitamente
            if (!binariesDirectory.toString().contains(PGSQL_DIR)) {
                pb.environment().put("PGSYSCONFDIR", binariesDirectory.resolve(SHARE_DIR).toString());
                log.info("🔧 Configurando PGSYSCONFDIR para pg/win: {}", binariesDirectory.resolve(SHARE_DIR));
            }
            // Sempre tenta garantir que o diretório de suporte está visível
            pb.environment().put("PGSYSDIR", binariesDirectory.resolve(SHARE_DIR).toString());

            // Log das configurações para diagnóstico
            log.info("🔍 Comando PostgreSQL: {}", String.join(" ", postgresCommand));
            log.info("🔍 Variáveis de ambiente:");
            log.info("   PGDATA: {}", pb.environment().get("PGDATA"));
            log.info("   PGTZ: {}", pb.environment().get("PGTZ"));
            log.info("   PGSYSCONFDIR: {}", pb.environment().get("PGSYSCONFDIR"));
            log.info("   PGSYSDIR: {}", pb.environment().get("PGSYSDIR"));

            // NÃO redirecionar stderr para stdout - queremos capturar separadamente
            pb.redirectErrorStream(false);

            postgresProcess = pb.start();

            log.info("🚀 Servidor PostgreSQL iniciado (PID: {})", postgresProcess.pid());
        }

        private void waitForServerReady() throws IOException {
            log.info("⏳ Aguardando servidor PostgreSQL ficar pronto...");

            String jdbcUrl = getJdbcUrl();
            int maxAttempts = 15; // 15 segundos (mais rápido)

            for (int attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    // Verificar se processo ainda está rodando
                    if (!postgresProcess.isAlive()) {
                        // Capturar código de saída e logs para diagnóstico
                        int exitCode = postgresProcess.exitValue();
                        String errorDetails = captureProcessOutput();
                        log.error("❌ PostgreSQL parou inesperadamente!");
                        log.error("📊 Código de saída: {}", exitCode);
                        log.error("📝 Saída do processo: {}", errorDetails);
                        log.error("🔍 Diretório de dados: {}", dataDirectory);
                        log.error("🔍 Binários: {}", binariesDirectory);
                        log.error("🔍 Porta: {}", postgresPort);
                        throw new IOException("Processo PostgreSQL parou inesperadamente (código: " + exitCode + ")");
                    }

                    Connection conn = DriverManager.getConnection(jdbcUrl, POSTGRES_USER, "");
                    conn.close();
                    log.info("✅ Servidor pronto após {} tentativas", attempt);
                    return;
                } catch (SQLException e) {
                    log.debug("Tentativa {}/{} - Aguardando PostgreSQL: {}", attempt, maxAttempts, e.getMessage());

                    if (attempt == maxAttempts) {
                        throw new IOException(
                                "Servidor não ficou pronto após " + maxAttempts + " tentativas. URL: " + jdbcUrl, e);
                    }

                    try {
                        Thread.sleep(1000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new IOException("Interrompido aguardando servidor", ie);
                    }
                }
            }
        }

        private void testPostgresExecutable(Path postgresExe) throws IOException {
            log.info("🧪 Testando executável PostgreSQL...");

            try {
                // Testar postgres --version
                ProcessBuilder versionTest = new ProcessBuilder(postgresExe.toString(), "--version");
                versionTest.environment().put("PATH", binariesDirectory.toString() + ";" + System.getenv("PATH"));

                Process versionProcess = versionTest.start();
                boolean finished = versionProcess.waitFor(5, TimeUnit.SECONDS);

                if (finished && versionProcess.exitValue() == 0) {
                    // Capturar versão
                    try (var reader = new java.io.BufferedReader(
                            new java.io.InputStreamReader(versionProcess.getInputStream()))) {
                        String version = reader.readLine();
                        log.info("✅ PostgreSQL versão: {}", version);
                    }
                } else {
                    log.error("❌ Falha no teste de versão do PostgreSQL (código: {})", versionProcess.exitValue());
                    // Capturar erro
                    try (var reader = new java.io.BufferedReader(
                            new java.io.InputStreamReader(versionProcess.getErrorStream()))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            log.error("  STDERR: {}", line);
                        }
                    }
                    throw new IOException("PostgreSQL executável falhou no teste de versão");
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Teste de PostgreSQL interrompido", e);
            }
        }

        private String captureProcessOutput() {
            StringBuilder output = new StringBuilder();

            try {
                if (postgresProcess != null) {
                    output.append("Código de saída: ").append(postgresProcess.exitValue()).append("\n");

                    // Capturar stdout
                    try (var stdout = postgresProcess.getInputStream();
                            var reader = new java.io.BufferedReader(new java.io.InputStreamReader(stdout))) {
                        String line;
                        output.append("STDOUT:\n");
                        while ((line = reader.readLine()) != null) {
                            output.append("  ").append(line).append("\n");
                        }
                    }

                    // Capturar stderr
                    try (var stderr = postgresProcess.getErrorStream();
                            var reader = new java.io.BufferedReader(new java.io.InputStreamReader(stderr))) {
                        String line;
                        output.append("STDERR:\n");
                        while ((line = reader.readLine()) != null) {
                            output.append("  ").append(line).append("\n");
                        }
                    }
                }
            } catch (Exception e) {
                output.append("Erro ao capturar saída: ").append(e.getMessage());
            }

            return output.toString();
        }

        public String getJdbcUrl() {
            return "jdbc:postgresql://localhost:" + postgresPort + "/" + POSTGRES_DB;
        }

        public int getPort() {
            return postgresPort;
        }

        public void shutdown() {
            log.info("🛑 Encerrando PostgreSQL nativo...");

            if (postgresProcess != null && postgresProcess.isAlive()) {
                postgresProcess.destroy();

                try {
                    boolean finished = postgresProcess.waitFor(10, TimeUnit.SECONDS);
                    if (!finished) {
                        log.warn("⚠️ Forçando encerramento do PostgreSQL");
                        postgresProcess.destroyForcibly();
                    }
                    log.info("✅ PostgreSQL encerrado");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    log.warn("⚠️ Interrompido durante encerramento");
                }
            }
        }
    }
}
