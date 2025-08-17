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
    private static final String FORWARD_INDEX = "forward:/app/index.html";

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
        registry.addViewController("/").setViewName(FORWARD_INDEX);
        registry.addViewController("/app/").setViewName(FORWARD_INDEX);
        // Encaminhar rotas do SPA (ex: /app/login, /app/dashboard) para index.html
        // Excetua arquivos com extensão (png, js, css, etc.) usando regex
        registry.addViewController("/app/{path:[^\\.]*}").setViewName(FORWARD_INDEX);
        // The fallback for deeper SPA routes under /app/** is handled by
        // FrontendFallbackController to avoid invalid path patterns with the
        // PathPattern parser (see FrontendFallbackController.forwardAppPaths).
    }
}
