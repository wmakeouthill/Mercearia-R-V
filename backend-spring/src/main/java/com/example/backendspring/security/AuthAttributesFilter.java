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
                ServletRequest inner = wrapper.getRequest();
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

    @Override
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
