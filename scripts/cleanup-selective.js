#!/usr/bin/env node
// Script de limpeza seletiva - evita matar o próprio processo
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧹 Iniciando limpeza seletiva de processos...');

// Obter PID do processo atual e processos pais para não matá-los
const currentPid = process.pid;
const parentPid = process.ppid;

function execCommand(command) {
  return new Promise((resolve) => {
    exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', error });
    });
  });
}

function removeFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️  Removido: ${filePath}`);
    }
  } catch (error) {
    console.log(`⚠️  Erro ao remover ${filePath}: ${error.message}`);
  }
}

async function cleanup() {
  try {
    // 1. Liberar portas específicas (sem matar processos Node atuais)
    console.log('🔓 Liberando portas específicas...');
    const ports = [3000, 4200];
    
    for (const port of ports) {
      try {
        const { stdout } = await execCommand(`netstat -aon | findstr :${port}`);
        if (stdout && stdout.trim()) {
          const lines = stdout.split('\n').filter(line => line.includes(':' + port));
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const pid = parts[4];
              if (pid && !isNaN(pid) && pid !== '0' && 
                  parseInt(pid) !== currentPid && parseInt(pid) !== parentPid) {
                
                // Verificar se é um processo Java (Spring Boot) ou servidor web
                const { stdout: processInfo } = await execCommand(`tasklist /FI "PID eq ${pid}" /FO CSV 2>nul`);
                if (processInfo && (processInfo.includes('java.exe') || processInfo.includes('node.exe'))) {
                  await execCommand(`taskkill /F /PID ${pid} 2>nul`);
                  console.log(`🔓 Porta ${port} liberada (PID: ${pid})`);
                }
              }
            }
          }
        }
      } catch (error) {
        console.log(`⚠️  Erro ao liberar porta ${port}:`, error.message);
      }
    }
    
    // 2. Finalizar apenas processos Java órfãos (Spring Boot anteriores)
    console.log('🔴 Finalizando processos Java órfãos...');
    const { stdout: javaProcesses } = await execCommand('tasklist /FI "IMAGENAME eq java.exe" /FO CSV 2>nul');
    if (javaProcesses && javaProcesses.includes('java.exe')) {
      // Finalizar apenas processos Java que não são o atual
      await execCommand('taskkill /F /IM java.exe /T 2>nul');
      console.log('ℹ️  Processos Java anteriores finalizados');
    }
    
    // 3. Finalizar apenas processos PostgreSQL órfãos
    console.log('🔴 Finalizando processos PostgreSQL órfãos...');
    const pgResult = await execCommand('taskkill /F /IM postgres.exe /T 2>nul');
    if (!pgResult.error) {
      console.log('ℹ️  Processos PostgreSQL finalizados');
    }
    
    // 4. Aguardar um pouco
    console.log('⏳ Aguardando...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 5. Remover arquivos de lock do PostgreSQL
    console.log('🗑️  Removendo arquivos de lock...');
    const lockFiles = [
      path.join(__dirname, '..', 'backend-spring', 'data', 'pg', 'epg-lock'),
      path.join(__dirname, '..', 'backend-spring', 'data', 'pg', 'postmaster.pid')
    ];
    
    for (const lockFile of lockFiles) {
      removeFileIfExists(lockFile);
    }
    
    console.log('✅ Limpeza seletiva concluída!');
    
  } catch (error) {
    console.error('❌ Erro durante limpeza:', error.message);
  }
}

// Executar limpeza se chamado diretamente
if (require.main === module) {
  cleanup().then(() => {
    console.log('🎯 Prosseguindo com inicialização...');
  });
}

// Exportar função para uso em outros scripts
module.exports = { cleanup };
