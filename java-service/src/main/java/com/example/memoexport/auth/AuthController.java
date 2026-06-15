package com.example.memoexport.auth;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final UserService userService;
    private final JwtUtil jwtUtil;

    public AuthController(UserService userService, JwtUtil jwtUtil) {
        this.userService = userService;
        this.jwtUtil = jwtUtil;
    }

    // ── 일반 로그인 ──
    @PostMapping("/local/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> body, HttpServletResponse response) {
        String email    = body.get("email");
        String password = body.get("password");

        if (email == null || password == null)
            return ResponseEntity.badRequest().body(Map.of("error", "이메일과 비밀번호를 입력하세요"));

        Map<String, Object> user = userService.findByEmail(email);
        if (user == null || user.get("password") == null)
            return ResponseEntity.status(401).body(Map.of("error", "이메일 또는 비밀번호가 올바르지 않습니다"));

        if (!userService.verifyPassword(password, (String) user.get("password")))
            return ResponseEntity.status(401).body(Map.of("error", "이메일 또는 비밀번호가 올바르지 않습니다"));

        long   userId = ((Number) user.get("id")).longValue();
        String role   = user.get("role") != null ? (String) user.get("role") : "user";
        String token  = jwtUtil.generate(userId, email, (String) user.get("name"), role);

        setAuthCookie(response, token);
        userService.writeLog(userId, "login");
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // ── 회원가입 ──
    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody Map<String, String> body) {
        String name     = body.get("name");
        String email    = body.get("email");
        String password = body.get("password");

        if (name == null || email == null || password == null)
            return ResponseEntity.badRequest().body(Map.of("error", "이름, 이메일, 비밀번호를 모두 입력하세요"));
        if (password.length() < 8)
            return ResponseEntity.badRequest().body(Map.of("error", "비밀번호는 8자 이상이어야 합니다"));
        if (!password.matches(".*[A-Za-z].*") || !password.matches(".*[0-9].*"))
            return ResponseEntity.badRequest().body(Map.of("error", "비밀번호는 영문자와 숫자를 포함해야 합니다"));

        if (userService.emailExists(email))
            return ResponseEntity.status(409).body(Map.of("error", "이미 사용 중인 이메일입니다"));

        long userId = userService.createUser(email, name, password);
        userService.writeLog(userId, "register");
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // ── 로그아웃 ──
    @PostMapping("/logout")
    public ResponseEntity<?> logout(@AuthenticationPrincipal AuthUser user, HttpServletResponse response) {
        if (user != null) userService.writeLog(user.id(), "logout");
        clearAuthCookie(response);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // ── 현재 사용자 정보 ──
    @GetMapping("/me")
    public ResponseEntity<?> me(@AuthenticationPrincipal AuthUser user) {
        if (user == null)
            return ResponseEntity.status(401).body(Map.of("error", "미로그인"));

        return ResponseEntity.ok(Map.of(
                "id",        user.id(),
                "name",      user.name(),
                "email",     user.email(),
                "role",      user.role(),
                "hasGoogle", false
        ));
    }

    // ── 비밀번호 변경 ──
    @PostMapping("/local/change-password")
    public ResponseEntity<?> changePassword(@AuthenticationPrincipal AuthUser user,
                                             @RequestBody Map<String, String> body) {
        if (user == null)
            return ResponseEntity.status(401).body(Map.of("error", "미로그인"));

        String currentPassword = body.get("currentPassword");
        String newPassword     = body.get("newPassword");

        if (currentPassword == null || newPassword == null)
            return ResponseEntity.badRequest().body(Map.of("error", "현재 비밀번호와 새 비밀번호를 입력하세요"));
        if (newPassword.length() < 8)
            return ResponseEntity.badRequest().body(Map.of("error", "새 비밀번호는 8자 이상이어야 합니다"));
        if (!newPassword.matches(".*[A-Za-z].*") || !newPassword.matches(".*[0-9].*"))
            return ResponseEntity.badRequest().body(Map.of("error", "비밀번호는 영문자와 숫자를 포함해야 합니다"));

        Map<String, Object> dbUser = userService.findById(user.id());
        if (dbUser == null || dbUser.get("password") == null)
            return ResponseEntity.badRequest().body(Map.of("error", "Google 로그인 계정은 비밀번호를 변경할 수 없습니다"));

        if (!userService.verifyPassword(currentPassword, (String) dbUser.get("password")))
            return ResponseEntity.status(401).body(Map.of("error", "현재 비밀번호가 올바르지 않습니다"));

        userService.changePassword(user.id(), newPassword);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // ── 회원 탈퇴 ──
    @DeleteMapping("/local/withdraw")
    public ResponseEntity<?> withdraw(@AuthenticationPrincipal AuthUser user, HttpServletResponse response) {
        if (user == null)
            return ResponseEntity.status(401).body(Map.of("error", "미로그인"));

        userService.writeLog(user.id(), "withdraw");
        userService.deleteUser(user.id());
        clearAuthCookie(response);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    private void setAuthCookie(HttpServletResponse response, String token) {
        // HttpOnly + Secure + SameSite=Strict → XSS/CSRF 모두 차단
        response.addHeader("Set-Cookie",
                "auth_token=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400");
    }

    private void clearAuthCookie(HttpServletResponse response) {
        response.addHeader("Set-Cookie",
                "auth_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
    }
}
