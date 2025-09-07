package com.example.backendspring.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.File;
import java.util.concurrent.TimeUnit;
import java.io.IOException;
import java.nio.file.Files;

/**
 * Utilitário para diagnosticar problemas de inicialização do PostgreSQL
 * embedded
 * em PCs extremamente lentos.
 */
public class PostgresDiagnostic {

    private static final Logger log = LoggerFactory.getLogger(PostgresDiagnostic.class);
    private static final String JAVA_IO_TMPDIR = "java.io.tmpdir";
    private static final String JAVA_VENDOR = "java.vendor";

    private PostgresDiagnostic() {
        // Utility class
    }

    public static void runCompleteDiagnostic() {
        log.info("=== DIAGNÓSTICO COMPLETO POSTGRESQL EMBEDDED ===");

        // 1. Verificar sistema operacional e arquitetura
        diagnoseSystem();

        // 2. Verificar Java e versões
        diagnoseJava();

        // 3. Verificar espaço em disco e permissões
        diagnoseDiskSpace();

        // 4. Verificar dependências C++
        diagnoseCppRedistributable();

        // 5. Verificar antivírus/firewall
        diagnoseSecuritySoftware();

        // 6. Verificar processos PostgreSQL órfãos
        diagnosePostgresProcesses();

        // 7. Verificar temp directories
        diagnoseTempDirectories();

        log.info("=== FIM DIAGNÓSTICO ===");
    }

    private static void diagnoseSystem() {
        log.info("--- Diagnóstico Sistema ---");
        log.info("OS: {} {} {}",
                System.getProperty("os.name"),
                System.getProperty("os.version"),
                System.getProperty("os.arch"));

        log.info("Java: {} ({})",
                System.getProperty("java.version"),
                System.getProperty("java.vendor"));

        // Verificar se é Windows 32-bit ou 64-bit
        String arch = System.getProperty("os.arch");
        if (arch.contains("x86") && !arch.contains("64")) {
            log.warn("ATENÇÃO: Sistema 32-bit detectado. PostgreSQL embedded pode ter problemas!");
        }

        // Verificar memória disponível
        Runtime runtime = Runtime.getRuntime();
        long maxMemory = runtime.maxMemory();
        long totalMemory = runtime.totalMemory();
        long freeMemory = runtime.freeMemory();

        log.info("Memória JVM - Max: {}MB, Total: {}MB, Livre: {}MB",
                maxMemory / 1024 / 1024,
                totalMemory / 1024 / 1024,
                freeMemory / 1024 / 1024);

        if (maxMemory < 512 * 1024 * 1024) { // Menos que 512MB
            log.warn("ATENÇÃO: Memória JVM muito baixa! Recomendado pelo menos 512MB");
        }
    }

    private static void diagnoseJava() {
        log.info("--- Diagnóstico Java ---");

        // Verificar versão Java
        String javaVersion = System.getProperty("java.version");
        log.info("Java Version: {}", javaVersion);
        log.info("Java Home: {}", System.getProperty("java.home"));
        log.info("Java Vendor: {}", System.getProperty("java.vendor"));

        // Verificar se está usando OpenJDK vs Oracle JDK
        String vendor = System.getProperty("java.vendor").toLowerCase();
        if (vendor.contains("openjdk")) {
            log.info("Usando OpenJDK - OK para PostgreSQL embedded");
        } else if (vendor.contains("oracle")) {
            log.info("Usando Oracle JDK - OK para PostgreSQL embedded");
        } else {
            log.warn("JDK não reconhecido: {}", vendor);
        }

        // Verificar propriedades importantes do Java
        log.info("java.io.tmpdir: {}", System.getProperty("java.io.tmpdir"));
        log.info("user.dir: {}", System.getProperty("user.dir"));
        log.info("file.encoding: {}", System.getProperty("file.encoding"));
    }

    private static void diagnoseDiskSpace() {
        log.info("--- Diagnóstico Espaço em Disco ---");

        // Verificar espaço no temp
        String tempDir = System.getProperty("java.io.tmpdir");
        File tempFile = new File(tempDir);
        long freeSpace = tempFile.getFreeSpace();
        long totalSpace = tempFile.getTotalSpace();

        log.info("Diretório temp: {}", tempDir);
        log.info("Espaço livre: {}MB de {}MB total",
                freeSpace / 1024 / 1024,
                totalSpace / 1024 / 1024);

        if (freeSpace < 500 * 1024 * 1024) { // Menos que 500MB
            log.error("ERRO: Espaço insuficiente no temp! PostgreSQL precisa de pelo menos 500MB");
        }

        // Verificar permissões de escrita no temp
        try {
            File testFile = new File(tempDir, "pg-test-write-" + System.currentTimeMillis());
            if (testFile.createNewFile()) {
                testFile.delete();
                log.info("Permissões de escrita no temp: OK");
            }
        } catch (IOException e) {
            log.error("ERRO: Sem permissões de escrita no temp: {}", e.getMessage());
        }

        // Verificar working directory atual
        String userDir = System.getProperty("user.dir");
        File workDir = new File(userDir);
        long workFreeSpace = workDir.getFreeSpace();
        log.info("Working directory: {} ({}MB livres)",
                userDir, workFreeSpace / 1024 / 1024);
    }

