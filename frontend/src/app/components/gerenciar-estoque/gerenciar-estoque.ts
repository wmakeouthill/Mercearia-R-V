import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { Produto } from '../../models';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-gerenciar-estoque',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="estoque-container">
      <div class="header">
        <h2>📋 Gerenciar Estoque</h2>
        <div class="header-actions">
          <button (click)="voltarAoDashboard()" class="btn-voltar">← Voltar ao Dashboard</button>
        </div>
      </div>

      <div class="content">
        <div class="search-section">
          <input
            type="text"
            [(ngModel)]="searchTerm"
            (input)="filterProdutos()"
            placeholder="Buscar produtos..."
            class="search-input"
          >
        </div>

        @if (!loading) {<div class="produtos-grid">
          @for (produto of produtosFiltrados; track produto.id) {<div class="produto-card">
            <div class="produto-info">
              <h3>{{ produto.nome }}</h3>
              <p class="codigo">Código: {{ produto.codigo_barras || 'N/A' }}</p>
              <p class="preco">Preço: R$ {{ produto.preco_venda.toFixed(2) }}</p>
            </div>

            <div class="estoque-section">
              <div class="estoque-atual">
                <span class="label">Estoque Atual:</span>
                <span class="quantidade" [class.baixo]="produto.quantidade_estoque < 10">
                  {{ produto.quantidade_estoque }}
                </span>
              </div>

              <div class="estoque-actions">
                <input
                  type="number"
                  [(ngModel)]="produto.novaQuantidade"
                  [placeholder]="produto.quantidade_estoque.toString()"
                  class="quantidade-input"
                  min="0"
                >
                <button
                  (click)="atualizarEstoque(produto)"
                  [disabled]="produto.atualizando"
                  class="btn-atualizar"
                >
                  {{ produto.atualizando ? 'Atualizando...' : 'Atualizar' }}
                </button>
              </div>
            </div>
          </div>}
        </div>}

        @if (loading) {<div class="loading">Carregando produtos...</div>}

        @if (produtosFiltrados.length === 0 && !loading) {<div class="no-produtos">
          Nenhum produto encontrado
        </div>}
      </div>

      <div class="stats-section">
        <div class="stat-card">
          <h4>Total de Produtos</h4>
          <span class="stat-value">{{ produtos.length }}</span>
        </div>
        <div class="stat-card">
          <h4>Em Estoque</h4>
          <span class="stat-value">{{ getProdutosEmEstoque() }}</span>
        </div>
        <div class="stat-card">
          <h4>Estoque Baixo</h4>
          <span class="stat-value warning">{{ getProdutosEstoqueBaixo() }}</span>
        </div>
        <div class="stat-card">
          <h4>Sem Estoque</h4>
          <span class="stat-value danger">{{ getProdutosSemEstoque() }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .estoque-container {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 30px;
      padding-bottom: 12px;
      border-bottom: 2px solid #e0e0e0;
    }

    .header-actions {
      display: flex;
      align-items: center;
    }

    .btn-voltar {
      background: linear-gradient(135deg, #DBC27D 0%, #D1B867 100%);
      color: var(--primary-blue);
      border: none;
      padding: 12px 24px;
      border-radius: 12px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 700;
      transition: all 0.3s ease;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      box-shadow: 0 4px 12px rgba(219, 194, 125, 0.3);
    }

    .btn-voltar:hover {
      background: linear-gradient(135deg, #D1B867 0%, #C9AA55 100%);
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(219, 194, 125, 0.45);
    }

    .header h2 {
      margin: 0;
      color: #333;
    }

    .search-section {
      margin-bottom: 20px;
    }

    .search-input {
      width: 100%;
      max-width: 400px;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 16px;
    }

    .produtos-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .produto-card {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 20px;
      background: white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .produto-info h3 {
      margin: 0 0 10px 0;
      color: #333;
    }

    .codigo, .preco {
      margin: 5px 0;
      color: #666;
    }

    .estoque-section {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #eee;
    }

    .estoque-atual {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .label {
      font-weight: 500;
      color: #333;
    }

    .quantidade {
      font-size: 18px;
      font-weight: bold;
      color: #28a745;
    }

    .quantidade.baixo {
      color: #ffc107;
    }

    .quantidade.zero {
      color: #dc3545;
    }

    .estoque-actions {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .quantidade-input {
      flex: 1;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    .btn-atualizar {
      padding: 8px 16px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }

    .btn-atualizar:hover:not(:disabled) {
      background: #0056b3;
    }

    .btn-atualizar:disabled {
      background: #6c757d;
      cursor: not-allowed;
    }

    .loading, .no-produtos {
      text-align: center;
      padding: 40px;
      color: #666;
      font-style: italic;
    }

    .stats-section {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-top: 30px;
    }

    .stat-card {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }

    .stat-card h4 {
      margin: 0 0 10px 0;
      color: #333;
      font-size: 14px;
    }

    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #28a745;
    }

    .stat-value.warning {
      color: #ffc107;
    }

    .stat-value.danger {
      color: #dc3545;
    }

    @media (max-width: 768px) {
      .produtos-grid {
        grid-template-columns: 1fr;
      }

      .estoque-actions {
        flex-direction: column;
      }

      .stats-section {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  `]
})
export class GerenciarEstoqueComponent implements OnInit {
  produtos: Produto[] = [];
  produtosFiltrados: Produto[] = [];
  searchTerm = '';
  loading = false;
  error = '';

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly router: Router
  ) { }

  ngOnInit(): void {
    logger.info('GERENCIAR_ESTOQUE', 'INIT', 'Componente iniciado');
    this.loadProdutos();
  }

  loadProdutos(): void {
    this.loading = true;
    this.error = '';

    this.apiService.getProdutos().subscribe({
      next: (produtos) => {
        this.produtos = produtos.map(p => ({
          ...p,
          novaQuantidade: p.quantidade_estoque,
          atualizando: false
        }));
        this.produtosFiltrados = [...this.produtos];
        this.loading = false;
        logger.info('GERENCIAR_ESTOQUE', 'LOAD_PRODUTOS', 'Produtos carregados', { count: produtos.length });
      },
      error: (error: any) => {
        this.error = 'Erro ao carregar produtos';
        this.loading = false;
        logger.error('GERENCIAR_ESTOQUE', 'LOAD_PRODUTOS', 'Erro ao carregar produtos', error);
      }
    });
  }

  filterProdutos(): void {
    if (!this.searchTerm.trim()) {
      this.produtosFiltrados = [...this.produtos];
    } else {
      const term = this.searchTerm.toLowerCase();
      this.produtosFiltrados = this.produtos.filter(produto =>
        produto.nome.toLowerCase().includes(term) ||
        produto.codigo_barras?.toLowerCase().includes(term)
      );
    }
  }

  atualizarEstoque(produto: Produto): void {
    if (produto.novaQuantidade === undefined || produto.novaQuantidade === null) {
      return;
    }

    const novaQuantidade: number = produto.novaQuantidade;

    produto.atualizando = true;

    this.apiService.updateEstoque(produto.id!, novaQuantidade).subscribe({
      next: () => {
        produto.quantidade_estoque = novaQuantidade;
        produto.atualizando = false;
        logger.info('GERENCIAR_ESTOQUE', 'UPDATE_ESTOQUE', 'Estoque atualizado', { id: produto.id, quantidade: produto.quantidade_estoque });
      },
      error: (error: any) => {
        produto.atualizando = false;
        logger.error('GERENCIAR_ESTOQUE', 'UPDATE_ESTOQUE', 'Erro ao atualizar estoque', error);
        alert('Erro ao atualizar estoque');
      }
    });
  }

  getProdutosEmEstoque(): number {
    return this.produtos.filter(p => p.quantidade_estoque > 0).length;
  }

  getProdutosEstoqueBaixo(): number {
    return this.produtos.filter(p => p.quantidade_estoque > 0 && p.quantidade_estoque < 10).length;
  }

  getProdutosSemEstoque(): number {
    return this.produtos.filter(p => p.quantidade_estoque === 0).length;
  }

  voltarAoDashboard(): void {
    this.router.navigate(['/dashboard']);
  }
}
