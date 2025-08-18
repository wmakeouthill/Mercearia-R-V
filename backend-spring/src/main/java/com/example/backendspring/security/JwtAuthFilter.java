package com.example.backendspring.security;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletRequestWrapper;
import java.util.HashSet;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
@RequiredArgsConstructor
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private static final Logger log = LoggerFactory.getLogger(JwtAuthFilter.class);

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
            // Log and handle: warn-level to surface unexpected errors during request
            // wrapper inspection
            log.warn("error while logging wrapper chain", t);
        }
    }

    // Extracted helper to avoid catching Throwable and nested try/catch in the loop
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
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        log.debug("enter JwtAuthFilter for {}", request.getRequestURI());
        if (log.isDebugEnabled()) {
            // Only inspect wrapper chain when debug logging is enabled to avoid
            // interacting with request wrappers in production (can trigger edge-case
            // recursion).
            logRequestWrapperChain(request);
        }
        if (header != null && header.startsWith("Bearer ")) {
            log.debug("Authorization header present for request {} (len={})", request.getRequestURI(), header.length());
            try {
                String token = header.substring(7);
                Claims claims = jwtService.parseToken(token);
                Long id = ((Number) claims.get("id")).longValue();
                log.debug("JWT parsed for request {} -> userId={}", request.getRequestURI(), id);
                String username = (String) claims.get("username");
                String role = (String) claims.get("role");
                UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                        username,
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase())));
                auth.setDetails(id);
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (Exception e) {
                // Token inválido -> segue sem autenticação. Clear any partial context and log
                // for debug.
                SecurityContextHolder.clearContext();
                // Token parsing failed; warn so it's visible in logs and considered handled
                log.warn("Invalid JWT token while parsing", e);
            }
        }
        try {
            filterChain.doFilter(request, response);
        } catch (StackOverflowError soe) {
            log.error("StackOverflowError in JwtAuthFilter while processing {}", request.getRequestURI(), soe);
            throw new ServletException("StackOverflowError while processing " + request.getRequestURI(), soe);
        }
    }
}
