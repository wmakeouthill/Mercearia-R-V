import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { formatDateBR } from '../../utils/date-utils';
// Usa versão component (standalone) recriada
import { ExchangeReturnDetailModalComponent } from '../exchange-return-detail-modal/exchange-return-detail-modal.component';
import { CurrencyBrPipe } from '../../pipes/currency-br.pipe';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';

@Component({
  selector: 'app-exchange-return-list',
  standalone: true,
  imports: [CommonModule, FormsModule, ExchangeReturnDetailModalComponent, CurrencyBrPipe],
  templateUrl: './exchange-return-list.html',
  styleUrls: ['./exchange-return-list.scss']
})
export class ExchangeReturnListComponent implements OnInit, OnDestroy {
  items: any[] = [];
  page = 0;
  size = 10;
  total = 0;
  q = '';
  from = '';
  fromTime = '';
  to = '';
  toTime = '';
  operatorFilter = '';
  loading = false;
  selectedSale: any = null;
  operators: any[] = [];
  totalPages = 0;
  paginationItems: Array<number | string> = [];
  jumpPage = 1;
  private readonly querySubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  constructor(private readonly api: ApiService) { }

  ngOnInit(): void {
    this.loadPage();
    this.loadOperators();
    this.querySubject.pipe(debounceTime(500), distinctUntilChanged(), takeUntil(this.destroy$)).subscribe(() => this.loadPage(0));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.querySubject.complete();
  }

  private loadOperators(): void {
    this.api.getUsers().subscribe({
      next: (users) => {
        this.operators = (users || []).map((u: any) => ({ username: u.username }));
      }, error: () => { this.operators = []; }
    });
  }

  // Resolve operator username from various backend shapes
  private resolveOperator(obj: any): string | null {
    if (!obj) return null;
    // explicit username fields
    if (obj.operador_username) return obj.operador_username;
    if (obj.operator_username) return obj.operator_username;
    if (obj.operator) return typeof obj.operator === 'string' ? obj.operator : (obj.operator.username || obj.operator.name || obj.operator.nome || null);
    if (obj.operador) return typeof obj.operador === 'string' ? obj.operador : (obj.operador.username || obj.operador.name || obj.operador.nome || null);
    // nested in payments or other shapes
    if (obj.pagos && Array.isArray(obj.pagos) && obj.pagos.length > 0) {
      const p = obj.pagos[0];
      if (p.operador) return p.operador.username || null;
    }
    return null;
  }

  // Resolve customer name from various backend shapes
  private resolveCustomer(obj: any): string | null {
    if (!obj) return null;
    if (obj.customer_name) return obj.customer_name;
    if (obj.cliente_nome) return obj.cliente_nome;
    if (obj.customerName) return obj.customerName;
    if (obj.cliente) return typeof obj.cliente === 'string' ? obj.cliente : (obj.cliente.nome || obj.cliente.name || null);
    if (obj.customer) return typeof obj.customer === 'string' ? obj.customer : (obj.customer.name || obj.customer.nome || null);
    return null;
  }

  onQueryInput(value: string): void {
    this.q = value;
    this.querySubject.next(value);
  }

