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

        // normalize merged rows: derive product, image, quantity and total when missing + devoluções
        const merged = [...completasMapped, ...detalhadasMapped].map((m: any) => {
          const itens = Array.isArray(m?.itens) ? m.itens : [];
          let adjustments: any[] = [];
          if (Array.isArray(m?.adjustments)) adjustments = m.adjustments;
          else if (Array.isArray(m?.ajustes)) adjustments = m.ajustes;
          const returnedByItem: Record<string, number> = {};
          const exchangeDiffByItem: Record<string, number> = {};
          const exchangeMethodByItem: Record<string, string> = {};
          const exchangePaymentMethods = new Set<string>();
          const exchangesRaw: Array<{ sid?: string; rpid?: number; diff: number; pm?: string; qty?: number }> = [];
          let exchangeDiffTotal = 0;
          for (const a of adjustments) {
            const t = (a?.type || a?.tipo || '').toLowerCase();
            if (t === 'return') {
              const sid = String(a.sale_item_id || a.saleItem?.id || '');
              if (sid) returnedByItem[sid] = (returnedByItem[sid] || 0) + (a.quantity || a.quantidade || 0);
            } else if (t === 'exchange' || t === 'troca') {
              let diffRaw: any = a.difference ?? a.diferenca ?? a.price_difference ?? (a as any).priceDifference ?? (a as any).valor_diferenca ?? a.amount ?? a.valor ?? 0;
              // Aceitar string com vírgula decimal ("1,50")
              if (typeof diffRaw === 'string') {
                const cleaned = diffRaw.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
                const parsed = Number(cleaned);
                if (!isNaN(parsed)) diffRaw = parsed;
              }
              const diffNum = Number(diffRaw) || 0;
              if (diffNum !== 0) exchangeDiffTotal += diffNum;
              try {
                const sid = String(a.sale_item_id || a.saleItem?.id || a.saleItemId || a.item_id || '');
                if (sid) exchangeDiffByItem[sid] = (exchangeDiffByItem[sid] || 0) + diffNum;
                const pm = (a as any).payment_method || (a as any).metodo_pagamento;
                if (pm) {
                  exchangeMethodByItem[sid] = String(pm);
                  exchangePaymentMethods.add(String(pm));
                }
                const rpidRaw = (a as any).replacement_product_id || (a as any).replacementProductId;
                const rpid = rpidRaw != null ? Number(rpidRaw) : undefined;
                const q = Number((a as any).quantity || (a as any).quantidade || 0) || 0;
                exchangesRaw.push({ sid, rpid, diff: diffNum, pm, qty: q });
              } catch { /* ignore */ }
            }
          }
          // Montagem de nomes completa será feita após calcular returned_quantity por item
          // produto_nome base (sem duplicar anotações), manter primeiro nome para filtros simples
          if (!m.produto_nome && itens.length > 0) {
            const firstNome = itens[0].produto_nome || itens[0].produtoNome || (itens[0].produto ? itens[0].produto.nome : undefined);
            if (firstNome) m.produto_nome = firstNome;
          }
          // Calcular totais bruto, líquido e devoluções por item
          let grossTotal = 0; let netTotal = 0; let returnedQtyTotal = 0; let returnedValueTotal = 0;
          for (const it of itens) {
            const sid = String(it.id || it.sale_item_id || '');
            const unit = Number(it.preco_unitario || it.precoUnitario || it.preco || it.valor_unitario || 0) || 0;
            const qtyOrig = Number(it.quantidade || it.quantidade_vendida || 0) || 0;
            let ret = Math.min(qtyOrig, Number(returnedByItem[sid] || 0));
            // Fallback: inferir devolução pelo valor líquido vs bruto
            try {
              if (ret === 0 && unit > 0) {
                const brutoDecl = Number(it.preco_total || it.precoTotal || (unit * qtyOrig)) || 0;
                const liquidoDeclRaw = (it as any).preco_total_liquido ?? (it as any).precoTotalLiquido;
                const liquidoDecl = Number(liquidoDeclRaw != null ? liquidoDeclRaw : brutoDecl);
                if (liquidoDecl < brutoDecl - 0.0001) {
                  const diff = brutoDecl - liquidoDecl;
                  const inferred = Math.min(qtyOrig, Math.round(diff / unit));
                  if (inferred > 0) ret = inferred;
                }
              }
            } catch { /* ignore */ }
            const eff = Math.max(0, qtyOrig - ret);
            const grossItem = unit * qtyOrig;
            const netItem = unit * eff;
            grossTotal += grossItem;
            netTotal += netItem;
            if (ret > 0) {
              returnedQtyTotal += ret;
              returnedValueTotal += (unit * ret);
              (it as any).returned_quantity = ret;
            }
            if ((it as any).quantidade_liquida == null) (it as any).quantidade_liquida = eff;
            if ((it as any).preco_total == null) (it as any).preco_total = grossItem;
            if ((it as any).preco_total_liquido == null) (it as any).preco_total_liquido = netItem;
            // Anexar diferença de troca por item, se houver
            try {
              const exch = Number(exchangeDiffByItem[sid] || 0) || 0;
              if (exch !== 0) {
                (it as any).exchange_difference_total = exch;
                const pm = exchangeMethodByItem[sid];
                if (pm) (it as any).exchange_payment_method = pm;
              }
            } catch { /* ignore */ }
          }
          // Fallback: se não casou por sale_item_id, tentar por replacement_product_id ou primeiro item
          try {
            const itemsArr = Array.isArray(itens) ? itens : [];
            // Mapas para localizar itens por id e produto_id
            const idToIndex: Record<string, number> = {};
            const pidToIndex: Record<string, number> = {};
            for (let i = 0; i < itemsArr.length; i++) {
              const it = itemsArr[i] as any;
              const iid = String(it.id || it.item_id || it.sale_item_id || '');
              if (iid) idToIndex[iid] = i;
              const pid = String(it.produto_id || it.produtoId || (it.produto?.id) || '');
              if (pid) pidToIndex[pid] = i;
            }
            for (const ex of exchangesRaw) {
              // já aplicado via sid
              if (ex.sid && Number(exchangeDiffByItem[ex.sid] || 0) !== 0) continue;
              let targetIdx = -1;
              if (ex.rpid != null) {
                targetIdx = itemsArr.findIndex((it: any) => Number(it.produto_id || it.produtoId || it.produto?.id) === Number(ex.rpid));
              }
              if (targetIdx < 0) {
                // escolher item com maior preco_total
                let max = -Infinity; let idx = -1;
                for (let i = 0; i < itemsArr.length; i++) {
                  const it = itemsArr[i];
                  const val = Number(it.preco_total || it.precoTotal || 0) || 0;
                  if (val > max) { max = val; idx = i; }
                }
                targetIdx = idx >= 0 ? idx : 0;
              }
              const tgt = itemsArr[targetIdx];
              if (tgt) {
                (tgt as any).exchange_difference_total = ((tgt as any).exchange_difference_total || 0) + Number(ex.diff || 0);
                if (ex.pm) (tgt as any).exchange_payment_method = String(ex.pm);
              }
              // Vincular informações detalhadas (de/para)
              try {
                let fromIdx = ex.sid && idToIndex[ex.sid] != null ? idToIndex[ex.sid] : -1;
                const toIdx = ex.rpid != null && pidToIndex[String(ex.rpid)] != null ? pidToIndex[String(ex.rpid)] : targetIdx;
                // Se não conseguimos fromIdx, e há exatamente 2 itens, usar o outro índice
                if (fromIdx < 0 && itemsArr.length === 2) fromIdx = (toIdx === 0 ? 1 : 0);
                const fromIt = itemsArr[fromIdx] as any;
                const toIt = itemsArr[toIdx] as any;
                const q = Number(ex.qty || 0) || 0;
                const diff = Number(ex.diff || 0) || 0;
                const pm = ex.pm ? String(ex.pm) : undefined;
                if (fromIt && toIt) {
                  fromIt._exchange_partner_name = (toIt.produto_nome || toIt.produtoNome || 'Produto');
                  fromIt._exchange_partner_role = 'from';
                  fromIt._exchange_quantity = q || 1;
                  fromIt._exchange_diff = diff;
                  if (pm) fromIt._exchange_payment_method = pm;
                  toIt._exchange_partner_name = (fromIt.produto_nome || fromIt.produtoNome || 'Produto');
                  toIt._exchange_partner_role = 'to';
                  toIt._exchange_quantity = q || 1;
                  toIt._exchange_diff = diff;
                  if (pm) toIt._exchange_payment_method = pm;
                  // Garantir valor monetário também no fromIt para exibição
                  fromIt.exchange_difference_total = Number(fromIt.exchange_difference_total || 0) + diff;
                }
              } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
          // Após calcular returned_quantity por item, montar lista completa com anotações
          try {
            const partes: string[] = [];
            for (const it of itens) {
              const baseNome = it.produto_nome || it.produtoNome || (it.produto?.nome) || 'Produto';
              const ret = Number((it as any).returned_quantity || 0);
              if (ret > 0) partes.push(`${baseNome} (devolvido, qtd: ${ret})`); else partes.push(baseNome);
            }
            let composed = partes.join(', ');
            if (exchangeDiffTotal !== 0) {
              const sign = exchangeDiffTotal > 0 ? '+' : '-';
              composed = `${composed} (troca ${sign}${Math.abs(exchangeDiffTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
              (m as any).exchange_difference_total = exchangeDiffTotal;
            }
            if (partes.length > 0) (m as any)._produtos_compostos = composed;
          } catch { /* ignore */ }
          // Quantidade líquida agregada
          const qtyOrigAgg = itens.reduce((s: number, it: any) => s + (Number(it.quantidade || it.quantidade_vendida) || 0), 0);
          const qtyRetAgg = returnedQtyTotal;
          const qtyNetAgg = Math.max(0, qtyOrigAgg - qtyRetAgg);
          if (m.quantidade == null) m.quantidade = qtyNetAgg;
          // Se não encontramos returned quantities mas existe diferença monetária (fallback por valor total)
          try {
            const brutoVenda = grossTotal;
            let netVenda = Number(m.preco_total_liquido ?? m.net_total ?? netTotal);
            if (isNaN(netVenda)) netVenda = netTotal;
            const diffValor = Math.max(0, brutoVenda - netVenda);
            if (returnedQtyTotal === 0 && diffValor > 0.0001 && itens.length > 0) {
              // Distribuir devolução por item proporcional ao valor bruto de cada item
              let restanteValor = diffValor;
              for (let idx = 0; idx < itens.length; idx++) {
                const it = itens[idx];
                const unit = Number(it.preco_unitario || it.precoUnitario || it.preco || it.valor_unitario || 0) || 0;
                const qtyOrig = Number(it.quantidade || it.quantidade_vendida || 0) || 0;
                if (unit <= 0 || qtyOrig <= 0) continue;
                const brutoItem = unit * qtyOrig;
                let retItem = 0;
                if (idx < itens.length - 1) {
                  const proporcao = brutoItem / brutoVenda;
                  const valorAlocado = Math.min(restanteValor, diffValor * proporcao);
                  retItem = Math.min(qtyOrig, Math.round(valorAlocado / unit));
                } else {
                  // último item absorve o restante
                  retItem = Math.min(qtyOrig, Math.round(restanteValor / unit));
                }
                if (retItem > 0) {
                  (it as any).returned_quantity = retItem;
                  restanteValor -= retItem * unit;
                  returnedQtyTotal += retItem;
                }
                if (restanteValor <= 0.0001) break;
              }
              if ((m as any).returned_quantity_total == null && returnedQtyTotal > 0) (m as any).returned_quantity_total = returnedQtyTotal;
              // Recalcular quantidade líquida agregada
              const qtyRetNovo = itens.reduce((s: number, it: any) => s + (Number((it as any).returned_quantity || 0)), 0);
              // Atualizar quantidade_liquida por item (efetiva)
              for (const it of itens) {
                try {
                  const qtyOrig = Number(it.quantidade || it.quantidade_vendida || 0) || 0;
                  const retIt = Number((it as any).returned_quantity || 0);
                  (it as any).quantidade_liquida = Math.max(0, qtyOrig - retIt);
                } catch { /* ignore */ }
              }
              m.quantidade = Math.max(0, qtyOrigAgg - qtyRetNovo);
              logger.info('HISTORICO_VENDAS', 'FALLBACK_RETURN_ALLOCATION', 'Distribuiu devolução por valor', { id: m.id, diffValor, returnedQtyTotal: qtyRetNovo });
            }
          } catch { /* ignore */ }
          // Preços totais agregado
          (m as any).preco_total ??= grossTotal;
          if (m.net_total != null) {
            m.preco_total_liquido = Number(m.net_total) || 0;
          } else {
            // Ajuste líquido considerando devoluções (já refletidas em netTotal) + diferença de troca
            const exchangeAdj = Number((m as any).exchange_difference_total || exchangeDiffTotal || 0) || 0;
            m.preco_total_liquido = Number(netTotal) + exchangeAdj;
          }
          // Log de trocas por item para debug
          try {
            const itemsLog = (Array.isArray(itens) ? itens : []).map((it: any) => ({
              produto: it.produto_nome || it.produtoNome,
              diff: Number((it as any).exchange_difference_total || 0) || 0,
              pm: (it as any).exchange_payment_method || null
            }));
            logger.info('HISTORICO_VENDAS', 'EXCHANGE_MAP', 'Trocas mapeadas na venda', {
              id: m.id,
              exchange_total: Number((m as any).exchange_difference_total || exchangeDiffTotal || 0) || 0,
              itens: itemsLog
            });
          } catch { /* ignore */ }
          // Valor devolvido agregado (se não presente)
          if (m.returned_total == null) {
            const calcReturned = Math.max(0, grossTotal - (m.preco_total_liquido ?? netTotal));
            if (calcReturned > 0) m.returned_total = calcReturned;
          }
          // Fallback: se há ajustes de devolução e valor devolvido ainda 0, usar soma itemizada
          try {
            const hasReturnAdj = adjustments.some(a => (a?.type || a?.tipo || '').toLowerCase() === 'return');
            if (hasReturnAdj && returnedValueTotal > 0 && Number(m.returned_total || 0) === 0) {
              (m as any).returned_total = returnedValueTotal;
              logger.warn('HISTORICO_VENDAS', 'AJUSTES_SEM_RETURNED_TOTAL', 'Ajustes de devolução presentes mas returned_total == 0 (aplicado fallback)', {
                id: m.id,
                bruto: grossTotal,
                returnedQtyTotal,
                returnedValueTotal
              });
            } else if (hasReturnAdj && Number(m.returned_total || 0) === 0) {
              logger.warn('HISTORICO_VENDAS', 'AJUSTES_SEM_RETURNED_TOTAL', 'Ajustes de devolução presentes mas não foi possível calcular returned_total', {
                id: m.id,
                bruto: grossTotal,
                returnedQtyTotal,
                returnedValueTotal
              });
            }
          } catch { /* ignore */ }
          // Quantidade devolvida agregada
          if ((m as any).returned_quantity_total == null && returnedQtyTotal > 0) (m as any).returned_quantity_total = returnedQtyTotal;
          // Não adicionar mais anotação no produto_nome aqui; usamos _produtos_compostos + badge inline
          // Log por venda mapeada (nivel INFO para facilitar auditoria de devoluções)
          try {
            logger.info('HISTORICO_VENDAS', 'MAP_VENDA', 'Venda normalizada', {
              id: m.id,
              bruto: grossTotal,
              net: Number(m.preco_total_liquido ?? m.net_total ?? netTotal),
              returned_total: Number(m.returned_total || 0),
              returned_qty_total: returnedQtyTotal,
              itens: itens.length,
              ajustes_return: Object.keys(returnedByItem).length
            });
          } catch { /* ignore logging errors */ }
          // produto_imagem
          if (!m.produto_imagem) {
            if (itens.length > 0) {
              const firstImagem = itens[0].produto_imagem || itens[0].produtoImagem || (itens[0].produto ? itens[0].produto.imagem : undefined);
              if (firstImagem) m.produto_imagem = firstImagem;
            }
          }
          try {
            if (exchangePaymentMethods.size > 0) (m as any).exchange_payment_methods = Array.from(exchangePaymentMethods);
          } catch { /* ignore */ }
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
        // Log resumo agregado após carga
        try {
          const totalBruto = sorted.reduce((a: number, v: any) => a + (Number(v.preco_total) || 0), 0);
          const totalLiquido = sorted.reduce((a: number, v: any) => a + this._getNetValor(v), 0);
          const totalDevolvido = sorted.reduce((a: number, v: any) => a + (Number(v.returned_total) || 0), 0);
          logger.info('HISTORICO_VENDAS', 'LOAD_SUMMARY', 'Resumo de vendas carregadas', {
            linhas: sorted.length,
            totalBruto,
            totalLiquido,
            totalDevolvido
          });
        } catch { /* ignore */ }
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
    return src.reduce((acc, v: any) => acc + this._getNetValor(v), 0);
  }

  getTotalDevolvido(): number {
    const src = this.vendasFiltradasAll || this.vendasFiltradas;
    if (!Array.isArray(src)) return 0;
    return src.reduce((acc, v: any) => acc + (v.returned_total || 0), 0);
  }

  getQuantidadeDevolvidaTotal(): number {
    const src = this.vendasFiltradasAll || this.vendasFiltradas;
    if (!Array.isArray(src)) return 0;
    return src.reduce((acc, v: any) => acc + (v.returned_quantity_total || 0), 0);
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

  private _getNetValor(v: any): number {
    try {
      if (!v) return 0;
      const bruto = Number(v.preco_total ?? 0) || 0;
      const liquidoDireto = Number(v.preco_total_liquido ?? v.net_total ?? NaN);
      if (!isNaN(liquidoDireto)) return liquidoDireto;
      const devolvido = Number(v.returned_total ?? 0) || 0;
      return Math.max(0, bruto - devolvido);
    } catch { return 0; }
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

  // --- Helpers para exibição de troca por item (com fallback quando só há 1 item) ---
  getItemExchangeDiff(item: any, venda: any): number {
    try {
      const d = Number(item?.exchange_difference_total ?? 0) || 0;
      if (d !== 0) return d;
      const itensLen = Array.isArray(venda?.itens) ? venda.itens.length : 0;
      if (itensLen === 1) return Number(venda?.exchange_difference_total ?? 0) || 0;
      return 0;
    } catch { return 0; }
  }

  getItemExchangeMethod(item: any, venda: any): string | null {
    try {
      const m = item?.exchange_payment_method;
      if (m) return String(m);
      const itensLen = Array.isArray(venda?.itens) ? venda.itens.length : 0;
      const list = venda?.exchange_payment_methods;
      if (itensLen === 1 && Array.isArray(list) && list.length) return list.join(' / ');
      return null;
    } catch { return null; }
  }

  absValue(n: number): number { return Math.abs(Number(n) || 0); }

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
