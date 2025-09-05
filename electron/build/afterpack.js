const fs = require('fs');
const path = require('path');

/**
 * Hook afterPack do electron-builder
 * Executado DEPOIS do empacotamento mas ANTES da criação do instalador NSIS
 */
module.exports = async function (context) {
    const { electronPlatformName, appOutDir } = context;
    
    console.log('\n=== AfterPack Hook Starting ===');
    console.log(`Platform: ${electronPlatformName}`);
    console.log(`App Output Dir: ${appOutDir}`);
    
    if (electronPlatformName !== 'win32') {
        console.log('Skipping database copy for non-Windows platform');
        return;
    }

    // Usar a mesma lógica do copy-db-for-build.js
    const copyDbScript = path.join(__dirname, '../../scripts/copy-db-for-build.js');
    
    console.log(`\n=== Copying database files to: ${appOutDir} ===`);
    
    // Definir variável de ambiente para indicar que estamos no afterPack
    process.env.AFTERPACK_TARGET_DIR = appOutDir;
    
    try {
        // Importar e executar o script de cópia
        const copyDb = require(copyDbScript);
        
        // Se o script exporta uma função, executá-la
        if (typeof copyDb === 'function') {
            await copyDb();
        } else {
            // Se não, executar como subprocess
            const { spawn } = require('child_process');
            
            return new Promise((resolve, reject) => {
                const child = spawn('node', [copyDbScript], {
                    stdio: 'inherit',
                    env: { ...process.env, AFTERPACK_TARGET_DIR: appOutDir }
                });
                
                child.on('close', (code) => {
                    if (code === 0) {
                        console.log('Database copy completed successfully');
                        resolve();
                    } else {
                        reject(new Error(`Database copy failed with code ${code}`));
                    }
                });
            });
        }
    } catch (error) {
        console.error('Error during afterPack database copy:', error);
        throw error;
    }
    
    console.log('=== AfterPack Hook Completed ===\n');
};
