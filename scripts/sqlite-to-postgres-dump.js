const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Configurações
const DB_PATH = path.join(__dirname, '..', 'database.sqlite');
const OUTPUT_FILE = path.join(__dirname, '..', 'database-dump.sql');

// Mapeamento de métodos de pagamento legacy
const METODO_PAGAMENTO_MAP = {
  'dinheiro': 'dinheiro',
  'cartao': 'cartao_credito', // Assumindo que cartão legacy era crédito
  'cartao_credito': 'cartao_credito',
  'cartao_debito': 'cartao_debito',
  'pix': 'pix',
  'debito': 'cartao_debito',
  'credito': 'cartao_credito'
};

/**
 * Escapa valores para SQL PostgreSQL
 */
function escapeValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Normaliza método de pagamento
 */
function normalizeMetodoPagamento(metodo) {
  if (!metodo) return 'dinheiro';
  const metodoLower = String(metodo).toLowerCase().trim();
  return METODO_PAGAMENTO_MAP[metodoLower] || 'dinheiro';
}

/**
 * Gera timestamp atual para campos created_at/updated_at
 */
function getCurrentTimestamp() {
  return new Date().toISOString();
}

/**
 * Faz dump da tabela produtos
 */
function dumpProdutos(db) {
  return new Promise((resolve, reject) => {
    const query = 'SELECT * FROM produtos ORDER BY id';
    
    db.all(query, [], (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      let sql = '\n-- DUMP DA TABELA PRODUTOS\n';
      sql += '-- Estrutura: id, nome, codigo_barras, preco_venda, quantidade_estoque, imagem\n\n';
      
      if (rows && rows.length > 0) {
        sql += 'INSERT INTO produtos (id, nome, codigo_barras, preco_venda, quantidade_estoque, imagem) VALUES\n';
        
        const values = rows.map(row => {
          return `(${escapeValue(row.id)}, ${escapeValue(row.nome)}, ${escapeValue(row.codigo_barras)}, ${escapeValue(row.preco_venda)}, ${escapeValue(row.quantidade_estoque)}, ${escapeValue(row.imagem)})`;
        });
        
        sql += values.join(',\n') + ';\n\n';
        
        // Atualiza sequence
        const maxId = Math.max(...rows.map(r => r.id || 0));
        sql += `SELECT setval('produtos_id_seq', ${maxId + 1}, false);\n\n`;
      } else {
        sql += '-- Nenhum produto encontrado\n\n';
      }

      console.log(`✓ Produtos: ${rows ? rows.length : 0} registros`);
      resolve(sql);
    });
  });
}

/**
 * Faz dump das vendas legacy e converte para nova estrutura
 */
