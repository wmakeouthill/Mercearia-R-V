const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { exec } = require('child_process');

/**
 * Detecta automaticamente a porta do PostgreSQL rodando
 */
async function detectPostgresPort() {
  const { Client } = require('pg');
  
  // Lista de portas comuns para PostgreSQL embedded + portas locais encontradas
  const commonPorts = [5432, 56983, 61549, 55432, 27060, 49673, 51368, 51370, 51930, 56200, 56352, 59969];
  
  console.log('🔍 Detectando porta do PostgreSQL...');
  
  for (const port of commonPorts) {
    try {
      const testClient = new Client({
        host: '127.0.0.1',
        port: port,
        database: 'postgres',
        user: 'postgres',
        password: '',
        connectionTimeoutMillis: 2000
      });
      
      await testClient.connect();
      await testClient.end();
      
      console.log(`✅ PostgreSQL encontrado na porta: ${port}`);
      return port;
    } catch (error) {
      // Porta não disponível ou sem PostgreSQL
      console.log(`❌ Porta ${port}: ${error.code || 'não disponível'}`);
      continue;
    }
  }
  
  // Se não encontrou, tenta ler dos logs do backend
  try {
    const fs = require('fs');
    const path = require('path');
    
    const backendLogPath = path.join(__dirname, '..', 'backend.log');
    if (fs.existsSync(backendLogPath)) {
      const logContent = fs.readFileSync(backendLogPath, 'utf8');
      const portMatch = logContent.match(/porta (\d+)/i);
      if (portMatch) {
        const port = parseInt(portMatch[1]);
        console.log(`� Porta encontrada nos logs: ${port}`);
        return port;
      }
    }
  } catch (error) {
    console.log('⚠️  Não foi possível ler os logs do backend');
  }
  
  throw new Error('❌ Não foi possível detectar a porta do PostgreSQL. Certifique-se de que o sistema está rodando com "npm run dev"');
}

// Configurações de conexão PostgreSQL (porta será detectada dinamicamente)
const PG_CONFIG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: null, // será definido dinamicamente
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || ''
};

const DUMP_FILE = path.join(__dirname, '..', 'db', 'dump_data.sql');
const MARKER_FILE = path.join(__dirname, '..', 'db', '.data-imported');

/**
 * Verifica se os dados já foram importados
 */
function isDataAlreadyImported() {
  return fs.existsSync(MARKER_FILE);
}

/**
 * Marca que os dados foram importados
 */
function markDataAsImported() {
  const timestamp = new Date().toISOString();
  const info = {
    imported_at: timestamp,
    dump_file: DUMP_FILE,
    records: {
      produtos: 0,
      vendas: 0
    }
  };
  
  fs.writeFileSync(MARKER_FILE, JSON.stringify(info, null, 2), 'utf8');
  console.log(`✓ Marcado como importado em: ${timestamp}`);
}

/**
 * Conta registros no dump SQL
 */
function countRecordsInDump(sql) {
  const produtosMatch = sql.match(/INSERT INTO produtos[^;]*;/g);
  const vendasMatch = sql.match(/INSERT INTO venda_cabecalho[^;]*;/g);
  
  return {
    produtos: produtosMatch ? produtosMatch.length : 0,
    vendas: vendasMatch ? vendasMatch.length : 0
  };
}

/**
 * Executa o dump SQL no PostgreSQL
 */
