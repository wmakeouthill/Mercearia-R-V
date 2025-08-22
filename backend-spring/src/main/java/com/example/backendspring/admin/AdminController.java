package com.example.backendspring.admin;

import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.context.SecurityContextHolder;

@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminController {

    private final AdminService adminService;

    private static final String ROLE_ADMIN = "hasRole('ADMIN')";
    private static final String KEY_MESSAGE = "message";

    @PostMapping("/backups")
    @PreAuthorize(ROLE_ADMIN)
    public ResponseEntity<Map<String, Object>> createBackup(@RequestBody Map<String, String> body)
            throws IOException, InterruptedException {
        String format = body.getOrDefault("format", "custom");
        var res = adminService.createBackup(format);
        // audit log
        String username = "";
        try {
            var auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getName() != null)
                username = auth.getName();
        } catch (Exception e) {
            /* ignore */
        }
        String filename = (String) res.get("filename");
        org.slf4j.LoggerFactory.getLogger(AdminController.class)
                .info("ADMIN_TOOL action=create_backup format={} filename={} user={}", format, filename, username);
        // persist audit record
        adminService.recordAdminAction(username, "create_backup", "", filename);
        return ResponseEntity.ok(Map.of("filename", res.get("filename")));
    }

    @GetMapping("/backups")
    @PreAuthorize(ROLE_ADMIN)
    public ResponseEntity<List<Map<String, Object>>> listBackups() throws IOException {
        return ResponseEntity.ok(adminService.listBackups());
    }

    @GetMapping("/backups/{name}/download")
    @PreAuthorize(ROLE_ADMIN)
    public ResponseEntity<Resource> downloadBackup(@PathVariable String name) {
        var res = adminService.getBackupResource(name);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + res.getFilename() + "\"")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(res);
    }

    @PostMapping("/backups/{name}/restore")
    @PreAuthorize(ROLE_ADMIN)
    public ResponseEntity<Map<String, Object>> restoreBackup(@PathVariable String name,
            @RequestBody(required = false) Map<String, String> body) throws IOException, InterruptedException {
        String observation = body == null ? "" : body.getOrDefault("observation", "");
        String username = "";
        try {
            var auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getName() != null)
                username = auth.getName();
        } catch (Exception e) {
            /* ignore */
        }
        org.slf4j.LoggerFactory.getLogger(AdminController.class)
                .info("ADMIN_TOOL action=restore filename={} user={} observation={}", name, username, observation);
        adminService.recordAdminAction(username, "restore", observation, name);
        adminService.restoreBackup(name);
        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "restore_started"));
    }

    @PostMapping("/reset-database")
    @PreAuthorize(ROLE_ADMIN)
    public ResponseEntity<Map<String, Object>> resetDatabase(@RequestBody Map<String, String> body)
            throws IOException, InterruptedException {
        String phrase = body.getOrDefault("confirmationPhrase", "");
        String mode = body.getOrDefault("mode", "ALL");
        final String exact = "Desejo com certeza, apagar todos os dados do banco de dados e fazer um reset geral dos dados do aplicativo.";
        if (!exact.equals(phrase)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Frase de confirmação inválida"));
        }

        boolean exceptProducts = "EXCEPT_PRODUCTS".equalsIgnoreCase(mode);

        if (!adminService.isResetEnabled()) {
            return ResponseEntity.status(403).body(Map.of("error", "Database reset is disabled on this instance"));
        }

        // Antes de resetar, criar backup automático
        adminService.createBackup("custom");

        // Log minimal de auditoria
        String username = "";
        try {
            var auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getName() != null)
                username = auth.getName();
        } catch (Exception e) {
            /* ignore */ }
        String observation = body.getOrDefault("observation", "");
        org.slf4j.LoggerFactory.getLogger(AdminController.class).info("ADMIN_RESET user={} mode={} observation={}",
                username, mode, observation);
        adminService.recordAdminAction(username, "reset_database", observation + " mode=" + mode, null);

        adminService.resetDatabase(exceptProducts);

        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "reset_executed", "mode", mode));
    }

    @GetMapping("/audit-logs")
    @PreAuthorize(ROLE_ADMIN)
    public ResponseEntity<List<Map<String, String>>> getAuditLogs() throws IOException {
        // Read application log file configured by logging.file.name (default
        // ../backend.log)
        String logFile = System.getenv().getOrDefault("LOG_FILE", System.getProperty("LOG_FILE", "../backend.log"));
        java.nio.file.Path p = java.nio.file.Path.of(logFile);
        if (!java.nio.file.Files.exists(p)) {
            return ResponseEntity.ok(List.of());
        }

        List<String> lines = java.nio.file.Files.readAllLines(p);
        int max = 500; // return up to last 500 lines
        int start = Math.max(0, lines.size() - max);
        List<String> tail = lines.subList(start, lines.size());

        List<Map<String, String>> out = new java.util.ArrayList<>();
        for (String line : tail) {
            // only include lines written by our admin tool (tagged ADMIN_TOOL)
            if (!line.contains("ADMIN_TOOL"))
                continue;
            String ts = "";
            String level = "";
            String logger = "";
            String message = line;
            try {
                int firstSpace = line.indexOf(' ');
                int secondSpace = line.indexOf(' ', firstSpace + 1);
                if (firstSpace > 0 && secondSpace > firstSpace) {
                    ts = line.substring(0, secondSpace);
                    String remainder = line.substring(secondSpace + 1).trim();
                    int lvlEnd = remainder.indexOf(' ');
                    if (lvlEnd > 0) {
                        level = remainder.substring(0, lvlEnd);
                        int dash = remainder.indexOf(" - ");
                        if (dash > 0) {
                            String beforeDash = remainder.substring(lvlEnd + 1, dash).trim();
                            logger = beforeDash;
                            message = remainder.substring(dash + 3).trim();
                        } else {
                            message = remainder.substring(lvlEnd + 1).trim();
                        }
                    }
                }
            } catch (Exception e) {
                // fallback keep raw line
            }
            // Attempt to extract username (user=) and observation (observation=) if present
            // in the message
            String user = "";
            String observation = "";
            try {
                int uidx = message.indexOf("user=");
                if (uidx >= 0) {
                    int end = message.indexOf(' ', uidx);
                    if (end < 0)
                        end = message.length();
                    user = message.substring(uidx + 5, end).replace("[", "").replace("]", "");
                }

                int oidx = message.indexOf("observation=");
                if (oidx >= 0) {
                    int end = message.indexOf(' ', oidx);
                    if (end < 0)
                        end = message.length();
                    observation = message.substring(oidx + 12, end).replace("[", "").replace("]", "");
                }

                int aidx = message.indexOf("action=");
                String action = "";
                if (aidx >= 0) {
                    int end = message.indexOf(' ', aidx);
                    if (end < 0)
                        end = message.length();
                    action = message.substring(aidx + 7, end).replace("[", "").replace("]", "");
                }

                out.add(Map.of("timestamp", ts, "level", level, "logger", logger, KEY_MESSAGE, message, "user", user,
                        "observation", observation, "action", action));
            } catch (Exception e) {
                // ignore parsing errors, push raw
                out.add(Map.of("timestamp", ts, "level", level, "logger", logger, KEY_MESSAGE, message, "user", user,
                        "observation", observation, "action", ""));
            }
        }

        return ResponseEntity.ok(out);
    }

    @GetMapping("/actions")
    @PreAuthorize(ROLE_ADMIN)
    public ResponseEntity<List<Map<String, Object>>> listAdminActions() {
        var rows = adminService.listAdminActions();
        return ResponseEntity.ok(rows);
    }

    @PostMapping("/backups/{name}/delete")
    @PreAuthorize(ROLE_ADMIN)
    public ResponseEntity<Map<String, Object>> deleteBackup(@PathVariable String name,
            @RequestBody(required = false) Map<String, String> body) {
        String observation = body == null ? "" : body.getOrDefault("observation", "");
        boolean deleted = adminService.deleteBackupFile(name);
        String username = "";
        try {
            var auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getName() != null)
                username = auth.getName();
        } catch (Exception e) {
            /* ignore */ }
        org.slf4j.LoggerFactory.getLogger(AdminController.class).info(
                "ADMIN_TOOL action=delete filename={} user={} observation={}", name,
                username, observation);
        adminService.recordAdminAction(username, "delete_backup", observation, name);
        return ResponseEntity.ok(Map.of(KEY_MESSAGE, deleted ? "deleted" : "not_found"));
    }

    @GetMapping("/tools/status")
    @PreAuthorize(ROLE_ADMIN)
    public ResponseEntity<Map<String, Object>> toolsStatus() {
        return ResponseEntity.ok(adminService.checkToolStatus());
    }
}
