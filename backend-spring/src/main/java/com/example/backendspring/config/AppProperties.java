package com.example.backendspring.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Propriedades customizadas da aplicação para backup e restore do PostgreSQL.
 */
@Component
@ConfigurationProperties(prefix = "app")
public class AppProperties {

    private String pgDumpPath = "pg_dump";
    private String pgRestorePath = "pg_restore";
    private String backupDir = "backups";
    private boolean enableDatabaseReset = false;

    public String getPgDumpPath() {
        return pgDumpPath;
    }

    public void setPgDumpPath(String pgDumpPath) {
        this.pgDumpPath = pgDumpPath;
    }

    public String getPgRestorePath() {
        return pgRestorePath;
    }

    public void setPgRestorePath(String pgRestorePath) {
        this.pgRestorePath = pgRestorePath;
    }

    public String getBackupDir() {
        return backupDir;
    }

    public void setBackupDir(String backupDir) {
        this.backupDir = backupDir;
    }

    public boolean isEnableDatabaseReset() {
        return enableDatabaseReset;
    }

    public void setEnableDatabaseReset(boolean enableDatabaseReset) {
        this.enableDatabaseReset = enableDatabaseReset;
    }
}
