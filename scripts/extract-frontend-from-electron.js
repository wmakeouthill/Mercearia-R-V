const fs = require('fs');
const path = require('path');

// Script para extrair frontend do executável do Electron para servir separadamente

function findElectronFrontend() {
    // Possíveis caminhos onde o frontend pode estar no build do Electron
    const possiblePaths = [
        path.join(__dirname, '../electron/dist-installer/win-unpacked/resources/frontend'),
        path.join(__dirname, '../electron/dist-installer/win-unpacked/resources/app/frontend'),
        path.join(__dirname, '../electron/resources/frontend'),
        path.join(__dirname, '../frontend/dist/sistema-estoque/browser')
    ];
    
    for (const frontendPath of possiblePaths) {
        if (fs.existsSync(frontendPath)) {
            const indexPath = path.join(frontendPath, 'index.html');
            if (fs.existsSync(indexPath)) {
                return frontendPath;
            }
        }
    }
    
    return null;
}

function copyFrontend(sourcePath, targetPath) {
    try {
        // Criar diretório de destino se não existir
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }
        
        // Copiar arquivos recursivamente
        const items = fs.readdirSync(sourcePath);
        
        for (const item of items) {
            const sourceItemPath = path.join(sourcePath, item);
            const targetItemPath = path.join(targetPath, item);
            
            const stat = fs.statSync(sourceItemPath);
            
            if (stat.isDirectory()) {
                copyFrontend(sourceItemPath, targetItemPath);
            } else {
                fs.copyFileSync(sourceItemPath, targetItemPath);
            }
        }
        
        return true;
    } catch (error) {
        console.error('Erro ao copiar:', error.message);
        return false;
    }
}

function extractFrontend() {
    console.log('🔍 Procurando frontend do Electron...');
    
    const frontendPath = findElectronFrontend();
    
    if (!frontendPath) {
        console.error('❌ Frontend não encontrado nos builds do Electron');
        console.log('💡 Certifique-se de que executou: npm run dist:win');
        return false;
    }
    
    console.log('✅ Frontend encontrado em:', frontendPath);
    
    const targetPath = path.join(__dirname, '../temp-frontend-extracted');
    
    console.log('📋 Extraindo frontend para:', targetPath);
    
    if (copyFrontend(frontendPath, targetPath)) {
        console.log('✅ Frontend extraído com sucesso!');
        console.log('\n🚀 Para servir o frontend:');
        console.log(`node -e "
            const express = require('express');
            const app = express();
            app.use(express.static('${targetPath}'));
            app.get('*', (req, res) => res.sendFile('${path.join(targetPath, 'index.html')}'));
            app.listen(4200, '0.0.0.0', () => console.log('Frontend servindo em http://localhost:4200'));
        "`);
        return true;
    } else {
        console.error('❌ Erro ao extrair frontend');
        return false;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    extractFrontend();
}

module.exports = { extractFrontend, findElectronFrontend };