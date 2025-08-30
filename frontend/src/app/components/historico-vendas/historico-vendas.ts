import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CurrencyBrPipe } from '../../pipes/currency-br.pipe';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { formatDateBR } from '../../utils/date-utils';
import { Venda } from '../../models';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-historico-vendas',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyBrPipe],
  templateUrl: './historico-vendas.html',
  styleUrl: './historico-vendas.scss'
})
export class HistoricoVendasComponent implements OnInit, OnDestroy {
  vendas: Venda[] = [];
  private readonly vendasLegado: Venda[] = [];
  private readonly vendasCheckout: Venda[] = [];
  vendasFiltradas: any[] = [];
  // when we fetch all pages for aggregates we store them here
  vendasFiltradasAll: any[] | null = null;
  expandedRows = new Set<string>();
  dataFiltro = '';
  horaInicioFiltro = '';
  horaFimFiltro = '';
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

  private salesChangedSub: any;

  constructor(
    private readonly apiService: ApiService,
    public readonly authService: AuthService,
    private readonly imageService: ImageService,
    public readonly router: Router
  ) { }

  ngOnInit(): void {
    logger.info('HISTORICO_VENDAS', 'INIT', 'Componente iniciado');
    this.loadPage(1);
    // Auto refresh quando houver ajustes (devolução/troca)
    this.salesChangedSub = this.apiService.salesChanged$.subscribe(() => {
      logger.info('HISTORICO_VENDAS', 'SALES_CHANGED_EVENT', 'Recebido evento de alteração de vendas -> recarregando');
      const currentPage = this.page;
      this.loadPage(currentPage);
    });
  }

  ngOnDestroy(): void { try { if (this.salesChangedSub) this.salesChangedSub.unsubscribe(); } catch { /* ignore */ } }

