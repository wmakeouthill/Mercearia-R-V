package com.example.backendspring.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;
import java.nio.file.*;

@Configuration
public class UploadsInitializer {

    private static final Logger log = LoggerFactory.getLogger(UploadsInitializer.class);
    private static final String DEFAULT_IMAGE = "padrao.png";
    private static final String UPLOADS_DIR = "uploads";
    private static final String PRODUTOS_DIR = "produtos";

    @Bean
    CommandLineRunner ensureUploadsFolder() {
        return args -> {
            Path dir = Paths.get(UPLOADS_DIR, PRODUTOS_DIR);
            ensureDirectory(dir);
            ensureDefaultImage(dir);
        };
    }

    private void ensureDirectory(Path dir) {
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            log.warn("Falha ao criar diretório de uploads: {}", e.getMessage());
        }
    }

    private void ensureDefaultImage(Path dir) {
        Path defaultTarget = dir.resolve(DEFAULT_IMAGE);
        if (Files.exists(defaultTarget)) {
            return;
        }
        for (Path candidate : defaultImageCandidates()) {
            if (Files.exists(candidate)) {
                try {
                    Files.copy(candidate, defaultTarget, StandardCopyOption.REPLACE_EXISTING);
                } catch (IOException e) {
                    log.warn("Falha ao copiar imagem padrão: {}", e.getMessage());
                }
                return;
            }
        }
    }

    private Path[] defaultImageCandidates() {
        return new Path[] {
                Paths.get("backend", UPLOADS_DIR, PRODUTOS_DIR, DEFAULT_IMAGE),
                Paths.get("frontend", "src", "shared", DEFAULT_IMAGE),
                Paths.get("frontend", "shared", DEFAULT_IMAGE)
        };
    }
}
