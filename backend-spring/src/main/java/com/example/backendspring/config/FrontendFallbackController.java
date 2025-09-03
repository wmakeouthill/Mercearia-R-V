package com.example.backendspring.config;

import org.springframework.stereotype.Controller;

/**
 * Fallback controller to support SPA deep links under /app/** by forwarding
 * non-file requests to the frontend index.html.
 */
@Controller
public class FrontendFallbackController {

    // Controller no longer needed because ResourceResolver handles SPA fallback.
    // Keep class present (no mappings) to avoid component-scan surprises or wiring
    // changes.
    // If you prefer, this class can be deleted.
}
