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
import java.io.File;
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

            // 4.5. Configurar permissões e estratégia anti-admin
            setupAdminWorkaround();

            // 4.6. Criar estrutura de diretórios esperada pelo PostgreSQL
            setupPostgresDirectoryStructure();

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

        private void setupAdminWorkaround() {
            // Detectar se está executando como administrador e configurar workarounds
            boolean isAdmin = isRunningAsAdministrator();
            if (isAdmin) {
                log.warn("⚠️ Executando como administrador! Configurando workarounds...");

                // Ajustar permissões do diretório de dados
                adjustDataDirectoryPermissions();
            } else {
                log.info("✅ Executando como usuário normal");
            }
        }

        private void adjustDataDirectoryPermissions() {
            try {
                // Ajustar permissões do diretório de dados para todos os usuários
                File dataDir = dataDirectory.toFile();
                if (dataDir.exists()) {
                    boolean readable = dataDir.setReadable(true, false);
                    boolean writable = dataDir.setWritable(true, false);
                    boolean executable = dataDir.setExecutable(true, false);

                    log.info("📁 Permissões ajustadas - R:{} W:{} X:{}", readable, writable, executable);
                }
            } catch (Exception e) {
                log.debug("Erro ao ajustar permissões: {}", e.getMessage());
            }
        }

        private void setupPostgresDirectoryStructure() {
            try {
                // 🔧 SOLUÇÃO: Garantir que PostgreSQL encontre todos os diretórios necessários
                if (!binariesDirectory.toString().contains(PGSQL_DIR)) {
                    log.info("🔧 Configurando estrutura de diretórios para pg/win...");

                    Path pgRoot = binariesDirectory.getParent(); // pg/win -> pg

                    // Criar diretório 'lib' se não existir (PostgreSQL procura por /lib)
                    Path libDir = pgRoot.resolve("lib");
                    if (!Files.exists(libDir)) {
                        Files.createDirectories(libDir);
                        log.info("📁 Criado diretório lib: {}", libDir);

                        // Copiar DLLs essenciais para lib/
                        String[] essentialDlls = { "libpq.dll", "vcruntime140.dll", "msvcp140.dll" };
                        for (String dll : essentialDlls) {
                            Path sourceDll = binariesDirectory.resolve(dll);
                            Path targetDll = libDir.resolve(dll);
                            if (Files.exists(sourceDll) && !Files.exists(targetDll)) {
                                try {
                                    Files.copy(sourceDll, targetDll);
                                    log.debug("📋 Copiado: {}", dll);
                                } catch (Exception e) {
                                    log.debug("⚠️ Falha ao copiar {}: {}", dll, e.getMessage());
                                }
                            }
                        }
                    }

                    // 🎯 SOLUÇÃO PRINCIPAL: Criar estrutura completa que PostgreSQL espera
                    // PostgreSQL procura por /lib, /share, etc. relativos ao working directory

                    // Criar /lib relativo ao working directory (binariesDirectory)
                    Path workingLibDir = binariesDirectory.resolve("lib");
                    if (!Files.exists(workingLibDir)) {
                        Files.createDirectories(workingLibDir);
                        log.info("📁 Criado working lib: {}", workingLibDir);

                        // Copiar todas as DLLs para o lib do working directory
                        try {
                            Files.walk(binariesDirectory)
                                    .filter(p -> p.toString().endsWith(".dll"))
                                    .forEach(dll -> {
                                        try {
                                            Path targetDll = workingLibDir.resolve(dll.getFileName());
                                            if (!Files.exists(targetDll)) {
                                                Files.copy(dll, targetDll);
                                                log.debug("📋 Copiado para working lib: {}", dll.getFileName());
                                            }
                                        } catch (Exception e) {
                                            log.debug("⚠️ Falha ao copiar DLL: {}", e.getMessage());
                                        }
                                    });
                        } catch (Exception e) {
                            log.warn("⚠️ Erro ao copiar DLLs para working lib: {}", e.getMessage());
                        }
                    }

                    // 🎯 SOLUÇÃO CRÍTICA: Criar diretório /lib absoluto que PostgreSQL procura
                    // PostgreSQL no Windows às vezes procura por C:/lib ou /lib dependendo do
                    // contexto
                    try {
                        // Tentar criar na raiz do disco atual
                        Path diskRoot = Paths.get(System.getProperty("user.dir")).getRoot();
                        Path absoluteLibDir = diskRoot.resolve("lib");

                        if (!Files.exists(absoluteLibDir)) {
                            try {
                                Files.createDirectories(absoluteLibDir);
                                log.info("📁 Criado lib absoluto: {}", absoluteLibDir);

                                // Copiar DLLs essenciais para o diretório absoluto
                                String[] criticalDlls = { "libpq.dll", "postgres.exe" };
                                for (String dll : criticalDlls) {
                                    Path sourceDll = binariesDirectory.resolve(dll);
                                    if (Files.exists(sourceDll)) {
                                        Path targetDll = absoluteLibDir.resolve(dll);
                                        if (!Files.exists(targetDll)) {
                                            Files.copy(sourceDll, targetDll);
                                            log.debug("📋 Copiado para lib absoluto: {}", dll);
                                        }
                                    }
                                }
                            } catch (Exception e) {
                                log.debug("⚠️ Não foi possível criar lib absoluto: {}", e.getMessage());
                            }
                        }
                    } catch (Exception e) {
                        log.debug("⚠️ Erro ao criar estrutura lib absoluta: {}", e.getMessage());
                    }

                    // 🎯 SOLUÇÃO CRÍTICA: Criar diretório /share absoluto que PostgreSQL procura
                    // PostgreSQL procura por /share/timezone, /share/timezonesets, etc.
                    try {
                        Path diskRoot = Paths.get(System.getProperty("user.dir")).getRoot();
                        Path absoluteShareDir = diskRoot.resolve("share");
                        Path sourceShareDir = binariesDirectory.resolve(SHARE_DIR);

                        if (!Files.exists(absoluteShareDir) && Files.exists(sourceShareDir)) {
                            try {
                                Files.createDirectories(absoluteShareDir);
                                log.info("📁 Criado share absoluto: {}", absoluteShareDir);

                                // Copiar diretórios essenciais do share
                                String[] criticalDirs = { "timezone", "timezonesets", "locale" };
                                for (String dir : criticalDirs) {
                                    Path sourceDir = sourceShareDir.resolve(dir);
                                    Path targetDir = absoluteShareDir.resolve(dir);
                                    if (Files.exists(sourceDir) && !Files.exists(targetDir)) {
                                        try {
                                            copyDirectory(sourceDir, targetDir);
                                            log.debug("📋 Copiado diretório share: {}", dir);
                                        } catch (Exception e) {
                                            log.debug("⚠️ Falha ao copiar {}: {}", dir, e.getMessage());
                                        }
                                    }
                                }

                                // Copiar arquivos essenciais do share
                                String[] criticalFiles = { "postgres.bki", "postgresql.conf.sample" };
                                for (String file : criticalFiles) {
                                    Path sourceFile = sourceShareDir.resolve(file);
                                    Path targetFile = absoluteShareDir.resolve(file);
                                    if (Files.exists(sourceFile) && !Files.exists(targetFile)) {
                                        try {
                                            Files.copy(sourceFile, targetFile);
                                            log.debug("📋 Copiado arquivo share: {}", file);
                                        } catch (Exception e) {
                                            log.debug("⚠️ Falha ao copiar {}: {}", file, e.getMessage());
                                        }
                                    }
                                }
                            } catch (Exception e) {
                                log.debug("⚠️ Não foi possível criar share absoluto: {}", e.getMessage());
                            }
                        }
                    } catch (Exception e) {
                        log.debug("⚠️ Erro ao criar estrutura share absoluta: {}", e.getMessage());
                    }

                    // Verificar se share existe
                    Path shareDir = binariesDirectory.resolve(SHARE_DIR);
                    if (!Files.exists(shareDir)) {
                        log.warn("❌ Diretório share não encontrado: {}", shareDir);
                    } else {
                        log.info("✅ Diretório share OK: {}", shareDir);
                    }
                }
            } catch (Exception e) {
                log.warn("⚠️ Falha ao configurar estrutura de diretórios: {}", e.getMessage());
            }
        }

        /**
         * Método helper para copiar diretórios recursivamente
         */
        private void copyDirectory(Path source, Path target) throws IOException {
            Files.walk(source)
                    .forEach(sourcePath -> {
                        try {
                            Path targetPath = target.resolve(source.relativize(sourcePath));
                            if (Files.isDirectory(sourcePath)) {
                                Files.createDirectories(targetPath);
                            } else {
                                Files.copy(sourcePath, targetPath);
                            }
                        } catch (IOException e) {
                            log.debug("⚠️ Erro ao copiar {}: {}", sourcePath, e.getMessage());
                        }
                    });
        }

        private void startPostgresServer() throws IOException {
            log.info("🔥 Iniciando servidor PostgreSQL...");

            Path postgresExe = binariesDirectory.resolve(POSTGRES_EXE);

            // Detectar se está executando como administrador
            boolean isRunningAsAdmin = isRunningAsAdministrator();
            log.info("🔍 Executando como administrador: {}", isRunningAsAdmin);

            // Primeiro, testar se o PostgreSQL consegue mostrar a versão
            testPostgresExecutable(postgresExe);

            List<String> postgresCommand = new ArrayList<>();

            if (isRunningAsAdmin) {
                // SOLUÇÃO 1: Tentar usar pg_ctl que pode ser mais permissivo
                log.info("🔧 Tentando usar pg_ctl para contornar restrições de administrador...");
                Path pgCtlExe = binariesDirectory.resolve("pg_ctl.exe");
                if (Files.exists(pgCtlExe)) {
                    postgresCommand.add(pgCtlExe.toString());
                    postgresCommand.add("start");
                    postgresCommand.add("-D");
                    postgresCommand.add(dataDirectory.toString());
                    postgresCommand.add("-o");
                    postgresCommand.add("-p " + postgresPort
                            + " -c logging_collector=off -c shared_preload_libraries= -c dynamic_shared_memory_type=windows -c log_timezone=UTC -c timezone=UTC");
                    postgresCommand.add("-w"); // Wait for startup
                } else {
                    // SOLUÇÃO 2: Usar postgres diretamente mas sem superuser
                    log.warn("⚠️ pg_ctl não encontrado, tentando postgres diretamente...");
                    postgresCommand.add(postgresExe.toString());
                    postgresCommand.add("-D");
                    postgresCommand.add(dataDirectory.toString());
                    postgresCommand.add("-p");
                    postgresCommand.add(String.valueOf(postgresPort));
                    postgresCommand.add("-F"); // Don't run in background
                    // Remover --allow-superuser para evitar erro de administrador
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
                }
            } else {
                // Execução normal se não for administrador
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
            }

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

                log.info("🔧 Configurado para usar APENAS pg/win:");
                log.info("   PGSYSCONFDIR: {}", shareDir);
                log.info("   PGLIBDIR: {}", binariesDirectory);
                log.info("   PGHOME: {}", pgRoot);
                log.info("   Working Directory: {}", binariesDirectory);
            } else {
                // Para distribuição completa, usar configuração padrão
                pb.environment().put("PGSYSDIR", binariesDirectory.resolve(SHARE_DIR).toString());
                log.info("✅ Usando distribuição completa do PostgreSQL");
            } // Log das configurações para diagnóstico
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

        /**
         * Detecta se o processo atual está sendo executado com privilégios
         * administrativos
         */
        private boolean isRunningAsAdministrator() {
            try {
                // Tentar criar um arquivo temporário em C:\ (requer admin)
                Path tempFile = Paths.get("C:\\", "temp_admin_test_" + System.currentTimeMillis() + ".tmp");
                Files.createFile(tempFile);
                Files.deleteIfExists(tempFile);
                log.debug("🔍 Teste de administrador: POSITIVO (conseguiu criar arquivo em C:\\)");
                return true;
            } catch (Exception e) {
                // Se falhou, provavelmente não é administrador
                log.debug("🔍 Teste de administrador: NEGATIVO ({})", e.getMessage());
                return false;
            }
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
