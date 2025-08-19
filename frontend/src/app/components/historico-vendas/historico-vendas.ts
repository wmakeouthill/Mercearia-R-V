import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { extractLocalDate, formatDateBR, parseDate } from '../../utils/date-utils';
import { Venda, MetodoPagamento } from '../../models';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-historico-vendas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './historico-vendas.html',
  styleUrl: './historico-vendas.scss'
})
export class HistoricoVendasComponent implements OnInit {
  vendas: Venda[] = [];
  private vendasLegado: Venda[] = [];
  private vendasCheckout: Venda[] = [];
  vendasFiltradas: any[] = [];
  expandedRows = new Set<string>();
  dataFiltro = '';
  produtoFiltro = '';
  metodoPagamentoFiltro = '';
  loading = false;
  error = '';
  // confirmação customizada
  showConfirmModal = false;
  confirmTitle = '';
  confirmMessage = '';
  private pendingDeleteId: number | null = null;
  private pendingIsCheckout = false;

  constructor(
    private readonly apiService: ApiService,
    public readonly authService: AuthService,
    private readonly imageService: ImageService,
    public readonly router: Router
  ) { }

  ngOnInit(): void {
    logger.info('HISTORICO_VENDAS', 'INIT', 'Componente iniciado');
    this.loadPage(1);
  }

  // pagination (same model as Caixa)
  page = 1;
  pageSize: 20 | 50 | 100 = 20;
  get total(): number { return this.vendasFiltradas.length; }
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
  setPageSize(n: 20 | 50 | 100) { this.pageSize = n; this.page = 1; }

  get vendasPagina(): any[] {
    const start = (this.page - 1) * Number(this.pageSize || 1);
    return this.vendasFiltradas.slice(start, start + Number(this.pageSize || 1));
  }

  private loadAllVendas(): void {
    this.loadPage(this.page);
  }

  loadPage(pageNum: number): void {
    this.loading = true;
    this.error = '';
    this.page = pageNum;
    this.apiService.getVendasDetalhadas(pageNum - 1, this.pageSize).subscribe({
      next: (resp: any) => {
        const items = Array.isArray(resp?.items) ? resp.items : [];
        this.vendas = items;
        this.vendasFiltradas = items;
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Erro ao carregar vendas';
        this.loading = false;
      }
    });
  }

  private mergeAndFilter(): void {
    // Mesclar as duas fontes e ordenar
    this.vendas = [...(this.vendasCheckout || []), ...(this.vendasLegado || [])].sort((a, b) => {
      const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
      if (timeDiff !== 0) return timeDiff;
      return (b.id || 0) - (a.id || 0);
    });
    this.filterVendas();
  }

  toggleExpand(rowId: string): void {
    if (!rowId) return;
    if (this.expandedRows.has(rowId)) this.expandedRows.delete(rowId);
    else this.expandedRows.add(rowId);
  }

  filterVendas(): void {
    // Garantir que vendas sempre seja um array válido
    if (!Array.isArray(this.vendas)) {
      this.vendas = [];
      this.vendasFiltradas = [];
      return;
    }

    this.vendasFiltradas = this.vendas.filter(venda => {
      if (!venda) return false; // Filtrar vendas nulas/undefined

      let matchData = true;
      let matchProduto = true;
      let matchMetodoPagamento = true;

      // Filtro por data
      if (this.dataFiltro) {
        try {
          const vendaDataLocal = extractLocalDate(venda.data_venda);
          matchData = vendaDataLocal === this.dataFiltro;
        } catch {
          matchData = false;
        }
      }

      // Filtro por produto (suporta vendas agregadas de checkout com vários itens)
      if (this.produtoFiltro?.trim()) {
        const termoBusca = this.produtoFiltro.toLowerCase().trim();
        const produtoNomePrincipal = (venda.produto_nome || '').toLowerCase();
        const itensArr = (venda as any).itens || [];
        const itensConcat = Array.isArray(itensArr) ? itensArr.map((it: any) => (it.produto_nome || it.produtoNome || '')).join(' ').toLowerCase() : '';
        matchProduto = produtoNomePrincipal.includes(termoBusca) || itensConcat.includes(termoBusca);
      }

      // Filtro por método de pagamento (suporta múltiplos métodos nas vendas do checkout)
      if (this.metodoPagamentoFiltro?.trim()) {
        const metodosMulti: MetodoPagamento[] | undefined = (venda as any).metodos_multi;
        if (Array.isArray(metodosMulti) && metodosMulti.length > 0) {
          matchMetodoPagamento = metodosMulti.includes(this.metodoPagamentoFiltro as MetodoPagamento);
        } else {
          matchMetodoPagamento = venda.metodo_pagamento === this.metodoPagamentoFiltro;
        }
      }

      return matchData && matchProduto && matchMetodoPagamento;
    }).sort((a, b) => {
      const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
      if (timeDiff !== 0) return timeDiff;
      return (b.id || 0) - (a.id || 0);
    });
  }

  limparFiltros(): void {
    this.dataFiltro = '';
    this.produtoFiltro = '';
    this.metodoPagamentoFiltro = '';
    this.vendasFiltradas = [...this.vendas].sort((a, b) => {
      const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
      if (timeDiff !== 0) return timeDiff;
      return (b.id || 0) - (a.id || 0);
    });
  }