  // Build local ISO datetime string (no Z) from YYYY-MM-DD and HH:mm
  private normalizeDateTimeLocal(dateYmd: string, timeHHmm: string): string {
    try {
      const parts = dateYmd.split('-');
      if (parts.length !== 3) return dateYmd;
      const year = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const day = Number(parts[2]);
      const t = (timeHHmm || '').split(':');
      const hours = Number(t[0]) || 0;
      const minutes = Number(t[1]) || 0;
      const d = new Date(year, month, day, hours, minutes, 0, 0);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      const ms = String(d.getMilliseconds()).padStart(3, '0');
      return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}.${ms}`;
    } catch {
      return `${dateYmd}T00:00:00.000`;
    }
  }

  // pagination (same model as Caixa)
  page = 1;
  pageSize: 20 | 50 | 100 = 20;
  jumpPage: number | null = null;
  // when using server pagination we keep totalCount from server; fallback to local length
  totalCount = 0;
  get total(): number { return Number(this.totalCount || this.vendasFiltradas.length); }
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
    // If any client-side filters are active or we have fetched the full dataset,
    // paginate locally instead of refetching from the server which would reset
    // filters. Otherwise request the server page.
    const clientSideFilteringActive = Boolean(this.dataFiltro || this.horaInicioFiltro || this.horaFimFiltro || this.produtoFiltro || this.metodoPagamentoFiltro || this.vendasFiltradasAll);
    if (clientSideFilteringActive) {
      this.page = page;
      return;
    }
    // fetch the requested page from server
    this.loadPage(page);
  }
  nextPage() { if (this.page < this.totalPages) this.goToPage(this.page + 1); }
  prevPage() { if (this.page > 1) this.goToPage(this.page - 1); }
  goBy(delta: number): void { this.goToPage(this.page + delta); }
  goToFirstPage(): void { this.goToPage(1); }
  goToLastPage(): void { this.goToPage(this.totalPages); }
  setPageSize(n: 20 | 50 | 100) { this.pageSize = n; this.page = 1; }

  onJumpToPage(): void {
    if (this.jumpPage == null) return;
    this.goToPage(this.jumpPage);
  }

  onClickPage(p: number | string): void {
    if (typeof p === 'number') this.goToPage(p);
  }

  get vendasPagina(): any[] {
    // If backend is providing paged results (totalCount > vendasFiltradas.length)
    // then vendasFiltradas already contains only the current page items.
    if (this.totalCount && this.totalCount > (this.vendasFiltradas?.length || 0)) {
      return this.vendasFiltradas || [];
    }
    const start = (this.page - 1) * Number(this.pageSize || 1);
    return this.vendasFiltradas.slice(start, start + Number(this.pageSize || 1));
  }

  getRowNumber(venda: any, indexOnPage: number): number {
    // Prefer using the full cached dataset to compute stable global index
    let source: any[] = [];
    if (Array.isArray(this.vendasFiltradasAll)) source = this.vendasFiltradasAll; else if (Array.isArray(this.vendasFiltradas)) source = this.vendasFiltradas;
    if (Array.isArray(source) && source.length > 0) {
      const idx = source.findIndex((s: any) => (s && venda) ? (s.id === venda.id) : false);
      if (idx >= 0) {
        return (source.length - idx);
      }
    }
    // Fallback: derive stable increasing index based on overall ordering (newest-first -> number increases)
    const total = Number(this.total || (Array.isArray(this.vendasFiltradas) ? this.vendasFiltradas.length : 0));
    const globalIndexZeroBased = (this.page - 1) * Number(this.pageSize || 1) + indexOnPage;
    // Compute reversed rank so oldest sale is 1
    return Math.max(1, total - globalIndexZeroBased);
  }

  private loadAllVendas(): void {
    this.loadPage(this.page);
  }

  loadPage(pageNum: number): void {
    this.loading = true;
    this.error = '';
    this.page = pageNum;
    // Fetch both detailed vendas and checkout (complete) vendas and merge, avoiding duplicates.
    forkJoin({
      detalhadas: this.apiService.getVendasDetalhadas(pageNum - 1, this.pageSize).pipe(catchError(() => of(null))),
      completas: this.apiService.getVendasCompletas().pipe(catchError(() => of([])))
    }).subscribe({
      next: ({ detalhadas, completas }: any) => {
        const resp = detalhadas || {};
        if (resp && typeof resp.total === 'number') this.totalCount = resp.total; else this.totalCount = 0;

        const detalhadasItems = Array.isArray(resp?.items) ? resp.items : [];
        const completasItems = Array.isArray(completas) ? completas : [];

        // normalize completa items to the same shape and mark as checkout
        const completasMapped = completasItems.map((v: any, idx: number) => {
          const row: any = { ...(v || {}) };
          row._isCheckout = true;
          row.row_id = row.row_id || `hist-checkout-${row.id ?? idx}`;
          // pagamentos and itens are expected on checkout entries
          const pagamentosArr = Array.isArray(row?.pagamentos) ? row.pagamentos : [];
          if (pagamentosArr.length > 0) {
            try { row.pagamentos_resumo = this.buildPagamentoResumo(pagamentosArr.map((p: any) => ({ metodo: p.metodo, valor: p.valor }))); } catch { row.pagamentos_resumo = ''; }
            const metodosSet = new Set<string>();
            for (const p of pagamentosArr) {
              if (p?.metodo) metodosSet.add(p.metodo);
            }
            row.metodos_multi = Array.from(metodosSet);
          }
          return row;
        });

        // Build map of checkout ids to avoid duplicates
        const checkoutIds = new Set<number | string>(completasMapped.map(c => c.id));

        // Process detalhadas items, skipping those that are present in checkout
        const detalhadasMapped = (detalhadasItems || []).map((v: any, idx: number) => {
          const row: any = { ...(v || {}) };
          row._isCheckout = checkoutIds.has(row.id);
          let pagamentosArr: any[] = [];
          if (Array.isArray(v?.pagamentos)) pagamentosArr = v.pagamentos; else if (Array.isArray(v?.pagamentos_list)) pagamentosArr = v.pagamentos_list;
          if (Array.isArray(pagamentosArr) && pagamentosArr.length > 0) {
            try { row.pagamentos_resumo = this.buildPagamentoResumo(pagamentosArr.map((p: any) => ({ metodo: p.metodo, valor: p.valor }))); } catch { row.pagamentos_resumo = ''; }
            const metodosSet = new Set<string>();
            for (const p of pagamentosArr) {
              if (p?.metodo) metodosSet.add(p.metodo);
            }
            row.metodos_multi = Array.from(metodosSet);
          }
          row.row_id = row.row_id || `hist-${row.id ?? idx}`;
          return row;
        }).filter((r: any) => !checkoutIds.has(r.id));

        // normalize merged rows: derive product, image, quantity and total when missing
        const merged = [...completasMapped, ...detalhadasMapped].map((m: any) => {
          const itens = Array.isArray(m?.itens) ? m.itens : [];
          const adjustments = Array.isArray(m?.adjustments) ? m.adjustments : [];
          const returnedByItem: Record<string, number> = {};
          for (const a of adjustments) {
            const t = (a?.type || a?.tipo || '').toLowerCase();
            if (t === 'return') {
              const sid = String(a.sale_item_id || a.saleItem?.id || '');
              if (sid) returnedByItem[sid] = (returnedByItem[sid] || 0) + (a.quantity || a.quantidade || 0);
            }
          }
          // produto_nome
          if (!m.produto_nome) {
            if (itens.length > 0) {
              const firstNome = itens[0].produto_nome || itens[0].produtoNome || (itens[0].produto ? itens[0].produto.nome : undefined);
              if (firstNome) m.produto_nome = firstNome;
            }
          }
          // Anotação (Devolvido) se venda completamente devolvida (net_total = 0 e returned_total > 0)
          try {
            const net = Number(m.net_total ?? m.preco_total_liquido ?? 0);
            const retTotal = Number(m.returned_total ?? 0);
            if (retTotal > 0 && net <= 0) {
              if (m.produto_nome && !/Devolvido/i.test(m.produto_nome)) m.produto_nome = m.produto_nome + ' (Devolvido)';
            }
          } catch { /* ignore */ }
          // produto_imagem
          if (!m.produto_imagem) {
            if (itens.length > 0) {
              const firstImagem = itens[0].produto_imagem || itens[0].produtoImagem || (itens[0].produto ? itens[0].produto.imagem : undefined);
              if (firstImagem) m.produto_imagem = firstImagem;
            }
          }
          // quantidade
          if (m.quantidade == null) {
            const qtyOrig = itens.reduce((s: number, it: any) => s + (Number(it.quantidade) || 0), 0);
            const qtyRet = Object.values(returnedByItem).reduce((s: number, r: any) => s + (Number(r) || 0), 0);
            const qty = Math.max(0, qtyOrig - qtyRet);
            m.quantidade = qty;
          }
          // preço total
          let netTotal = 0; let grossTotal = 0;
          for (const it of itens) {
            const sid = String(it.id || it.sale_item_id || '');
            const unit = Number(it.preco_unitario || it.precoUnitario || it.preco || it.valor_unitario || 0) || 0;
            const qtyOrig = Number(it.quantidade || it.quantidade_vendida || 0) || 0;
            const ret = returnedByItem[sid] || 0;
            const eff = Math.max(0, qtyOrig - ret);
            grossTotal += unit * qtyOrig;
            netTotal += unit * eff;
          }
          // manter explicito usando nullish coalescing
          (m as any).preco_total ??= grossTotal;
          // Preferir net_total vindo do backend se existir
          if (m.net_total != null) {
            m.preco_total_liquido = Number(m.net_total) || 0;
          } else {
            m.preco_total_liquido = netTotal;
          }
          return m;
        });

        // finalize merged rows: sort by recency, apply limits
        const sorted = merged.slice().sort((a: any, b: any) => {
          const ad = new Date(a.data_hora || a.dataHora || 0).getTime();
          const bd = new Date(b.data_hora || b.dataHora || 0).getTime();
          return bd - ad;
        });
        this.vendasFiltradas = sorted;
        this.vendasFiltradasAll = sorted;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.message || err?.error?.message || 'Erro desconhecido ao carregar vendas';
        logger.error('HISTORICO_VENDAS', 'LOAD_PAGE_ERROR', this.error);
      }
    });
  }

  private buildPagamentoResumo(pagamentos: { metodo: string, valor: number }[]): string {
    if (!Array.isArray(pagamentos) || pagamentos.length === 0) return '';
    // Aggregate by method preserving first-seen order
    const order: string[] = [];
    const totals: Record<string, number> = {};
    for (const p of pagamentos) {
      if (!p || !p.metodo) continue;
      if (!(p.metodo in totals)) order.push(p.metodo);
      totals[p.metodo] = (totals[p.metodo] || 0) + (Number(p.valor) || 0);
    }
    const label = (m: string) => {
      switch (m) {
        case 'dinheiro': return 'Dinheiro';
        case 'cartao_credito': return 'Crédito';
        case 'cartao_debito': return 'Débito';
        case 'pix': return 'PIX';
        default: return m;
      }
    };
    const parts = order.map(m => `${label(m)} ${totals[m].toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    return parts.join(' | ');
  }

  onDeleteVenda(venda: any): void {
    this.pendingDeleteId = venda.id;
    this.pendingIsCheckout = venda._isCheckout === true;
    this.confirmTitle = 'Excluir venda';
    this.confirmMessage = `Tem certeza que deseja excluir a venda ${venda.id}? Esta ação não pode ser desfeita.`;
    this.showConfirmModal = true;
  }

  onConfirmDelete(): void {
    const id = this.pendingDeleteId;
    const isCheckout = this.pendingIsCheckout;
    if (id == null) return;
    this.showConfirmModal = false;
    this.loading = true;
    this.error = '';
    // Optimistically remove the item from the list
    this.vendasFiltradas = this.vendasFiltradas.filter((v: any) => v.id !== id);
    // Use métodos existentes na ApiService
    const deleteObs = isCheckout ? this.apiService.deleteCheckoutOrder(id) : this.apiService.deleteVenda(id);
    deleteObs.pipe(catchError((err) => {
      this.loading = false;
      this.error = err?.message || err?.error?.message || 'Erro desconhecido ao excluir venda';
      logger.error('HISTORICO_VENDAS', 'DELETE_ERROR', this.error);
      // Rollback optimistic removal
      this.vendasFiltradas = [...this.vendasFiltradas, ...(this.vendasFiltradasAll?.filter((v: any) => v.id === id) || [])];
      return of(null);
    })).subscribe({
      next: () => {
        this.loading = false;
        // Refresh page if using server-side pagination, otherwise just remove from local array
        if (this.totalCount > this.vendasFiltradas.length) {
          this.loadPage(this.page);
        } else {
          this.vendasFiltradas = this.vendasFiltradas.filter((v: any) => v.id !== id);
        }
      }
    });
  }

  onRowExpandToggle(venda: any): void {
    const id = venda?.id;
    if (!id) return;
    if (this.expandedRows.has(id)) this.expandedRows.delete(id); else this.expandedRows.add(id);
  }

  toggleExpand(rowId: string): void {
    if (!rowId) return;
    if (this.expandedRows.has(rowId)) this.expandedRows.delete(rowId); else this.expandedRows.add(rowId);
  }

  onDeleteClick(ev: Event, id: number): void {
    ev.stopPropagation();
    const venda = { id } as any;
    this.onDeleteVenda(venda);
  }

  confirmModalCancel(): void { this.showConfirmModal = false; }
  confirmModalConfirm(): void { this.onConfirmDelete(); }

  limparFiltros(): void { this.onFilterReset(); }

  getImageUrl(path?: string): string {
    return this.imageService.getImageUrl(path);
  }

  onImageError(ev: Event): void {
    const el = ev?.target as HTMLImageElement | null;
    if (el) el.src = this.imageService.getImageUrl(null);
  }

  // Reset filtros e recarrega primeira página (server-side)
  onFilterReset(): void {
    this.dataFiltro = '';
    this.horaInicioFiltro = '';
    this.horaFimFiltro = '';
    this.produtoFiltro = '';
    this.metodoPagamentoFiltro = '';
    this.vendasFiltradasAll = null;
    this.loadPage(1);
  }

  // --- Métricas líquidas ---
  getReceitaTotal(): number {
    const src = this.vendasFiltradasAll || this.vendasFiltradas;
    if (!Array.isArray(src)) return 0;
    return src.reduce((acc, v: any) => acc + (v.preco_total_liquido ?? v.preco_total ?? 0), 0);
  }

  getTotalDevolvido(): number {
    const src = this.vendasFiltradasAll || this.vendasFiltradas;
    if (!Array.isArray(src)) return 0;
    return src.reduce((acc, v: any) => acc + (v.returned_total || 0), 0);
  }

  getTotalTrocas(): number {
    const src = this.vendasFiltradasAll || this.vendasFiltradas;
    if (!Array.isArray(src)) return 0;
    return src.reduce((acc, v: any) => acc + (v.exchange_difference_total || 0), 0);
  }

  getQuantidadeTotal(): number {
    const src = this.vendasFiltradasAll || this.vendasFiltradas;
    if (!Array.isArray(src)) return 0;
    return src.reduce((acc, v: any) => acc + (v.quantidade ?? v.quantidade_vendida ?? 0), 0);
  }

  getTicketMedio(): number {
    const src = this.vendasFiltradasAll || this.vendasFiltradas;
    if (!Array.isArray(src) || src.length === 0) return 0;
    return this.getReceitaTotal() / src.length;
  }

  formatarData(data: string): string { return formatDateBR(data, true); }

  getMetodoPagamentoNome(metodo: string): string {
    const map: any = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão Crédito', cartao_debito: 'Cartão Débito', pix: 'PIX' };
    return map[metodo] || metodo;
  }

  getMetodoPagamentoIcone(metodo: string): string {
    const map: any = { dinheiro: '💵', cartao_credito: '💳', cartao_debito: '🏧', pix: '📱' };
    return map[metodo] || '💰';
  }

  filterVendas(): void {
    const src = this.vendasFiltradasAll || this.vendasFiltradas || [];
    let list = [...src];
    if (this.produtoFiltro?.trim()) {
      const q = this.produtoFiltro.toLowerCase();
      list = list.filter(v => (v.produto_nome || '').toLowerCase().includes(q));
    }
    if (this.metodoPagamentoFiltro?.trim()) {
      const q = this.metodoPagamentoFiltro.toLowerCase();
      list = list.filter(v => {
        if (Array.isArray(v.metodos_multi) && v.metodos_multi.length) return v.metodos_multi.some((m: string) => m.toLowerCase() === q);
        return (v.metodo_pagamento || '').toLowerCase() === q;
      });
    }
    this.vendasFiltradas = list;
    this.page = 1;
  }

  voltarAoDashboard(): void {
    try { this.router.navigate(['/dashboard']); } catch { /* ignore */ }
  }
}
