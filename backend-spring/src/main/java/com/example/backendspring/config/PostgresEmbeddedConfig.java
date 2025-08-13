package com.example.backendspring.config;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import org.springframework.jdbc.datasource.SimpleDriverDataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

@Configuration
public class PostgresEmbeddedConfig {

    private static final Logger log = LoggerFactory.getLogger(PostgresEmbeddedConfig.class);
    private static final String POSTGRES_USER = "postgres";
    private static final String POSTGRES_DB = "postgres";
    private static final String TEMP_DIR_PREFIX = "embedded-pg-";

    @Value("${spring.datasource.url}")
    private String configuredUrl;

    @Value("${spring.datasource.username}")
    private String configuredUser;

    @Value("${spring.datasource.password}")
    private String configuredPass;

    @Bean(destroyMethod = "close")
    public EmbeddedPostgres embeddedPostgres() throws IOException {
        boolean persist = shouldPersistData();
        Path dataDir = resolveInitialDataDirectory(persist);
        log.info("Embedded Postgres data directory: {} (persist={})", dataDir, persist);
        return startEmbeddedPostgresWithRetries(dataDir, persist, 3);
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
        try {
            log.warn("Lock do Postgres encontrado em {}. Tentando remover lock obsoleto...", lockFile);
            Files.deleteIfExists(lockFile);
            log.info("Lock removido com sucesso. Prosseguindo com diretório persistente.");
            return true;
        } catch (IOException e) {
            log.warn("Falha ao remover lock {} ({}). Será usado diretório temporário nesta execução.", lockFile,
                    e.getMessage());
            return false;
        }
    }

    private Path createTempDataDirectory() throws IOException {
        return Files.createTempDirectory(TEMP_DIR_PREFIX);
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
                try {
                    dataDir = createTempDataDirectory();
                    log.info("Usando diretório temporário para próxima tentativa: {}", dataDir);
                } catch (IOException ioe) {
                    log.warn("Não foi possível criar diretório temporário para próxima tentativa: {}",
                            ioe.getMessage());
                }
                try {
                    Thread.sleep(1500);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }
        }
        throw lastError != null ? lastError : new IOException("Falha desconhecida ao iniciar Embedded Postgres");
    }

    @Bean
    public DataSource dataSource(EmbeddedPostgres pg) {
        // Se variáveis de ambiente/arquivo definirem URL, usa elas; senão, usa embedded
        if (configuredUrl != null && !configuredUrl.isBlank()) {
            return new SimpleDriverDataSource(new org.postgresql.Driver(), configuredUrl, configuredUser,
                    configuredPass);
        }
        String url = pg.getJdbcUrl(POSTGRES_DB, POSTGRES_USER);
        return new SimpleDriverDataSource(new org.postgresql.Driver(), url, POSTGRES_USER, "");
    }
}
