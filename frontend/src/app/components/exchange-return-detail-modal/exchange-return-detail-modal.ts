import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { CurrencyBrPipe } from '../../pipes/currency-br.pipe';

@Component({
    selector: 'app-exchange-return-detail-modal',
    standalone: true,
    imports: [CommonModule, FormsModule, CurrencyBrPipe],
    templateUrl: './exchange-return-detail-modal.html',
    styleUrls: ['./exchange-return-detail-modal.scss']
})
export class ExchangeReturnDetailModalComponent implements OnInit {
    @Input() saleSummary: any;
    @Output() close = new EventEmitter<void>();

    saleDetails: any = null;
    selections: { [itemId: number]: 'none' | 'return' | 'exchange' } = {};
    replacementProductIds: { [itemId: number]: number | null } = {};
    quantities: { [itemId: number]: number } = {};
    produtosDisponiveis: any[] = [];

    // UI state for searchable replacement select
    replacementSearch: { [itemId: number]: string } = {};
    replacementFiltered: { [itemId: number]: any[] } = {};
    showReplacementList: { [itemId: number]: boolean } = {};
    replacementPosition: { [itemId: number]: { top?: string; left?: string; width?: string } } = {};
    replacementInputWidth: { [itemId: number]: number } = {};
    replacementHideTimer: { [itemId: number]: any } = {};
    // pagination for replacement dropdown
    replacementPage: { [itemId: number]: number } = {};
    replacementPageSize = 5;
    replacementTotalPages: { [itemId: number]: number } = {};
    replacementVisible: { [itemId: number]: any[] } = {};

    // value adjustments (troco / pagamento adicional)
    valueAdjustments: { [itemId: number]: { type: 'refund' | 'charge' | null, amount: number } } = {};

    loading = false;

    constructor(private readonly api: ApiService) { }

    ngOnInit(): void {
        this.loadDetails();
    }

    loadDetails(): void {
        this.loading = true;
        this.api.getOrderById(this.saleSummary.id).subscribe({
            next: (r) => {
                this.saleDetails = r;
                // init selections and quantities
                (r.itens || []).forEach((it: any) => {
                    this.selections[it.produto_id] = 'none';
                    this.quantities[it.produto_id] = it.quantidade;
                    this.replacementProductIds[it.produto_id] = null;
                    this.replacementSearch[it.produto_id] = '';
                    this.replacementFiltered[it.produto_id] = [];
                    this.showReplacementList[it.produto_id] = false;
                    this.valueAdjustments[it.produto_id] = { type: null, amount: 0 };
                });
                // fetch available products for replacement dropdown (simple list)
                this.api.getProdutos().subscribe({
                    next: (ps) => {
                        this.saleDetails.produtosDisponiveis = (ps || []).map((p: any) => ({
                            id: p.id,
                            nome: p.nome,
                            quantidade_estoque: p.quantidade_estoque,
                            preco_venda: Number(p.preco_venda ?? p.precoVenda ?? p.preco) || 0
                        }));
                        // initialize replacement lists and pagination for each sale item
                        (r.itens || []).forEach((it: any) => {
                            this.replacementFiltered[it.produto_id] = this.saleDetails.produtosDisponiveis || [];
                            this.replacementPage[it.produto_id] = 0;
                            this.updateReplacementPagination(it.produto_id);
                        });
                    }, error: () => { this.saleDetails.produtosDisponiveis = []; }
                });
                this.loading = false;
            }, error: () => { this.loading = false; }
        });
    }

    onReplacementFocus(itemId: number, event?: FocusEvent): void {
        this.showReplacementList[itemId] = true;
        // ensure filtered list and pagination are initialized
        this.replacementFiltered[itemId] = this.replacementFiltered[itemId] && this.replacementFiltered[itemId].length > 0
            ? this.replacementFiltered[itemId]
            : (this.saleDetails?.produtosDisponiveis || []);
        this.replacementPage[itemId] ??= 0;
        this.clearHideTimer(itemId);
        this.updateReplacementPagination(itemId);
        // compute dropdown position to avoid clipping: place it above if near bottom of modal
        try {
            const inputEl = (event?.target) as HTMLElement | null;
            if (inputEl) {
                const rect = inputEl.getBoundingClientRect();
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                const spaceBelow = viewportHeight - rect.bottom;
                const top = rect.bottom + window.scrollY;
                const left = rect.left + window.scrollX;
                this.replacementInputWidth[itemId] = rect.width;
                // if space below < 220px, place above the input
                if (spaceBelow < 220) {
                    const aboveTop = rect.top + window.scrollY - Math.min(260, rect.height + 12) - 6;
                    // compute auto width
                    const w = this.computeDropdownWidthForItems(this.replacementFiltered[itemId] || [], rect.width);
                    this.replacementPosition[itemId] = { top: `${aboveTop}px`, left: `${left}px`, width: `${w}px` };
                } else {
                    const w = this.computeDropdownWidthForItems(this.replacementFiltered[itemId] || [], rect.width);
                    this.replacementPosition[itemId] = { top: `${top}px`, left: `${left}px`, width: `${w}px` };
                }
            }
        } catch { /* ignore positioning errors */ }
    }

    onReplacementSearch(itemId: number): void {
        const q = (this.replacementSearch[itemId] || '').toLowerCase();
        const all = this.saleDetails?.produtosDisponiveis || [];
        if (!q) {
            this.replacementFiltered[itemId] = all;
        } else {
            this.replacementFiltered[itemId] = all.filter((p: any) => (p.nome || '').toLowerCase().includes(q));
        }
        this.replacementPage[itemId] = 0;
        this.updateReplacementPagination(itemId);
    }

