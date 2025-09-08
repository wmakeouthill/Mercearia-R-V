const { Client } = require('pg');

async function analyzeLegacyImpact() {
  const client = new Client({
    host: '127.0.0.1',
    port: 54191,
    database: 'postgres',
    user: 'postgres',
    password: ''
  });

  try {
    await client.connect();
    console.log('📊 Analisando impacto das vendas legacy...');
    
    const legacyIds = [1, 2, 3, 4, 5, 7, 9, 10];
    
    // Contar vendas legacy
    const legacyVendas = await client.query(
      'SELECT COUNT(DISTINCT vc.id) as count FROM venda_cabecalho vc INNER JOIN venda_itens vi ON vc.id = vi.venda_id WHERE vi.produto_id = ANY($1)', 
      [legacyIds]
    );
    console.log('🔸 Vendas com produtos legacy:', legacyVendas.rows[0].count);
    
    // Contar total de vendas
    const totalVendas = await client.query('SELECT COUNT(*) as count FROM venda_cabecalho');
    console.log('📈 Total de vendas:', totalVendas.rows[0].count);
    
    // Calcular percentual
    const percentual = ((legacyVendas.rows[0].count / totalVendas.rows[0].count) * 100).toFixed(1);
    console.log('📊 Percentual legacy:', percentual + '%');
    
    // Verificar datas das vendas legacy
    const legacyDates = await client.query(
      'SELECT MIN(vc.data_venda) as primeira, MAX(vc.data_venda) as ultima FROM venda_cabecalho vc INNER JOIN venda_itens vi ON vc.id = vi.venda_id WHERE vi.produto_id = ANY($1)', 
      [legacyIds]
    );
    console.log('📅 Período das vendas legacy:', legacyDates.rows[0].primeira, 'a', legacyDates.rows[0].ultima);
    
    // Listar IDs específicos das vendas legacy
    const legacyVendaIds = await client.query(
      'SELECT DISTINCT vc.id, vc.data_venda FROM venda_cabecalho vc INNER JOIN venda_itens vi ON vc.id = vi.venda_id WHERE vi.produto_id = ANY($1) ORDER BY vc.data_venda', 
      [legacyIds]
    );
    console.log('\n🔍 IDs das vendas legacy:');
    legacyVendaIds.rows.forEach(v => {
      console.log('  - Venda ID:', v.id, '- Data:', v.data_venda);
    });
    
    // Verificar valor total das vendas legacy
    const legacyTotal = await client.query(
      'SELECT SUM(vc.total_final) as total FROM venda_cabecalho vc INNER JOIN venda_itens vi ON vc.id = vi.venda_id WHERE vi.produto_id = ANY($1)', 
      [legacyIds]
    );
    console.log('\n💰 Valor total das vendas legacy: R$', legacyTotal.rows[0].total);
    
    // Contar itens legacy
    const legacyItens = await client.query(
      'SELECT COUNT(*) as count FROM venda_itens WHERE produto_id = ANY($1)', 
      [legacyIds]
    );
    console.log('📦 Itens legacy:', legacyItens.rows[0].count);
    
    console.log('\n🤔 OPÇÕES:');
    console.log('1. 🗑️  REMOVER as vendas legacy (perder histórico)');
    console.log('2. 🏷️  MANTER com produtos placeholder (atual - recomendado)');
    console.log('3. 📝 RENOMEAR os produtos legacy com nomes descritivos');
    
    await client.end();
  } catch (err) {
    console.log('❌ Erro:', err.message);
  }
}

analyzeLegacyImpact();
