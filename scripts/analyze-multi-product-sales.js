const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');

async function analyzeMultiProductSales() {
  console.log('🔍 Analisando vendas com múltiplos produtos...');
  
  // Primeiro, analisar SQLite
  const sqliteResults = await new Promise((resolve, reject) => {
    const db = new sqlite3.Database('./database.sqlite');
    
    db.all(`
      SELECT 
        data_venda,
        COUNT(*) as produtos_por_venda,
        SUM(preco_total) as valor_total_venda,
        GROUP_CONCAT(produto_id) as produto_ids,
        GROUP_CONCAT(quantidade_vendida) as quantidades
      FROM vendas 
      GROUP BY data_venda 
      HAVING COUNT(*) > 1 
      ORDER BY data_venda
    `, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
      db.close();
    });
  });
  
  console.log('\n📊 SQLite - Vendas com múltiplos produtos:');
  console.log('Total de vendas multi-produto:', sqliteResults.length);
  
  if (sqliteResults.length > 0) {
    console.log('\nDetalhes das vendas multi-produto no SQLite:');
    sqliteResults.slice(0, 10).forEach((venda, index) => {
      console.log(`\n${index + 1}. Data: ${venda.data_venda}`);
      console.log(`   Produtos: ${venda.produtos_por_venda} itens`);
      console.log(`   IDs: ${venda.produto_ids}`);
      console.log(`   Quantidades: ${venda.quantidades}`);
      console.log(`   Valor total: R$ ${venda.valor_total_venda}`);
    });
    
    if (sqliteResults.length > 10) {
      console.log(`\n... e mais ${sqliteResults.length - 10} vendas multi-produto`);
    }
  }
  
  // Agora analisar PostgreSQL
  const client = new Client({
    host: '127.0.0.1',
    port: 54191,
    database: 'postgres',
    user: 'postgres',
    password: ''
  });
  
  try {
    await client.connect();
    
    // Verificar vendas com múltiplos itens no PostgreSQL
    const pgMultiSales = await client.query(`
      SELECT 
        vc.data_venda,
        vc.id as venda_id,
        COUNT(vi.id) as itens_por_venda,
        SUM(vi.preco_total) as valor_total,
        STRING_AGG(vi.produto_id::text, ',') as produto_ids,
        STRING_AGG(vi.quantidade::text, ',') as quantidades
      FROM venda_cabecalho vc
      INNER JOIN venda_itens vi ON vc.id = vi.venda_id
      GROUP BY vc.id, vc.data_venda
      HAVING COUNT(vi.id) > 1
      ORDER BY vc.data_venda
    `);
    
    console.log('\n📊 PostgreSQL - Vendas com múltiplos itens:');
    console.log('Total de vendas multi-item:', pgMultiSales.rows.length);
    
    if (pgMultiSales.rows.length > 0) {
      console.log('\nDetalhes das vendas multi-item no PostgreSQL:');
      pgMultiSales.rows.slice(0, 10).forEach((venda, index) => {
        console.log(`\n${index + 1}. Venda ID: ${venda.venda_id}`);
        console.log(`   Data: ${venda.data_venda}`);
        console.log(`   Itens: ${venda.itens_por_venda}`);
        console.log(`   Produtos: ${venda.produto_ids}`);
        console.log(`   Quantidades: ${venda.quantidades}`);
        console.log(`   Valor: R$ ${venda.valor_total}`);
      });
      
      if (pgMultiSales.rows.length > 10) {
        console.log(`\n... e mais ${pgMultiSales.rows.length - 10} vendas multi-item`);
      }
    }
    
    // Comparar estruturas
    console.log('\n🔄 COMPARAÇÃO DA MIGRAÇÃO:');
    console.log(`SQLite: ${sqliteResults.length} vendas com múltiplos produtos`);
    console.log(`PostgreSQL: ${pgMultiSales.rows.length} vendas com múltiplos itens`);
    
    if (sqliteResults.length > 0 && pgMultiSales.rows.length === 0) {
      console.log('\n❌ PROBLEMA: Vendas multi-produto do SQLite foram separadas incorretamente!');
      console.log('💡 As vendas foram migradas linha por linha ao invés de agrupadas.');
    } else if (sqliteResults.length === 0 && pgMultiSales.rows.length === 0) {
      console.log('\n✅ OK: Não há vendas multi-produto em nenhum dos bancos.');
    } else {
      console.log('\n✅ Estrutura parece correta - analisando compatibilidade...');
    }
    
    // Verificar se todas as vendas no PostgreSQL têm apenas 1 item
    const singleItemSales = await client.query(`
      SELECT COUNT(*) as count
      FROM venda_cabecalho vc
      INNER JOIN venda_itens vi ON vc.id = vi.venda_id
      GROUP BY vc.id
      HAVING COUNT(vi.id) = 1
    `);
    
    const totalSales = await client.query('SELECT COUNT(*) as count FROM venda_cabecalho');
    
    console.log('\n📈 ANÁLISE ESTRUTURAL:');
    console.log(`Total de vendas: ${totalSales.rows[0].count}`);
    console.log(`Vendas com 1 item: ${singleItemSales.rows.length}`);
    console.log(`Vendas com múltiplos itens: ${pgMultiSales.rows.length}`);
    
    if (singleItemSales.rows.length === parseInt(totalSales.rows[0].count)) {
      console.log('\n🤔 SUSPEITO: Todas as vendas têm exatamente 1 item.');
      console.log('💡 Isso pode indicar que vendas multi-produto foram separadas incorretamente.');
    }
    
    await client.end();
    
  } catch (err) {
    console.log('❌ Erro PostgreSQL:', err.message);
  }
}

analyzeMultiProductSales().catch(console.error);
