package com.example.backendspring;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class BackendSpringApplication {
    public static void main(String[] args) {
        SpringApplication.run(BackendSpringApplication.class, args);
    }
}
