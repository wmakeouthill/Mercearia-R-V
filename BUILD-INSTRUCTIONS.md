# Instruções de Build e Distribuição

## Pré-requisitos

1. **Node.js** (versão 16 ou superior)
2. **npm** ou **yarn**
3. **Git**

## Instalação de Dependências

```bash
# Instalar todas as dependências do projeto
npm run install:all
```

## Desenvolvimento

```bash
# Iniciar em modo desenvolvimento
npm run dev
```

Este comando irá:

- Iniciar o backend na porta 3000
- Iniciar o frontend na porta 4200
- Iniciar o Electron

## Build para Produção

### 1. Build Completo

```bash
# Build de todos os componentes
npm run build:all
```

Este comando irá:

- Compilar o backend TypeScript
- Build do frontend Angular
- Compilar o Electron TypeScript

### 2. Criar Instalador

```bash
# Para Windows
npm run dist:win

# Para todas as plataformas
npm run dist
```

## Estrutura de Arquivos de Produção

Após o build, os arquivos serão organizados da seguinte forma:

```nocod
electron/dist-installer/
├── Sistema de Gestão de Estoque Setup.exe (Windows)
├── Sistema de Gestão de Estoque.dmg (macOS)
└── Sistema de Gestão de Estoque.AppImage (Linux)
```

## Configurações de Ambiente

### Desenvolvimento2

- Backend: `http://localhost:3000`
- Frontend: `http://localhost:4200`
- API: `http://localhost:3000/api`

### Produção

- Backend: Embarcado no Electron (porta 3000)
- Frontend: Arquivos estáticos servidos pelo Electron
- API: `http://localhost:3000/api` (backend local)

## Configurações de Rede

### Desenvolvimento3

- CORS configurado para `localhost:4200` e `localhost:3000`
- Backend roda separadamente

### Produção3

- CORS configurado para `file://` (Electron) e `localhost:3000`
- Backend embarcado no aplicativo Electron
- Todas as comunicações são locais

## Personalização

### Ícones

Coloque os ícones nos seguintes formatos em `electron/assets/`:

- `icon.ico` - Windows
- `icon.icns` - macOS
- `icon.png` - Linux

### Configuração do Instalador

Edite `electron/electron-builder.json` para personalizar:

- Nome do aplicativo
- Configurações do instalador
- Atalhos do desktop/menu iniciar

## Solução de Problemas

### Erro de Build do Frontend

```bash
cd frontend
npm install
npm run build
```

### Erro de Build do Backend

```bash
cd backend
npm install
npm run build
```

### Erro de Build do Electron

```bash
cd electron
npm install
npm run build
```

### Banco de Dados

- O banco SQLite será copiado automaticamente para o instalador
- Em produção, o banco fica no diretório do aplicativo
- Backup automático não implementado (considere implementar)

## Distribuição

### Windows

- Instalador NSIS criado automaticamente
- Suporte a x64
- Atalhos no desktop e menu iniciar

### macOS

- Arquivo DMG criado automaticamente
- Assinatura de código requerida para distribuição

### Linux

- AppImage criado automaticamente
- Compatível com a maioria das distribuições

## Notas Importantes

1. **Segurança**: O aplicativo roda com permissões locais
2. **Banco de Dados**: SQLite local, sem sincronização automática
3. **Atualizações**: Não há sistema de atualização automática
4. **Logs**: Logs são salvos localmente no diretório do aplicativo
5. **Backup**: Implemente backup manual do banco de dados

## Próximos Passos Recomendados

1. Implementar sistema de backup automático
2. Adicionar sistema de atualizações
3. Implementar sincronização com servidor remoto
4. Adicionar relatórios em PDF
5. Implementar sistema de usuários mais robusto
