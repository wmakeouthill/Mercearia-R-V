const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');

// Usage: node scripts/seed-complete.js [--api http://localhost:3000/api] [--db ./database.sqlite] [--pg]
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

const NUM_RECORDS = 2000; // Aumentado para cobrir mais período
const MULTI_PAYMENT_CHANCE = 0.6; // 60% das vendas terão múltiplos métodos de pagamento

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDateInRange(startDate, endDate) {
  const start = startDate.getTime();
  const end = endDate.getTime();
  const t = randInt(start, end);
  return new Date(t).toISOString();
}

function getRandomBusinessHour(date) {
  // Horários comerciais: 8h às 18h em dias úteis, 8h às 12h nos finais de semana
  const dayOfWeek = date.getDay(); // 0=domingo, 6=sábado
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  let startHour, endHour;
  if (isWeekend) {
    startHour = 8;
    endHour = 12;
  } else {
    startHour = 8;
    endHour = 18;
  }

  const hour = randInt(startHour, endHour);
  const minute = randInt(0, 59);
  const second = randInt(0, 59);

  const businessDate = new Date(date);
  businessDate.setHours(hour, minute, second, 0);

  return businessDate.toISOString();
}

function getDateRange() {
  // De janeiro de 2024 até hoje
  const startDate = new Date('2024-01-01T00:00:00Z');
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

function generateMultiplePayments(totalValue, caixaStatusId) {
  const payments = [];
  const methods = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'];

  // Decide quantos métodos usar (2 ou 3)
  const numMethods = Math.random() < 0.7 ? 2 : 3;

  // Gera valores proporcionais
  const parts = [];
  let remaining = totalValue;

  for (let i = 0; i < numMethods - 1; i++) {
    const minPart = 1;
    const maxPart = remaining - (numMethods - i - 1) * minPart;
    const part = Number((Math.random() * (maxPart - minPart) + minPart).toFixed(2));
    parts.push(part);
    remaining -= part;
  }
  parts.push(Number(remaining.toFixed(2)));

  // Embaralha os métodos
  const selectedMethods = methods.sort(() => Math.random() - 0.5).slice(0, numMethods);

  // Cria pagamentos
  for (let i = 0; i < numMethods; i++) {
    payments.push({
      metodo: selectedMethods[i],
      valor: parts[i],
      troco: selectedMethods[i] === 'dinheiro' && Math.random() < 0.3 ? Number((Math.random() * 10).toFixed(2)) : 0.0,
      caixa_status_id: caixaStatusId
    });
  }

  return payments;
}

async function createPgCashEntry(client, valor, caixaStatusId, operadorId, vendaId, dataMovimento) {
  // Criar entrada no caixa para dinheiro recebido (simulando o comportamento do backend)
  const descricao = `Venda ${vendaId}`;
  await client.query('INSERT INTO caixa_movimentacoes(tipo, valor, descricao, usuario_id, operador_id, caixa_status_id, data_movimento, criado_em, atualizado_em) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    ['entrada', valor, descricao, operadorId, operadorId, caixaStatusId, dataMovimento, dataMovimento, dataMovimento]);
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

  const { startDate, endDate } = getDateRange();

  for (let i = 0; i < NUM_RECORDS; i++) {
    const chooseSale = Math.random() < 0.8; // 80% vendas, 20% movimentações
    if (chooseSale) {
      const p = products[randInt(0, products.length - 1)];
      const qty = randInt(1, Math.max(1, Math.min(15, p.quantidade_estoque || 15)));
      const price = (p.preco_venda || 1) * qty;

      try {
        const payload = {
          produto_id: p.id,
          quantidade_vendida: qty,
          preco_total: Number(price.toFixed(2)),
          metodo_pagamento: 'dinheiro' // API mode usa método único
        };
        await client.post('/vendas', payload);
      } catch (e) {
        console.warn('sale insert failed (api):', e.response ? e.response.data : e.message);
      }
    } else {
      const tipo = Math.random() < 0.5 ? 'entrada' : 'retirada';
      const valor = Number((Math.random() * 300 + 1).toFixed(2));
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
    console.log('🔍 Checking database file:', DB_PATH);

    if (!fs.existsSync(DB_PATH)) {
      console.log('📝 Database file not found, will create new one');
    }
    const db = new sqlite3.Database(DB_PATH);

    console.log('🔧 Ensuring database tables exist...');

    const createTablesSQL = `
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        pode_controlar_caixa BOOLEAN DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS produtos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome VARCHAR(255) NOT NULL,
        codigo_barras VARCHAR(255) UNIQUE,
        preco_venda DOUBLE PRECISION NOT NULL,
        quantidade_estoque INTEGER NOT NULL DEFAULT 0,
        imagem VARCHAR(255)
      );

      CREATE TABLE IF NOT EXISTS status_caixa (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        aberto BOOLEAN NOT NULL DEFAULT 0,
        horario_abertura_obrigatorio VARCHAR(255),
        horario_fechamento_obrigatorio VARCHAR(255),
        aberto_por INTEGER,
        fechado_por INTEGER,
        data_abertura TIMESTAMP,
        data_fechamento TIMESTAMP,
        criado_em TIMESTAMP,
        atualizado_em TIMESTAMP,
        saldo_inicial DOUBLE PRECISION,
        saldo_esperado DOUBLE PRECISION,
        saldo_contado DOUBLE PRECISION,
        variacao DOUBLE PRECISION,
        variacao_acumulada DOUBLE PRECISION,
        deficit_nao_reposto_acumulada DOUBLE PRECISION,
        terminal_id VARCHAR(100),
        observacoes_fechamento TEXT,
        version BIGINT,
        FOREIGN KEY (aberto_por) REFERENCES usuarios(id),
        FOREIGN KEY (fechado_por) REFERENCES usuarios(id)
      );

      CREATE TABLE IF NOT EXISTS venda_cabecalho (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_venda TIMESTAMP NOT NULL,
        subtotal DOUBLE PRECISION NOT NULL,
        desconto DOUBLE PRECISION NOT NULL,
        acrescimo DOUBLE PRECISION NOT NULL,
        total_final DOUBLE PRECISION NOT NULL,
        adjusted_total DOUBLE PRECISION,
        customer_name VARCHAR(255),
        customer_email VARCHAR(255),
        customer_phone VARCHAR(50),
        cliente_id INTEGER,
        operador_id INTEGER,
        caixa_status_id INTEGER,
        status VARCHAR(50),
        FOREIGN KEY (cliente_id) REFERENCES clientes(id),
        FOREIGN KEY (operador_id) REFERENCES usuarios(id),
        FOREIGN KEY (caixa_status_id) REFERENCES status_caixa(id)
      );

      CREATE TABLE IF NOT EXISTS venda_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        produto_id INTEGER NOT NULL,
        quantidade INTEGER NOT NULL,
        preco_unitario DOUBLE PRECISION NOT NULL,
        preco_total DOUBLE PRECISION NOT NULL,
        FOREIGN KEY (venda_id) REFERENCES venda_cabecalho(id),
        FOREIGN KEY (produto_id) REFERENCES produtos(id)
      );

      CREATE TABLE IF NOT EXISTS venda_pagamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venda_id INTEGER NOT NULL,
        metodo VARCHAR(50) NOT NULL,
        valor DOUBLE PRECISION NOT NULL,
        troco DOUBLE PRECISION,
        caixa_status_id INTEGER,
        FOREIGN KEY (venda_id) REFERENCES venda_cabecalho(id),
        FOREIGN KEY (caixa_status_id) REFERENCES status_caixa(id)
      );

      CREATE TABLE IF NOT EXISTS caixa_movimentacoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo VARCHAR(50) NOT NULL,
        valor DOUBLE PRECISION NOT NULL,
        descricao VARCHAR(255),
        usuario_id INTEGER,
        operador_id INTEGER,
        caixa_status_id INTEGER,
        motivo VARCHAR(255),
        aprovado_por INTEGER,
        data_movimento TIMESTAMP NOT NULL,
        criado_em TIMESTAMP NOT NULL,
        atualizado_em TIMESTAMP NOT NULL,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
        FOREIGN KEY (operador_id) REFERENCES usuarios(id),
        FOREIGN KEY (caixa_status_id) REFERENCES status_caixa(id),
        FOREIGN KEY (aprovado_por) REFERENCES usuarios(id)
      );

      CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        telefone VARCHAR(50),
        created_at TIMESTAMP
      );
    `;

    db.serialize(() => {
      db.exec(createTablesSQL, (tableErr) => {
        if (tableErr) {
          console.error('❌ Error creating tables:', tableErr);
          return reject(tableErr);
        }

        console.log('✅ Database tables created/verified');

        // Simple approach: just create sample data and exit
        console.log('📦 Creating sample products...');
        const sample = [
          { nome: 'Arroz 5kg', codigo_barras: '0001', preco_venda: 25.9, quantidade_estoque: 200 },
          { nome: 'Feijão 1kg', codigo_barras: '0002', preco_venda: 9.5, quantidade_estoque: 150 },
          { nome: 'Açúcar 1kg', codigo_barras: '0003', preco_venda: 4.75, quantidade_estoque: 180 },
          { nome: 'Óleo 900ml', codigo_barras: '0004', preco_venda: 7.5, quantidade_estoque: 120 },
          { nome: 'Leite 1L', codigo_barras: '0005', preco_venda: 3.99, quantidade_estoque: 200 },
          { nome: 'Café 500g', codigo_barras: '0006', preco_venda: 12.5, quantidade_estoque: 100 },
          { nome: 'Pão Francês', codigo_barras: '0007', preco_venda: 0.8, quantidade_estoque: 500 },
          { nome: 'Queijo Mussarela 500g', codigo_barras: '0008', preco_venda: 18.9, quantidade_estoque: 80 },
          { nome: 'Presunto 200g', codigo_barras: '0009', preco_venda: 15.5, quantidade_estoque: 90 },
          { nome: 'Refrigerante 2L', codigo_barras: '0010', preco_venda: 8.5, quantidade_estoque: 150 }
        ];

        let inserted = 0;
        sample.forEach(product => {
          db.run('INSERT OR IGNORE INTO produtos(nome, codigo_barras, preco_venda, quantidade_estoque, imagem) VALUES (?, ?, ?, ?, ?)',
            [product.nome, product.codigo_barras, product.preco_venda, product.quantidade_estoque, null],
            (err) => {
              if (err) console.error('Error inserting product:', err);
              inserted++;
              if (inserted === sample.length) {
                console.log('✅ Sample products created');
                db.close((closeErr) => {
                  if (closeErr) console.error('Error closing DB:', closeErr);
                  console.log('✅ Database setup completed successfully');
                  resolve();
                });
              }
            });
        });
      });
    });
  });
}

function createCaixaSessions(db, userIds, operadorId, productsList, callback) {
  const dateRange = getDateRange();
  const sessions = [];

  // Cria sessões de caixa para cada dia útil no período
  let currentDate = new Date(dateRange.startDate);
  let sessionCount = 0;

  function createNextSession() {
    if (currentDate > dateRange.endDate) {
      console.log(`Created ${sessionCount} caixa sessions`);
      createSalesAndMovements(db, sessions, userIds, operadorId, productsList, callback);
      return;
    }

    const dayOfWeek = currentDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const shouldCreateSession = isWeekend ? Math.random() < 0.4 : Math.random() < 0.8;

    if (!shouldCreateSession) {
      currentDate.setDate(currentDate.getDate() + 1);
      createNextSession();
      return;
    }

    createSingleSession();

    function createSingleSession() {
      const aberturaHour = isWeekend ? randInt(8, 10) : randInt(8, 9);
      const abertura = new Date(currentDate);
      abertura.setHours(aberturaHour, randInt(0, 59), 0, 0);

      const sessionDuration = isWeekend ? randInt(2, 4) : randInt(4, 10);
      const fechamento = new Date(abertura.getTime() + sessionDuration * 60 * 60 * 1000);

      const abertoFlag = Math.random() < 0.95;
      const openedBy = userIds[randInt(0, userIds.length - 1)];
      let closedBy = null;
      if (!abertoFlag) {
        closedBy = Math.random() < 0.7 ? openedBy : userIds[randInt(0, userIds.length - 1)];
      }

      const saldoInicial = Number((Math.random() * 200 + 50).toFixed(2));
      const now = new Date().toISOString();

      const abertoValue = abertoFlag ? 0 : 1;
      const terminalId = `TERMINAL-${String(sessionCount + 1).padStart(3, '0')}`;

      db.run('INSERT INTO status_caixa(aberto, horario_abertura_obrigatorio, horario_fechamento_obrigatorio, aberto_por, fechado_por, data_abertura, data_fechamento, criado_em, atualizado_em, saldo_inicial, saldo_esperado, terminal_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [abertoValue, null, null, openedBy, closedBy, abertura.toISOString(), fechamento.toISOString(), now, now, saldoInicial, saldoInicial, terminalId], function(errCs) {
        if (errCs) {
          console.error('Error creating caixa session:', errCs);
          currentDate.setDate(currentDate.getDate() + 1);
          createNextSession();
          return;
        }

        sessions.push({
          id: this.lastID,
          abertura: abertura,
          fechamento: fechamento,
          aberto: !abertoFlag,
          saldoInicial: saldoInicial,
          terminalId: terminalId
        });
        sessionCount++;
        currentDate.setDate(currentDate.getDate() + 1);
        createNextSession();
      });
    }
  }

  createNextSession();
}

function createSalesAndMovements(db, caixaSessions, userIds, operadorId, productsList, callback) {
  let recordsCreated = 0;
  const totalRecords = NUM_RECORDS;
  console.log('🛒 Starting to create', totalRecords, 'records...');

  function createNextRecord() {
    if (recordsCreated >= totalRecords) {
      console.log(`✅ Created ${recordsCreated} records total`);
      callback();
      return;
    }

    // Show progress every 100 records
    if (recordsCreated % 100 === 0 && recordsCreated > 0) {
      console.log(`📊 Progress: ${recordsCreated}/${totalRecords} records created`);
    }

    const doSale = Math.random() < 0.75; // 75% vendas, 25% movimentações

    if (doSale) {
      createSale(db, caixaSessions, userIds, operadorId, productsList, () => {
        recordsCreated++;
        createNextRecord();
      });
    } else {
      createMovement(db, caixaSessions, userIds, operadorId, () => {
        recordsCreated++;
        createNextRecord();
      });
    }
  }

  createNextRecord();
}

function createSale(db, caixaSessions, userIds, operadorId, productsList, callback) {
  // Seleciona uma sessão de caixa aleatória
  if (caixaSessions.length === 0) {
    callback();
    return;
  }

  const session = caixaSessions[randInt(0, caixaSessions.length - 1)];

  // Gera data dentro da sessão de caixa
  const saleDate = new Date(session.abertura.getTime() +
    Math.random() * (session.fechamento.getTime() - session.abertura.getTime()));

  // Seleciona produtos para a venda (1-8 produtos diferentes)
  const numProducts = randInt(1, 8);
  const selectedProducts = [];
  let subtotal = 0;

  for (let i = 0; i < numProducts; i++) {
    const product = productsList[randInt(0, productsList.length - 1)];
    const qty = randInt(1, Math.max(1, Math.min(10, product.quantidade_estoque || 10)));
    const unitPrice = product.preco_venda || 1;
    const total = Number((unitPrice * qty).toFixed(2));

    selectedProducts.push({
      product: product,
      qty: qty,
      unitPrice: unitPrice,
      total: total
    });

    subtotal += total;
  }

  const desconto = Math.random() < 0.1 ? Number((subtotal * (Math.random() * 0.1)).toFixed(2)) : 0; // 10% chance de desconto até 10%
  const acrescimo = Math.random() < 0.05 ? Number((subtotal * (Math.random() * 0.05)).toFixed(2)) : 0; // 5% chance de acréscimo até 5%
  const totalFinal = Number((subtotal - desconto + acrescimo).toFixed(2));

  // Decide se será venda com múltiplos métodos de pagamento
  const useMultiPayment = Math.random() < MULTI_PAYMENT_CHANCE;

  // Cria cabeçalho da venda
  db.run('INSERT INTO venda_cabecalho(data_venda, subtotal, desconto, acrescimo, total_final, operador_id, caixa_status_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [saleDate.toISOString(), subtotal, desconto, acrescimo, totalFinal, operadorId, session.id], function(orderErr) {
    if (orderErr) {
      console.error('Error creating sale header:', orderErr);
      callback();
      return;
    }

    const vendaId = this.lastID;

    // Insere itens da venda
    let itemsInserted = 0;
    selectedProducts.forEach(item => {
      db.run('INSERT INTO venda_itens(venda_id, produto_id, quantidade, preco_unitario, preco_total) VALUES (?, ?, ?, ?, ?)',
        [vendaId, item.product.id, item.qty, item.unitPrice, item.total], function(itemErr) {
        if (itemErr) console.error('Error creating sale item:', itemErr);
        itemsInserted++;
        if (itemsInserted === selectedProducts.length) {
          createPayments();
        }
      });
    });

    function createPayments() {
      if (useMultiPayment) {
        // Cria múltiplos pagamentos
        const payments = generateMultiplePayments(totalFinal, session.id);
        let paymentsInserted = 0;

        payments.forEach(payment => {
          db.run('INSERT INTO venda_pagamentos(venda_id, metodo, valor, troco, caixa_status_id) VALUES (?, ?, ?, ?, ?)',
            [vendaId, payment.metodo, payment.valor, payment.troco, payment.caixa_status_id], function(payErr) {
            if (payErr) console.error('Error creating payment:', payErr);
            paymentsInserted++;

            // Criar movimentação de entrada para pagamentos em dinheiro
            if (payment.metodo === 'dinheiro' && payment.valor > 0) {
              createCashEntry(payment.valor, session, operadorId, vendaId);
            }

            if (paymentsInserted === payments.length) {
              callback();
            }
          });
        });
      } else {
        // Pagamento único
        const metodo = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'][randInt(0, 3)];
        const troco = metodo === 'dinheiro' && Math.random() < 0.4 ? Number((Math.random() * 20).toFixed(2)) : 0;
        const valorPago = troco > 0 ? totalFinal + troco : totalFinal;

        db.run('INSERT INTO venda_pagamentos(venda_id, metodo, valor, troco, caixa_status_id) VALUES (?, ?, ?, ?, ?)',
          [vendaId, metodo, totalFinal, troco, session.id], function(payErr) {
          if (payErr) console.error('Error creating payment:', payErr);

          // Criar movimentação de entrada para pagamentos em dinheiro
          if (metodo === 'dinheiro' && totalFinal > 0) {
            createCashEntry(totalFinal, session, operadorId, vendaId);
          }

          callback();
        });
      }
    }

    function createCashEntry(valor, session, operadorId, vendaId) {
      // Criar entrada no caixa para dinheiro recebido (simulando o comportamento do backend)
      const descricao = `Venda ${vendaId}`;
      db.run('INSERT INTO caixa_movimentacoes(tipo, valor, descricao, usuario_id, operador_id, caixa_status_id, data_movimento, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['entrada', valor, descricao, operadorId, operadorId, session.id, saleDate.toISOString(), saleDate.toISOString(), saleDate.toISOString()], function(movErr) {
        if (movErr) console.error('Error creating cash entry:', movErr);
      });
    }
  });
}

