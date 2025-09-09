package com.example.backendspring;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@SpringBootApplication
@ConfigurationPropertiesScan
@EntityScan("com.example.backendspring")
@EnableJpaRepositories("com.example.backendspring")
public class BackendSpringApplication {
    public static void main(String[] args) {
        SpringApplication.run(BackendSpringApplication.class, args);
    }
}
