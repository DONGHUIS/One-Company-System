package com.example.memoexport.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtUtil jwtUtil;

    public JwtAuthFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {

        String token = extractToken(req);
        if (token != null) {
            try {
                Claims claims = jwtUtil.parse(token);
                long userId = Long.parseLong(claims.getSubject());
                String email = claims.get("email", String.class);
                String name  = claims.get("name",  String.class);
                String role  = claims.get("role",  String.class);

                AuthUser authUser = new AuthUser(userId, email, name, role);
                var auth = new UsernamePasswordAuthenticationToken(
                        authUser, null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase()))
                );
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (JwtException ignored) {
                // 만료되거나 위조된 토큰은 그냥 인증 없이 통과 → 보호된 엔드포인트에서 401 반환
            }
        }

        chain.doFilter(req, res);
    }

    private String extractToken(HttpServletRequest req) {
        if (req.getCookies() == null) return null;
        for (Cookie c : req.getCookies()) {
            if ("auth_token".equals(c.getName())) return c.getValue();
        }
        return null;
    }
}
