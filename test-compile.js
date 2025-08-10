// Script para testar compilação do frontend
const { exec } = require('child_process');

console.log('🔧 Testando compilação do frontend...');

exec('cd frontend && npm run build', (error, stdout, stderr) => {
    if (error) {
        console.error('❌ Erro na compilação:');
        console.error(error.message);
        return;
    }

    if (stderr) {
        console.log('⚠️ Warnings/Errors:');
        console.log(stderr);
    }

    if (stdout) {
        console.log('✅ Saída da compilação:');
        console.log(stdout);
    }

    console.log('🎉 Teste de compilação concluído!');
});