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

          const insertSale = db.prepare('INSERT INTO vendas(produto_id, quantidade_vendida, preco_total, data_venda, metodo_pagamento, cliente_id, operador_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
          const insertMov = db.prepare('INSERT INTO caixa_movimentacoes(tipo, valor, descricao, usuario_id, operador_id, caixa_status_id, motivo, aprovado_por, data_movimento, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

          for (let i = 0; i < NUM_RECORDS; i++) {
            const doSale = Math.random() < 0.7;
            const dt = randomDateIn2025();
            if (doSale) {
              const p = productsList[randInt(0, productsList.length - 1)];
              const qty = randInt(1, Math.max(1, Math.min(10, p.quantidade_estoque || 10)));
              const price = Number(((p.preco_venda || 1) * qty).toFixed(2));
              const metodo = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'][randInt(0, 3)];
              insertSale.run(p.id, qty, price, dt, metodo, null, null);
            } else {
              const tipo = Math.random() < 0.5 ? 'entrada' : 'retirada';
              const valor = Number((Math.random() * 200 + 1).toFixed(2));
              insertMov.run(tipo, valor, 'Seed ' + tipo, null, null, null, null, null, dt, dt, dt);
            }
          }

          insertSale.finalize();
          insertMov.finalize();
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
    // ensure tables exist (we assume Liquibase already ran)
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

    for (let i = 0; i < NUM_RECORDS; i++) {
      const doSale = Math.random() < 0.7;
      const dt = randomDateIn2025();
      if (doSale) {
        const p = products[randInt(0, products.length - 1)];
        const qty = randInt(1, Math.max(1, Math.min(10, p.quantidade_estoque || 10)));
        const price = Number(((p.preco_venda || 1) * qty).toFixed(2));
        const metodo = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'][randInt(0, 3)];
        await client.query('INSERT INTO vendas(produto_id, quantidade_vendida, preco_total, data_venda, metodo_pagamento, cliente_id, operador_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [p.id, qty, price, dt, metodo, null, null]);
      } else {
        const tipo = Math.random() < 0.5 ? 'entrada' : 'retirada';
        const valor = Number((Math.random() * 200 + 1).toFixed(2));
        await client.query('INSERT INTO caixa_movimentacoes(tipo, valor, descricao, usuario_id, operador_id, caixa_status_id, motivo, aprovado_por, data_movimento, criado_em, atualizado_em) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [tipo, valor, 'Seed ' + tipo, null, null, null, null, null, dt, dt, dt]);
      }
    }

    console.log('Inserted', NUM_RECORDS, 'records into Postgres');
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
