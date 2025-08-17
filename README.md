# Sistema de Gestão de Estoque

Sistema desktop completo para gestão de produtos, estoque e vendas, desenvolvido com TypeScript, Angular, Node.js/Express e Electron.

## 🚀 Tecnologias Utilizadas

- **Frontend**: Angular 17 (TypeScript)
- **Backend**: Node.js + Express.js (TypeScript)
- **Banco de Dados**: SQLite
- **Desktop**: Electron (TypeScript)
- **Autenticação**: JWT
- **Estilização**: SCSS

## 📁 Estrutura do Projeto

```mermaid
sistema-estoque/
├── backend/             # API REST em TypeScript
│   ├── src/
│   │   ├── config/      # Configuração do banco
│   │   ├── controllers/ # Controladores da API
│   │   ├── middleware/  # Middlewares de autenticação
│   │   ├── models/      # Modelos de dados
│   │   ├── routes/      # Rotas da API
│   │   ├── types/       # Tipos TypeScript
│   │   └── server.ts    # Servidor principal
│   └── package.json
├── frontend/            # Aplicação Angular
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/ # Componentes da UI
│   │   │   ├── services/   # Serviços
│   │   │   ├── guards/     # Guards de rota
│   │   │   └── models/     # Modelos TypeScript
│   │   └── ...
│   └── package.json
├── electron/            # Aplicação Electron
│   ├── src/
│   │   ├── main.ts      # Processo principal
│   │   └── preload.ts   # Script de preload
│   └── package.json
└── package.json         # Scripts principais
```

## 🛠️ Instalação e Configuração

### ⚡ Início Rápido de Desenvolvimento

Para reduzir o tempo até a janela Electron abrir você pode usar os scripts de desenvolvimento rápido:

```bash
npm run dev:fast          # Frontend inicia em paralelo (HTTP)
npm run dev:fast:https    # Frontend inicia em paralelo (HTTPS se certs existirem)
```

Ou definir a variável de ambiente manualmente:

```bash
FAST_FRONTEND_START=true npm run dev
```

Variáveis relevantes:

| Variável | Padrão | Efeito |
|----------|--------|--------|
| FAST_FRONTEND_START | false | Se true, não espera /health; inicia Angular após pequeno delay (configurável) |
| FAST_FRONTEND_DELAY | 3     | Segundos de espera antes de subir o frontend em modo FAST |
| AUTO_DEV_HTTPS      | true  | Se certificados existirem ativa HTTPS automaticamente |
| DEV_HTTPS_HOST      | (vazio)| Host override para ng serve em modo https |
| FRONTEND_BASE_HREF  | /app/ | Quando copiar frontend para o backend, define o `<base href>` usado pelo index (override via env)|

Certificados esperados em `frontend/certs/merceariarv.app.pem` e `merceariarv.app-key.pem` (gerar com `npm run cert:generate`).

### Pré-requisitos

- Node.js (versão 18 ou superior)
- npm ou yarn
- Angular CLI (será instalado automaticamente)

### 1. Instalar Dependências

```bash
# Instalar dependências de todos os módulos
npm run install:all
```

### 2. Configurar o Backend

```bash
# Navegar para o backend
cd backend

# Instalar dependências
npm install

# Compilar TypeScript
npm run build

# Iniciar em modo desenvolvimento
npm run dev
```

O backend estará disponível em `http://localhost:3000`

### 3. Configurar o Frontend

```bash
# Navegar para o frontend
cd frontend

# Instalar dependências
npm install

# Iniciar servidor de desenvolvimento
npm start
```

O frontend estará disponível em `http://localhost:4200`

### 4. Configurar o Electron

```bash
# Navegar para o electron
cd electron

# Instalar dependências
npm install

# Compilar TypeScript
npm run build
```

## 🚀 Executando o Sistema

### Modo Desenvolvimento

```bash
# Executar todos os serviços simultaneamente
npm run dev
```

Este comando irá:

- Iniciar o backend na porta 3000
- Iniciar o frontend na porta 4200
- Iniciar o Electron

### Modo Produção

```bash
# Build completo (gera frontend, copia para backend, empacota o JAR e prepara Electron)
# No root do repositório execute:
npm run build:backend   # -> executa o build do frontend, copia os assets para backend e empacota o JAR

# Alternativamente (build completo):
npm run build:all       # constrói backend, frontend e electron

# Executar aplicação (após build)
npm start

# Criar executável (Electron)
npm run package
```

## 👤 Credenciais de Acesso

### Usuário Administrador

- **Username**: `admin`
- **Password**: `admin123`
- **Permissões**: Acesso total ao sistema

