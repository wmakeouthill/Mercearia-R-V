const fs = require('fs');
const path = require('path');

console.log('🔍 Verificando dependências para build de produção...\n');

// Verificar dependências do backend
const backendDeps = [
    '../backend/dist/server.js',
    '../backend/node_modules/express',
    '../backend/node_modules/sqlite3',
    '../backend/node_modules/bcrypt',
    '../backend/node_modules/jsonwebtoken',
    '../backend/node_modules/cors',
    '../backend/node_modules/helmet',
    '../backend/node_modules/express-rate-limit'
];

// Verificar dependências do frontend
const frontendDeps = [
    '../frontend/dist/sistema-estoque/browser/index.html',
    '../frontend/dist/sistema-estoque/browser/main-PWDGB2KM.js'
];

// Verificar dependências do electron
const electronDeps = [
    '../electron/dist/main.js',
    '../electron/node_modules/electron'
];

console.log('📦 Backend Dependencies:');
backendDeps.forEach(dep => {
    const fullPath = path.join(__dirname, dep);
    const exists = fs.existsSync(fullPath);
    console.log(`  ${exists ? '✅' : '❌'} ${dep}`);
    if (!exists) {
        console.log(`    ⚠️  Arquivo não encontrado: ${fullPath}`);
    }
});

console.log('\n🌐 Frontend Dependencies:');
frontendDeps.forEach(dep => {
    const fullPath = path.join(__dirname, dep);
    const exists = fs.existsSync(fullPath);
    console.log(`  ${exists ? '✅' : '❌'} ${dep}`);
    if (!exists) {
        console.log(`    ⚠️  Arquivo não encontrado: ${fullPath}`);
    }
});

console.log('\n⚡ Electron Dependencies:');
electronDeps.forEach(dep => {
    const fullPath = path.join(__dirname, dep);
    const exists = fs.existsSync(fullPath);
    console.log(`  ${exists ? '✅' : '❌'} ${dep}`);
    if (!exists) {
        console.log(`    ⚠️  Arquivo não encontrado: ${fullPath}`);
    }
});

// Verificar tamanho do node_modules do backend
const backendNodeModulesPath = path.join(__dirname, '../backend/node_modules');
if (fs.existsSync(backendNodeModulesPath)) {
    const stats = fs.statSync(backendNodeModulesPath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`\n📊 Tamanho do node_modules do backend: ${sizeInMB} MB`);
}

console.log('\n🎯 Status do Build:');
console.log('  Para funcionar standalone, o electron-builder deve incluir:');
console.log('  ✅ Backend compilado (dist/)');
console.log('  ✅ Dependências do backend (node_modules/)');
console.log('  ✅ Frontend buildado (dist/sistema-estoque/browser/)');
console.log('  ✅ Banco de dados (database.sqlite)');
console.log('  ✅ Electron compilado');

console.log('\n💡 Dica: Execute "npm run build:all" antes de "npm run dist:win"'); 