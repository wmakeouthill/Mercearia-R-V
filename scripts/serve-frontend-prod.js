const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 4200;

// Função para obter IPs da rede
function getNetworkIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    
    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            if (interface.family === 'IPv4' && !interface.internal) {
                ips.push(interface.address);
            }
        }
    }
    
    return ips;
}

// Caminho para o frontend buildado
const frontendPath = path.join(__dirname, '../frontend/dist/sistema-estoque/browser');

// Verificar se o build existe
if (!fs.existsSync(frontendPath)) {
    console.error('❌ Frontend não encontrado em:', frontendPath);
    console.log('💡 Execute primeiro: npm run build:frontend');
    process.exit(1);
}

// Servir arquivos estáticos
app.use(express.static(frontendPath));

// SPA fallback - todas as rotas retornam index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Configurar CORS para permitir acesso do backend
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    next();
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('🌐 FRONTEND PRODUÇÃO SERVIDO COM SUCESSO!');
    console.log('='.repeat(50));
    console.log('\n📱 ACESSO LOCAL:');
    console.log(`  http://localhost:${PORT}`);
    console.log(`  http://127.0.0.1:${PORT}`);
    
    const ips = getNetworkIPs();
    if (ips.length > 0) {
        console.log('\n🌍 ACESSO NA REDE:');
        ips.forEach(ip => {
            console.log(`  http://${ip}:${PORT}`);
        });
    }
    
    console.log('\n🔗 BACKEND (API):');
    console.log(`  http://localhost:3000`);
    ips.forEach(ip => {
        console.log(`  http://${ip}:3000`);
    });
    
    console.log('\n💡 IMPORTANTE:');
    console.log('  • Este servidor serve o frontend de PRODUÇÃO');
    console.log('  • Certifique-se que o backend esteja rodando');
    console.log('  • Use Ctrl+C para parar o servidor');
    console.log('='.repeat(50));
});