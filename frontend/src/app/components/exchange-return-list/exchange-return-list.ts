import { Component, OnInit, Output, EventEmitter } from '@angular/core';
import { formatDateBR } from '../../utils/date-utils';
import { ExchangeReturnDetailModalComponent } from '../exchange-return-detail-modal/exchange-return-detail-modal';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';

@Component({
    selector: 'app-exchange-return-list',
    standalone: true,
    imports: [CommonModule, FormsModule, ExchangeReturnDetailModalComponent],
    templateUrl: './exchange-return-list.html',
    styleUrls: ['./exchange-return-list.scss']
})
export class ExchangeReturnListComponent implements OnInit {
    items: any[] = [];
    page = 0;
    size = 10;
    total = 0;
    q = '';
    from = '';
    to = '';
    operatorFilter = '';
    loading = false;
    selectedSale: any = null;
    operators: any[] = [];
    totalPages = 0;
    paginationItems: Array<number | string> = [];
    jumpPage = 1;

    constructor(private readonly api: ApiService) { }

    ngOnInit(): void {
        this.loadPage();
        this.loadOperators();
    }

    private loadOperators(): void {
        this.api.getUsers().subscribe({
            next: (users) => {
                this.operators = (users || []).map((u: any) => ({ username: u.username }));
            }, error: () => { this.operators = []; }
        });
    }

    loadPage(p: number = 0): void {
        this.loading = true;
        this.api.searchSales(p, this.size, this.from || undefined, this.to || undefined, this.q || undefined).subscribe({
            next: (r) => {
                let list = r.items || [];
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
    onClickPage(p: number | string): void { if (p === '…') return; this.loadPage(Number(p) - 1); }

    formatDate(dateString: string): string { return formatDateBR(dateString, true); }

    openSaleDetail(sale: any): void {
        this.selectedSale = sale;
    }

    closeDetail(): void { this.selectedSale = null; this.loadPage(this.page); }

    @Output() close = new EventEmitter<void>();

    // request parent to close the list view
    requestClose(): void { this.selectedSale = null; this.loadPage(this.page); this.close.emit(); }
}


