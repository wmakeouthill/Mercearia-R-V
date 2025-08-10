package com.example.backendspring.config;

import com.example.backendspring.config.props.CorsProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.Arrays;

@Configuration
public class CorsConfig {

    @Bean
    public CorsFilter corsFilter(CorsProperties props) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowCredentials(props.isAllowCredentials());
        if ("*".equals(props.getAllowedOrigins())) {
            config.setAllowedOriginPatterns(Arrays.asList("*"));
        } else {
            config.setAllowedOrigins(Arrays.asList(props.getAllowedOrigins().split(",")));
        }
        config.setAllowedMethods(Arrays.asList(props.getAllowedMethods().split(",")));
        config.setAllowedHeaders(Arrays.asList(props.getAllowedHeaders().split(",")));
        config.setExposedHeaders(Arrays.asList(props.getExposedHeaders().split(",")));
        config.setMaxAge(props.getMaxAge());

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return new CorsFilter(source);
    }
}
