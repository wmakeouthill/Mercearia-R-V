const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

async function investigateSQLiteVendas() {
  return new Promise((resolve, reject) => {
    console.log('🔍 Investigando vendas no SQLite original...');

    // Primeiro verificar a estrutura da tabela de vendas
    db.all('PRAGMA table_info(vendas)', [], (err, columns) => {
      if (err) {
        console.log('❌ Erro:', err.message);
        reject(err);
        return;
      }
      
      console.log('Colunas da tabela vendas no SQLite:');
      columns.forEach(col => {
        console.log('  -', col.name, '(' + col.type + ')');
      });
      
      // Verificar se há produtos órfãos nas vendas do SQLite
      db.all('SELECT produto_id, COUNT(*) as count FROM vendas GROUP BY produto_id ORDER BY produto_id', [], (err2, rows) => {
        if (err2) {
          console.log('❌ Erro ao buscar vendas:', err2.message);
          reject(err2);
          return;
        }
        
        console.log('\n📊 Produtos referenciados nas vendas do SQLite:');
        const legacyIds = [1, 2, 3, 4, 5, 7, 9, 10];
        
        rows.forEach(row => {
          const isLegacy = legacyIds.includes(row.produto_id);
          const marker = isLegacy ? '🔸 ÓRFÃO' : '  ';
          console.log(marker, 'Produto ID:', row.produto_id, '- Vendas:', row.count);
        });
        
        // Verificar detalhes das vendas órfãs
        const orphanProductIds = rows.filter(r => legacyIds.includes(r.produto_id)).map(r => r.produto_id);
        
        if (orphanProductIds.length > 0) {
          console.log('\n🔍 Detalhes das vendas com produtos órfãos:');
          
          let processed = 0;
          orphanProductIds.forEach(prodId => {
            db.all('SELECT * FROM vendas WHERE produto_id = ? LIMIT 3', [prodId], (err3, vendas) => {
              if (!err3) {
                console.log('\n  Produto ID', prodId + ':');
                vendas.forEach(v => {
                  console.log('    - Data:', v.data_hora_venda);
                  console.log('    - Quantidade:', v.quantidade);
                  console.log('    - Preço unitário:', v.preco_unitario);
                  console.log('    - Total item:', v.total_item);
                  console.log('    ---');
                });
              }
              
              processed++;
              if (processed === orphanProductIds.length) {
                db.close();
                resolve();
              }
            });
          });
        } else {
          console.log('\n✅ Não há produtos órfãos nas vendas do SQLite original!');
          db.close();
          resolve();
        }
      });
    });
  });
}

investigateSQLiteVendas().catch(console.error);
