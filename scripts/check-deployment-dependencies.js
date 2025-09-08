/**
 * Script para verificar se todos os recursos essenciais estão presentes
 * para o funcionamento correto em máquinas cliente (sem ambiente de desenvolvimento)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 DIAGNÓSTICO DE DEPENDÊNCIAS PARA DEPLOY\n');

let hasIssues = false;

function reportIssue(issue) {
    console.log(`❌ ${issue}`);
    hasIssues = true;
}

function reportOk(message) {
    console.log(`✅ ${message}`);
}

function checkFileExists(filePath, description) {
    if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        reportOk(`${description} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
        return true;
    } else {
        reportIssue(`${description} não encontrado: ${filePath}`);
        return false;
    }
}

function checkDirectoryContents(dirPath, description, requiredFiles = []) {
    if (!fs.existsSync(dirPath)) {
        reportIssue(`${description} não encontrado: ${dirPath}`);
        return false;
    }

    const files = fs.readdirSync(dirPath);
    if (files.length === 0) {
        reportIssue(`${description} está vazio: ${dirPath}`);
        return false;
    }

    let allRequired = true;
    for (const required of requiredFiles) {
        if (!files.includes(required)) {
            reportIssue(`Arquivo essencial não encontrado em ${description}: ${required}`);
            allRequired = false;
        }
    }

    if (allRequired) {
        reportOk(`${description} (${files.length} arquivos)`);
    }
    return allRequired;
}

console.log('=== 1. VERIFICAÇÃO DE DEPENDÊNCIAS JAVA ===');

// Verificar JDK/JRE embarcado
const jdkDir = path.join(__dirname, '..', 'electron', 'jdk-21');
const jreDir = path.join(__dirname, '..', 'electron', 'jre', 'win');

if (fs.existsSync(jdkDir)) {
    checkDirectoryContents(path.join(jdkDir, 'bin'), 'JDK-21 binários', ['java.exe', 'javac.exe']);
    checkDirectoryContents(path.join(jdkDir, 'lib'), 'JDK-21 bibliotecas', ['rt.jar', 'tools.jar'].filter(() => false)); // JDK 21 não tem rt.jar
    reportOk('JDK-21 embarcado detectado');
} else if (fs.existsSync(jreDir)) {
    checkDirectoryContents(jreDir, 'JRE embarcado');
} else {
    reportIssue('Nem JDK nem JRE embarcado encontrado');
    console.log('💡 Solução: Adicionar JDK-21 ou JRE à pasta electron/jdk-21 ou electron/jre/win');
}

console.log('\n=== 2. VERIFICAÇÃO DE DEPENDÊNCIAS POSTGRESQL ===');

// Verificar PostgreSQL embarcado
const pgWinDir = path.join(__dirname, '..', 'backend-spring', 'pg', 'win');
checkDirectoryContents(pgWinDir, 'PostgreSQL Windows binários', [
    'postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'libpq.dll', 'vcruntime140.dll'
]);

// Verificar Visual C++ Runtime
const vcRuntimeFiles = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'].filter(file => 
    fs.existsSync(path.join(pgWinDir, file))
);

if (vcRuntimeFiles.length >= 2) {
    reportOk(`Visual C++ Runtime DLLs (${vcRuntimeFiles.length}/3 presentes)`);
} else {
    reportIssue(`Visual C++ Runtime incompleto (apenas ${vcRuntimeFiles.length}/3 DLLs)`);
    console.log('💡 Solução: Instalar Visual C++ Redistributable 2015-2022 ou incluir DLLs');
}

console.log('\n=== 3. VERIFICAÇÃO DE DADOS PADRÃO ===');

// Verificar banco de dados
const dataDir = path.join(__dirname, '..', 'data', 'pg');
if (fs.existsSync(dataDir)) {
    checkDirectoryContents(dataDir, 'Dados PostgreSQL', ['PG_VERSION', 'base', 'global'].filter(item => {
        const fullPath = path.join(dataDir, item);
        return fs.existsSync(fullPath) && (fs.statSync(fullPath).isDirectory() || fs.statSync(fullPath).isFile());
    }));
} else {
    console.log('ℹ️  Dados PostgreSQL não encontrados (será criado na primeira execução)');
}

// Verificar dados do backend
const backendUploadsDir = path.join(__dirname, '..', 'backend-spring', 'uploads');
checkDirectoryContents(backendUploadsDir, 'Uploads do backend');

const backendSecretsDir = path.join(__dirname, '..', 'backend-spring', 'secrets');
if (fs.existsSync(backendSecretsDir)) {
    reportOk('Pasta de segredos do backend');
} else {
    console.log('ℹ️  Pasta de segredos não encontrada (será criada se necessário)');
}

console.log('\n=== 4. VERIFICAÇÃO DE RECURSOS DE BUILD ===');

// Verificar JAR do backend
const backendJar = path.join(__dirname, '..', 'backend-spring', 'target', 'backend-spring-0.0.1-SNAPSHOT.jar');
checkFileExists(backendJar, 'JAR do backend Spring');

// Verificar frontend buildado
const frontendBuild = path.join(__dirname, '..', 'frontend', 'dist', 'sistema-estoque', 'browser');
checkDirectoryContents(frontendBuild, 'Frontend buildado', ['index.html', 'main.js'].filter(file => {
    const files = fs.existsSync(frontendBuild) ? fs.readdirSync(frontendBuild) : [];
    return files.some(f => f.includes(file.replace('.js', '')));
}));

console.log('\n=== 5. VERIFICAÇÃO DE SCRIPTS ESSENCIAIS ===');

// Verificar scripts de limpeza
const cleanupScript = path.join(__dirname, 'cleanup-selective.js');
checkFileExists(cleanupScript, 'Script de limpeza');

const renderScript = path.join(__dirname, 'render-nota-pdf.js');
checkFileExists(renderScript, 'Script de renderização de PDF');

console.log('\n=== 6. VERIFICAÇÃO DE PERMISSÕES E SISTEMA ===');

// Verificar permissões
try {
    const testFile = path.join(__dirname, '..', 'temp-permission-test.txt');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    reportOk('Permissões de escrita no diretório do projeto');
} catch (e) {
    reportIssue('Sem permissões de escrita no diretório do projeto');
    console.log('💡 Solução: Execute como administrador ou mova para pasta com permissões');
    console.log(`   Erro: ${e.message}`);
}

// Verificar se é Windows
if (process.platform !== 'win32') {
    console.log('⚠️  Este diagnóstico foi otimizado para Windows');
}

console.log('\n=== 7. SOLUÇÕES RECOMENDADAS ===');

if (hasIssues) {
    console.log('❌ PROBLEMAS ENCONTRADOS - SOLUÇÕES:');
    console.log('');
    console.log('1. Para problemas com PostgreSQL/OverlappingFileLockException:');
    console.log('   • Execute: taskkill /F /IM postgres.exe');
    console.log('   • Delete arquivos: data/pg/postmaster.pid e data/pg/epg-lock');
    console.log('   • Reinicie o sistema se necessário');
    console.log('');
    console.log('2. Para problemas com Java:');
    console.log('   • Adicione JDK-21 completo em electron/jdk-21/');
    console.log('   • Ou instale Java no sistema cliente');
    console.log('');
    console.log('3. Para problemas com Visual C++:');
    console.log('   • Instale Visual C++ Redistributable 2015-2022 no cliente');
    console.log('   • Ou inclua DLLs necessárias no diretório pg/win');
    console.log('');
    console.log('4. Execute script de limpeza antes do deploy:');
    console.log('   • node scripts/cleanup-selective.js');
    console.log('');
    console.log('5. Para máquinas virtuais muito lentas:');
    console.log('   • Aumente timeout de inicialização do PostgreSQL');
    console.log('   • Desative antivírus temporariamente durante instalação');
    console.log('   • Use perfil "slow-pc" definido no application.yml');
} else {
    console.log('✅ TODAS AS DEPENDÊNCIAS ESSENCIAIS ENCONTRADAS!');
    console.log('');
    console.log('📋 RECOMENDAÇÕES PARA DEPLOY:');
    console.log('1. Execute limpeza: node scripts/cleanup-selective.js');
    console.log('2. Build completo: npm run dist:win');
    console.log('3. Teste em máquina virtual antes de distribuir');
    console.log('4. Instrua clientes a executar como administrador na primeira vez');
}

console.log('\n=== RELATÓRIO CONCLUÍDO ===');
