const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🔍 Procurando logs do backend em produção...');

// Possíveis localizações dos logs do backend
const possibleLogPaths = [
    // Logs na pasta do usuário (AppData)
    path.join(os.homedir(), 'AppData', 'Roaming', 'mercearia-rv', 'logs', 'backend.log'),
    path.join(os.homedir(), 'AppData', 'Local', 'mercearia-rv', 'logs', 'backend.log'),
    
    // Logs na pasta de instalação
    'C:\\Program Files\\Mercearia R-V\\logs\\backend.log',
    'C:\\Program Files (x86)\\Mercearia R-V\\logs\\backend.log',
    
    // Logs na pasta do executável
    path.join(process.cwd(), 'logs', 'backend.log'),
    path.join(process.cwd(), '..', 'logs', 'backend.log'),
    
    // Logs temporários
    path.join(os.tmpdir(), 'mercearia-rv', 'logs', 'backend.log'),
    
    // Logs no desktop
    path.join(os.homedir(), 'Desktop', 'Mercearia R-V', 'logs', 'backend.log'),
];

console.log('📁 Verificando localizações possíveis:');

let foundLogs = [];

for (const logPath of possibleLogPaths) {
    try {
        if (fs.existsSync(logPath)) {
            const stats = fs.statSync(logPath);
            console.log(`✅ ENCONTRADO: ${logPath}`);
            console.log(`   📅 Modificado: ${stats.mtime}`);
            console.log(`   📊 Tamanho: ${(stats.size / 1024).toFixed(2)} KB`);
            foundLogs.push({ path: logPath, stats });
        } else {
            console.log(`❌ Não existe: ${logPath}`);
        }
    } catch (error) {
        console.log(`⚠️  Erro ao verificar: ${logPath} - ${error.message}`);
    }
}

if (foundLogs.length === 0) {
    console.log('\n❌ Nenhum log do backend encontrado!');
    console.log('\n🔧 Possíveis soluções:');
    console.log('1. O aplicativo não foi executado ainda em produção');
    console.log('2. Os logs podem estar desabilitados');
    console.log('3. O aplicativo pode estar salvando logs em outra localização');
    
    // Tentar encontrar onde o executável está instalado
    console.log('\n🔍 Procurando executável instalado...');
    const commonInstallPaths = [
        'C:\\Program Files\\Mercearia R-V',
        'C:\\Program Files (x86)\\Mercearia R-V',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'mercearia-rv'),
        path.join(os.homedir(), 'Desktop', 'Mercearia R-V'),
    ];
    
    for (const installPath of commonInstallPaths) {
        try {
            if (fs.existsSync(installPath)) {
                console.log(`✅ Encontrada instalação: ${installPath}`);
                const files = fs.readdirSync(installPath);
                console.log(`   📁 Arquivos: ${files.join(', ')}`);
            }
        } catch (error) {
            // Ignorar
        }
    }
} else {
    console.log(`\n✅ Encontrados ${foundLogs.length} arquivo(s) de log!`);
    
    // Mostrar os últimos logs do arquivo mais recente
    const mostRecent = foundLogs.sort((a, b) => b.stats.mtime - a.stats.mtime)[0];
    console.log(`\n📖 Exibindo últimas 50 linhas do log mais recente:`);
    console.log(`📁 ${mostRecent.path}\n`);
    
    try {
        const content = fs.readFileSync(mostRecent.path, 'utf8');
        const lines = content.split('\n');
        const lastLines = lines.slice(-50).filter(line => line.trim());
        
        console.log('─'.repeat(80));
        lastLines.forEach(line => console.log(line));
        console.log('─'.repeat(80));
        
        // Procurar por erros relacionados ao restore
        console.log('\n🔍 Procurando erros relacionados ao restore:');
        const restoreErrors = lines.filter(line => 
            line.toLowerCase().includes('restore') && 
            (line.toLowerCase().includes('error') || line.toLowerCase().includes('exception'))
        );
        
        if (restoreErrors.length > 0) {
            console.log(`\n❌ Encontrados ${restoreErrors.length} erro(s) relacionados ao restore:`);
            restoreErrors.forEach(error => console.log(`   ${error}`));
        } else {
            console.log('\n✅ Nenhum erro específico de restore encontrado nos logs');
        }
        
    } catch (error) {
        console.log(`❌ Erro ao ler arquivo de log: ${error.message}`);
    }
}

console.log('\n🏁 Diagnóstico concluído!');