async function executeDump() {
  if (isDataAlreadyImported()) {
    console.log('⚠️  Os dados já foram importados anteriormente.');
    console.log('📄 Para reimportar, delete o arquivo:', MARKER_FILE);
    const markerContent = fs.readFileSync(MARKER_FILE, 'utf8');
    const info = JSON.parse(markerContent);
    console.log('📊 Importação anterior:', info.imported_at);
    return;
  }

  if (!fs.existsSync(DUMP_FILE)) {
    console.error(`❌ Arquivo de dump não encontrado: ${DUMP_FILE}`);
    console.log('💡 Execute primeiro: npm run dump-sqlite');
    process.exit(1);
  }

  console.log('🔄 Iniciando importação dos dados do SQLite para PostgreSQL...');
  console.log(`📂 Arquivo de dump: ${DUMP_FILE}`);
  
  // Detecta a porta do PostgreSQL automaticamente
  PG_CONFIG.port = await detectPostgresPort();
  console.log(`🗄️  Conexão PostgreSQL: ${PG_CONFIG.host}:${PG_CONFIG.port}/${PG_CONFIG.database}`);

  // Lê o arquivo SQL
  const sql = fs.readFileSync(DUMP_FILE, 'utf8');
  const recordCount = countRecordsInDump(sql);
  
  console.log(`📊 Registros a importar:`);
  console.log(`   - Produtos: ${recordCount.produtos}`);
  console.log(`   - Vendas: ${recordCount.vendas}`);

  // Conecta ao PostgreSQL
  const client = new Client(PG_CONFIG);
  
  try {
    console.log('🔌 Conectando ao PostgreSQL...');
    await client.connect();
    console.log('✓ Conectado com sucesso!');

    // Verifica se há dados existentes
    const produtosExistentes = await client.query('SELECT COUNT(*) as count FROM produtos');
    const vendasExistentes = await client.query('SELECT COUNT(*) as count FROM venda_cabecalho');
    
    const produtosCount = parseInt(produtosExistentes.rows[0].count);
    const vendasCount = parseInt(vendasExistentes.rows[0].count);

    if (produtosCount > 0 || vendasCount > 0) {
      console.log(`⚠️  Dados existentes encontrados:`);
      console.log(`   - Produtos: ${produtosCount}`);
      console.log(`   - Vendas: ${vendasCount}`);
      console.log('');
      
      // Pergunta se quer continuar
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        rl.question('🤔 Deseja continuar e sobrescrever os dados existentes? (s/N): ', resolve);
      });
      rl.close();
      
      if (answer.toLowerCase() !== 's' && answer.toLowerCase() !== 'sim') {
        console.log('❌ Importação cancelada pelo usuário.');
        process.exit(0);
      }
    }

    console.log('🗃️  Executando importação...');
    
    // Executa o SQL em uma transação
    await client.query('BEGIN');
    
    try {
      await client.query(sql);
      await client.query('COMMIT');
      
      console.log('✅ Importação concluída com sucesso!');
      
      // Verifica os dados importados
      const produtosImportados = await client.query('SELECT COUNT(*) as count FROM produtos');
      const vendasImportadas = await client.query('SELECT COUNT(*) as count FROM venda_cabecalho');
      const itensImportados = await client.query('SELECT COUNT(*) as count FROM venda_itens');
      const pagamentosImportados = await client.query('SELECT COUNT(*) as count FROM venda_pagamentos');
      
      console.log('📊 Dados no banco após importação:');
      console.log(`   - Produtos: ${produtosImportados.rows[0].count}`);
      console.log(`   - Vendas: ${vendasImportadas.rows[0].count}`);
      console.log(`   - Itens de venda: ${itensImportados.rows[0].count}`);
      console.log(`   - Pagamentos: ${pagamentosImportados.rows[0].count}`);
      
      markDataAsImported();
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Erro durante a importação:', error.message);
    if (error.code) {
      console.error(`   Código: ${error.code}`);
    }
    if (error.detail) {
      console.error(`   Detalhe: ${error.detail}`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

/**
 * Função para forçar reimportação (remove o marker)
 */
function resetImportMarker() {
  if (fs.existsSync(MARKER_FILE)) {
    fs.unlinkSync(MARKER_FILE);
    console.log('✓ Marker de importação removido. Você pode importar novamente.');
  } else {
    console.log('ℹ️  Nenhum marker de importação encontrado.');
  }
}

// Verifica argumentos da linha de comando
const args = process.argv.slice(2);

if (args.includes('--reset')) {
  resetImportMarker();
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('📖 Uso:');
  console.log('  npm run import-sqlite-data        # Importa os dados (apenas uma vez)');
  console.log('  npm run import-sqlite-data --reset # Remove marker para permitir nova importação');
  console.log('  npm run import-sqlite-data --help  # Mostra esta ajuda');
  process.exit(0);
}

// Execução principal
if (require.main === module) {
  executeDump().catch(console.error);
}

module.exports = { executeDump, resetImportMarker, isDataAlreadyImported };