  excluirVenda(id: number): void {
    const venda = this.vendas.find(v => v.id === id);
    if (!venda) return;

    if ((venda as any)._isCheckout) {
      this.apiService.deleteCheckoutOrder(id).subscribe({
        next: () => {
          this.removeVendaFromLists(id);
          logger.info('HISTORICO_VENDAS', 'DELETE_CHECKOUT_ORDER', 'Ordem de checkout excluída', { id });
        },
        error: (error: any) => {
          logger.error('HISTORICO_VENDAS', 'DELETE_CHECKOUT_ORDER', 'Erro ao excluir ordem de checkout', error);
          alert('Erro ao excluir venda de checkout');
        }
      });
      return;
    }

    this.apiService.deleteVenda(id).subscribe({
      next: () => {
        this.removeVendaFromLists(id);
        logger.info('HISTORICO_VENDAS', 'DELETE_VENDA', 'Venda excluída', { id });
      },
      error: (error: any) => {
        logger.error('HISTORICO_VENDAS', 'DELETE_VENDA', 'Erro ao excluir venda', error);
        alert('Erro ao excluir venda');
      }
    });
  }

  private removeVendaFromLists(id: number): void {
    this.vendas = this.vendas.filter(v => v.id !== id);
    this.vendasFiltradas = this.vendasFiltradas
      .filter(v => v.id !== id)
      .sort((a, b) => {
        const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
        if (timeDiff !== 0) return timeDiff;
        return (b.id || 0) - (a.id || 0);
      });
  }

  // helper called from template to ensure event propagation handled correctly
  onDeleteClick(event: Event, id: number | undefined): void {
    event.stopPropagation();
    console.debug('HISTORICO_VENDAS: delete click', { id });
    if (!id) return;
    const venda = this.vendas.find(v => v.id === id);
    if (!venda) return;
    this.pendingDeleteId = id;
    this.pendingIsCheckout = !!(venda as any)._isCheckout;
    this.confirmTitle = 'Confirmar exclusão';
    this.confirmMessage = this.pendingIsCheckout
      ? 'Deseja realmente excluir esta venda de checkout? Esta ação restaurará o estoque.'
      : 'Deseja realmente excluir esta venda?';
    this.showConfirmModal = true;
  }

  confirmModalCancel(): void {
    this.showConfirmModal = false;
    this.pendingDeleteId = null;
  }

  confirmModalConfirm(): void {
    this.showConfirmModal = false;
    if (this.pendingDeleteId) {
      this.excluirVenda(this.pendingDeleteId);
    }
    this.pendingDeleteId = null;
  }

  formatarData(data: string): string {
    return formatDateBR(data, true); // incluir hora
  }

  getMetodoPagamentoNome(metodo: MetodoPagamento): string {
    const nomes = {
      'dinheiro': 'Dinheiro',
      'cartao_credito': 'Cartão de Crédito',
      'cartao_debito': 'Cartão de Débito',
      'pix': 'PIX'
    };
    return nomes[metodo] || metodo;
  }

  getMetodoPagamentoIcone(metodo: MetodoPagamento): string {
    const icones = {
      'dinheiro': '💵',
      'cartao_credito': '💳',
      'cartao_debito': '🏧',
      'pix': '📱'
    };
    return icones[metodo] || '💰';
  }

  private buildPagamentoResumo(pagamentos: Array<{ metodo: MetodoPagamento; valor: number }>): string {
    if (!Array.isArray(pagamentos) || pagamentos.length === 0) return '';
    const order: MetodoPagamento[] = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'];
    const somaPorMetodo: Record<MetodoPagamento, number> = {
      dinheiro: 0,
      cartao_credito: 0,
      cartao_debito: 0,
      pix: 0
    };
    for (const p of pagamentos) {
      const m = p.metodo;
      const v = Number(p.valor || 0);
      if (m in somaPorMetodo) somaPorMetodo[m] += v;
    }
    const partes: string[] = [];
    for (const m of order) {
      const v = somaPorMetodo[m];
      if (v > 0) {
        const nome = this.getMetodoPagamentoNome(m);
        const valorFmt = v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        partes.push(`${nome} R$ ${valorFmt}`);
      }
    }
    return partes.join(' + ');
  }

  getReceitaTotal(): number {
    if (!Array.isArray(this.vendasFiltradas)) return 0;
    return this.vendasFiltradas.reduce((total, venda) => {
      return total + (venda?.preco_total || 0);
    }, 0);
  }

  getQuantidadeTotal(): number {
    if (!Array.isArray(this.vendasFiltradas)) return 0;
    return this.vendasFiltradas.reduce((total, venda) => {
      return total + (venda?.quantidade_vendida || 0);
    }, 0);
  }

  getTicketMedio(): number {
    if (!Array.isArray(this.vendasFiltradas) || this.vendasFiltradas.length === 0) return 0;
    return this.getReceitaTotal() / this.vendasFiltradas.length;
  }

  voltarAoDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  getImageUrl(imageName: any): string {
    return this.imageService.getImageUrl(imageName);
  }

  onImageError(event: any): void {
    // Se a imagem falhar ao carregar, tentar carregar a imagem padrão
    const fallbackUrl = this.imageService.getImageUrl(null);
    if (event.target.src !== fallbackUrl) {
      event.target.src = fallbackUrl;
    }
  }
}
