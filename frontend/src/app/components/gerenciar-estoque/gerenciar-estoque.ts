import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
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
          <button (click)="limparFiltro()" class="btn-filtrar" [disabled]="selectedNivelFiltroSet.size === 0">🔍 Limpar filtro</button>
          <button (click)="voltarAoDashboard()" class="btn-voltar">← Voltar ao Dashboard</button>
        </div>
      </div>

      <div class="content">
        <!-- search + pageSize aligned -->
        <div class="search-and-controls" style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
          <div style="flex:1">
            <input
              type="text"
              [(ngModel)]="searchTerm"
              (input)="filterProdutos()"
              placeholder="Buscar produtos..."
              class="search-input"
            >
          </div>
          <div class="header-actions">
            <label class="page-size-label">Qtd produtos:
              <select [(ngModel)]="pageSize" (change)="setPageSize(pageSize)" class="select-filtro page-size-select">
                <option [ngValue]="6">6</option>
                <option [ngValue]="12">12</option>
                <option [ngValue]="18">18</option>
                <option [ngValue]="24">24</option>
              </select>
            </label>
          </div>
        </div>

        @if (!loading) {<div class="produtos-grid">
          @for (produto of produtosPagina; track produto.id) {<div class="produto-card">
            <div class="produto-content" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
              <div class="produto-info" style="flex:1;">
                <h3>{{ produto.nome }}</h3>
                <p class="codigo">Código: {{ produto.codigo_barras || 'N/A' }}</p>
                <p class="preco">Preço: R$ {{ produto.preco_venda.toFixed(2) }}</p>
              </div>
              <div class="produto-imagem" style="width:80px; height:80px; display:flex; align-items:center; justify-content:center;">
                <img [src]="getImageUrl(produto.imagem)" [alt]="produto.nome" class="produto-card-thumb" (error)="onImageError($event)" />
              </div>
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

        <!-- paginação abaixo dos cards (mesmo padrão do lista-produtos) -->
        @if (totalPages >= 1) {<div class="paginacao">
           <div class="pagination-left">
             <button class="btn-page btn-ghost" (click)="goToFirstPage()" [disabled]="page<=1" title="Primeira">«</button>
             <button class="btn-page btn-ghost" (click)="goBy(-10)" [disabled]="page<=1" title="-10">«10</button>
             <button class="btn-page btn-ghost" (click)="goBy(-5)" [disabled]="page<=1" title="-5">«5</button>
             <button class="btn-page btn-ghost" (click)="prevPage()" [disabled]="page<=1" title="Anterior">‹</button>
           </div>
           <div class="pagination-center">
             @for (p of paginationItems; track $index) {
               @if (p === '…') {<span class="ellipsis">…</span>} @else {<button class="btn-page" [class.active]="p === page" (click)="onClickPage(p)">{{ p }}</button>}
             }
           </div>
           <div class="pagination-right">
             <button class="btn-page btn-ghost" (click)="nextPage()" [disabled]="page>=totalPages" title="Próxima">›</button>
             <button class="btn-page btn-ghost" (click)="goBy(5)" [disabled]="page>=totalPages" title="+5">5»</button>
             <button class="btn-page btn-ghost" (click)="goBy(10)" [disabled]="page>=totalPages" title="+10">10»</button>
             <button class="btn-page btn-ghost" (click)="goToLastPage()" [disabled]="page>=totalPages" title="Última">»</button>
           </div>
           <div class="pagination-jump">
             <label>
               Ir para
               <input type="number" min="1" [max]="totalPages" [(ngModel)]="jumpPage" (keyup.enter)="onJumpToPage()" />
             </label>
             <button class="btn-go" (click)="onJumpToPage()">Ir</button>
           </div>
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
        <div class="stat-card clickable" (click)="toggleFiltroNivel('alto')" [class.active]="selectedNivelFiltroSet.has('alto')">
          <h4>Alto</h4>
          <span class="stat-value">{{ getProdutosEstoqueAlto() }}</span>
        </div>
        <div class="stat-card clickable" (click)="toggleFiltroNivel('medio')" [class.active]="selectedNivelFiltroSet.has('medio')">
          <h4>Médio</h4>
          <span class="stat-value">{{ getProdutosEstoqueMedio() }}</span>
        </div>
        <div class="stat-card clickable" (click)="toggleFiltroNivel('baixo')" [class.active]="selectedNivelFiltroSet.has('baixo')">
          <h4>Baixo</h4>
          <span class="stat-value warning">{{ getProdutosEstoqueBaixo() }}</span>
        </div>
        <div class="stat-card clickable" (click)="toggleFiltroNivel('critico')" [class.active]="selectedNivelFiltroSet.has('critico')">
          <h4>Crítico</h4>
          <span class="stat-value danger">{{ getProdutosEstoqueCritico() }}</span>
        </div>
        <div class="stat-card clickable" (click)="toggleFiltroNivel('sem-estoque')" [class.active]="selectedNivelFiltroSet.has('sem-estoque')">
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

    /* reuse exact .btn-filtrar style from relatorio-vendas */
    .btn-filtrar {
      padding: 8px 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
      transition: all 0.3s ease;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      box-shadow: 0 2px 8px rgba(0, 46, 89, 0.1);
      background: linear-gradient(135deg, var(--primary-blue) 0%, var(--secondary-blue) 100%);
      color: var(--white);
      margin-right: 8px;
    }

    .btn-filtrar:hover:not(:disabled) {
      background: linear-gradient(135deg, var(--secondary-blue) 0%, var(--dark-blue) 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 46, 89, 0.3);
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

    /* controlar tamanho das imagens nos cards */
    .produto-imagem {
      width: 80px;
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-radius: 8px;
      background: #f8f9fa;
      flex-shrink: 0;
    }

    .produto-card-thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .page-size-label { display: inline-flex; align-items: center; gap: 8px; }

    /* Paginação - reaproveitar estilo do lista-produtos para consistência visual */
    .paginacao {
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        gap: 8px 12px;
        padding: 12px 16px;
        align-items: center;
        justify-content: space-between;
    }
    .paginacao .pagination-left, .paginacao .pagination-right {
        display: inline-flex;
        gap: 6px;
        align-items: center;
    }
    .paginacao .pagination-center {
        display: flex;
        gap: 6px;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
    }
    .paginacao .pagination-jump {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        justify-self: end;
    }
    .paginacao .btn-page {
        min-width: 36px;
        height: 36px;
        padding: 0 10px;
        border-radius: 8px;
        border: 2px solid var(--medium-gray);
        background: var(--white);
        color: var(--primary-blue);
        font-weight: 700;
        cursor: pointer;
    }
    .paginacao .btn-page.active {
        background: var(--primary-blue);
        color: var(--white);
        border-color: var(--primary-blue);
    }
    .paginacao .btn-page:disabled { opacity: .5; cursor: not-allowed; }
    .paginacao .ellipsis { padding: 0 8px; color: var(--primary-blue); opacity: .7; }
    .paginacao .btn-go { background: var(--primary-blue); color: var(--white); border: none; border-radius: 8px; padding: 8px 12px; font-weight: 700; cursor: pointer; }

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

    .stat-card.clickable {
      cursor: pointer;
      transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
      border: 2px solid transparent;
    }

    .stat-card.clickable:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 20px rgba(0,0,0,0.08);
    }

    .stat-card.clickable.active {
      border-color: rgba(0,46,89,0.12);
      background: linear-gradient(135deg, rgba(0,46,89,0.03) 0%, rgba(219,194,125,0.03) 100%);
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(0,46,89,0.08);
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
  // pagination
  page = 1;
  pageSize: 6 | 12 | 18 | 24 = 6;
  jumpPage: number | null = null;
  // support multi selections using a Set
  selectedNivelFiltroSet: Set<string> = new Set();
  selectedNivelFiltro: string | null = null; // kept for backward compatibility in template bindings if needed
  // thresholds
  readonly CRITICAL_THRESHOLD = 3;
  readonly LOW_THRESHOLD = 10;
  readonly MEDIUM_THRESHOLD = 30;

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly imageService: ImageService,
    private readonly router: Router
  ) { }

  ngOnInit(): void {
    logger.info('GERENCIAR_ESTOQUE', 'INIT', 'Componente iniciado');
    this.loadProdutos();
  }

  get total(): number { return this.produtosFiltrados.length; }

  get totalPages(): number {
    const totalItems = Number(this.total || 0);
    const perPage = Number(this.pageSize || 1);
    const pages = Math.ceil(totalItems / perPage);
    return Math.max(1, pages || 1);
  }

  get produtosPagina(): Produto[] {
    const start = (this.page - 1) * Number(this.pageSize || 1);
    return this.produtosFiltrados.slice(start, start + Number(this.pageSize || 1));
  }

  get paginationItems(): Array<number | string> {
    const totalPages = this.totalPages;
    const currentPage = this.page;
    const siblings = 2;
    const range: Array<number | string> = [];
    if (totalPages <= 1) return [1];
    range.push(1);
    const leftSibling = Math.max(2, currentPage - siblings);
    const rightSibling = Math.min(totalPages - 1, currentPage + siblings);
    if (leftSibling > 2) range.push('…');
    for (let i = leftSibling; i <= rightSibling; i++) range.push(i);
    if (rightSibling < totalPages - 1) range.push('…');
    if (totalPages > 1) range.push(totalPages);
    return range;
  }

  onClickPage(p: number | string): void { if (typeof p === 'number') this.goToPage(p); }

  goToPage(targetPage: number): void {
    const page = Math.max(1, Math.min(this.totalPages, Math.floor(Number(targetPage) || 1)));
    if (page === this.page) return;
    this.page = page;
  }

  nextPage() { if (this.page < this.totalPages) this.goToPage(this.page + 1); }
  prevPage() { if (this.page > 1) this.goToPage(this.page - 1); }
  goBy(delta: number): void { this.goToPage(this.page + delta); }
  goToFirstPage(): void { this.goToPage(1); }
  goToLastPage(): void { this.goToPage(this.totalPages); }

  onJumpToPage(): void {
    if (this.jumpPage == null) {
      return;
    }
    this.goToPage(this.jumpPage);
  }

  setPageSize(n: 6 | 12 | 18 | 24) { this.pageSize = n; this.page = 1; }

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
    const term = this.searchTerm ? this.searchTerm.trim().toLowerCase() : '';
    const nivel = this.selectedNivelFiltroSet.size ? Array.from(this.selectedNivelFiltroSet) : [];

    this.produtosFiltrados = this.produtos.filter(p => {
      const q = Number(p.quantidade_estoque || 0);
      const matchesTerm = !term || p.nome.toLowerCase().includes(term) || (p.codigo_barras?.toLowerCase().includes(term));
      let matchesNivel = true;
      if (nivel.length > 0) {
        matchesNivel = nivel.some(n => {
          if (n === 'alto') return q >= this.MEDIUM_THRESHOLD;
          if (n === 'medio') return q >= this.LOW_THRESHOLD && q < this.MEDIUM_THRESHOLD;
          if (n === 'baixo') return q > 0 && q < this.LOW_THRESHOLD;
          if (n === 'critico') return q < this.CRITICAL_THRESHOLD;
          if (n === 'sem-estoque') return q === 0;
          return false;
        });
      }

      return matchesTerm && matchesNivel;
    });

    this.page = 1;
  }

  toggleFiltroNivel(nivel: string): void {
    if (this.selectedNivelFiltroSet.has(nivel)) {
      this.selectedNivelFiltroSet.delete(nivel);
    } else {
      this.selectedNivelFiltroSet.add(nivel);
    }
    // keep compatibility var (not used for logic anymore)
    this.selectedNivelFiltro = this.selectedNivelFiltroSet.size ? Array.from(this.selectedNivelFiltroSet)[0] : null;
    this.filterProdutos();
  }

  limparFiltro(): void {
    this.selectedNivelFiltroSet.clear();
    this.selectedNivelFiltro = null;
    this.filterProdutos();
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

  getProdutosEstoqueAlto(): number {
    return this.produtos.filter(p => (p.quantidade_estoque || 0) >= this.MEDIUM_THRESHOLD).length;
  }

  getProdutosEstoqueMedio(): number {
    return this.produtos.filter(p => {
      const q = Number(p.quantidade_estoque || 0);
      return q >= this.LOW_THRESHOLD && q < this.MEDIUM_THRESHOLD;
    }).length;
  }

  getProdutosEstoqueBaixo(): number {
    return this.produtos.filter(p => {
      const q = Number(p.quantidade_estoque || 0);
      return q > 0 && q < this.LOW_THRESHOLD;
    }).length;
  }

  getProdutosSemEstoque(): number {
    return this.produtos.filter(p => p.quantidade_estoque === 0).length;
  }

  getProdutosEstoqueCritico(): number {
    return this.produtos.filter(p => Number(p.quantidade_estoque || 0) < this.CRITICAL_THRESHOLD).length;
  }

  voltarAoDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  getImageUrl(imageName: string | null | undefined): string {
    return this.imageService.getImageUrl(imageName);
  }

  onImageError(event: any): void {
    event.target.style.display = 'none';
    const container = event.target.parentElement;
    if (container) {
      const placeholder = container.querySelector('.produto-sem-imagem');
      if (placeholder) {
        placeholder.style.display = 'flex';
      } else {
        const newPlaceholder = document.createElement('div');
        newPlaceholder.className = 'produto-sem-imagem';
        newPlaceholder.textContent = '📷';
        container.appendChild(newPlaceholder);
      }
    }
  }
}
