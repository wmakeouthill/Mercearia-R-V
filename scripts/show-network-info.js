const os = require('os');

function getNetworkIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];

    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            // Pular loopback e interfaces não IPv4
            if (interface.family === 'IPv4' && !interface.internal) {
                ips.push({
                    name: name,
                    ip: interface.address
                });
            }
        }
    }

    return ips;
}

function showNetworkInfo() {
    console.log('\n🌐 INFORMAÇÕES DE REDE - ACESSO AO FRONTEND');
    console.log('='.repeat(50));

    const ips = getNetworkIPs();

    console.log('\n📱 ACESSO LOCAL:');
    console.log('  http://localhost:4200');
    console.log('  http://127.0.0.1:4200');

    if (ips.length > 0) {
        console.log('\n🌍 ACESSO NA REDE LOCAL:');
        ips.forEach(({ name, ip }) => {
            console.log(`  http://${ip}:4200 (${name})`);
        });

        console.log('\n📋 BACKEND (API):');
        console.log('  http://localhost:3000');
        ips.forEach(({ ip }) => {
            console.log(`  http://${ip}:3000`);
        });
    } else {
        console.log('\n⚠️  Nenhuma interface de rede encontrada');
    }

    console.log('\n💡 DICAS:');
    console.log('  • Use os IPs acima para acessar de outros dispositivos');
    console.log('  • Certifique-se que o firewall permite conexões na porta 4200');
    console.log('  • Para Electron + rede: npm run dev:network');
    console.log('  • Para apenas frontend na rede: cd frontend && npm run start:network');
    console.log('='.repeat(50));
}

// Executar se chamado diretamente
if (require.main === module) {
    showNetworkInfo();
}

module.exports = { getNetworkIPs, showNetworkInfo };