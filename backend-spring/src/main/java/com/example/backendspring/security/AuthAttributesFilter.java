package com.example.backendspring.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletRequestWrapper;
import java.util.HashSet;
import java.util.Set;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@Component
public class AuthAttributesFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(AuthAttributesFilter.class);

    private void logRequestWrapperChain(HttpServletRequest request) {
        try {
            ServletRequest cur = request;
            Set<ServletRequest> seen = new HashSet<>();
            int depth = 0;
            while (cur instanceof ServletRequestWrapper wrapper) {
                if (!seen.add(cur)) {
                    log.warn("Detected request wrapper cycle at depth {}: class={}", depth, cur.getClass().getName());
                    return;
                }
                log.debug("wrapper[{}]={}", depth, cur.getClass().getName());
                ServletRequest inner = getInnerSafely(wrapper, depth);
                if (inner == null)
                    return;
                // Defensive: if inner is same as current wrapper, break to avoid infinite loop
                if (inner == cur) {
                    log.warn("Detected wrapper self-reference at depth {}: class={}", depth, cur.getClass().getName());
                    return;
                }
                cur = inner;
                depth++;
                if (depth > 50) {
                    log.warn("Wrapper chain too deep (>{}) - stopping log", 50);
                    return;
                }
            }
            log.debug("final request class={}", cur.getClass().getName());
        } catch (Exception t) {
            // Log and handle: warn-level because this is unexpected and we want to surface
            // it in logs
            log.warn("error while logging wrapper chain", t);
        }
    }

    /**
     * Safely obtain the inner request from a ServletRequestWrapper.
     * Extracted to avoid nested try/catch and to catch only Exception (not
     * Throwable).
     * Returns null when inner request cannot be obtained (and logs a warning).
     */
    private ServletRequest getInnerSafely(ServletRequestWrapper wrapper, int depth) {
        try {
            return wrapper.getRequest();
        } catch (Exception e) {
            log.warn("Error while accessing inner request of wrapper at depth {}: {}", depth, e.toString());
            return null;
        }
    }

    @Override
    @SuppressWarnings("squid:S2139")
    // Suppress Sonar S2139: we intentionally catch StackOverflowError to wrap it
    // with ServletException
    // providing contextual information for higher layers and logs.
    protected void doFilterInternal(@org.springframework.lang.NonNull HttpServletRequest request,
            @org.springframework.lang.NonNull HttpServletResponse response,
            @org.springframework.lang.NonNull FilterChain filterChain)
            throws ServletException, IOException {
        log.debug("enter AuthAttributesFilter for {}", request.getRequestURI());
        logRequestWrapperChain(request);
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getDetails() instanceof Long id) {
            request.setAttribute("userId", id);
        }
        try {
            filterChain.doFilter(request, response);
        } catch (StackOverflowError soe) {
            log.error("StackOverflowError in AuthAttributesFilter while processing {}", request.getRequestURI(), soe);
            throw new ServletException("StackOverflowError while processing " + request.getRequestURI(), soe);
        }
    }
}
