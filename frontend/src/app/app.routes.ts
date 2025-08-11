import { Routes } from '@angular/router';
import { AuthGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';

export const routes: Routes = [
    { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
    { path: 'login', loadComponent: () => import('./components/login/login').then(m => m.LoginComponent) },
    {
        path: 'dashboard',
        loadComponent: () => import('./components/dashboard/dashboard').then(m => m.DashboardComponent),
        canActivate: [AuthGuard]
    },
    {
        path: 'caixa',
        loadComponent: () => import('./components/caixa/caixa').then(m => m.CaixaComponent),
        canActivate: [AuthGuard, AdminGuard]
    },
    {
        path: 'produtos',
        loadComponent: () => import('./components/lista-produtos/lista-produtos').then(m => m.ListaProdutosComponent),
        canActivate: [AuthGuard, AdminGuard]
    },
    {
        path: 'produtos/novo',
        loadComponent: () => import('./components/form-produto/form-produto').then(m => m.FormProdutoComponent),
        canActivate: [AuthGuard, AdminGuard]
    },
    {
        path: 'produtos/editar/:id',
        loadComponent: () => import('./components/form-produto/form-produto').then(m => m.FormProdutoComponent),
        canActivate: [AuthGuard, AdminGuard]
    },
    {
        path: 'vendas',
        loadComponent: () => import('./components/ponto-venda/ponto-venda').then(m => m.PontoVendaComponent),
        canActivate: [AuthGuard]
    },
    {
        path: 'relatorios',
        loadComponent: () => import('./components/relatorio-vendas/relatorio-vendas').then(m => m.RelatorioVendasComponent),
        canActivate: [AuthGuard]
    },
    {
        path: 'logs',
        loadComponent: () => import('./components/logs-viewer/logs-viewer').then(m => m.LogsViewerComponent),
        canActivate: [AuthGuard, AdminGuard]
    },
    {
        path: 'produtos/estoque',
        loadComponent: () => import('./components/gerenciar-estoque/gerenciar-estoque').then(m => m.GerenciarEstoqueComponent),
        canActivate: [AuthGuard, AdminGuard]
    },
    {
        path: 'vendas/historico',
        loadComponent: () => import('./components/historico-vendas/historico-vendas').then(m => m.HistoricoVendasComponent),
        canActivate: [AuthGuard, AdminGuard]
    },
    {
        path: 'administracao',
        loadComponent: () => import('./components/administracao/administracao').then(m => m.AdministracaoComponent),
        canActivate: [AuthGuard, AdminGuard]
    },
    { path: '**', redirectTo: '/dashboard' }
];
