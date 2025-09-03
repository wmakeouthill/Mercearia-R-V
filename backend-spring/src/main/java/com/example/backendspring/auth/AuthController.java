package com.example.backendspring.auth;

import com.example.backendspring.security.JwtService;
import com.example.backendspring.user.User;
import com.example.backendspring.user.UserRepository;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private static final String KEY_ERROR = "error";
    private static final String KEY_MESSAGE = "message";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_ROLE = "role";
    private static final String KEY_USER = "user";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_PODE_CONTROLAR_CAIXA = "pode_controlar_caixa";
    private static final String MSG_NAO_AUTENTICADO = "Usuário não autenticado";
    private static final String MSG_NAO_ENCONTRADO = "Usuário não encontrado";
    private static final String ROLE_ADMIN = "admin";
    private static final String ROLE_USER = "user";

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody LoginRequest req) {
        log.info("Login attempt for username={}", req.getUsername());
        if (req.getUsername() == null || req.getPassword() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.<String, Object>of(KEY_ERROR, "Username e password são obrigatórios"));
        }
        var maybeUser = userRepository.findByUsername(req.getUsername());
        if (maybeUser.isEmpty()) {
            log.warn("Failed login for username={} - user not found", req.getUsername());
            return ResponseEntity.status(401).body(Map.<String, Object>of(KEY_ERROR, "Credenciais inválidas"));
        }
        var u = maybeUser.get();
        if (!passwordEncoder.matches(req.getPassword(), u.getPassword())) {
            log.warn("Failed login for username={} - invalid password", req.getUsername());
            return ResponseEntity.status(401).body(Map.<String, Object>of(KEY_ERROR, "Credenciais inválidas"));
        }
        Map<String, Object> claims = new HashMap<>();
        claims.put("id", u.getId());
        claims.put(KEY_USERNAME, u.getUsername());
        claims.put(KEY_ROLE, u.getRole());
        String token = jwtService.generateToken(claims);
        Map<String, Object> user = new HashMap<>();
        user.put("id", u.getId());
        user.put(KEY_USERNAME, u.getUsername());
        user.put(KEY_ROLE, u.getRole());
        user.put(KEY_PODE_CONTROLAR_CAIXA, Boolean.TRUE.equals(u.getPodeControlarCaixa()));
        return ResponseEntity.ok(Map.<String, Object>of(KEY_TOKEN, token, KEY_USER, user));
    }

    @GetMapping("/profile")
    public ResponseEntity<Map<String, Object>> profile(
            @RequestAttribute(name = "userId", required = false) Long userId) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.<String, Object>of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        return userRepository.findById(userId)
                .map(u -> ResponseEntity.ok(Map.<String, Object>of(
                        "id", u.getId(),
                        KEY_USERNAME, u.getUsername(),
                        KEY_ROLE, u.getRole())))
                // Tratar usuário não encontrado como não autenticado (token órfão)
                .orElse(ResponseEntity.status(401).body(Map.<String, Object>of(KEY_ERROR, MSG_NAO_AUTENTICADO)));
    }

    @GetMapping("/me")
    public ResponseEntity<Map<String, Object>> me(@RequestAttribute(name = "userId", required = false) Long userId) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.<String, Object>of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        return userRepository.findById(userId)
                .map(u -> ResponseEntity.ok(Map.<String, Object>of(
                        "id", u.getId(),
                        KEY_USERNAME, u.getUsername(),
                        KEY_ROLE, u.getRole(),
                        KEY_PODE_CONTROLAR_CAIXA, Boolean.TRUE.equals(u.getPodeControlarCaixa()))))
                // Tratar usuário não encontrado como não autenticado (token órfão)
                .orElse(ResponseEntity.status(401).body(Map.<String, Object>of(KEY_ERROR, MSG_NAO_AUTENTICADO)));
    }

    @PostMapping("/change-password")
    public ResponseEntity<Map<String, Object>> changePassword(
            @RequestAttribute(name = "userId", required = false) Long userId,
            @RequestBody ChangePasswordRequest req) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.<String, Object>of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        if (req.getCurrentPassword() == null || req.getNewPassword() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.<String, Object>of(KEY_ERROR, "Senha atual e nova senha são obrigatórias"));
        }
        return userRepository.findById(userId).map(u -> {
            if (!passwordEncoder.matches(req.getCurrentPassword(), u.getPassword())) {
                return ResponseEntity.badRequest().body(Map.<String, Object>of(KEY_ERROR, "Senha atual incorreta"));
            }
            u.setPassword(passwordEncoder.encode(req.getNewPassword()));
            userRepository.save(u);
            return ResponseEntity.ok(Map.<String, Object>of(KEY_MESSAGE, "Senha alterada com sucesso"));
        }).orElse(ResponseEntity.status(404).body(Map.<String, Object>of(KEY_ERROR, MSG_NAO_ENCONTRADO)));
    }

    // Endpoints admin: listar/criar/atualizar/deletar usuários
    @GetMapping("/users")
    public ResponseEntity<List<Map<String, Object>>> listUsers() {
        List<User> users = userRepository.findAll();
        return ResponseEntity.ok(users.stream().map(u -> Map.<String, Object>of(
                "id", u.getId(),
                KEY_USERNAME, u.getUsername(),
                KEY_ROLE, u.getRole(),
                KEY_PODE_CONTROLAR_CAIXA, Boolean.TRUE.equals(u.getPodeControlarCaixa()))).toList());
    }

    @PostMapping("/users")
    public ResponseEntity<Map<String, Object>> createUser(@RequestBody CreateUserRequest req) {
        if (req.getUsername() == null || req.getPassword() == null || req.getRole() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.<String, Object>of(KEY_ERROR, "Username, password e role são obrigatórios"));
        }
        if (!req.getRole().equals(ROLE_ADMIN) && !req.getRole().equals(ROLE_USER)) {
            return ResponseEntity.badRequest().body(Map.<String, Object>of(KEY_ERROR, "Role deve ser admin ou user"));
        }
        if (userRepository.existsByUsername(req.getUsername())) {
            return ResponseEntity.badRequest().body(Map.<String, Object>of(KEY_ERROR, "Username já existe"));
        }
        boolean permissaoCaixa = ROLE_ADMIN.equals(req.getRole()) || Boolean.TRUE.equals(req.getPodeControlarCaixa());
        User u = User.builder()
                .username(req.getUsername())
                .password(passwordEncoder.encode(req.getPassword()))
                .role(req.getRole())
                .podeControlarCaixa(permissaoCaixa)
                .build();
        userRepository.save(u);
        return ResponseEntity.status(201).body(Map.<String, Object>of(
                "id", u.getId(),
                KEY_USERNAME, u.getUsername(),
                KEY_ROLE, u.getRole(),
                KEY_MESSAGE, "Usuário criado com sucesso"));
    }

    @PutMapping("/users/{id}")
    public ResponseEntity<Map<String, Object>> updateUser(@PathVariable Long id, @RequestBody UpdateUserRequest req) {
        if (req.getUsername() == null || req.getRole() == null) {
            return ResponseEntity.badRequest()
                    .body(Map.<String, Object>of(KEY_ERROR, "Username e role são obrigatórios"));
        }
        if (!req.getRole().equals(ROLE_ADMIN) && !req.getRole().equals(ROLE_USER)) {
            return ResponseEntity.badRequest().body(Map.<String, Object>of(KEY_ERROR, "Role deve ser admin ou user"));
        }
        return userRepository.findById(id).map(u -> {
            u.setUsername(req.getUsername());
            u.setRole(req.getRole());
            boolean permissaoCaixa = ROLE_ADMIN.equals(req.getRole())
                    || Boolean.TRUE.equals(req.getPodeControlarCaixa());
            u.setPodeControlarCaixa(permissaoCaixa);
            if (req.getPassword() != null && !req.getPassword().isBlank()) {
                u.setPassword(passwordEncoder.encode(req.getPassword()));
            }
            userRepository.save(u);
            return ResponseEntity.ok(Map.<String, Object>of(KEY_MESSAGE, "Usuário atualizado com sucesso"));
        }).orElse(ResponseEntity.status(404).body(Map.<String, Object>of(KEY_ERROR, MSG_NAO_ENCONTRADO)));
    }

    @DeleteMapping("/users/{id}")
    public ResponseEntity<Map<String, Object>> deleteUser(
            @RequestAttribute(name = "userId", required = false) Long requesterId,
            @PathVariable Long id) {
        if (requesterId != null && requesterId.equals(id)) {
            return ResponseEntity.badRequest()
                    .body(Map.<String, Object>of(KEY_ERROR, "Não é possível deletar sua própria conta"));
        }
        if (!userRepository.existsById(id)) {
            return ResponseEntity.status(404).body(Map.<String, Object>of(KEY_ERROR, MSG_NAO_ENCONTRADO));
        }
        userRepository.deleteById(id);
        return ResponseEntity.ok(Map.<String, Object>of(KEY_MESSAGE, "Usuário deletado com sucesso"));
    }

    @Data
    public static class LoginRequest {
        @NotBlank
        private String username;
        @NotBlank
        private String password;
    }

    @Data
    public static class ChangePasswordRequest {
        private String currentPassword;
        private String newPassword;
    }

    @Data
    public static class CreateUserRequest {
        private String username;
        private String password;
        private String role;
        private Boolean podeControlarCaixa;
    }

    @Data
    public static class UpdateUserRequest {
        private String username;
        private String password;
        private String role;
        private Boolean podeControlarCaixa;
    }
}
