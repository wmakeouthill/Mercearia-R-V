#!/usr/bin/env node
// Script para limpeza completa de processos e recursos
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧹 Iniciando limpeza completa de processos...');

// Função para executar comando e aguardar resultado
function execCommand(command) {
  return new Promise((resolve) => {
    exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', error });
    });
  });
}

// Função para remover arquivo se existir
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
    // 1. Finalizar processos Java (Spring Boot)
    console.log('🔴 Finalizando processos Java...');
    const javaResult = await execCommand('taskkill /F /IM java.exe /T 2>nul');
    if (javaResult.error) {
      console.log('ℹ️  Nenhum processo Java encontrado');
    }
    
    // 2. Finalizar processos Node.js
    console.log('🔴 Finalizando processos Node.js...');
    const nodeResult = await execCommand('taskkill /F /IM node.exe /T 2>nul');
    if (nodeResult.error) {
      console.log('ℹ️  Nenhum processo Node encontrado');
    }
    
    // 3. Finalizar processos PostgreSQL
    console.log('🔴 Finalizando processos PostgreSQL...');
    const pgResult = await execCommand('taskkill /F /IM postgres.exe /T 2>nul');
    if (pgResult.error) {
      console.log('ℹ️  Nenhum processo PostgreSQL encontrado');
    }
    
    // 4. Liberar portas específicas
    console.log('🔓 Liberando portas...');
    const ports = [3000, 4200, 5432];
    for (const port of ports) {
      try {
        const { stdout } = await execCommand(`netstat -aon | findstr :${port}`);
        if (stdout && stdout.trim()) {
          const lines = stdout.split('\n').filter(line => line.includes(':' + port));
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const pid = parts[4];
              if (pid && !isNaN(pid) && pid !== '0') {
                await execCommand(`taskkill /F /PID ${pid} 2>nul`);
                console.log(`🔓 Porta ${port} liberada (PID: ${pid})`);
              }
            }
          }
        }
      } catch (error) {
        console.log(`⚠️  Erro ao liberar porta ${port}:`, error.message);
      }
    }
    
    // 5. Aguardar um pouco para os processos terminarem
    console.log('⏳ Aguardando processos finalizarem...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 6. Remover arquivos de lock do PostgreSQL
    console.log('🗑️  Removendo arquivos de lock...');
    const lockFiles = [
      path.join(__dirname, '..', 'backend-spring', 'data', 'pg', 'epg-lock'),
      path.join(__dirname, '..', 'backend-spring', 'data', 'pg', 'postmaster.pid')
    ];
    
    for (const lockFile of lockFiles) {
      removeFileIfExists(lockFile);
    }
    
    console.log('✅ Limpeza concluída com sucesso!');
    
  } catch (error) {
    console.error('❌ Erro durante limpeza:', error.message);
  }
}

// Executar limpeza
cleanup().then(() => {
  // Se chamado com argumento 'exit', finalizar este processo também
  if (process.argv.includes('exit')) {
    console.log('🔴 Finalizando processo de limpeza...');
    process.exit(0);
  }
});

// Capturar sinais de finalização para limpeza automática
process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT recebido, executando limpeza final...');
  cleanup().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM recebido, executando limpeza final...');
  cleanup().then(() => process.exit(0));
});

// Exportar função para uso em outros scripts
module.exports = { cleanup };
