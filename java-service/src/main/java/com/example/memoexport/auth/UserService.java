package com.example.memoexport.auth;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class UserService {

    private final JdbcTemplate jdbc;
    private final BCryptPasswordEncoder encoder;

    public UserService(JdbcTemplate jdbc, BCryptPasswordEncoder encoder) {
        this.jdbc = jdbc;
        this.encoder = encoder;
    }

    public Map<String, Object> findByEmail(String email) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, email, name, password, role, access_token FROM users WHERE email = ?", email);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public Map<String, Object> findById(long id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, email, name, password, role, access_token FROM users WHERE id = ?", id);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public boolean emailExists(String email) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM users WHERE email = ?", Integer.class, email);
        return count != null && count > 0;
    }

    public long createUser(String email, String name, String rawPassword) {
        String hashed = encoder.encode(rawPassword);
        jdbc.update("INSERT INTO users (email, name, password) VALUES (?, ?, ?)", email, name, hashed);
        Long id = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id != null ? id : -1;
    }

    public boolean verifyPassword(String rawPassword, String hashed) {
        return encoder.matches(rawPassword, hashed);
    }

    public void changePassword(long userId, String newRawPassword) {
        String hashed = encoder.encode(newRawPassword);
        jdbc.update("UPDATE users SET password = ? WHERE id = ?", hashed, userId);
    }

    public void deleteUser(long userId) {
        jdbc.update("DELETE FROM users WHERE id = ?", userId);
    }

    public void writeLog(Long userId, String action) {
        try {
            jdbc.update(
                    "INSERT INTO audit_logs (user_id, action, target, detail) VALUES (?, ?, NULL, NULL)",
                    userId, action);
        } catch (Exception e) {
            System.err.println("[audit] 로그 기록 실패: " + e.getMessage());
        }
    }
}
