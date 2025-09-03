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
                // Apply security filters only to /api/** to avoid interfering with SPA/static
                // resources
                http.securityMatcher("/api/**")
                                .csrf(csrf -> csrf.disable())
                                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                                .authorizeHttpRequests(auth -> auth
                                                // Permit preflight CORS requests on API
                                                .requestMatchers(HttpMethod.OPTIONS, "/api/**").permitAll()
                                                .requestMatchers(HttpMethod.GET, "/api", "/api/produtos/imagem/**")
                                                .permitAll()
                                                .requestMatchers("/api/auth/login").permitAll()
                                                .requestMatchers("/api/auth/profile", "/api/auth/me",
                                                                "/api/auth/change-password")
                                                .authenticated()
                                                .requestMatchers(HttpMethod.GET, "/api/auth/users").hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.POST, "/api/auth/users").hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.PUT, "/api/auth/users/**")
                                                .hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.DELETE, "/api/auth/users/**")
                                                .hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.POST, "/api/produtos").hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.PUT, PRODUTOS_ALL).hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.DELETE, PRODUTOS_ALL).hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.DELETE, "/api/vendas/**")
                                                .hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.DELETE, "/api/checkout/**")
                                                .hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.GET, "/api/audit/sales").hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.PUT, "/api/audit/**").hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.DELETE, "/api/audit/**").hasRole(ROLE_ADMIN)
                                                .requestMatchers(HttpMethod.PUT, "/api/caixa/horarios")
                                                .hasRole(ROLE_ADMIN)
                                                // Allow public GET access to generated nota PDF so frontend can
                                                // preview/download
                                                .requestMatchers(HttpMethod.GET, "/api/checkout/*/nota").permitAll()
                                                // Keep other checkout operations protected
                                                .requestMatchers(PRODUTOS_ALL, "/api/vendas/**", "/api/caixa/**",
                                                                "/api/checkout/**", "/api/admin/**")
                                                .authenticated()
                                                .anyRequest().authenticated())
                                .httpBasic(Customizer.withDefaults());
                // Allow embedding responses from same origin (needed for PDF preview in
                // <object>)
                http.headers(headers -> headers.frameOptions(frame -> frame.sameOrigin()));

                http.addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
                http.addFilterAfter(authAttributesFilter, JwtAuthFilter.class);
                return http.build();
        }

        @Bean
        public PasswordEncoder passwordEncoder() {
                return new BCryptPasswordEncoder();
        }
}
