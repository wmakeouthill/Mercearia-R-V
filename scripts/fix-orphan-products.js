const { Client } = require('pg');

async function fixOrphanProducts() {
  const client = new Client({
    host: '127.0.0.1',
    port: 54191,
    database: 'postgres',
    user: 'postgres',
    password: ''
  });

  try {
    await client.connect();
    console.log('🔧 Corrigindo produtos órfãos...');
    
    // Lista dos IDs órfãos identificados
    const orphanIds = [1, 2, 3, 4, 5, 7, 9, 10];
    
    // Criar produtos placeholder para os IDs órfãos
    for (const id of orphanIds) {
      const checkExists = await client.query('SELECT id FROM produtos WHERE id = $1', [id]);
      if (checkExists.rows.length === 0) {
        await client.query(
          'INSERT INTO produtos (id, nome, preco_venda, quantidade_estoque) VALUES ($1, $2, $3, $4)',
          [id, `Produto Legacy ${id}`, 1.00, 0]
        );
        console.log('✅ Criado produto placeholder para ID:', id);
      }
    }
    
    // Verificar se ainda há órfãos
    const orphanQuery = 'SELECT DISTINCT vi.produto_id FROM venda_itens vi LEFT JOIN produtos p ON vi.produto_id = p.id WHERE p.id IS NULL';
    const remainingOrphans = await client.query(orphanQuery);
    
    if (remainingOrphans.rows.length === 0) {
      console.log('\n🎉 Todos os produtos órfãos foram corrigidos!');
      
      // Testar uma consulta que estava falhando
      const testQuery = 'SELECT COUNT(*) as total FROM venda_itens vi INNER JOIN produtos p ON vi.produto_id = p.id';
      const testResult = await client.query(testQuery);
      console.log('✅ Teste de integridade:', testResult.rows[0].total, 'itens de venda com produtos válidos');
      
      // Verificar se o endpoint de checkout agora funciona
      console.log('\n📊 Resumo final:');
      const vendas = await client.query('SELECT COUNT(*) as total FROM venda_cabecalho');
      const itens = await client.query('SELECT COUNT(*) as total FROM venda_itens');
      const produtos = await client.query('SELECT COUNT(*) as total FROM produtos');
      
      console.log('  - Vendas:', vendas.rows[0].total);
      console.log('  - Itens de venda:', itens.rows[0].total);
      console.log('  - Produtos:', produtos.rows[0].total);
      console.log('\n💡 O sistema deve funcionar sem erros 500 agora!');
      
    } else {
      console.log('❌ Ainda há produtos órfãos:', remainingOrphans.rows.map(r => r.produto_id));
    }
    
    await client.end();
  } catch (err) {
    console.log('❌ Erro:', err.message);
    console.log('Stack:', err.stack);
  }
}

fixOrphanProducts();
