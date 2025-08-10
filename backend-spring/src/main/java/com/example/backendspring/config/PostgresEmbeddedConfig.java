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
        // Persistência local: usa pasta fixa no projeto
        Path dataDir = Paths.get("backend-spring", "data", "pg").toAbsolutePath();
        try {
            Files.createDirectories(dataDir);
        } catch (IOException ignored) {
            // Diretório pode já existir ou não ser criável agora. Continuamos e deixamos o
            // EmbeddedPostgres falhar se for realmente um problema.
            log.debug("Ignorando falha ao garantir diretório {}: {}", dataDir, ignored.getMessage());
        }
        return EmbeddedPostgres.builder()
                .setDataDirectory(dataDir)
                .setCleanDataDirectory(false)
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
