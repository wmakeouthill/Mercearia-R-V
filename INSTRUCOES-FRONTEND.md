# Instruções para Completar o Frontend

## Status Atual

✅ **Concluído:**

- Estrutura do projeto Angular criada
- Componentes básicos criados (login, dashboard, lista-produtos)
- Serviços de autenticação e API implementados
- Guards de autenticação criados
- Modelos TypeScript definidos
- Estilos CSS implementados

🔄 **Pendente:**

- Implementar componentes restantes
- Configurar rotas com guards
- Conectar com o backend real
- Testar funcionalidades

## Próximos Passos

### 1. Completar Componentes Restantes

#### Formulário de Produto (`form-produto`)

```typescript
// Implementar:
- Formulário para criar/editar produtos
- Validação de campos
- Integração com API
- Navegação de volta para lista
```

#### Ponto de Venda (`ponto-venda`)

```typescript
// Implementar:
- Interface para selecionar produtos
- Cálculo de valores
- Finalização de vendas
- Atualização de estoque
```

#### Relatório de Vendas (`relatorio-vendas`)

```typescript
// Implementar:
- Gráficos de vendas
- Filtros por período
- Exportação de dados
- Estatísticas
```

### 2. Configurar Rotas com Guards

Atualizar `app.routes.ts` para incluir os guards:

```typescript
import { AuthGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { 
    path: 'dashboard', 
    component: DashboardComponent,
    canActivate: [AuthGuard]
  },
  { 
    path: 'produtos', 
    component: ListaProdutosComponent,
    canActivate: [AuthGuard]
  },
  { 
    path: 'produtos/novo', 
    component: FormProdutoComponent,
    canActivate: [AuthGuard, AdminGuard]
  },
  // ... outras rotas
];
```

### 3. Conectar com Backend Real

#### Atualizar AuthService

```typescript
// Substituir simulação por chamadas reais:
login(credentials: LoginRequest): Observable<LoginResponse> {
  return this.http.post<LoginResponse>(`${this.baseUrl}/auth/login`, credentials);
}
```

#### Atualizar ApiService

```typescript
// Descomentar chamadas reais da API:
getProdutos(): Observable<Produto[]> {
  return this.http.get<Produto[]>(`${this.baseUrl}/produtos`, { 
    headers: this.getHeaders() 
  });
}
```

### 4. Instalar Dependências Adicionais

```bash
cd frontend
npm install @angular/material @angular/cdk @angular/animations
npm install chart.js ng2-charts  # Para gráficos
npm install @angular/forms       # Para formulários reativos
```

### 5. Configurar Angular Material

```typescript
// app.config.ts
import { provideAnimations } from '@angular/platform-browser/animations';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimations(),
    provideHttpClient()
  ]
};
```

### 6. Implementar Interceptor HTTP

```typescript
// Criar: src/app/interceptors/auth.interceptor.ts
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = this.authService.getToken();
    
    if (token) {
      req = req.clone({
        setHeaders: {
          Authorization: `Bearer ${token}`
        }
      });
    }
    
    return next.handle(req);
  }
}
```

### 7. Testar Funcionalidades

#### Testar Login

1. Acessar `http://localhost:4200`
2. Fazer login com credenciais:
   - Admin: `admin` / `admin123`
   - User: `user` / `user123`

#### Testar Navegação

1. Verificar se rotas protegidas redirecionam para login
2. Verificar se funcionalidades admin só aparecem para admins
3. Testar logout e limpeza de dados

#### Testar API

1. Verificar se backend está rodando em `http://localhost:3000`
2. Testar endpoints com Postman ou similar
3. Verificar se tokens JWT estão sendo enviados corretamente

## Estrutura Final Esperada

```mermaid
frontend/src/app/
├── components/
│   ├── login/              ✅ Concluído
│   ├── dashboard/          ✅ Concluído
│   ├── lista-produtos/     ✅ Concluído
│   ├── form-produto/       🔄 Pendente
│   ├── ponto-venda/        🔄 Pendente
│   └── relatorio-vendas/   🔄 Pendente
├── services/
│   ├── auth.ts            ✅ Concluído
│   └── api.ts             ✅ Concluído
├── guards/
│   ├── auth.guard.ts      ✅ Concluído
│   └── admin.guard.ts     ✅ Concluído
├── models/
│   └── index.ts           ✅ Concluído
├── interceptors/          🔄 Pendente
└── shared/                🔄 Pendente
```

## Comandos para Executar

```bash
# 1. Instalar dependências
cd frontend
npm install

# 2. Iniciar servidor de desenvolvimento
npm start

# 3. Em outro terminal, iniciar backend
cd ../backend
npm run dev

# 4. Acessar aplicação
# Frontend: http://localhost:4200
# Backend: http://localhost:3000
```

## Problemas Comuns

### Erro de CORS

- Verificar se backend está configurado para aceitar requisições do frontend
- Verificar se URLs estão corretas

### Erro de Compilação TypeScript

- Verificar se todas as dependências estão instaladas
- Verificar se imports estão corretos

### Erro de Autenticação

- Verificar se tokens estão sendo armazenados corretamente
- Verificar se headers estão sendo enviados

## Próximas Melhorias

1. **Validação de Formulários**: Implementar validação reativa
2. **Notificações**: Adicionar sistema de notificações
3. **Loading States**: Melhorar feedback visual
4. **Error Handling**: Implementar tratamento de erros global
5. **Responsividade**: Melhorar design mobile
6. **Testes**: Adicionar testes unitários e e2e