    private static void diagnoseCppRedistributable() {
        log.info("--- Diagnóstico C++ Redistributable ---");

        // Verificar se Visual C++ Redistributable está instalado
        String[] vcRedistPaths = {
                "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Redist",
                "C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\Community\\VC\\Redist",
                "C:\\Program Files (x86)\\Microsoft Visual Studio 14.0\\VC\\redist",
                "C:\\Windows\\System32\\msvcr120.dll",
                "C:\\Windows\\System32\\msvcp140.dll",
                "C:\\Windows\\System32\\vcruntime140.dll"
        };

        boolean foundVcRedist = false;
        for (String path : vcRedistPaths) {
            if (new File(path).exists()) {
                log.info("Encontrado VC++ Redistributable: {}", path);
                foundVcRedist = true;
            }
        }

        if (!foundVcRedist) {
            log.warn("ATENÇÃO: Visual C++ Redistributable não encontrado!");
            log.warn("PostgreSQL embedded pode precisar do VC++ Redistributable 2015-2022");
            log.warn("Download: https://aka.ms/vs/17/release/vc_redist.x64.exe");
        }
    }

    private static void diagnoseSecuritySoftware() {
        log.info("--- Diagnóstico Software de Segurança ---");

        // Lista de processos que podem interferir
        String[] problematicProcesses = {
                "avp.exe", "avpui.exe", // Kaspersky
                "avgnt.exe", "avguard.exe", // Avira
                "msmpeng.exe", // Windows Defender
                "NortonSecurity.exe", // Norton
                "McShield.exe", "mcods.exe", // McAfee
                "bdagent.exe", "vsserv.exe", // Bitdefender
                "ekrn.exe" // ESET
        };

        try {
            Process proc = Runtime.getRuntime().exec("tasklist.exe");
            proc.waitFor(5, TimeUnit.SECONDS);

            // Não vamos analisar a saída completa aqui, apenas alertar
            log.info("Verifique manualmente se antivírus está bloqueando PostgreSQL");
            log.info("Comando para verificar: tasklist.exe | findstr postgres");

        } catch (Exception e) {
            log.warn("Não foi possível verificar processos ativos: {}", e.getMessage());
        }

        log.warn("IMPORTANTE: Se houver antivírus ativo, adicione exceções para:");
        log.warn("- Diretório temp: {}", System.getProperty("java.io.tmpdir"));
        log.warn("- Processo java.exe");
        log.warn("- Portas TCP dinâmicas (49152-65535)");
    }

    private static void diagnosePostgresProcesses() {
        log.info("--- Diagnóstico Processos PostgreSQL ---");

        try {
            // Verificar processos postgres ativos
            Process proc = Runtime.getRuntime().exec("tasklist.exe /FI \"IMAGENAME eq postgres.exe\"");
            proc.waitFor(10, TimeUnit.SECONDS);

            if (proc.exitValue() == 0) {
                log.info("Comando tasklist executado. Verifique se há processos postgres órfãos");
            }

            // Verificar se há lock files órfãos
            String tempDir = System.getProperty("java.io.tmpdir");
            File tempFile = new File(tempDir);
            File[] pgDirs = tempFile.listFiles((dir, name) -> name.startsWith("embedded-pg"));

            if (pgDirs != null && pgDirs.length > 0) {
                log.warn("Encontrados {} diretórios embedded-pg órfãos no temp", pgDirs.length);
                for (File pgDir : pgDirs) {
                    log.warn("Diretório órfão: {}", pgDir.getAbsolutePath());
                }
            } else {
                log.info("Nenhum diretório embedded-pg órfão encontrado no temp");
            }

        } catch (Exception e) {
            log.error("Erro ao verificar processos PostgreSQL: {}", e.getMessage());
        }
    }

    private static void diagnoseTempDirectories() {
        log.info("--- Diagnóstico Diretórios Temporários ---");

        String tempDir = System.getProperty("java.io.tmpdir");
        log.info("Java temp dir: {}", tempDir);

        // Verificar se temp está em SSD ou HD
        File temp = new File(tempDir);
        try {
            // Teste simples de velocidade de escrita
            long startTime = System.currentTimeMillis();
            File testFile = new File(temp, "speed-test-" + System.currentTimeMillis());
            byte[] data = new byte[1024 * 1024]; // 1MB
            Files.write(testFile.toPath(), data);
            long writeTime = System.currentTimeMillis() - startTime;
            testFile.delete();

            log.info("Tempo escrita 1MB: {}ms", writeTime);
            if (writeTime > 500) {
                log.warn("DISCO LENTO detectado! PostgreSQL será muito lento");
                log.warn("Considere mover java.io.tmpdir para SSD se disponível");
            } else {
                log.info("Velocidade de disco adequada");
            }

        } catch (Exception e) {
            log.error("Erro ao testar velocidade do disco: {}", e.getMessage());
        }

        // Verificar caminhos alternativos para temp
        String[] altTempDirs = {
                System.getenv("TEMP"),
                System.getenv("TMP"),
                "C:\\temp",
                "C:\\tmp"
        };

        for (String altTemp : altTempDirs) {
            if (altTemp != null && !altTemp.equals(tempDir)) {
                File altFile = new File(altTemp);
                if (altFile.exists() && altFile.canWrite()) {
                    log.info("Diretório temp alternativo disponível: {}", altTemp);
                }
            }
        }
    }
}
