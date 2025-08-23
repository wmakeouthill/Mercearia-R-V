const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');

// Usage: node scripts/seed-2025.js [--api http://localhost:3000/api] [--db ./database.sqlite] [--pg]
// If --api is provided, the script will call the API endpoints (requires auth token env AUTH_TOKEN optional).
// If --pg is provided, the script will connect to Postgres using env vars or flags and insert directly (recommended to set PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD).

const argv = require('minimist')(process.argv.slice(2));

const API_BASE = argv.api || argv.A || null;
const DB_PATH = argv.db || argv.D || path.join(__dirname, '..', 'database.sqlite');
const AUTH_TOKEN = process.env.AUTH_TOKEN || null; // optional Bearer token for API mode
const USE_PG = argv.pg || argv.P || false;

const PGHOST = argv['pg-host'] || process.env.PGHOST || '127.0.0.1';
const PGPORT = argv['pg-port'] || process.env.PGPORT || process.env.DB_PORT || process.env.PGPORT || null;
const PGDATABASE = argv['pg-db'] || process.env.PGDATABASE || process.env.DB_NAME || process.env.DB_DATABASE || 'postgres';
const PGUSER = argv['pg-user'] || process.env.PGUSER || process.env.DB_USERNAME || process.env.DB_USER || 'postgres';
const PGPASSWORD = argv['pg-pass'] || process.env.PGPASSWORD || process.env.DB_PASSWORD || '';

const NUM_RECORDS = 500;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDateIn2025() {
  const start = new Date('2025-01-01T00:00:00Z').getTime();
  const end = new Date('2025-12-31T23:59:59Z').getTime();
  const t = randInt(start, end);
  return new Date(t).toISOString();
}

async function runApiMode() {
  if (!API_BASE) throw new Error('API base URL not provided');
  console.log('Running in API mode, base:', API_BASE);

  const client = axios.create({
    baseURL: API_BASE,
    headers: AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}
  });

  // fetch products
  let products = [];
  try {
    const res = await client.get('/produtos');
    products = res.data;
  } catch (e) {
    console.error('Failed to fetch products from API:', e.message);
    return;
  }

  if (!Array.isArray(products) || products.length === 0) {
    console.error('No products found. Create some products first or run script in DB mode.');
    return;
  }

  for (let i = 0; i < NUM_RECORDS; i++) {
    const chooseSale = Math.random() < 0.7; // more sales than manual mov
    if (chooseSale) {
      const p = products[randInt(0, products.length - 1)];
      const qty = randInt(1, Math.max(1, Math.min(10, p.quantidade_estoque || 10)));
      const price = (p.preco_venda || 1) * qty;
      const metodo = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'][randInt(0, 3)];
      try {
        const payload = {
          produto_id: p.id,
          quantidade_vendida: qty,
          preco_total: Number(price.toFixed(2)),
          metodo_pagamento: metodo
        };
        // create sale
        await client.post('/vendas', payload);
        // optionally patch the created sale to set custom date by direct DB mode not available via API
      } catch (e) {
        console.warn('sale insert failed (api):', e.response ? e.response.data : e.message);
      }
    } else {
      const tipo = Math.random() < 0.5 ? 'entrada' : 'retirada';
      const valor = Number((Math.random() * 200 + 1).toFixed(2));
      try {
        await client.post('/caixa/movimentacoes', { tipo, valor, descricao: 'Seed ' + tipo });
      } catch (e) {
        console.warn('mov insert failed (api):', e.response ? e.response.data : e.message);
      }
    }
  }
  console.log('API mode done. Note: API creates current timestamps; to set dates directly, run in DB mode.');
}