    selectReplacement(itemId: number, product: any): void {
        this.replacementProductIds[itemId] = product.id;
        this.replacementSearch[itemId] = product.nome;
        this.showReplacementList[itemId] = false;
        this.replacementFiltered[itemId] = this.saleDetails?.produtosDisponiveis || [];
        this.updateReplacementPagination(itemId);
        // automatically mark action as 'exchange' and compute price difference
        try {
            // ensure the item is set to exchange
            this.selections[itemId] = 'exchange';
            const qty = this.quantities[itemId] || 1;
            // find original sale item by produto_id
            const orig = (this.saleDetails && Array.isArray(this.saleDetails.itens))
                ? this.saleDetails.itens.find((it: any) => it.produto_id === itemId || it.produtoId === itemId)
                : null;
            let origUnit = 0;
            if (orig) {
                if (orig.preco_unitario != null) {
                    origUnit = orig.preco_unitario;
                } else if (orig.precoUnitario != null) {
                    origUnit = orig.precoUnitario;
                } else if (orig.preco_total != null && (orig.quantidade != null && orig.quantidade !== 0)) {
                    origUnit = orig.preco_total / (orig.quantidade || 1);
                } else {
                    origUnit = 0;
                }
            }
            const replPrice = Number(product.preco_venda || product.precoVenda || product.preco || 0) || 0;
            const diffPerUnit = replPrice - origUnit;
            const totalDiff = diffPerUnit * qty;
            if (!this.valueAdjustments[itemId]) this.valueAdjustments[itemId] = { type: null, amount: 0 };
            if (Math.abs(totalDiff) < 0.001) {
                this.valueAdjustments[itemId].type = null;
                this.valueAdjustments[itemId].amount = 0;
            } else if (totalDiff > 0) {
                this.valueAdjustments[itemId].type = 'charge';
                this.valueAdjustments[itemId].amount = Number(totalDiff.toFixed(2));
            } else {
                this.valueAdjustments[itemId].type = 'refund';
                this.valueAdjustments[itemId].amount = Number((Math.abs(totalDiff)).toFixed(2));
            }
        } catch (e) {
            console.warn('Erro ao calcular diferença de preço para troca', e);
        }
    }

    hideReplacementListDelayed(itemId: number): void {
        this.clearHideTimer(itemId);
        this.replacementHideTimer[itemId] = setTimeout(() => { this.showReplacementList[itemId] = false; this.clearHideTimer(itemId); }, 150);
    }

    clearHideTimer(itemId: number): void {
        const t = this.replacementHideTimer[itemId];
        if (t) {
            clearTimeout(t);
            delete this.replacementHideTimer[itemId];
        }
    }

    onDropdownMouseDown(itemId: number, event: MouseEvent): void {
        // prevent the input blur from immediately closing the dropdown when interacting with it
        event.preventDefault();
        this.clearHideTimer(itemId);
        this.showReplacementList[itemId] = true;
    }

    updateReplacementPagination(itemId: number): void {
        const list = this.replacementFiltered[itemId] || [];
        const page = this.replacementPage[itemId] || 0;
        const size = this.replacementPageSize;
        const totalPages = Math.max(1, Math.ceil(list.length / size));
        this.replacementTotalPages[itemId] = totalPages;
        const start = page * size;
        this.replacementVisible[itemId] = list.slice(start, start + size);
    }

    replacementPrev(itemId: number): void {
        const p = (this.replacementPage[itemId] || 0) - 1;
        this.replacementPage[itemId] = Math.max(0, p);
        this.updateReplacementPagination(itemId);
    }

    replacementNext(itemId: number): void {
        const p = (this.replacementPage[itemId] || 0) + 1;
        const max = (this.replacementTotalPages[itemId] || 1) - 1;
        this.replacementPage[itemId] = Math.min(max, p);
        this.updateReplacementPagination(itemId);
    }

    // Determine dropdown width based on longest item string and the input width
    private computeDropdownWidthForItems(items: any[], inputWidth: number): number {
        try {
            // crude measurement: estimate characters width ~8px and add padding
            let maxLabelLen = 0;
            for (const it of items) {
                const label = `${it.nome} R$ ${it.preco_venda}`;
                if (label.length > maxLabelLen) maxLabelLen = label.length;
            }
            const est = Math.max(inputWidth, Math.min(700, maxLabelLen * 8 + 80));
            return est;
        } catch {
            return inputWidth;
        }
    }

    confirmActions(): void {
        // for each selected item, call API
        const selected = Object.keys(this.selections).filter(k => this.selections[+k] !== 'none');
        const calls: any[] = [];
        for (const key of selected) {
            const itemId = Number(key);
            const action = this.selections[itemId];
            const qty = this.quantities[itemId] || 1;
            if (action === 'return') {
                calls.push(this.api.postSaleAdjustment(this.saleDetails.id, { type: 'return', saleItemId: itemId, quantity: qty, paymentMethod: 'dinheiro' }));
            } else if (action === 'exchange') {
                const replacementId = this.replacementProductIds[itemId];
                calls.push(this.api.postSaleAdjustment(this.saleDetails.id, { type: 'exchange', saleItemId: itemId, quantity: qty, replacementProductId: replacementId, paymentMethod: 'dinheiro' }));
            }
        }

        if (calls.length === 0) { alert('Nenhuma ação selecionada'); return; }

        // execute sequentially
        const obs = calls.reduce((prev, cur) => prev.then(() => cur.toPromise().catch(() => null)), Promise.resolve());
        obs.then(() => { alert('Ações processadas'); this.close.emit(); }).catch(() => { alert('Erro ao processar ações'); });
    }

    cancel(): void { this.close.emit(); }
}