  loadPage(p: number = 0): void {
    this.loading = true;
    // Convert to UTC ISO with Z for backend compatibility
    const fromNormalizedLocal = this.from ? this.normalizeDateStartWithTime(this.from, this.fromTime) : undefined;
    const toNormalizedLocal = this.to ? this.normalizeDateEndWithTime(this.to, this.toTime) : undefined;
    const fromUtc = fromNormalizedLocal ? this.toUtcIso(fromNormalizedLocal) : undefined;
    const toUtc = toNormalizedLocal ? this.toUtcIso(toNormalizedLocal) : undefined;

    // Log params for debugging backend filtering
    console.log('searchSales params:', { page: p, size: this.size, from: fromUtc, to: toUtc, q: this.q, operator: this.operatorFilter });

    forkJoin({
      search: this.api.searchSales(p, this.size, fromUtc || undefined, toUtc || undefined, this.q || undefined).pipe(catchError(() => of(null))),
      completas: this.api.getVendasCompletas().pipe(catchError(() => of([])))
    }).subscribe({
      next: (res: any) => {
        const r = res.search || {};
        let list = r.items || [];
        const completas = Array.isArray(res.completas) ? res.completas : [];

        // map completas into lightweight search-shape and normalize operator/customer
        const completasMapped = completas.map((c: any) => {
          const it: any = { ...c };
          it.itens = it.itens || it.items || [];
          const previewArr = Array.isArray(it.itens) ? it.itens.map((i: any) => i.produto_nome || i.produtoNome || i.product_name || i.name || i.title || i.produto_id).filter(Boolean) : [];
          it.products_preview = previewArr.join(', ');
          it.itens_count = it.itens.length;
          it.total_preview = it.preco_total || it.total_final || it.totalFinal || it.total || it.order_total || null;
          it.preco_total = it.preco_total || it.total_preview;
          it.operator = this.resolveOperator(it) || null;
          it.customer_name = this.resolveCustomer(it) || null;
          it.data_venda = it.data_venda || it.dataVenda || it.dataVenda;
          return it;
        });

        // If detailed search returned items, prefer it but replace entries with checkout data when available
        if (Array.isArray(list) && list.length > 0) {
          const completasById: Record<string, any> = {};
          for (const c of completasMapped) if (c && c.id != null) completasById[String(c.id)] = c;
          list = list.map((it: any) => {
            const cid = it && it.id != null ? String(it.id) : null;
            if (cid && completasById[cid]) {
              // merge checkout authoritative data on top
              return { ...it, ...completasById[cid] };
            }
            return it;
          });
          // normalize fields for any remaining detailed items
          list = list.map((it: any) => {
            const itemsArr = it.itens || it.items || it.sale_items || [];
            const names = Array.isArray(itemsArr) ? itemsArr.map((x: any) => x && (x.produto_nome || x.product_name || x.name || x.title || x.produto_id)).filter(Boolean) : [];
            it.products_preview = it.products_preview || names.join(', ');
            it.itens_count = it.itens_count || itemsArr.length || it.itens_count || 0;
            it.total_preview = it.total_preview || it.preco_total || it.valor_total || it.total || it.order_total || it.precoTotal || '';
            if ((!it.total_preview || it.total_preview === '') && Array.isArray(itemsArr) && itemsArr.length > 0) {
              const computed = this.computeItemsSum(itemsArr);
              if (computed > 0) it.total_preview = computed;
            }
            it.operator = this.resolveOperator(it) || null;
            it.customer_name = this.resolveCustomer(it) || null;
            return it;
          });

          // Merge in any checkout-only orders (completas) that are not present
          // in the detailed results so recently created checkout orders appear
          // in the exchange/return list.
          try {
            const existingIds = new Set(list.map((it: any) => String(it.id)));
            for (const c of completasMapped) {
              try {
                const cid = c && c.id != null ? String(c.id) : null;
                if (cid && !existingIds.has(cid)) {
                  list.push(c);
                  existingIds.add(cid);
                }
              } catch {
                /* ignore malformed completa */
              }
            }
          } catch {
            // ignore merge errors
          }

          // If the user provided from/to, additionally enforce the date range
          // client-side to guard against backend returning out-of-range results.
          try {
            if (fromUtc || toUtc) {
              const fromMs = fromUtc ? new Date(fromUtc).getTime() : null;
              const toMs = toUtc ? new Date(toUtc).getTime() : null;
              list = list.filter((it: any) => {
                try {
                  const ds = it.data_venda || it.dataVenda || it.dataVenda || it.data_venda || it.created_at || it.data_venda;
                  if (!ds) return false;
                  const dt = new Date(ds).getTime();
                  if (isNaN(dt)) return false;
                  if (fromMs != null && dt < fromMs) return false;
                  if (toMs != null && dt > toMs) return false;
                  return true;
                } catch {
                  return false;
                }
              });
            }
          } catch (e) {
            // ignore parse errors and fall back to server result
          }

          // apply operator filter if present
          if (this.operatorFilter) {
            list = list.filter((it: any) => (it.operator || '').toLowerCase() === String(this.operatorFilter).toLowerCase());
          }

          // sort by date desc (newest first)
          try {
            list.sort((x: any, y: any) => {
              const xs = x.data_venda || x.dataVenda || x.created_at || x.createdAt || x.data_venda;
              const ys = y.data_venda || y.dataVenda || y.created_at || y.createdAt || y.data_venda;
              const dx = xs ? new Date(xs).getTime() : 0;
              const dy = ys ? new Date(ys).getTime() : 0;
              return dy - dx;
            });
          } catch (e) { /* ignore sort errors */ }
          this.items = list.map((it: any) => this.decorateNetFields(it));
          this.page = (r.page || 0);
          this.size = (r.size || this.size);
          this.total = (r.total_elements || list.length);
          this.totalPages = Math.max(1, Math.ceil(this.total / this.size));
          this.buildPaginationItems();
          this.loading = false;
          return;
        }

        // If detailed search returned nothing (legacy endpoint removed), paginate checkout results locally
        const completasFull = completasMapped;
        // apply optional date range filter (from/to) to checkout results so UI filters behave
        // consistently with the server-side detailed search
        let completasFiltered = completasFull;
        try {
          if (fromUtc || toUtc) {
            const fromMs = fromUtc ? new Date(fromUtc).getTime() : null;
            const toMs = toUtc ? new Date(toUtc).getTime() : null;
            completasFiltered = completasFull.filter((it: any) => {
              try {
                const dt = it.data_venda ? new Date(it.data_venda).getTime() : null;
                if (dt == null) return false;
                if (fromMs != null && dt < fromMs) return false;
                if (toMs != null && dt > toMs) return false;
                return true;
              } catch {
                return false;
              }
            });
          }
        } catch (e) {
          // fallback to unfiltered completasFull on parse errors
          completasFiltered = completasFull;
        }
        // apply operator filter
        if (this.operatorFilter) {
          completasFiltered = completasFiltered.filter((it: any) => (it.operator || '').toLowerCase() === String(this.operatorFilter).toLowerCase());
        }
        const total = completasFiltered.length;
        const start = p * this.size;
        const end = start + this.size;
        // sort checkout fallback by date desc before paginating
        try {
          completasFiltered.sort((x: any, y: any) => {
            const xs = x.data_venda || x.dataVenda || x.created_at || x.createdAt || x.data_venda;
            const ys = y.data_venda || y.dataVenda || y.created_at || y.createdAt || y.data_venda;
            const dx = xs ? new Date(xs).getTime() : 0;
            const dy = ys ? new Date(ys).getTime() : 0;
            return dy - dx;
          });
        } catch (e) { /* ignore */ }
        const pageSlice = completasFiltered.slice(start, end).map((it: any) => this.decorateNetFields(it));
        this.items = pageSlice;
        this.page = p;
        // ensure size reflects user's selector
        this.size = this.size || 10;
        this.total = total;
        this.totalPages = Math.max(1, Math.ceil(total / this.size));
        this.buildPaginationItems();
        this.loading = false;
      }, error: () => { this.loading = false; }
    });
  }