function runDbMode() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(DB_PATH)) {
      return reject(new Error('DB file not found: ' + DB_PATH));
    }
    const db = new sqlite3.Database(DB_PATH);

    db.serialize(() => {
      // read products
      db.all('SELECT id, preco_venda, quantidade_estoque FROM produtos', (err, rows) => {
        if (err) return reject(err);
        const products = rows || [];

        function createSampleProductsIfEmpty(cb) {
          if (products.length > 0) return cb(null, products);
          console.log('No products found. Creating sample products...');
          const sample = [
            { nome: 'Arroz 5kg', codigo_barras: '0001', preco_venda: 25.9, quantidade_estoque: 100 },
            { nome: 'Feijão 1kg', codigo_barras: '0002', preco_venda: 9.5, quantidade_estoque: 100 },
            { nome: 'Açúcar 1kg', codigo_barras: '0003', preco_venda: 4.75, quantidade_estoque: 100 },
            { nome: 'Óleo 900ml', codigo_barras: '0004', preco_venda: 7.5, quantidade_estoque: 100 },
            { nome: 'Leite 1L', codigo_barras: '0005', preco_venda: 3.99, quantidade_estoque: 100 }
          ];
          const insertP = db.prepare('INSERT INTO produtos(nome, codigo_barras, preco_venda, quantidade_estoque, imagem) VALUES (?, ?, ?, ?, ?)');
          for (const s of sample) {
            insertP.run(s.nome, s.codigo_barras, s.preco_venda, s.quantidade_estoque, null);
          }
          insertP.finalize(err2 => {
            if (err2) return cb(err2);
            db.all('SELECT id, preco_venda, quantidade_estoque FROM produtos', (err3, newRows) => {
              if (err3) return cb(err3);
              cb(null, newRows || []);
            });
          });
        }

        createSampleProductsIfEmpty((errCreate, finalProducts) => {
          if (errCreate) return reject(errCreate);
          const productsList = finalProducts;

          // Ensure some users exist so sales/movimentacoes can be linked to operadores
          const userNames = ['Wesley', 'Vera', 'Fabiano'];
          db.all('SELECT id, username FROM usuarios WHERE username IN (?,?,?)', userNames, (errUsers, rows) => {
            if (errUsers) return reject(errUsers);
            const existing = {};
            (rows || []).forEach(r => { existing[r.username] = r.id; });
            const toInsert = userNames.filter(u => !existing[u]);

            function insertNext(idx, cb) {
              if (idx >= toInsert.length) return cb();
              const uname = toInsert[idx];
              db.run('INSERT INTO usuarios(username, password, role, pode_controlar_caixa) VALUES (?, ?, ?, ?)', [uname, 'seeded', 'user', 0], function(insErr) {
                if (insErr) return cb(insErr);
                existing[uname] = this.lastID;
                insertNext(idx + 1, cb);
              });
            }

            insertNext(0, (insErr) => {
              if (insErr) return reject(insErr);
              const userIds = userNames.map(u => existing[u]).filter(Boolean);
              const operadorId = userIds.length > 0 ? userIds[randInt(0, userIds.length - 1)] : null;

              // if status_caixa table exists, create multiple sessions (abertura/fechamento) to link to
              db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='status_caixa'", (tblErr, tblRow) => {
                if (tblErr) return reject(tblErr);
                const createInserts = (caixaSessions) => {
                  // do not write to legacy `vendas`; create unified orders instead
                  const insertMov = db.prepare('INSERT INTO caixa_movimentacoes(tipo, valor, descricao, usuario_id, operador_id, caixa_status_id, motivo, aprovado_por, data_movimento, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

                  for (let i = 0; i < NUM_RECORDS; i++) {
                    const doSale = Math.random() < 0.7;
                    const dt = randomDateIn2025();
                    if (doSale) {
                      const p = productsList[randInt(0, productsList.length - 1)];
                      const qty = randInt(1, Math.max(1, Math.min(10, p.quantidade_estoque || 10)));
                      const unit = p.preco_venda || 1;
                      const price = Number((unit * qty).toFixed(2));
                      const metodo = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'][randInt(0, 3)];
                      // choose a random caixa session for this order (70% chance)
                      const orderCaixaId = caixaSessions && caixaSessions.length > 0 && Math.random() < 0.7 ? caixaSessions[randInt(0, caixaSessions.length - 1)] : null;
                      db.run('INSERT INTO venda_cabecalho(data_venda, subtotal, desconto, acrescimo, total_final, operador_id, caixa_status_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [dt, price, 0.0, 0.0, price, operadorId, orderCaixaId], function(orderErr) {
                        if (!orderErr) {
                          const vendaId = this.lastID;
                          db.run('INSERT INTO venda_itens(venda_id, produto_id, quantidade, preco_unitario, preco_total) VALUES (?, ?, ?, ?, ?)', [vendaId, p.id, qty, unit, price]);
                          db.run('INSERT INTO venda_pagamentos(venda_id, metodo, valor, troco, caixa_status_id) VALUES (?, ?, ?, ?, ?)', [vendaId, metodo, price, 0.0, orderCaixaId]);
                        }
                      });
                    } else {
                      const tipo = Math.random() < 0.5 ? 'entrada' : 'retirada';
                      const valor = Number((Math.random() * 200 + 1).toFixed(2));
                      const usuarioId = userIds.length > 0 ? userIds[randInt(0, userIds.length - 1)] : null;
                      // pick a random caixa session or null (80% chance to link)
                      const caixaStatusId = caixaSessions && caixaSessions.length > 0 && Math.random() < 0.8 ? caixaSessions[randInt(0, caixaSessions.length - 1)] : null;
                      insertMov.run(tipo, valor, 'Seed ' + tipo, usuarioId, operadorId, caixaStatusId, null, null, dt, dt, dt);
                    }
                  }

                  insertMov.finalize();

                  // Additionally, create some multi-payment orders (venda_cabecalho + items + pagamentos) linked to caixa session
                  const createOrder = db.prepare('INSERT INTO venda_cabecalho(data_venda, subtotal, desconto, acrescimo, total_final, operador_id, caixa_status_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
                  const createItem = db.prepare('INSERT INTO venda_itens(venda_id, produto_id, quantidade, preco_unitario, preco_total) VALUES (?, ?, ?, ?, ?)');
                  const createPayment = db.prepare('INSERT INTO venda_pagamentos(venda_id, metodo, valor, troco, caixa_status_id) VALUES (?, ?, ?, ?, ?)');

                  for (let j = 0; j < Math.min(50, NUM_RECORDS / 4); j++) {
                    const dt2 = randomDateIn2025();
                    const p = productsList[randInt(0, productsList.length - 1)];
                    const qty = randInt(1, Math.max(1, Math.min(6, p.quantidade_estoque || 6)));
                    const unit = p.preco_venda || 1;
                    const subtotal = Number((unit * qty).toFixed(2));
                    const desconto = 0.0;
                    const acrescimo = 0.0;
                    const total = subtotal;
                    // choose a random caixa session for this order (70% chance)
                    const orderCaixaId = caixaSessions && caixaSessions.length > 0 && Math.random() < 0.7 ? caixaSessions[randInt(0, caixaSessions.length - 1)] : null;
                    createOrder.run(dt2, subtotal, desconto, acrescimo, total, operadorId, orderCaixaId, function(errOrd) {
                      const vendaId = this.lastID;
                      if (vendaId) {
                        createItem.run(vendaId, p.id, qty, unit, subtotal);
                        // possibly split payment
                        if (Math.random() < 0.3) {
                          // two payments
                          const part = Number((total * (0.4 + Math.random() * 0.5)).toFixed(2));
                          createPayment.run(vendaId, 'cartao_credito', part, 0.0, orderCaixaId);
                          createPayment.run(vendaId, 'dinheiro', Number((total - part).toFixed(2)), 0.0, orderCaixaId);
                        } else {
                          const metodo = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'][randInt(0, 3)];
                          createPayment.run(vendaId, metodo, total, 0.0, orderCaixaId);
                        }
                      }
                    });
                  }

                  createOrder.finalize();
                  createItem.finalize();
                  createPayment.finalize(() => {
                    // done
                  });
                };
                if (tblRow) {
                  // create multiple sessions across 2025 with random open/close times
                  const sessCount = randInt(6, 12);
                  const sessions = [];
                  function createSess(idx) {
                    if (idx >= sessCount) return createInserts(sessions);
                    // pick random abertura and maybe fechamento
                    const abertura = new Date(randomDateIn2025()).toISOString();
                    const willClose = Math.random() < 0.85; // most sessions closed
                    let fechamento = null;
                    if (willClose) {
                      // fechamento after abertura by up to 7 days
                      const aTs = Date.parse(abertura);
                      const maxClose = aTs + 7 * 24 * 60 * 60 * 1000;
                      const closeTs = randInt(aTs, maxClose);
                      fechamento = new Date(closeTs).toISOString();
                    }
                    const abertoFlag = !willClose;
                    const openedBy = operadorId;
                    const closedBy = willClose ? (Math.random() < 0.7 ? operadorId : (userIds.length > 0 ? userIds[randInt(0, userIds.length - 1)] : operadorId)) : null;
                    const now = new Date().toISOString();
                    db.run('INSERT INTO status_caixa(aberto, horario_abertura_obrigatorio, horario_fechamento_obrigatorio, aberto_por, fechado_por, data_abertura, data_fechamento, criado_em, atualizado_em, saldo_inicial, saldo_esperado, terminal_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [abertoFlag ? 1 : 0, null, null, openedBy, closedBy, abertura, fechamento, now, now, 0.0, 0.0, null], function(errCs) {
                      if (errCs) return reject(errCs);
                      sessions.push(this.lastID);
                      createSess(idx + 1);
                    });
                  }
                  createSess(0);
                } else {
                  createInserts([]);
                }
              });
            });
          });
          db.close(err2 => {
            if (err2) return reject(err2);
            resolve();
          });
        });
      });
    });
  });
}

