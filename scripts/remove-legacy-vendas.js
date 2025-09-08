const { Client } = require('pg');

async function removeLegacyVendas() {
  const client = new Client({
    host: '127.0.0.1',
    port: 54191,
    database: 'postgres',
    user: 'postgres',
    password: ''
  });

  try {
    await client.connect();
    console.log('🗑️ Removendo vendas legacy...');
    
    const legacyIds = [1, 2, 3, 4, 5, 7, 9, 10];
    
    // Primeiro, buscar IDs das vendas que serão removidas
    const vendasParaRemover = await client.query(
      'SELECT DISTINCT vc.id FROM venda_cabecalho vc INNER JOIN venda_itens vi ON vc.id = vi.venda_id WHERE vi.produto_id = ANY($1)', 
      [legacyIds]
    );
    
    const vendaIds = vendasParaRemover.rows.map(row => row.id);
    console.log('📋 Vendas que serão removidas:', vendaIds.length, 'vendas');
    console.log('   IDs:', vendaIds.join(', '));
    
    // Começar transação
    await client.query('BEGIN');
    
    try {
      // 1. Remover venda_pagamentos das vendas legacy
      const pagamentosRemovidos = await client.query(
        'DELETE FROM venda_pagamentos WHERE venda_id = ANY($1)', 
        [vendaIds]
      );
      console.log('✅ Removidos', pagamentosRemovidos.rowCount, 'pagamentos');
      
      // 2. Remover venda_itens das vendas legacy
      const itensRemovidos = await client.query(
        'DELETE FROM venda_itens WHERE venda_id = ANY($1)', 
        [vendaIds]
      );
      console.log('✅ Removidos', itensRemovidos.rowCount, 'itens');
      
      // 3. Remover venda_cabecalho das vendas legacy
      const vendasRemovidas = await client.query(
        'DELETE FROM venda_cabecalho WHERE id = ANY($1)', 
        [vendaIds]
      );
      console.log('✅ Removidas', vendasRemovidas.rowCount, 'vendas');
      
      // 4. Remover produtos placeholder que não são mais necessários
      const produtosRemovidos = await client.query(
        'DELETE FROM produtos WHERE id = ANY($1)', 
        [legacyIds]
      );
      console.log('✅ Removidos', produtosRemovidos.rowCount, 'produtos placeholder');
      
      // Confirmar transação
      await client.query('COMMIT');
      
      // Verificar resultado final
      console.log('\n📊 RESULTADO FINAL:');
      const vendasRestantes = await client.query('SELECT COUNT(*) as count FROM venda_cabecalho');
      const itensRestantes = await client.query('SELECT COUNT(*) as count FROM venda_itens');
      const produtosRestantes = await client.query('SELECT COUNT(*) as count FROM produtos');
      
      console.log('  - Vendas restantes:', vendasRestantes.rows[0].count);
      console.log('  - Itens restantes:', itensRestantes.rows[0].count);
      console.log('  - Produtos restantes:', produtosRestantes.rows[0].count);
      
      console.log('\n🎉 Vendas legacy removidas com sucesso!');
      console.log('💡 O histórico agora contém apenas vendas de produtos válidos.');
      
    } catch (transactionError) {
      await client.query('ROLLBACK');
      console.log('❌ Erro na transação, rollback executado:', transactionError.message);
    }
    
    await client.end();
  } catch (err) {
    console.log('❌ Erro:', err.message);
  }
}

// Solicitar confirmação antes de executar
console.log('⚠️  ATENÇÃO: Esta operação irá REMOVER PERMANENTEMENTE:');
console.log('   - 17 vendas legacy (2.2% do total)');
console.log('   - Valor total: R$ 8.767,81');
console.log('   - Período: Jan/2024 a Jul/2025');
console.log('');
console.log('💡 Para confirmar, execute novamente com: node scripts/remove-legacy-vendas.js --confirm');

// Só executar se tiver confirmação
if (process.argv.includes('--confirm')) {
  removeLegacyVendas();
} else {
  console.log('🛡️  Operação cancelada - adicione --confirm para executar');
}
