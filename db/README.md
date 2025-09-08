# Migração de Dados SQLite para PostgreSQL

Este diretório contém scripts para migrar dados do SQLite legacy para PostgreSQL com suporte a múltiplos métodos de pagamento.

## Scripts Disponíveis

### 1. Gerar Dump (`npm run dump-sqlite`)

Gera um arquivo SQL com os dados do SQLite convertidos para a nova estrutura PostgreSQL:

```bash
npm run dump-sqlite
```

**O que faz:**

- Lê dados do `database.sqlite`
- Converte estrutura legacy de vendas (método único) para nova estrutura (múltiplos métodos)
- Gera arquivo `database-dump.sql` e copia para `db/dump_data.sql`

### 2. Importar Dados (`npm run import-sqlite-data`)

Importa os dados do dump para o PostgreSQL embedded **apenas uma vez**:

```bash
npm run import-sqlite-data
```

**O que faz:**

- Verifica se já foi importado anteriormente
- Conecta ao PostgreSQL embedded
- Executa o dump SQL em uma transação
- Marca como importado para evitar duplicação

### 3. Resetar Importação (`npm run import-sqlite-data:reset`)

Remove o marker de importação para permitir nova importação:

```bash
npm run import-sqlite-data:reset
```

## Fluxo de Uso

1. **Primeira vez (migração completa):**

   ```bash
   # Gera o dump do SQLite
   npm run dump-sqlite
   
   # Importa os dados para PostgreSQL
   npm run import-sqlite-data
   
   # Inicia o sistema normalmente
   npm run dev
   ```

2. **Uso normal (após migração):**

   ```bash
   # O sistema usa PostgreSQL com dados migrados
   npm run dev
   ```

3. **Reimportar dados (se necessário):**

   ```bash
   # Remove marker de importação
   npm run import-sqlite-data:reset
   
   # Importa novamente
   npm run import-sqlite-data
   ```

## Estrutura de Conversão

### Vendas Legacy → Nova Estrutura

**Antes (SQLite legacy):**

```sql
CREATE TABLE vendas (
  id INTEGER PRIMARY KEY,
  produto_id INTEGER,
  quantidade INTEGER,
  preco_total DOUBLE,
  metodo_pagamento VARCHAR(50), -- UM método apenas
  data_venda TIMESTAMP,
  -- outros campos...
);
```

**Depois (PostgreSQL nova):**

```sql
-- Cabeçalho da venda
CREATE TABLE venda_cabecalho (
  id BIGSERIAL PRIMARY KEY,
  data_venda TIMESTAMP,
  subtotal DOUBLE PRECISION,
  total_final DOUBLE PRECISION,
  -- outros campos...
);

-- Itens da venda
CREATE TABLE venda_itens (
  id BIGSERIAL PRIMARY KEY,
  venda_id BIGINT REFERENCES venda_cabecalho(id),
  produto_id BIGINT,
  quantidade INTEGER,
  preco_unitario DOUBLE PRECISION,
  preco_total DOUBLE PRECISION
);

-- MÚLTIPLOS métodos de pagamento por venda
CREATE TABLE venda_pagamentos (
  id BIGSERIAL PRIMARY KEY,
  venda_id BIGINT REFERENCES venda_cabecalho(id),
  metodo VARCHAR(50), -- dinheiro, cartao_credito, cartao_debito, pix
  valor DOUBLE PRECISION,
  troco DOUBLE PRECISION
);
```

## Mapeamento de Métodos de Pagamento

O script converte os métodos legacy para os novos padrões:

```javascript
{
  'dinheiro': 'dinheiro',
  'cartao': 'cartao_credito',      // Legacy
  'cartao_credito': 'cartao_credito',
  'cartao_debito': 'cartao_debito',
  'pix': 'pix',
  'debito': 'cartao_debito',       // Legacy
  'credito': 'cartao_credito'      // Legacy
}
```

## Arquivos Gerados

- `database-dump.sql`: Dump SQL completo (raiz do projeto)
- `db/dump_data.sql`: Cópia do dump na pasta correta
- `db/.data-imported`: Marker que indica que dados já foram importados

## Segurança

- **Proteção contra duplicação**: O script verifica se já foi executado
- **Transações**: Importação em transação (rollback em caso de erro)
- **Backup automático**: Mantém dados originais no SQLite
- **Confirmação**: Pergunta antes de sobrescrever dados existentes

## Solução de Problemas

### Erro de conexão PostgreSQL

```bash
# Verifique se o PostgreSQL embedded está rodando
npm run dev
```

### Dados já existem

```bash
# Para sobrescrever, use reset primeiro
npm run import-sqlite-data:reset
npm run import-sqlite-data
```

### Arquivo de dump não encontrado

```bash
# Gere o dump primeiro
npm run dump-sqlite
```
