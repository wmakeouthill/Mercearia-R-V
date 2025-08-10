# Instruções de Instalação e Execução

## 🚀 Instalação Rápida

### 1. Pré-requisitos

- Node.js 18+ instalado
- npm ou yarn
- Angular CLI: `npm install -g @angular/cli`

### 2. Instalar Dependências

```bash
# Na raiz do projeto
npm run install:all
```

### 3. Executar em Desenvolvimento

```bash
npm run dev
```

## 📋 Instalação Detalhada

### Backend

```bash
cd backend
npm install
npm run build
npm run dev
```

### Frontend (Angular)

```bash
cd frontend
ng new sistema-estoque-frontend --routing --style=scss
cd sistema-estoque-frontend
npm install
ng serve
```

### Electron

```bash
cd electron
npm install
npm run build
npm start
```

## 🔧 Configuração do Ambiente

### 1. Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
JWT_SECRET=sua_chave_secreta_muito_segura_aqui
PORT=3000
NODE_ENV=development
```

### 2. Configuração do Banco de Dados

O SQLite será criado automaticamente na primeira execução.

### 3. Usuário Padrão

- **Username**: admin
- **Password**: admin123

## 🚀 Execução

### Desenvolvimento

```bash
# Executa tudo simultaneamente
npm run dev
```

### Produção

```bash
# Build completo
npm run build

# Executar aplicação
npm start

# Criar executável
npm run package
```

## 📁 Estrutura Criada

```mermaid
meu-sistema-estoque/
├── backend/                 ✅ Criado
│   ├── src/
│   │   ├── config/         ✅ database.ts
│   │   ├── controllers/    ✅ auth, produtos, vendas
│   │   ├── middleware/     ✅ auth, admin
│   │   ├── models/         ✅ (usando SQLite direto)
│   │   ├── routes/         ✅ auth, produtos, vendas
│   │   ├── types/          ✅ interfaces TypeScript
│   │   └── server.ts       ✅ servidor principal
│   ├── package.json        ✅ dependências
│   └── tsconfig.json       ✅ configuração TS
├── electron/               ✅ Criado
│   ├── src/
│   │   ├── main.ts         ✅ processo principal
│   │   └── preload.ts      ✅ comunicação segura
│   ├── package.json        ✅ dependências
│   └── tsconfig.json       ✅ configuração TS
├── frontend/               ⏳ Precisa criar Angular
├── package.json            ✅ scripts principais
├── tsconfig.json           ✅ configuração TS
├── README.md               ✅ documentação
└── INSTRUCOES.md           ✅ este arquivo
```

## 🔍 Testando a API

### 1. Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

### 2. Criar Produto

```bash
curl -X POST http://localhost:3000/api/produtos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -d '{
    "nome": "Produto Teste",
    "codigo_barras": "123456789",
    "preco_venda": 29.99,
    "quantidade_estoque": 100
  }'
```

### 3. Listar Produtos

```bash
curl -X GET http://localhost:3000/api/produtos \
  -H "Authorization: Bearer SEU_TOKEN"
```

## 🛠️ Próximos Passos

### 1. Criar Frontend Angular

```bash
cd frontend
ng new sistema-estoque-frontend --routing --style=scss
```

### 2. Implementar Componentes

- Login
- Dashboard
- Lista de Produtos
- Formulário de Produtos
- Ponto de Venda
- Relatórios

### 3. Implementar Serviços

- AuthService
- ApiService
- Guards de rota

### 4. Testar Integração

- Backend + Frontend
- Electron + Backend + Frontend

## 🔧 Solução de Problemas

### Erro de Dependências

```bash
# Limpar cache
npm cache clean --force

# Reinstalar
rm -rf node_modules package-lock.json
npm install
```

### Erro de Porta

```bash
# Verificar se a porta 3000 está livre
netstat -ano | findstr :3000

# Matar processo se necessário
taskkill /PID <PID> /F
```

### Erro de Build

```bash
# Limpar builds
rm -rf dist/

# Rebuild
npm run build
```

## 📞 Suporte

Para problemas específicos:

1. Verifique os logs do console
2. Confirme se todas as dependências estão instaladas
3. Verifique se as portas estão livres
4. Consulte a documentação do README.md