  // Normalize input YYYY-MM-DD to start of day in ISO with timezone offset preserved as local
  private normalizeDateStart(dateYmd: string): string {
    try {
      // create local date at 00:00
      const parts = dateYmd.split('-');
      if (parts.length !== 3) return dateYmd;
      const year = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const day = Number(parts[2]);
      const d = new Date(year, month, day, 0, 0, 0, 0);
      return this.formatLocalIso(d);
    } catch {
      return dateYmd;
    }
  }

  // Normalize input YYYY-MM-DD to end of day in ISO (23:59:59.999) local
  private normalizeDateEnd(dateYmd: string): string {
    try {
      const parts = dateYmd.split('-');
      if (parts.length !== 3) return dateYmd;
      const year = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const day = Number(parts[2]);
      const d = new Date(year, month, day, 23, 59, 59, 999);
      return this.formatLocalIso(d);
    } catch {
      return dateYmd;
    }
  }

  // Normalize with optional time HH:mm
  private normalizeDateStartWithTime(dateYmd: string, timeHHmm?: string): string {
    try {
      const parts = dateYmd.split('-');
      if (parts.length !== 3) return dateYmd;
      const year = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const day = Number(parts[2]);
      let hours = 0;
      let minutes = 0;
      if (timeHHmm && typeof timeHHmm === 'string' && timeHHmm.trim()) {
        const t = timeHHmm.split(':');
        hours = Number(t[0]) || 0;
        minutes = Number(t[1]) || 0;
      }
      const d = new Date(year, month, day, hours, minutes, 0, 0);
      return this.formatLocalIso(d);
    } catch {
      return dateYmd;
    }
  }

