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
  selector: 'app-lista-produtos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lista-produtos.html',
  styleUrl: './lista-produtos.scss'
})
export class ListaProdutosComponent implements OnInit {
  produtos: Produto[] = [];
  produtosFiltrados: Produto[] = [];
  loading = false;
  error = '';
  isAdmin = false;
  // pagination
  page = 1;
  pageSize: 5 | 10 | 20 | 30 | 50 = 5;
  jumpPage: number | null = null;
  // filtros
  filtroNome = '';
  filtroNivelEstoque: '' | 'alto' | 'medio' | 'baixo' | 'critico' = '';

  // thresholds (assumidos): critico <= 2, baixo < 10, medio < 30
  readonly CRITICAL_THRESHOLD = 3;
  readonly LOW_THRESHOLD = 10;
  readonly MEDIUM_THRESHOLD = 30;

  get total(): number { return this.produtosFiltrados.length; }

  get totalPages(): number {
    const totalItems = Number(this.total || 0);
    const perPage = Number(this.pageSize || 1);
    const pages = Math.ceil(totalItems / perPage);
    return Math.max(1, pages || 1);
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
    if (this.jumpPage == null) return;
    this.goToPage(this.jumpPage);
  }

  setPageSize(n: 5 | 10 | 20 | 30 | 50) { this.pageSize = n; this.page = 1; }

  get produtosPagina(): Produto[] {
    const start = (this.page - 1) * Number(this.pageSize || 1);
    return this.produtosFiltrados.slice(start, start + Number(this.pageSize || 1));
  }

  onClickPage(p: number | string): void { if (typeof p === 'number') this.goToPage(p); }

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly imageService: ImageService,
    public router: Router
  ) { }

  ngOnInit(): void {
    this.isAdmin = this.authService.isAdmin();
    this.loadProdutos();
    logger.info('LISTA_PRODUTOS', 'INIT', 'Componente iniciado', { isAdmin: this.isAdmin });
  }

  loadProdutos(): void {
    this.loading = true;
    this.error = '';

    this.apiService.getProdutos().subscribe({
      next: (produtos) => {
        this.produtos = produtos;
        this.produtosFiltrados = produtos;
        this.loading = false;
        logger.info('LISTA_PRODUTOS', 'LOAD_PRODUTOS', 'Produtos carregados', { count: produtos.length });
      },
      error: (error) => {
        this.error = 'Erro ao carregar produtos';
        this.loading = false;
        logger.error('LISTA_PRODUTOS', 'LOAD_PRODUTOS', 'Erro ao carregar produtos', error);
      }
    });
  }

  aplicarFiltros(): void {
    const nome = (this.filtroNome || '').toString().trim().toLowerCase();
    this.produtosFiltrados = this.produtos.filter(p => {
      const nomeOk = !nome || (p.nome || '').toString().toLowerCase().includes(nome);
      if (!nomeOk) return false;
      if (!this.filtroNivelEstoque) return true;
      const nivel = this.nivelEstoque(p);
      return nivel === this.filtroNivelEstoque;
    });
    this.page = 1;
  }

  nivelEstoque(produto: Produto): 'critico' | 'baixo' | 'medio' | 'alto' {
    const q = Number(produto.quantidade_estoque || 0);
    if (q < this.CRITICAL_THRESHOLD) return 'critico';
    if (q < this.LOW_THRESHOLD) return 'baixo';
    if (q < this.MEDIUM_THRESHOLD) return 'medio';
    return 'alto';
  }

  editProduto(id: number): void {
    this.router.navigate(['/produtos/editar', id]);
  }

  deleteProduto(id: number): void {
    if (confirm('Tem certeza que deseja excluir este produto?')) {
      this.loading = true;
      this.error = '';

      this.apiService.deleteProduto(id).subscribe({
        next: () => {
          this.produtos = this.produtos.filter(p => p.id !== id);
          this.loading = false;
          logger.info('LISTA_PRODUTOS', 'DELETE_PRODUTO', 'Produto deletado', { id });
        },
        error: (error: any) => {
          this.error = 'Erro ao excluir produto';
          this.loading = false;
          logger.error('LISTA_PRODUTOS', 'DELETE_PRODUTO', 'Erro ao excluir produto', error);
        }
      });
    }
  }

  updateEstoque(id: number, novaQuantidade: number): void {
    this.loading = true;
    this.error = '';

    this.apiService.updateEstoque(id, novaQuantidade).subscribe({
      next: () => {
        const produto = this.produtos.find(p => p.id === id);
        if (produto) {
          produto.quantidade_estoque = novaQuantidade;
        }
        this.loading = false;
        logger.info('LISTA_PRODUTOS', 'UPDATE_ESTOQUE', 'Estoque atualizado', { id, quantidade: novaQuantidade });
      },
      error: (error: any) => {
        this.error = 'Erro ao atualizar estoque';
        this.loading = false;
        logger.error('LISTA_PRODUTOS', 'UPDATE_ESTOQUE', 'Erro ao atualizar estoque', error);
      }
    });
  }

  novoProduto(): void {
    this.router.navigate(['/produtos/novo']);
  }

  getProdutosEmEstoque(): number {
    return this.produtos.filter(p => p.quantidade_estoque > 0).length;
  }

  getProdutosEstoqueBaixo(): number {
    return this.produtos.filter(p => p.quantidade_estoque < 10).length;
  }

  getImageUrl(imageName: string | null | undefined): string {
    return this.imageService.getImageUrl(imageName);
  }

  onImageError(event: any): void {
    // Se a imagem falhar ao carregar, esconder o elemento
    event.target.style.display = 'none';

    // Mostrar placeholder no lugar
    const container = event.target.parentElement;
    if (container) {
      const placeholder = container.querySelector('.produto-sem-imagem');
      if (placeholder) {
        placeholder.style.display = 'flex';
      } else {
        // Criar placeholder se não existir
        const newPlaceholder = document.createElement('div');
        newPlaceholder.className = 'produto-sem-imagem';
        newPlaceholder.textContent = '📷';
        container.appendChild(newPlaceholder);
      }
    }
  }
}