async function runPgMode() {
  const port = PGPORT || 61549; // fallback to observed port
  console.log('Running in Postgres mode, connecting to', PGHOST, port, PGDATABASE, 'user', PGUSER ? PGUSER : '(none)');
  const client = new Client({ host: PGHOST, port: Number(port), database: PGDATABASE, user: PGUSER, password: PGPASSWORD });
  await client.connect();

  try {
    // fetch products
    const prodRes = await client.query('SELECT id, preco_venda, quantidade_estoque FROM produtos');
    let products = prodRes.rows;
    if (!products || products.length === 0) {
      console.log('No products found. Creating sample products...');
      const sample = [
        { nome: 'Arroz 5kg', codigo_barras: '0001', preco_venda: 25.9, quantidade_estoque: 100 },
        { nome: 'Feijão 1kg', codigo_barras: '0002', preco_venda: 9.5, quantidade_estoque: 100 },
        { nome: 'Açúcar 1kg', codigo_barras: '0003', preco_venda: 4.75, quantidade_estoque: 100 },
        { nome: 'Óleo 900ml', codigo_barras: '0004', preco_venda: 7.5, quantidade_estoque: 100 },
        { nome: 'Leite 1L', codigo_barras: '0005', preco_venda: 3.99, quantidade_estoque: 100 }
      ];
      for (const s of sample) {
        await client.query('INSERT INTO produtos(nome, codigo_barras, preco_venda, quantidade_estoque, imagem) VALUES($1,$2,$3,$4,$5)', [s.nome, s.codigo_barras, s.preco_venda, s.quantidade_estoque, null]);
      }
      const prodRes2 = await client.query('SELECT id, preco_venda, quantidade_estoque FROM produtos');
      products = prodRes2.rows;
    }

    // ensure some users exist
    const userNames = ['Wesley', 'Vera', 'Fabiano'];
    const userRows = await client.query('SELECT id, username FROM usuarios WHERE username = ANY($1)', [userNames]);
    const existing = {};
    (userRows.rows || []).forEach(r => { existing[r.username] = r.id; });
    for (const uname of userNames) {
      if (!existing[uname]) {
        const res = await client.query('INSERT INTO usuarios(username, password, role, pode_controlar_caixa) VALUES($1,$2,$3,$4) RETURNING id', [uname, 'seeded', 'user', false]);
        existing[uname] = res.rows[0].id;
      }
    }
    const userIds = Object.values(existing).filter(Boolean);

    // ensure there are at least 30 caixa sessions in August 2025 and collect their ranges
    const caixaRes = await client.query("SELECT id, data_abertura, data_fechamento FROM status_caixa WHERE date_part('year', data_abertura) = 2025 AND date_part('month', data_abertura) = 8");
    let caixaSessions = (caixaRes.rows || []).map(r => ({ id: r.id, aberturaTs: r.data_abertura ? new Date(r.data_abertura).getTime() : null, fechamentoTs: r.data_fechamento ? new Date(r.data_fechamento).getTime() : null }));
    const need = Math.max(0, 30 - caixaSessions.length);
    const augustStart = Date.parse('2025-08-01T00:00:00Z');
    const augustEnd = Date.parse('2025-08-31T23:59:59Z');
    for (let s = 0; s < need; s++) {
      // abertura random in August
      const aberturaTs = randInt(augustStart, augustEnd);
      // fechamento within same day between 30 minutes and 12 hours after abertura, clamp to augustEnd
      const fechamentoTs = Math.min(augustEnd, aberturaTs + randInt(30 * 60 * 1000, 12 * 60 * 60 * 1000));
      const abertoFlag = false;
      const openedBy = userIds.length > 0 ? userIds[randInt(0, userIds.length - 1)] : null;
      const closedBy = openedBy;
      const abertura = new Date(aberturaTs).toISOString();
      const fechamento = new Date(fechamentoTs).toISOString();
      const now = new Date().toISOString();
      const ins = await client.query('INSERT INTO status_caixa(aberto, horario_abertura_obrigatorio, horario_fechamento_obrigatorio, aberto_por, fechado_por, data_abertura, data_fechamento, criado_em, atualizado_em, saldo_inicial, saldo_esperado, terminal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id', [abertoFlag ? true : false, null, null, openedBy, closedBy, abertura, fechamento, now, now, 0.0, 0.0, null]);
      caixaSessions.push({ id: ins.rows[0].id, aberturaTs: aberturaTs, fechamentoTs: fechamentoTs });
    }

    // helper to pick random date inside a session
    function randomDateInsideSession(sess) {
      const a = sess.aberturaTs || augustStart;
      const f = sess.fechamentoTs || Math.min(a + 8 * 60 * 60 * 1000, augustEnd);
      const t = randInt(a, f);
      return new Date(t).toISOString();
    }

    // insert records linking vendas to operador and one of the August sessions
    for (let i = 0; i < NUM_RECORDS; i++) {
      const doSale = Math.random() < 0.7;
      if (doSale) {
        const sess = caixaSessions[randInt(0, caixaSessions.length - 1)];
        const dt = randomDateInsideSession(sess);
        const p = products[randInt(0, products.length - 1)];
        const qty = randInt(1, Math.max(1, Math.min(10, p.quantidade_estoque || 10)));
        const unit = p.preco_venda || 1;
        const price = Number((unit * qty).toFixed(2));
        const metodo = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'][randInt(0, 3)];
        const operadorId = userIds.length > 0 ? userIds[randInt(0, userIds.length - 1)] : null;
        const orderCaixaId = sess.id;
        const orderRes = await client.query('INSERT INTO venda_cabecalho(data_venda, subtotal, desconto, acrescimo, total_final, operador_id, caixa_status_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [dt, price, 0.0, 0.0, price, operadorId, orderCaixaId]);
        const vendaId = orderRes.rows && orderRes.rows[0] && orderRes.rows[0].id ? orderRes.rows[0].id : null;
        if (vendaId) {
          await client.query('INSERT INTO venda_itens(venda_id, produto_id, quantidade, preco_unitario, preco_total) VALUES($1,$2,$3,$4,$5)', [vendaId, p.id, qty, unit, price]);
          await client.query('INSERT INTO venda_pagamentos(venda_id, metodo, valor, troco, caixa_status_id) VALUES($1,$2,$3,$4,$5)', [vendaId, metodo, price, 0.0, orderCaixaId]);
        }
      } else {
        const sess = caixaSessions[randInt(0, caixaSessions.length - 1)];
        const dt = randomDateInsideSession(sess);
        const tipo = Math.random() < 0.5 ? 'entrada' : 'retirada';
        const valor = Number((Math.random() * 200 + 1).toFixed(2));
        const usuarioId = userIds.length > 0 ? userIds[randInt(0, userIds.length - 1)] : null;
        const operadorId = userIds.length > 0 ? userIds[randInt(0, userIds.length - 1)] : null;
        const caixaStatusId = sess.id;
        await client.query('INSERT INTO caixa_movimentacoes(tipo, valor, descricao, usuario_id, operador_id, caixa_status_id, motivo, aprovado_por, data_movimento, criado_em, atualizado_em) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [tipo, valor, 'Seed ' + tipo, usuarioId, operadorId, caixaStatusId, null, null, dt, dt, dt]);
      }
    }

    console.log('Inserted', NUM_RECORDS, 'records into Postgres (with operador and caixa links where possible)');
  } finally {
    await client.end();
  }
}

async function main() {
  if (API_BASE) {
    await runApiMode();
  } else if (USE_PG) {
    await runPgMode();
  } else {
    try {
      await runDbMode();
      console.log('DB mode done: inserted records into', DB_PATH);
    } catch (e) {
      console.error('DB mode failed:', e.message);
      console.log('You can run with --api to use API mode (requires server + auth) or --pg to use Postgres (set PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD).');
    }
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
