package com.example.backendspring.config;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import jakarta.servlet.http.HttpServletRequest;

/**
 * Fallback controller to support SPA deep links under /app/** by forwarding
 * non-file requests to the frontend index.html.
 */
@Controller
public class FrontendFallbackController {

    @GetMapping("/app/**")
    public String forwardAppPaths(HttpServletRequest request) {
        String path = request.getRequestURI();
        // If the path contains a dot, treat it as a file (leave to resource handler)
        if (path != null && path.contains(".")) {
            return null; // let Spring try to resolve static resource
        }
        return "forward:/app/index.html";
    }
}
