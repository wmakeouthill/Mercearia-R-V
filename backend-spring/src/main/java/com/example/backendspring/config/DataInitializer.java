package com.example.backendspring.config;

import com.example.backendspring.user.User;
import com.example.backendspring.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.core.io.FileSystemResource;
import javax.sql.DataSource;

@Configuration
@RequiredArgsConstructor
public class DataInitializer {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    private final PasswordEncoder passwordEncoder;
    private final UserRepository userRepository;
    private final DataSource dataSource;

    private static final String ROLE_ADMIN = "admin";
    private static final String ROLE_USER = "user";

    @Value("${spring.datasource.url:}")
    private String configuredUrl;

    // Executa após a aplicação estar pronta (garante que o DB e migrations já
    // rodaram)
    @EventListener(ApplicationReadyEvent.class)
    public void initUsersAfterReady() {
        // Se explicitamente pedido para não inicializar, respeita
        String skipEnv = System.getenv("SKIP_DB_INIT");
        if (skipEnv != null && skipEnv.equalsIgnoreCase("true")) {
            log.info("SKIP_DB_INIT=true -> pulando inicialização automática de usuários");
            return;
        }

        // Se existe uma URL externa configurada, assumimos que o DB local é a fonte de
        // verdade
        // e não devemos inserir dados automaticamente
        if (configuredUrl != null && !configuredUrl.isBlank()) {
            log.info("spring.datasource.url está configurada ({}). Pulando seed de usuários.", configuredUrl);
            return;
        }

        // Se existir um dump SQL empacotado, tentamos aplicá-lo (dados somente)
        try {
            if (applyDumpIfPresent()) {
                return; // dump aplicado com sucesso
            }
        } catch (Exception e) {
            log.warn("Falha ao aplicar dump SQL: {}. Continuando com seed mínimo.", e.getMessage());
        }

        if (this.userRepository.findByUsername(ROLE_ADMIN).isEmpty()) {
            String adminPass = System.getenv().getOrDefault("DEFAULT_ADMIN_PASSWORD", "admin123");
            this.userRepository.save(User.builder()
                    .username(ROLE_ADMIN)
                    .password(passwordEncoder.encode(adminPass))
                    .role(ROLE_ADMIN)
                    .podeControlarCaixa(true)
                    .build());
            log.info("Usuário admin criado (username={})", ROLE_ADMIN);
        }
        if (this.userRepository.findByUsername(ROLE_USER).isEmpty()) {
            String userPass = System.getenv().getOrDefault("DEFAULT_USER_PASSWORD", "user123");
            this.userRepository.save(User.builder()
                    .username(ROLE_USER)
                    .password(passwordEncoder.encode(userPass))
                    .role(ROLE_USER)
                    .podeControlarCaixa(false)
                    .build());
            log.info("Usuário padrão criado (username={})", ROLE_USER);
        }
    }

    /**
     * Se existir `db/dump_data.sql` tenta aplicá-lo. Retorna true se foi aplicado.
     */
    private boolean applyDumpIfPresent() {
        java.nio.file.Path dumpPath = java.nio.file.Paths.get("db", "dump_data.sql").toAbsolutePath();
        if (!java.nio.file.Files.exists(dumpPath)) {
            return false;
        }
        log.info("Dump SQL encontrado em {}. Aplicando dados via ResourceDatabasePopulator...", dumpPath);
        java.nio.file.Path targetPath = dumpPath;
        java.nio.file.Path temp = null;
        try {
            java.util.List<String> lines = java.nio.file.Files.readAllLines(dumpPath);
            boolean hasPsqlCommands = lines.stream().anyMatch(l -> l.trim().startsWith("\\"));
            if (hasPsqlCommands) {
                log.info("Detectados comandos psql no dump. Gerando versão sanitizada temporária para aplicação...");
                temp = java.nio.file.Files.createTempFile("dump_sanitized", ".sql");
                try (java.io.BufferedWriter w = java.nio.file.Files.newBufferedWriter(temp)) {
                    for (String l : lines) {
                        if (l.trim().startsWith("\\"))
                            continue; // pular linhas psql meta-commands
                        w.write(l);
                        w.newLine();
                    }
                }
                targetPath = temp;
            }

            ResourceDatabasePopulator pop = new ResourceDatabasePopulator();
            pop.addScript(new FileSystemResource(targetPath.toFile()));
            pop.setContinueOnError(false);
            pop.execute(dataSource);
            log.info("Dump SQL aplicado com sucesso.");
            return true;
        } catch (Exception ex) {
            log.warn("Falha ao aplicar dump SQL: {}. Continuando com seed mínimo.", ex.getMessage());
            return false;
        } finally {
            if (temp != null) {
                try {
                    java.nio.file.Files.deleteIfExists(temp);
                } catch (Exception e) {
                    log.debug("Falha ao remover temp dump: {}", e.getMessage());
                }
            }
        }
    }

}
