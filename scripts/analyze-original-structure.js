const sqlite3 = require('sqlite3').verbose();

async function analyzeOriginalSQLiteStructure() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database('./database.sqlite');
    
    console.log('🔍 Análise detalhada do SQLite original...');
    
    // Verificar estrutura da tabela vendas
    db.all('PRAGMA table_info(vendas)', [], (err, columns) => {
      if (err) {
        console.log('❌ Erro:', err.message);
        reject(err);
        return;
      }
      
      console.log('\nColunas da tabela vendas:');
      columns.forEach(col => {
        console.log('  -', col.name, '(' + col.type + ')');
      });
      
      // Buscar algumas vendas de exemplo
      db.all('SELECT * FROM vendas ORDER BY data_venda LIMIT 15', [], (err2, rows) => {
        if (err2) {
          console.log('❌ Erro:', err2.message);
          reject(err2);
          return;
        }
        
        console.log('\n📋 Amostra de vendas do SQLite:');
        rows.forEach((venda, index) => {
          console.log(`Venda ${index + 1}:`);
          console.log(`  ID: ${venda.id}`);
          console.log(`  Data: ${venda.data_venda}`);
          console.log(`  Produto ID: ${venda.produto_id}`);
          console.log(`  Quantidade: ${venda.quantidade_vendida}`);
          console.log(`  Preço total: R$ ${venda.preco_total}`);
          console.log(`  Método pagamento: ${venda.metodo_pagamento}`);
          console.log('  ---');
        });
        
        // Verificar se há vendas na mesma data/hora que poderiam ser agrupadas
        db.all('SELECT data_venda, COUNT(*) as count FROM vendas GROUP BY data_venda ORDER BY count DESC LIMIT 10', [], (err3, groups) => {
          if (err3) {
            console.log('❌ Erro:', err3.message);
            reject(err3);
            return;
          }
          
          console.log('\n🕐 Vendas por data/hora (top 10):');
          groups.forEach(group => {
            console.log(`  Data: ${group.data_venda} - Vendas: ${group.count}`);
          });
          
          // Verificar padrões de datas próximas
          if (groups.length > 0 && groups[0].count > 1) {
            const dataComMaisVendas = groups[0].data_venda;
            db.all('SELECT * FROM vendas WHERE data_venda = ? ORDER BY id', [dataComMaisVendas], (err4, vendasMesmaData) => {
              if (!err4) {
                console.log(`\n🔍 Vendas na data com mais transações (${dataComMaisVendas}):`);
                vendasMesmaData.forEach((v, i) => {
                  console.log(`  ${i + 1}. ID:${v.id} - Produto:${v.produto_id} - Qtd:${v.quantidade_vendida} - Total:R$${v.preco_total} - Pagamento:${v.metodo_pagamento}`);
                });
                
                // Verificar se são produtos diferentes ou mesmo produto vendido separadamente
                const produtosDiferentes = new Set(vendasMesmaData.map(v => v.produto_id)).size;
                console.log(`\n📊 Análise dessa data:`);
                console.log(`  - Total de transações: ${vendasMesmaData.length}`);
                console.log(`  - Produtos diferentes: ${produtosDiferentes}`);
                console.log(`  - Métodos de pagamento: ${new Set(vendasMesmaData.map(v => v.metodo_pagamento)).size}`);
                
                if (produtosDiferentes === vendasMesmaData.length) {
                  console.log(`  ✅ Cada venda tem produto diferente - vendas individuais corretas`);
                } else {
                  console.log(`  🤔 Alguns produtos repetidos - podem ser vendas separadas do mesmo item`);
                }
              }
              
              // Conclusão
              console.log('\n📝 CONCLUSÃO SOBRE A ESTRUTURA ORIGINAL:');
              if (groups[0].count === 1) {
                console.log('✅ SQLite original: Cada venda já era individual (1 produto por venda)');
                console.log('✅ Migração: Estrutura mantida corretamente');
                console.log('💡 Sistema de vendas sempre foi produto-por-produto');
              } else {
                console.log('🔍 SQLite original: Há vendas na mesma data/hora');
                console.log('💭 Pode ser normal do fluxo de vendas ou vendas separadas intencionalmente');
              }
              
              db.close();
              resolve();
            });
          } else {
            console.log('\n✅ Confirmado: No SQLite, cada linha é uma venda individual única.');
            console.log('💡 A estrutura original já era 1 produto por venda.');
            db.close();
            resolve();
          }
        });
      });
    });
  });
}

analyzeOriginalSQLiteStructure().catch(console.error);