function createMovement(db, caixaSessions, userIds, operadorId, callback) {
  if (caixaSessions.length === 0) {
    callback();
    return;
  }

  const session = caixaSessions[randInt(0, caixaSessions.length - 1)];
  const moveDate = new Date(session.abertura.getTime() +
    Math.random() * (session.fechamento.getTime() - session.abertura.getTime()));

  const tipo = Math.random() < 0.6 ? 'entrada' : 'retirada'; // 60% entradas, 40% retiradas
  const valor = Number((Math.random() * 500 + 1).toFixed(2));

  const descriptions = {
    entrada: ['Recebimento de cliente', 'Troco de venda', 'Pagamento de fornecedor', 'Recebimento de débito antigo', 'Correção de caixa'],
    retirada: ['Pagamento de fornecedor', 'Retirada para despesas', 'Pagamento de funcionário', 'Compra de material', 'Correção de caixa']
  };

  const descricao = descriptions[tipo][randInt(0, descriptions[tipo].length - 1)];
  const usuarioId = userIds[randInt(0, userIds.length - 1)];

  db.run('INSERT INTO caixa_movimentacoes(tipo, valor, descricao, usuario_id, operador_id, caixa_status_id, data_movimento, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [tipo, valor, descricao, usuarioId, operadorId, session.id, moveDate.toISOString(), moveDate.toISOString(), moveDate.toISOString()], function(movErr) {
    if (movErr) console.error('Error creating movement:', movErr);
    callback();
  });
}

