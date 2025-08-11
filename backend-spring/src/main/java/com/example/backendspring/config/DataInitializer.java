package com.example.backendspring.config;

import com.example.backendspring.user.User;
import com.example.backendspring.user.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
@RequiredArgsConstructor
public class DataInitializer {

    private final PasswordEncoder passwordEncoder;

    private static final String ROLE_ADMIN = "admin";
    private static final String ROLE_USER = "user";

    // Senhas padrão para desenvolvimento quando variáveis de ambiente não estiverem
    // definidas

    @Bean
    CommandLineRunner initUsers(UserRepository userRepository) {
        return args -> {
            if (userRepository.findByUsername(ROLE_ADMIN).isEmpty()) {
                String adminPass = System.getenv().getOrDefault("DEFAULT_ADMIN_PASSWORD", "admin123");
                userRepository.save(User.builder()
                        .username(ROLE_ADMIN)
                        .password(passwordEncoder.encode(adminPass))
                        .role(ROLE_ADMIN)
                        .podeControlarCaixa(true)
                        .build());
            }
            if (userRepository.findByUsername(ROLE_USER).isEmpty()) {
                String userPass = System.getenv().getOrDefault("DEFAULT_USER_PASSWORD", "user123");
                userRepository.save(User.builder()
                        .username(ROLE_USER)
                        .password(passwordEncoder.encode(userPass))
                        .role(ROLE_USER)
                        .podeControlarCaixa(false)
                        .build());
            }
        };
    }
}