function dumpVendas(db) {
  return new Promise((resolve, reject) => {
    // Primeiro, vamos verificar se existe a tabela vendas legacy
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='vendas'", [], (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      if (!row) {
        console.log('⚠ Tabela "vendas" legacy não encontrada. Verificando tabela "venda_cabecalho"...');
        dumpVendasNova(db).then(resolve).catch(reject);
        return;
      }

      // Existe tabela vendas legacy
      console.log('📋 Encontrada tabela "vendas" legacy. Convertendo...');
      
      const query = 'SELECT * FROM vendas ORDER BY id';
      
      db.all(query, [], (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        let sql = '\n-- DUMP DA TABELA VENDAS (CONVERTIDA DA ESTRUTURA LEGACY)\n';
        sql += '-- Conversão: vendas legacy -> venda_cabecalho + venda_itens + venda_pagamentos\n\n';
        
        if (rows && rows.length > 0) {
          const timestamp = getCurrentTimestamp();
          
          // Cabeçalhos das vendas
          sql += 'INSERT INTO venda_cabecalho (id, data_venda, subtotal, desconto, acrescimo, total_final, adjusted_total, customer_name, customer_email, customer_phone, cliente_id, operador_id, caixa_status_id, status) VALUES\n';
          
          const cabecalhoValues = rows.map(row => {
            const dataVenda = row.data_venda || row.data_hora || timestamp;
            const subtotal = row.preco_total || row.total || 0;
            const desconto = row.desconto || 0;
            const acrescimo = row.acrescimo || 0;
            const totalFinal = subtotal - desconto + acrescimo;
            
            return `(${escapeValue(row.id)}, ${escapeValue(dataVenda)}, ${escapeValue(subtotal)}, ${escapeValue(desconto)}, ${escapeValue(acrescimo)}, ${escapeValue(totalFinal)}, NULL, NULL, NULL, NULL, ${escapeValue(row.cliente_id)}, ${escapeValue(row.operador_id || row.usuario_id)}, ${escapeValue(row.caixa_status_id)}, 'completed')`;
          });
          
          sql += cabecalhoValues.join(',\n') + ';\n\n';
          
          // Itens das vendas (assumindo que cada venda legacy é um item único)
          sql += 'INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario, preco_total) VALUES\n';
          
          const itemValues = rows.map(row => {
            const quantidade = row.quantidade || 1;
            const precoTotal = row.preco_total || row.total || 0;
            const precoUnitario = quantidade > 0 ? precoTotal / quantidade : precoTotal;
            
            return `(${escapeValue(row.id)}, ${escapeValue(row.produto_id)}, ${escapeValue(quantidade)}, ${escapeValue(precoUnitario)}, ${escapeValue(precoTotal)})`;
          });
          
          sql += itemValues.join(',\n') + ';\n\n';
          
          // Pagamentos das vendas (convertendo método único para múltiplos)
          sql += 'INSERT INTO venda_pagamentos (venda_id, metodo, valor, troco, caixa_status_id) VALUES\n';
          
          const pagamentoValues = rows.map(row => {
            const metodo = normalizeMetodoPagamento(row.metodo_pagamento);
            const valor = row.preco_total || row.total || 0;
            const troco = row.troco || (metodo === 'dinheiro' ? (row.troco || 0) : 0);
            
            return `(${escapeValue(row.id)}, ${escapeValue(metodo)}, ${escapeValue(valor)}, ${escapeValue(troco)}, ${escapeValue(row.caixa_status_id)})`;
          });
          
          sql += pagamentoValues.join(',\n') + ';\n\n';
          
          // Atualiza sequences
          const maxId = Math.max(...rows.map(r => r.id || 0));
          sql += `SELECT setval('venda_cabecalho_id_seq', ${maxId + 1}, false);\n`;
          sql += `SELECT setval('venda_itens_id_seq', ${maxId * 10 + 1}, false);\n`;
          sql += `SELECT setval('venda_pagamentos_id_seq', ${maxId * 10 + 1}, false);\n\n`;
          
        } else {
          sql += '-- Nenhuma venda legacy encontrada\n\n';
        }

        console.log(`✓ Vendas Legacy: ${rows ? rows.length : 0} registros convertidos`);
        resolve(sql);
      });
    });
  });
}

/**
 * Faz dump das vendas já na nova estrutura
 */
