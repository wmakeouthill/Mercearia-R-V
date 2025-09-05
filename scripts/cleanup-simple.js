#!/usr/bin/env node
// Script simplificado para limpeza de processos
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🧹 Iniciando limpeza de processos...');

function runCommand(command, args = []) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { 
      stdio: 'pipe',
      shell: true,
      windowsHide: true
    });
    
    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve({ code, output });
    });
    
    proc.on('error', () => {
      resolve({ code: 1, output: '' });
    });
  });
}

async function cleanup() {
  try {
    console.log('🔴 Finalizando processos...');
    
    // Finalizar Java
    await runCommand('taskkill', ['/F', '/IM', 'java.exe', '/T']);
    
    // Finalizar Node
    await runCommand('taskkill', ['/F', '/IM', 'node.exe', '/T']);
    
    // Finalizar PostgreSQL
    await runCommand('taskkill', ['/F', '/IM', 'postgres.exe', '/T']);
    
    console.log('🔓 Liberando portas...');
    
    // Liberar portas específicas
    const ports = [3000, 4200, 5432];
    for (const port of ports) {
      const result = await runCommand('netstat', ['-aon']);
      if (result.output) {
        const lines = result.output.split('\n');
        for (const line of lines) {
          if (line.includes(`:${port} `) || line.includes(`:${port}\t`)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              const pid = parts[4];
              if (pid && !isNaN(pid) && pid !== '0') {
                await runCommand('taskkill', ['/F', '/PID', pid]);
                console.log(`🔓 Porta ${port} liberada (PID: ${pid})`);
              }
            }
          }
        }
      }
    }
    
    console.log('⏳ Aguardando...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('🗑️ Removendo arquivos de lock...');
    const lockFiles = [
      path.join(__dirname, '..', 'backend-spring', 'data', 'pg', 'epg-lock'),
      path.join(__dirname, '..', 'backend-spring', 'data', 'pg', 'postmaster.pid')
    ];
    
    for (const lockFile of lockFiles) {
      try {
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
          console.log(`🗑️ Removido: ${path.basename(lockFile)}`);
        }
      } catch (error) {
        console.log(`⚠️ Erro ao remover ${path.basename(lockFile)}`);
      }
    }
    
    console.log('✅ Limpeza concluída!');
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

// Executar limpeza
cleanup().then(() => {
  if (process.argv.includes('exit')) {
    process.exit(0);
  }
});

// Capturar sinais
process.on('SIGINT', () => {
  console.log('\n🛑 Finalizando limpeza...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Finalizando limpeza...');
  process.exit(0);
});

module.exports = { cleanup };