### Usuário Padrão

- **Username**: `user`
- **Password**: `user123`
- **Permissões**: Acesso limitado (visualização e vendas)

## 📋 Funcionalidades

### 🔐 Autenticação e Autorização

- Login com JWT
- Diferenciação entre usuários admin e padrão
- Guards de rota para proteção

### 📦 Gestão de Produtos

- Listagem de produtos
- Adicionar novo produto (admin)
- Editar produto (admin)
- Excluir produto (admin)
- Gerenciar estoque (admin)

### 💰 Ponto de Venda

- Realizar vendas
- Atualização automática do estoque
- Histórico de vendas

### 📊 Relatórios

- Relatório de vendas por dia
- Relatório de vendas por mês
- Dashboard com resumos

## 🔧 API Endpoints

### Autenticação

- `POST /api/auth/login` - Login de usuário

### Produtos

- `GET /api/produtos` - Listar produtos
- `GET /api/produtos/:id` - Obter produto específico
- `POST /api/produtos` - Criar produto (admin)
- `PUT /api/produtos/:id` - Atualizar produto (admin)
- `DELETE /api/produtos/:id` - Excluir produto (admin)
- `PUT /api/produtos/:id/estoque` - Atualizar estoque (admin)

### Vendas

- `GET /api/vendas` - Listar vendas
- `POST /api/vendas` - Criar venda
- `DELETE /api/vendas/:id` - Excluir venda (admin)

### Relatórios

- `GET /api/relatorios/vendas/dia` - Relatório diário
- `GET /api/relatorios/vendas/mes` - Relatório mensal

## 🗄️ Banco de Dados

O sistema utiliza SQLite com as seguintes tabelas:

### Usuarios

- `id` (INTEGER, PRIMARY KEY)
- `username` (TEXT, UNIQUE)
- `password` (TEXT, hash bcrypt)
- `role` (TEXT, 'admin' ou 'user')

### Produtos2

- `id` (INTEGER, PRIMARY KEY)
- `nome` (TEXT)
- `codigo_barras` (TEXT, UNIQUE)
- `preco_venda` (REAL)
- `quantidade_estoque` (INTEGER)

### Vendas2

- `id` (INTEGER, PRIMARY KEY)
- `produto_id` (INTEGER, FOREIGN KEY)
- `quantidade_vendida` (INTEGER)
- `preco_total` (REAL)
- `data_venda` (TEXT)

## 🐛 Solução de Problemas

### Erro de CORS

Se houver problemas de CORS, verifique se o backend está rodando na porta 3000 e o frontend na porta 4200.

### Erro de Banco de Dados

O banco SQLite será criado automaticamente na primeira execução. Verifique se o diretório tem permissões de escrita.

### Erro de Compilação TypeScript

Execute `npm run build` em cada módulo para verificar erros de compilação.

## 📝 Scripts Disponíveis

### Scripts Principais

- `npm run install:all` - Instalar todas as dependências
- `npm run dev` - Executar em modo desenvolvimento
- `npm run dev:fast` - Dev mais rápido (inicia frontend sem esperar backend ficar saudável)
- `npm run dev:fast:https` - Igual ao anterior mas preferindo HTTPS
- `npm run build` - Build completo
- `npm run start` - Executar aplicação
- `npm run package` - Criar executável

### Scripts do Backend

- `npm run build:backend` - Compilar backend
- `npm run start:backend` - Iniciar backend

Nota: `npm run build:backend` no root agora executa automaticamente o build do frontend e copia os arquivos gerados para `backend-spring/src/main/resources/frontend` antes de executar `mvn package`. O mesmo passo também é executado quando você roda `mvn package` dentro de `backend-spring` graças a um plugin Maven configurado para chamar o script `../scripts/copy-frontend-to-backend.js` durante a fase `generate-resources`.

Verificações de ambiente antes do build

-------------------------------------

Executar `node scripts/check-env.js` (ou `npm run check-env`) para garantir que as ferramentas necessárias estejam disponíveis no PATH (`node`, `npm`, `mvn`, `java`). O script retorna código de saída não-zero se algo estiver faltando.

### Scripts do Frontend

- `npm run build:frontend` - Build do frontend
- `npm run start:frontend` - Iniciar frontend

### Scripts do Electron

- `npm run build:electron` - Compilar Electron
- `npm run start:electron` - Iniciar Electron

## 🤝 Contribuição

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença ISC. Veja o arquivo `LICENSE` para mais detalhes.

## 📞 Suporte

Para suporte, abra uma issue no repositório do projeto.