function dumpVendasNova(db) {
  return new Promise((resolve, reject) => {
    let sql = '\n-- DUMP DAS VENDAS (ESTRUTURA NOVA)\n\n';
    
    // Dump venda_cabecalho
    db.all('SELECT * FROM venda_cabecalho ORDER BY id', [], (err, cabecalhos) => {
      if (err) {
        reject(err);
        return;
      }

      if (cabecalhos && cabecalhos.length > 0) {
        sql += 'INSERT INTO venda_cabecalho (id, data_venda, subtotal, desconto, acrescimo, total_final, adjusted_total, customer_name, customer_email, customer_phone, cliente_id, operador_id, caixa_status_id, status) VALUES\n';
        
        const cabecalhoValues = cabecalhos.map(row => {
          return `(${escapeValue(row.id)}, ${escapeValue(row.data_venda)}, ${escapeValue(row.subtotal)}, ${escapeValue(row.desconto)}, ${escapeValue(row.acrescimo)}, ${escapeValue(row.total_final)}, ${escapeValue(row.adjusted_total)}, ${escapeValue(row.customer_name)}, ${escapeValue(row.customer_email)}, ${escapeValue(row.customer_phone)}, ${escapeValue(row.cliente_id)}, ${escapeValue(row.operador_id)}, ${escapeValue(row.caixa_status_id)}, ${escapeValue(row.status || 'completed')})`;
        });
        
        sql += cabecalhoValues.join(',\n') + ';\n\n';
        
        const maxCabecalhoId = Math.max(...cabecalhos.map(r => r.id || 0));
        sql += `SELECT setval('venda_cabecalho_id_seq', ${maxCabecalhoId + 1}, false);\n\n`;
      }

      // Dump venda_itens
      db.all('SELECT * FROM venda_itens ORDER BY id', [], (err, itens) => {
        if (err) {
          reject(err);
          return;
        }

        if (itens && itens.length > 0) {
          sql += 'INSERT INTO venda_itens (id, venda_id, produto_id, quantidade, preco_unitario, preco_total) VALUES\n';
          
          const itemValues = itens.map(row => {
            return `(${escapeValue(row.id)}, ${escapeValue(row.venda_id)}, ${escapeValue(row.produto_id)}, ${escapeValue(row.quantidade)}, ${escapeValue(row.preco_unitario)}, ${escapeValue(row.preco_total)})`;
          });
          
          sql += itemValues.join(',\n') + ';\n\n';
          
          const maxItemId = Math.max(...itens.map(r => r.id || 0));
          sql += `SELECT setval('venda_itens_id_seq', ${maxItemId + 1}, false);\n\n`;
        }

        // Dump venda_pagamentos
        db.all('SELECT * FROM venda_pagamentos ORDER BY id', [], (err, pagamentos) => {
          if (err) {
            reject(err);
            return;
          }

          if (pagamentos && pagamentos.length > 0) {
            sql += 'INSERT INTO venda_pagamentos (id, venda_id, metodo, valor, troco, caixa_status_id) VALUES\n';
            
            const pagamentoValues = pagamentos.map(row => {
              const metodo = normalizeMetodoPagamento(row.metodo);
              return `(${escapeValue(row.id)}, ${escapeValue(row.venda_id)}, ${escapeValue(metodo)}, ${escapeValue(row.valor)}, ${escapeValue(row.troco)}, ${escapeValue(row.caixa_status_id)})`;
            });
            
            sql += pagamentoValues.join(',\n') + ';\n\n';
            
            const maxPagamentoId = Math.max(...pagamentos.map(r => r.id || 0));
            sql += `SELECT setval('venda_pagamentos_id_seq', ${maxPagamentoId + 1}, false);\n\n`;
          }

          console.log(`✓ Venda Cabeçalho: ${cabecalhos ? cabecalhos.length : 0} registros`);
          console.log(`✓ Venda Itens: ${itens ? itens.length : 0} registros`);
          console.log(`✓ Venda Pagamentos: ${pagamentos ? pagamentos.length : 0} registros`);
          resolve(sql);
        });
      });
    });
  });
}

/**
 * Função principal
 */
async function main() {
  console.log('🔄 Iniciando dump do SQLite para PostgreSQL...');
  console.log(`📂 Banco SQLite: ${DB_PATH}`);
  console.log(`📄 Arquivo de saída: ${OUTPUT_FILE}`);

  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ Arquivo de banco não encontrado: ${DB_PATH}`);
    process.exit(1);
  }

  const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

  try {
    let fullSql = '-- DUMP GERADO AUTOMATICAMENTE DO SQLITE PARA POSTGRESQL\n';
    fullSql += `-- Data: ${new Date().toISOString()}\n`;
    fullSql += '-- Estrutura convertida: vendas legacy -> vendas com múltiplos métodos de pagamento\n\n';
    
    fullSql += '-- Desabilita verificações durante inserção\n';
    fullSql += 'SET session_replication_role = replica;\n\n';

    // Dump produtos
    const produtosSql = await dumpProdutos(db);
    fullSql += produtosSql;

    // Dump vendas (detecta automaticamente se é legacy ou nova estrutura)
    const vendasSql = await dumpVendas(db);
    fullSql += vendasSql;

    fullSql += '-- Reabilita verificações\n';
    fullSql += 'SET session_replication_role = DEFAULT;\n\n';

    fullSql += '-- Atualiza estatísticas das tabelas\n';
    fullSql += 'ANALYZE produtos;\n';
    fullSql += 'ANALYZE venda_cabecalho;\n';
    fullSql += 'ANALYZE venda_itens;\n';
    fullSql += 'ANALYZE venda_pagamentos;\n\n';

    fullSql += '-- FIM DO DUMP\n';

    // Salva arquivo
    fs.writeFileSync(OUTPUT_FILE, fullSql, 'utf8');

    console.log(`✅ Dump concluído com sucesso!`);
    console.log(`📄 Arquivo gerado: ${OUTPUT_FILE}`);
    console.log(`📊 Tamanho: ${Math.round(fullSql.length / 1024)} KB`);

  } catch (error) {
    console.error('❌ Erro durante o dump:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Verifica se é execução direta
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
