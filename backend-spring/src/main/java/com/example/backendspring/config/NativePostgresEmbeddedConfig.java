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

            // 5. Configurar estrutura de diretórios (simplificada)
            setupPostgresDirectoryStructure();

            // 6. Iniciar servidor PostgreSQL
            startPostgresServer();

            // 7. Aguardar servidor ficar pronto
            waitForServerReady();

            log.info("✅ PostgreSQL nativo iniciado com sucesso na porta {}", postgresPort);
        }

        private void findLocalPostgresBinaries() throws IOException {
            // Usar distribuição completa do PostgreSQL em pgsql/bin/
            binariesDirectory = Paths.get(PGSQL_DIR, "bin").toAbsolutePath();

            // Se não existir, tentar pasta pg/win como fallback
            if (!Files.exists(binariesDirectory.resolve(POSTGRES_EXE))) {
                binariesDirectory = Paths.get("pg", "win").toAbsolutePath();

                if (!Files.exists(binariesDirectory.resolve(POSTGRES_EXE))) {
                    throw new IOException("❌ postgres.exe não encontrado nem em pgsql/bin nem em pg/win");
                }
            }

            log.info("✅ Binários PostgreSQL encontrados: {}", binariesDirectory);

            // Verificação rápida apenas dos arquivos críticos para pg/win
            if (!binariesDirectory.toString().contains(PGSQL_DIR)) {
                Path shareDir = binariesDirectory.resolve(SHARE_DIR);
                if (!Files.exists(shareDir)) {
                    throw new IOException("❌ Diretório share não encontrado: " + shareDir);
                }
                log.debug("✅ Diretório share verificado");
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

        private void setupPostgresDirectoryStructure() {
            try {
                // Configuração simplificada apenas para pg/win (evita operações custosas)
                if (!binariesDirectory.toString().contains(PGSQL_DIR)) {
                    log.debug("� Configurando estrutura de diretórios para pg/win...");

                    // Apenas verificar se o diretório share existe
                    Path shareDir = binariesDirectory.resolve(SHARE_DIR);
                    if (!Files.exists(shareDir)) {
                        throw new IOException("❌ Diretório share não encontrado: " + shareDir);
                    }
                    log.debug("✅ Diretório share OK: {}", shareDir);
                }
            } catch (Exception e) {
                log.warn("⚠️ Falha ao configurar estrutura de diretórios: {}", e.getMessage());
            }
        }

        private void startPostgresServer() throws IOException {
            log.info("🔥 Iniciando servidor PostgreSQL...");

            Path postgresExe = binariesDirectory.resolve(POSTGRES_EXE);

            // Teste rápido apenas se executável existe e é válido
            if (!Files.exists(postgresExe) || !Files.isExecutable(postgresExe)) {
                throw new IOException("❌ postgres.exe não encontrado ou não executável: " + postgresExe);
            }

            List<String> postgresCommand = new ArrayList<>();
            postgresCommand.add(postgresExe.toString());
            postgresCommand.add("-D");
            postgresCommand.add(dataDirectory.toString());
            postgresCommand.add("-p");
            postgresCommand.add(String.valueOf(postgresPort));
            postgresCommand.add("-F"); // Don't run in background

            postgresCommand.add("-c");
            postgresCommand.add("logging_collector=off");
            postgresCommand.add("-c");
            postgresCommand.add("shared_preload_libraries=");
            postgresCommand.add("-c");
            postgresCommand.add("dynamic_shared_memory_type=windows");
            postgresCommand.add("-c");
            postgresCommand.add("log_timezone=UTC");
            postgresCommand.add("-c");
            postgresCommand.add("timezone=UTC");

            ProcessBuilder pb = new ProcessBuilder(postgresCommand);

            // Configurar variáveis de ambiente essenciais para PostgreSQL
            pb.environment().put("PATH", binariesDirectory.toString() + ";" + System.getenv("PATH"));
            pb.environment().put("PGDATA", dataDirectory.toString());
            pb.environment().put("PGTZ", "UTC"); // Força timezone UTC para evitar erro

            // 🔧 SOLUÇÃO: Forçar PostgreSQL a usar APENAS os diretórios pg/win
            if (!binariesDirectory.toString().contains(PGSQL_DIR)) {
                Path shareDir = binariesDirectory.resolve(SHARE_DIR);

                // Configurar todos os caminhos para pg/win
                pb.environment().put("PGSYSCONFDIR", shareDir.toString());
                pb.environment().put("PGSYSDIR", shareDir.toString());
                pb.environment().put("PGSHARE", shareDir.toString());

                // Forçar lib paths para procurar na pasta pg/win
                pb.environment().put("PGLIBDIR", binariesDirectory.toString());
                pb.environment().put("PGLIB", binariesDirectory.toString());

                // Definir PostgreSQL installation root como pg/win parent
                Path pgRoot = binariesDirectory.getParent(); // pg/win -> pg
                pb.environment().put("PGHOME", pgRoot.toString());
                pb.environment().put("POSTGRES_HOME", pgRoot.toString());

                // Configurar working directory como binariesDirectory
                pb.directory(binariesDirectory.toFile());

                log.debug("🔧 Configurado para usar APENAS pg/win");
            } else {
                // Para distribuição completa, usar configuração padrão
                pb.environment().put("PGSYSDIR", binariesDirectory.resolve(SHARE_DIR).toString());
                log.debug("✅ Usando distribuição completa do PostgreSQL");
            }

            // NÃO redirecionar stderr para stdout - queremos capturar separadamente
            pb.redirectErrorStream(false);

            postgresProcess = pb.start();

            log.info("🚀 Servidor PostgreSQL iniciado (PID: {})", postgresProcess.pid());
        }

        private void waitForServerReady() throws IOException {
            log.info("⏳ Aguardando servidor PostgreSQL ficar pronto...");

            String jdbcUrl = getJdbcUrl();
            int maxAttempts = 10; // Reduzido para 10 segundos (mais rápido)

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
