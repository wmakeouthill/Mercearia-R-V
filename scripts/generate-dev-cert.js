#!/usr/bin/env node
/**
 * Gera certificado autoassinado para desenvolvimento se mkcert não estiver disponível.
 * Saída: frontend/certs/merceariarv.app.pem e merceariarv.app-key.pem
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const certDir = path.join(__dirname, '..', 'frontend', 'certs');
if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });

const certPath = path.join(certDir, 'merceariarv.app.pem');
const keyPath = path.join(certDir, 'merceariarv.app-key.pem');

// Se já existem, não sobrescrever
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  console.log('Certificados já existem, nada a fazer.');
  process.exit(0);
}

function hasMkcert() {
  try {
    execSync('mkcert -help', { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

try {
  if (hasMkcert()) {
    console.log('Usando mkcert para gerar certificados...');
    // mkcert cria arquivos nomeados com o host; vamos gerar e renomear se necessário
    process.chdir(certDir);
    execSync('mkcert merceariarv.app "*.merceariarv.app" localhost 127.0.0.1 ::1', { stdio: 'inherit' });
    // Localizar arquivos mais recentes
    const files = fs.readdirSync(certDir).filter(f => f.endsWith('.pem'));
    // Procurar par key+crt convencional
    const possibleKey = files.find(f => f.includes('key') || f.endsWith('-key.pem'));
    const possibleCert = files.find(f => !f.includes('key'));
    if (possibleCert && !fs.existsSync(certPath)) fs.copyFileSync(path.join(certDir, possibleCert), certPath);
    if (possibleKey && !fs.existsSync(keyPath)) fs.copyFileSync(path.join(certDir, possibleKey), keyPath);
    console.log('Certificados gerados via mkcert.');
  } else {
    console.log('mkcert não encontrado. Gerando certificado autoassinado via OpenSSL...');
    const subj = '/C=BR/ST=SP/L=Local/O=Dev/OU=Dev/CN=merceariarv.app';
    const cmd = `openssl req -x509 -nodes -days 825 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -subj "${subj}" -addext "subjectAltName=DNS:merceariarv.app,DNS:localhost,IP:127.0.0.1"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log('Certificado autoassinado gerado.');
  }
  console.log('Pronto. Use: cd frontend && npm run start:https');
} catch (e) {
  console.error('Falha ao gerar certificados:', e.message || e);
  process.exit(1);
}