  private normalizeDateEndWithTime(dateYmd: string, timeHHmm?: string): string {
    try {
      const parts = dateYmd.split('-');
      if (parts.length !== 3) return dateYmd;
      const year = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const day = Number(parts[2]);
      let hours = 23;
      let minutes = 59;
      if (timeHHmm && typeof timeHHmm === 'string' && timeHHmm.trim()) {
        const t = timeHHmm.split(':');
        hours = Number(t[0]) || 0;
        minutes = Number(t[1]) || 0;
      }
      const d = new Date(year, month, day, hours, minutes, 59, 999);
      return this.formatLocalIso(d);
    } catch {
      return dateYmd;
    }
  }

  // Format Date to local ISO without timezone suffix (YYYY-MM-DDTHH:mm:ss.sss)
  private formatLocalIso(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}.${ms}`;
  }

  // Convert local ISO string (YYYY-MM-DDTHH:mm:ss.sss) to UTC ISO with Z
  private toUtcIso(localIsoOrDate: string | Date): string {
    const d = typeof localIsoOrDate === 'string' ? new Date(localIsoOrDate) : localIsoOrDate;
    return d.toISOString();
  }

  private buildPaginationItems(): void {
    const pages = this.totalPages;
    const current = this.page + 1;
    const items: Array<number | string> = [];
    const maxPagesToShow = 7;
    let start = Math.max(1, current - Math.floor(maxPagesToShow / 2));
    let end = Math.min(pages, start + maxPagesToShow - 1);
    if (end - start < maxPagesToShow - 1) {
      start = Math.max(1, end - maxPagesToShow + 1);
    }
    if (start > 1) items.push(1);
    if (start > 2) items.push('…');
    for (let i = start; i <= end; i++) items.push(i);
    if (end < pages - 1) items.push('…');
    if (end < pages) items.push(pages);
    this.paginationItems = items;
  }

  // Pagination helpers used by template
  goToFirstPage(): void { this.loadPage(0); }
  goBy(offset: number): void { this.loadPage(Math.max(0, Math.min(this.totalPages - 1, this.page + offset))); }
  prevPage(): void { this.loadPage(Math.max(0, this.page - 1)); }
  nextPage(): void { this.loadPage(Math.min(this.totalPages - 1, this.page + 1)); }
  goToLastPage(): void { this.loadPage(Math.max(0, this.totalPages - 1)); }
  onClickPage(p: number | string): void {
    if (p === '…') {
      return;
    }
    this.loadPage(Number(p) - 1);
  }

  private populateOrderPreview(it: any): void {
    this.api.getOrderById(it.id).subscribe({
      next: (r) => {
        const fullItems = (r.itens || r.items || []);
        const fullNames = Array.isArray(fullItems) ? fullItems.map((x: any) => x && (x.produto_nome || x.product_name || x.name || x.title || x.produto_id)).filter(Boolean) : [];
        it.products_preview = fullNames.join(', ');
        it.total_preview = it.total_preview || r.preco_total || r.total || r.order_total || '';
        if ((!it.total_preview || it.total_preview === '') && Array.isArray(fullItems) && fullItems.length > 0) {
          const computed = this.computeItemsSum(fullItems);
          if (computed > 0) it.total_preview = computed;
        }
        if (!it.itens_count && Array.isArray(fullItems)) it.itens_count = fullItems.length;
        // populate operator and customer from full order when available
        try {
          it.operator = it.operator || r.operador_username || (r.operador && (r.operador.username || r.operador.name || r.operador.nome)) || it.operator || null;
        } catch {
          /* ignore */
        }
        try {
          it.customer_name = it.customer_name || r.cliente_nome || r.customerName || (r.cliente && (r.cliente.nome || r.cliente.name)) || (r.customer && (r.customer.name || r.customer.nome)) || it.customer_name || null;
        } catch {
          /* ignore */
        }
      },
      error: () => { /* ignore */ }
    });
  }

  private computeItemsSum(itemsArr: any[]): number {
    try {
      return itemsArr.reduce((acc, cur) => {
        const price = Number(cur.preco || cur.preco_unitario || cur.price || cur.unit_price || cur.valor_unitario || 0) || 0;
        const qty = Number(cur.quantidade || cur.quantity || cur.qty || cur.quantidade_vendida || 1) || 0;
        return acc + (price * qty);
      }, 0);
    } catch {
      return 0;
    }
  }

  formatDate(dateString: string): string { return formatDateBR(dateString, true); }

  openSaleDetail(sale: any): void {
    this.selectedSale = sale;
  }

  closeDetail(): void { this.selectedSale = null; this.loadPage(this.page); }

  @Output() close = new EventEmitter<void>();

  // request parent to close the list view
  requestClose(): void { this.selectedSale = null; this.loadPage(this.page); this.close.emit(); }

  private decorateNetFields(it: any): any {
    try {
      if (it.net_total != null && it.net_quantidade_vendida != null) return it;
      const itens: any[] = it.itens || it.items || [];
      const adjustments: any[] = it.ajustes || it.adjustments || it.sale_adjustments || [];
      const returnedByItem: Record<string, number> = {};
      for (const a of adjustments) this.collectReturn(a, returnedByItem);
      const result = this.computeNetFromItems(itens, returnedByItem);
      it.net_total ??= result.netTotal;
      it.net_quantidade_vendida ??= result.netQty;
      it.full_returned = result.fullReturn;
      it.partial_returned = result.anyReturn && !result.fullReturn;
      return it;
    } catch { return it; }
  }

  private collectReturn(a: any, map: Record<string, number>): void {
    if (!a) return;
    const type = (a.type || a.tipo || '').toLowerCase();
    if (type !== 'return' || !a.saleItem) return;
    const id = String(a.saleItem.id || a.sale_item_id || '');
    if (!id) return;
    map[id] = (map[id] || 0) + (a.quantity || a.quantidade || 0);
  }

  private computeNetFromItems(itens: any[], returned: Record<string, number>): { netTotal: number; netQty: number; anyReturn: boolean; fullReturn: boolean } {
    let netTotal = 0; let netQty = 0; let anyReturn = false; let fullReturn = true;
    for (const item of itens) {
      const id = String(item.id || item.sale_item_id || '');
      const origQty = Number(item.quantidade || item.quantity || item.qty || 0);
      const ret = returned[id] || 0;
      if (ret > 0) anyReturn = true;
      const effective = Math.max(0, origQty - ret);
      if (effective > 0) fullReturn = false;
      const unit = Number(item.preco_unitario || item.preco || item.valor_unitario || item.price || item.unit_price || 0) || 0;
      netTotal += unit * effective;
      netQty += effective;
    }
    if (!anyReturn) fullReturn = false;
    return { netTotal, netQty, anyReturn, fullReturn };
  }
}