async function runPgMode() {
  const port = PGPORT || 61549;
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
        { nome: 'Arroz 5kg', codigo_barras: '0001', preco_venda: 25.9, quantidade_estoque: 200 },
        { nome: 'Feijão 1kg', codigo_barras: '0002', preco_venda: 9.5, quantidade_estoque: 150 },
        { nome: 'Açúcar 1kg', codigo_barras: '0003', preco_venda: 4.75, quantidade_estoque: 180 },
        { nome: 'Óleo 900ml', codigo_barras: '0004', preco_venda: 7.5, quantidade_estoque: 120 },
        { nome: 'Leite 1L', codigo_barras: '0005', preco_venda: 3.99, quantidade_estoque: 200 },
        { nome: 'Café 500g', codigo_barras: '0006', preco_venda: 12.5, quantidade_estoque: 100 },
        { nome: 'Pão Francês', codigo_barras: '0007', preco_venda: 0.8, quantidade_estoque: 500 },
        { nome: 'Queijo Mussarela 500g', codigo_barras: '0008', preco_venda: 18.9, quantidade_estoque: 80 },
        { nome: 'Presunto 200g', codigo_barras: '0009', preco_venda: 15.5, quantidade_estoque: 90 },
        { nome: 'Refrigerante 2L', codigo_barras: '0010', preco_venda: 8.5, quantidade_estoque: 150 }
      ];
      for (const s of sample) {
        await client.query('INSERT INTO produtos(nome, codigo_barras, preco_venda, quantidade_estoque, imagem) VALUES($1,$2,$3,$4,$5)', [s.nome, s.codigo_barras, s.preco_venda, s.quantidade_estoque, null]);
      }
      const prodRes2 = await client.query('SELECT id, preco_venda, quantidade_estoque FROM produtos');
      products = prodRes2.rows;
    }

    // ensure some users exist
    const userNames = ['Wesley', 'Vera', 'Fabiano', 'João', 'Maria'];
    const userRows = await client.query('SELECT id, username FROM usuarios WHERE username = ANY($1)', [userNames]);
    const existing = {};
    (userRows.rows || []).forEach(r => { existing[r.username] = r.id; });
    for (const uname of userNames) {
      if (!existing[uname]) {
        const res = await client.query('INSERT INTO usuarios(username, password, role, pode_controlar_caixa) VALUES($1,$2,$3,$4) RETURNING id', [uname, 'seeded', 'user', true]);
        existing[uname] = res.rows[0].id;
      }
    }
    const userIds = Object.values(existing).filter(Boolean);

    // Create caixa sessions for the date range
    const { startDate, endDate } = getDateRange();
    const caixaSessions = [];
    let sessionCount = 0;

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const shouldCreateSession = isWeekend ? Math.random() < 0.4 : Math.random() < 0.8;

      if (shouldCreateSession) {
        const aberturaHour = isWeekend ? randInt(8, 10) : randInt(8, 9);
        const abertura = new Date(currentDate);
        abertura.setHours(aberturaHour, randInt(0, 59), 0, 0);

        const sessionDuration = isWeekend ? randInt(2, 4) : randInt(4, 10);
        const fechamento = new Date(abertura.getTime() + sessionDuration * 60 * 60 * 1000);

        const abertoFlag = Math.random() < 0.95;
        const openedBy = userIds[randInt(0, userIds.length - 1)];
        const closedBy = abertoFlag ? null : (Math.random() < 0.7 ? openedBy : userIds[randInt(0, userIds.length - 1)]);

        const saldoInicial = Number((Math.random() * 200 + 50).toFixed(2));
        const now = new Date().toISOString();
        const terminalId = `TERMINAL-${String(sessionCount + 1).padStart(3, '0')}`;

        try {
          const ins = await client.query('INSERT INTO status_caixa(aberto, horario_abertura_obrigatorio, horario_fechamento_obrigatorio, aberto_por, fechado_por, data_abertura, data_fechamento, criado_em, atualizado_em, saldo_inicial, saldo_esperado, terminal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
            [abertoFlag, null, null, openedBy, closedBy, abertura.toISOString(), fechamento.toISOString(), now, now, saldoInicial, saldoInicial, terminalId]);
          caixaSessions.push({
            id: ins.rows[0].id,
            abertura: abertura,
            fechamento: fechamento,
            aberto: abertoFlag,
            terminalId: terminalId
          });
          sessionCount++;
        } catch (err) {
          console.log(`⚠️  Skipping session for ${currentDate.toDateString()} due to constraint violation`);
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`✅ Created ${caixaSessions.length} caixa sessions in PostgreSQL`);

    // insert records linking vendas to operador and caixa sessions
    for (let i = 0; i < NUM_RECORDS; i++) {
      const doSale = Math.random() < 0.75;
      if (doSale) {
        const sess = caixaSessions[randInt(0, caixaSessions.length - 1)];
        const dt = new Date(sess.abertura.getTime() + Math.random() * (sess.fechamento.getTime() - sess.abertura.getTime()));
        const p = products[randInt(0, products.length - 1)];
        const qty = randInt(1, Math.max(1, Math.min(15, p.quantidade_estoque || 15)));
        const unit = p.preco_venda || 1;
        const price = Number((unit * qty).toFixed(2));
        const operadorId = userIds.length > 0 ? userIds[randInt(0, userIds.length - 1)] : null;
        const orderCaixaId = sess.id;

        const orderRes = await client.query('INSERT INTO venda_cabecalho(data_venda, subtotal, desconto, acrescimo, total_final, operador_id, caixa_status_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [dt.toISOString(), price, 0.0, 0.0, price, operadorId, orderCaixaId]);
        const vendaId = orderRes.rows && orderRes.rows[0] && orderRes.rows[0].id ? orderRes.rows[0].id : null;
        if (vendaId) {
          await client.query('INSERT INTO venda_itens(venda_id, produto_id, quantidade, preco_unitario, preco_total) VALUES($1,$2,$3,$4,$5)',
            [vendaId, p.id, qty, unit, price]);

          // Multi-payment logic
          if (Math.random() < MULTI_PAYMENT_CHANCE) {
            const payments = generateMultiplePayments(price, orderCaixaId);
            for (const payment of payments) {
              await client.query('INSERT INTO venda_pagamentos(venda_id, metodo, valor, troco, caixa_status_id) VALUES($1,$2,$3,$4,$5)',
                [vendaId, payment.metodo, payment.valor, payment.troco, payment.caixa_status_id]);

              // Criar movimentação de entrada para pagamentos em dinheiro
              if (payment.metodo === 'dinheiro' && payment.valor > 0) {
                await createPgCashEntry(client, payment.valor, orderCaixaId, operadorId, vendaId, dt);
              }
            }
          } else {
            const metodo = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'][randInt(0, 3)];
            const troco = metodo === 'dinheiro' && Math.random() < 0.4 ? Number((Math.random() * 20).toFixed(2)) : 0;
            await client.query('INSERT INTO venda_pagamentos(venda_id, metodo, valor, troco, caixa_status_id) VALUES($1,$2,$3,$4,$5)',
              [vendaId, metodo, price, troco, orderCaixaId]);

            // Criar movimentação de entrada para pagamentos em dinheiro
            if (metodo === 'dinheiro' && price > 0) {
              await createPgCashEntry(client, price, orderCaixaId, operadorId, vendaId, dt);
            }
          }
        }
      } else {
        const sess = caixaSessions[randInt(0, caixaSessions.length - 1)];
        const dt = new Date(sess.abertura.getTime() + Math.random() * (sess.fechamento.getTime() - sess.abertura.getTime()));
        const tipo = Math.random() < 0.6 ? 'entrada' : 'retirada';
        const valor = Number((Math.random() * 500 + 1).toFixed(2));
        const usuarioId = userIds.length > 0 ? userIds[randInt(0, userIds.length - 1)] : null;
        const operadorId = userIds.length > 0 ? userIds[randInt(0, userIds.length - 1)] : null;
        const caixaStatusId = sess.id;
        await client.query('INSERT INTO caixa_movimentacoes(tipo, valor, descricao, usuario_id, operador_id, caixa_status_id, data_movimento, criado_em, atualizado_em) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [tipo, valor, 'Seed ' + tipo, usuarioId, operadorId, caixaStatusId, dt.toISOString(), dt.toISOString(), dt.toISOString()]);
      }
    }

    console.log('Inserted', NUM_RECORDS, 'records into Postgres (with operador and caixa links where possible) and multi-payment support');
  } finally {
    await client.end();
  }
}

async function main() {
  console.log('🚀 Starting seed-complete.js');
  console.log('Mode:', API_BASE ? 'API' : USE_PG ? 'PostgreSQL' : 'SQLite');
  console.log('Records to create:', NUM_RECORDS);

  if (API_BASE) {
    console.log('API Base:', API_BASE);
    await runApiMode();
  } else if (USE_PG) {
    console.log('PostgreSQL connection:', PGHOST, PGPORT, PGDATABASE);
    await runPgMode();
  } else {
    console.log('SQLite database path:', DB_PATH);
    try {
      await runDbMode();
      console.log('✅ DB mode completed successfully!');
      console.log('📁 Database file:', DB_PATH);
    } catch (e) {
      console.error('❌ DB mode failed:', e.message);
      console.error('Stack:', e.stack);
      console.log('💡 Try running with --api to use API mode (requires server + auth) or --pg to use Postgres');
    }
  }

  console.log('🏁 Script execution finished');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
