package com.example.backendspring.common;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class ApiController {

    private static final String KEY_MESSAGE = "message";
    private static final String KEY_VERSION = "version";
    private static final String KEY_STATUS = "status";
    private static final String KEY_TIMESTAMP = "timestamp";
    private static final String VERSION_VALUE = "1.0.0";

    @GetMapping("/")
    public Map<String, Object> root() {
        return Map.of(
                KEY_MESSAGE, "Sistema de Gestão de Estoque API",
                KEY_VERSION, VERSION_VALUE,
                KEY_STATUS, "online",
                "environment", "development",
                KEY_TIMESTAMP, java.time.OffsetDateTime.now().toString());
    }

    @GetMapping("/test")
    public Map<String, Object> test() {
        return Map.of(
                KEY_STATUS, "ok",
                KEY_MESSAGE, "Backend está funcionando!",
                KEY_TIMESTAMP, java.time.OffsetDateTime.now().toString());
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                KEY_STATUS, "healthy",
                KEY_TIMESTAMP, java.time.OffsetDateTime.now().toString(),
                KEY_VERSION, VERSION_VALUE);
    }

    @GetMapping("/api")
    public Map<String, Object> api() {
        return Map.of(
                KEY_MESSAGE, "Sistema de Gestão de Estoque API",
                KEY_VERSION, VERSION_VALUE,
                KEY_STATUS, "online",
                KEY_TIMESTAMP, java.time.OffsetDateTime.now().toString());
    }
}
