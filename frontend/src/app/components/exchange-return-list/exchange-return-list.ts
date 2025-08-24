import { Component, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { formatDateBR } from '../../utils/date-utils';
import { ExchangeReturnDetailModalComponent } from '../exchange-return-detail-modal/exchange-return-detail-modal';
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

        this.api.searchSales(p, this.size, fromUtc || undefined, toUtc || undefined, this.q || undefined).subscribe({
            next: (r) => {
                let list = r.items || [];
                // client-side fallback filtering (in case backend ignores from/to/q/operator)
                const filtered = [] as any[];
                const fromTs = fromUtc ? new Date(fromUtc).getTime() : null;
                const toTs = toUtc ? new Date(toUtc).getTime() : null;

                for (const it of list) {
                    try {
                        // date filter
                        if (fromTs !== null || toTs !== null) {
                            const dv = it.data_venda ? new Date(it.data_venda).getTime() : null;
                            if (dv === null) continue;
                            if (fromTs !== null && dv < fromTs) continue;
                            if (toTs !== null && dv > toTs) continue;
                        }

                        // operator filter
                        if (this.operatorFilter && String(this.operatorFilter).trim()) {
                            if (!it.operator || String(it.operator).toLowerCase() !== String(this.operatorFilter).toLowerCase()) continue;
                        }

                        // text query filter (id, customer_name, preview)
                        if (this.q && String(this.q).trim()) {
                            const ql = String(this.q).toLowerCase();
                            const idMatch = String(it.id || '').toLowerCase().includes(ql);
                            const cust = String(it.customer_name || '').toLowerCase().includes(ql);
                            const previewArr = Array.isArray(it.preview) ? it.preview : (it.itens || it.items || it.sale_items || []);
                            const previewStr = Array.isArray(previewArr) ? previewArr.join(', ').toLowerCase() : String(previewArr || '').toLowerCase();
                            const previewMatch = previewStr.includes(ql);
                            if (!(idMatch || cust || previewMatch)) continue;
                        }

                        filtered.push(it);
                    } catch {
                        // skip invalid item
                    }
                }

                if (filtered.length > 0) list = filtered;
                // ensure each item has a products_preview, total_preview, operator and customer fields
                list = list.map((it: any) => {
                    // try to build from whatever the search endpoint returned
                    const itemsArr = it.itens || it.items || it.sale_items || [];
                    const names = Array.isArray(itemsArr)
                        ? itemsArr.map((x: any) => x && (x.produto_nome || x.product_name || x.name || x.title || x.produto_id)).filter(Boolean)
                        : [];
                    it.products_preview = names.join(', ');

                    // total may be present in different fields
                    it.total_preview = it.preco_total || it.valor_total || it.total || it.order_total || it.precoTotal || '';

                    // if total not present, try to compute from item lines (price * qty)
                    if ((!it.total_preview || it.total_preview === '') && Array.isArray(itemsArr) && itemsArr.length > 0) {
                        const computed = this.computeItemsSum(itemsArr);
                        if (computed > 0) it.total_preview = computed;
                    }

                    // if we couldn't build a products preview or total, fetch full order details asynchronously
                    if ((!it.products_preview || it.products_preview.length === 0) || !it.total_preview) {
                        this.populateOrderPreview(it);
                    }

                    // normalize operator field from various backend shapes
                    it.operator = it.operator || it.operador || it.operator_username || it.operador_username || (it.operador_username && String(it.operador_username)) || null;
                    // normalize customer name/id
                    it.customer_name = it.customer_name || it.cliente_nome || it.cliente_name || it.customerName || null;
                    it.customer_id = it.customer_id || it.cliente_id || it.clienteId || null;

                    return it;
                });
                if (this.operatorFilter) {
                    list = list.filter((it: any) => (it.operator || '').toLowerCase() === String(this.operatorFilter).toLowerCase());
                }
                this.items = list;
                this.page = (r.page || 0);
                this.size = (r.size || this.size);
                this.total = (r.total_elements || list.length);
                this.totalPages = Math.max(1, Math.ceil(this.total / this.size));
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
}


