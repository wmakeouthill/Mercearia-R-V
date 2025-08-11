package com.example.backendspring.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private static final String ROLE_ADMIN = "ADMIN";
    private static final String PRODUTOS_ALL = "/api/produtos/**";

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtAuthFilter jwtAuthFilter,
            AuthAttributesFilter authAttributesFilter) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.GET, "/health", "/test", "/api", "/api/produtos/imagem/**")
                        .permitAll()
                        .requestMatchers("/api/auth/login").permitAll()
                        .requestMatchers("/api/auth/profile", "/api/auth/me", "/api/auth/change-password")
                        .authenticated()
                        .requestMatchers(HttpMethod.GET, "/api/auth/users").hasRole(ROLE_ADMIN)
                        .requestMatchers(HttpMethod.POST, "/api/auth/users").hasRole(ROLE_ADMIN)
                        .requestMatchers(HttpMethod.PUT, "/api/auth/users/**").hasRole(ROLE_ADMIN)
                        .requestMatchers(HttpMethod.DELETE, "/api/auth/users/**").hasRole(ROLE_ADMIN)
                        .requestMatchers(HttpMethod.POST, "/api/produtos").hasRole(ROLE_ADMIN)
                        .requestMatchers(HttpMethod.PUT, PRODUTOS_ALL).hasRole(ROLE_ADMIN)
                        .requestMatchers(HttpMethod.DELETE, PRODUTOS_ALL).hasRole(ROLE_ADMIN)
                        .requestMatchers(HttpMethod.DELETE, "/api/vendas/**").hasRole(ROLE_ADMIN)
                        .requestMatchers(HttpMethod.PUT, "/api/caixa/horarios").hasRole(ROLE_ADMIN)
                        .requestMatchers(PRODUTOS_ALL, "/api/vendas/**", "/api/caixa/**", "/api/checkout/**")
                        .authenticated()
                        .anyRequest().permitAll())
                .httpBasic(Customizer.withDefaults());
        http.addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        http.addFilterAfter(authAttributesFilter, JwtAuthFilter.class);
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
