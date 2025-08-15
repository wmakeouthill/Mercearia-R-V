package com.example.backendspring.db;

import liquibase.change.custom.CustomTaskChange;
import liquibase.database.Database;
import liquibase.exception.CustomChangeException;
import liquibase.exception.SetupException;
import liquibase.resource.ResourceAccessor;
import liquibase.exception.ValidationErrors;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

public class LiquibaseSeedUsers implements CustomTaskChange {

    private static final String ADMIN = "admin";
    private static final String USER = "user";
    // resourceAccessor not required for this change

    @Override
    public void execute(Database database) throws CustomChangeException {
        try {
            Connection conn = ((liquibase.database.jvm.JdbcConnection) database.getConnection())
                    .getUnderlyingConnection();

            // Check if admin user exists
            try (PreparedStatement ps = conn.prepareStatement("select count(*) from usuarios where username = ?")) {
                ps.setString(1, ADMIN);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next() && rs.getInt(1) > 0) {
                        return; // admin already exists
                    }
                }
            }

            BCryptPasswordEncoder enc = new BCryptPasswordEncoder();
            String adminPassPlain = System.getenv().getOrDefault("DEFAULT_ADMIN_PASSWORD", "admin123");
            String userPassPlain = System.getenv().getOrDefault("DEFAULT_USER_PASSWORD", "user123");
            String adminHash = enc.encode(adminPassPlain);
            String userHash = enc.encode(userPassPlain);

            // Insert admin
            try (PreparedStatement ins = conn.prepareStatement(
                    "insert into usuarios (username, password, role, pode_controlar_caixa) values (?, ?, ?, ?)")) {
                ins.setString(1, ADMIN);
                ins.setString(2, adminHash);
                ins.setString(3, ADMIN);
                ins.setBoolean(4, true);
                ins.executeUpdate();
            }

            // Insert user
            try (PreparedStatement ins = conn.prepareStatement(
                    "insert into usuarios (username, password, role, pode_controlar_caixa) values (?, ?, ?, ?)")) {
                ins.setString(1, USER);
                ins.setString(2, userHash);
                ins.setString(3, USER);
                ins.setBoolean(4, false);
                ins.executeUpdate();
            }

        } catch (Exception e) {
            throw new CustomChangeException("Failed to seed users: " + e.getMessage(), e);
        }
    }

    @Override
    public String getConfirmationMessage() {
        return "Seeded default users (admin, user) if absent";
    }

    @Override
    public void setUp() throws SetupException {
        // no special setup required
    }

    @Override
    public void setFileOpener(ResourceAccessor resourceAccessor) {
        // no-op
    }

    @Override
    public ValidationErrors validate(Database database) {
        return new ValidationErrors();
    }
}
