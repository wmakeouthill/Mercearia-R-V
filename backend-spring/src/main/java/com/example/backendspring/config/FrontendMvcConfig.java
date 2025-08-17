package com.example.backendspring.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.lang.NonNull;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Configurações para servir os arquivos estáticos do frontend a partir do
 * backend
 * em produção. Mapeia /app/** para possíveis locais (diretório externo durante
 * desenvolvimento/empacotamento ou recursos no classpath quando embutido no
 * JAR).
 */
@Configuration
public class FrontendMvcConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(@NonNull ResourceHandlerRegistry registry) {
        // Priorizar diretório externo 'frontend' (útil em deploys/local), depois
        // classpath
        registry.addResourceHandler("/app/**")
                .addResourceLocations(
                        "file:frontend/",
                        "classpath:/frontend/",
                        "classpath:/static/frontend/",
                        "classpath:/META-INF/resources/frontend/")
                .setCachePeriod(3600);
    }

    @Override
    public void addViewControllers(@NonNull ViewControllerRegistry registry) {
        // Encaminhar raiz / e /app/ para o index do frontend empacotado
        registry.addViewController("/").setViewName("forward:/app/index.html");
        registry.addViewController("/app/").setViewName("forward:/app/index.html");
    }
}
