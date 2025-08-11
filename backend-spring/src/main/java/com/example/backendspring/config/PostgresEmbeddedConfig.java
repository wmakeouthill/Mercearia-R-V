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

    @Value("${spring.datasource.url}")
    private String configuredUrl;

    @Value("${spring.datasource.username}")
    private String configuredUser;

    @Value("${spring.datasource.password}")
    private String configuredPass;

    @Bean(destroyMethod = "close")
    public EmbeddedPostgres embeddedPostgres() throws IOException {
        // Em dev, por padrão, usar diretório TEMPORÁRIO único por execução para evitar
        // conflitos de postmaster.pid quando um processo anterior não terminou
        // corretamente.
        // Para persistir dados entre execuções, defina PERSIST_EMBEDDED_PG=true.

        // Persistência por padrão; defina PERSIST_EMBEDDED_PG=false para usar diretório
        // temporário
        boolean persist = !"false".equalsIgnoreCase(System.getenv("PERSIST_EMBEDDED_PG"));

        Path dataDir = null;
        if (persist) {
            // Permitir sobrescrever diretório de dados via variável de ambiente
            // (recomendado em produção)
            String pgDataDirEnv = System.getenv("PG_DATA_DIR");
            Path persistentDir = (pgDataDirEnv != null && !pgDataDirEnv.isBlank())
                    ? Paths.get(pgDataDirEnv).toAbsolutePath()
                    : Paths.get("data", "pg").toAbsolutePath();
            try {
                Files.createDirectories(persistentDir);
            } catch (IOException ignored) {
                log.debug("Ignorando falha ao garantir diretório {}: {}", persistentDir, ignored.getMessage());
            }

            // Se existir lock (postmaster.pid), tentar remover (stale) antes de decidir por
            // fallback
            Path lockFile = persistentDir.resolve("postmaster.pid");
            if (Files.exists(lockFile)) {
                try {
                    log.warn("Lock do Postgres encontrado em {}. Tentando remover lock obsoleto...", lockFile);
                    Files.deleteIfExists(lockFile);
                    log.info("Lock removido com sucesso. Prosseguindo com diretório persistente.");
                } catch (IOException e) {
                    log.warn("Falha ao remover lock {} ({}). Usando diretório temporário nesta execução.", lockFile,
                            e.getMessage());
                    dataDir = Files.createTempDirectory("embedded-pg-");
                }
            }
            if (dataDir == null) {
                dataDir = persistentDir;
            }
        } else {
            dataDir = Files.createTempDirectory("embedded-pg-");
        }

        log.info("Embedded Postgres data directory: {} (persist={})", dataDir, persist);
        return EmbeddedPostgres.builder()
                .setDataDirectory(dataDir)
                .setCleanDataDirectory(!persist)
                .start();
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
