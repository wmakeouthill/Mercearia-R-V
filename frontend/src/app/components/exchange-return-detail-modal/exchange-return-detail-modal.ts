import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { lastValueFrom } from 'rxjs';
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
    // map produto_id -> sale item id (backend sale item id)
    saleItemByProdutoId: { [produtoId: number]: number } = {};
    // original sold quantities per produto_id (from saleDetails.itens)
    saleItemOriginalQty: { [produtoId: number]: number } = {};

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

    // payment method and notes per sale item
    paymentMethodByItem: { [itemId: number]: string } = {};
    notesByItem: { [itemId: number]: string } = {};
    // multiple payments per item: map saleItemId -> array of { metodo, valor }
    paymentsByItem: { [itemId: number]: Array<{ metodo: string; valor: number }> } = {};

    // adjusted quantities already applied (sale_item_id -> adjusted qty)
    adjustedQuantities: { [saleItemId: number]: number } = {};
    remainingQuantityByProdutoId: { [produtoId: number]: number } = {};

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
                    const prodId = Number(it.produto_id ?? it.produtoId ?? (it.produto && it.produto.id) ?? NaN);
                    this.selections[prodId] = 'none';
                    this.quantities[prodId] = it.quantidade ?? it.quantidade_vendida ?? it.quantity ?? 0;
                    this.replacementProductIds[prodId] = null;
                    this.replacementSearch[prodId] = '';
                    this.replacementFiltered[prodId] = [];
                    this.showReplacementList[prodId] = false;
                    this.valueAdjustments[prodId] = { type: null, amount: 0 };
                    // record mapping from produto_id to sale item id (backend) using multiple possible keys
                    const saleItemId = it.item_id ?? it.id ?? it.sale_item_id ?? it.saleItemId ?? null;
                    if (saleItemId != null) this.saleItemByProdutoId[prodId] = saleItemId;
                    // record original sold quantity
                    this.saleItemOriginalQty[prodId] = this.quantities[prodId];
                    // defaults
                    this.paymentMethodByItem[prodId] = 'dinheiro';
                    this.notesByItem[prodId] = '';
                    this.paymentsByItem[prodId] = [{ metodo: 'dinheiro', valor: 0 }];
                });
                console.debug('saleDetails.itens loaded', r.itens);
                // compute already applied adjustments to clamp quantities
                try {
                    this.computeAdjustedQuantities();
                } catch (e) { /* ignore */ }
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

    private computeAdjustedQuantities(): void {
        this.adjustedQuantities = {};
        this.remainingQuantityByProdutoId = {};
        const adjustments = (this.saleDetails && Array.isArray(this.saleDetails.adjustments)) ? this.saleDetails.adjustments : [];
        for (const adj of adjustments) {
            try {
                const sid = adj.sale_item_id;
                const qty = Number(adj.quantity) || 0;
                if (sid != null) {
                    this.adjustedQuantities[sid] = (this.adjustedQuantities[sid] || 0) + qty;
                }
            } catch { /* ignore malformed */ }
        }
        // compute remaining per produto_id by matching sale items
        (this.saleDetails.itens || []).forEach((it: any) => {
            const prodId = Number(it.produto_id ?? it.produtoId ?? (it.produto && it.produto.id) ?? NaN);
            const saleItemId = it.item_id ?? it.id ?? it.sale_item_id ?? it.saleItemId ?? null;
            const origQty = Number(it.quantidade ?? it.quantidade_vendida ?? it.quantity ?? 0) || 0;
            const adjusted = saleItemId != null ? (this.adjustedQuantities[saleItemId] || 0) : 0;
            const remaining = Math.max(0, origQty - adjusted);
            this.remainingQuantityByProdutoId[prodId] = remaining;
            // ensure quantities input clamps to remaining
            this.quantities[prodId] = Math.min(this.quantities[prodId] || 0, remaining) || remaining;
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
            const qty = this.quantities[itemId] || 1; // fixed: use itemId here
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

    getUnitPrice(item: any): number {
        if (!item) return 0;
        if (item.preco_unitario != null) return item.preco_unitario;
        if (item.precoUnitario != null) return item.precoUnitario;
        if (item.preco_total != null && item.quantidade != null && item.quantidade !== 0) return item.preco_total / item.quantidade;
        return 0;
    }

    getUnitPriceTooltip(item: any): string {
        const val = this.getUnitPrice(item) || 0;
        try { return (val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); } catch { return `R$ ${val.toFixed(2)}`; }
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

    toggleSelection(itemId: number, val: 'none' | 'return' | 'exchange', ev: MouseEvent): void {
        try {
            ev.preventDefault();
            ev.stopPropagation();
        } catch { }
        if (this.selections[itemId] === val) {
            this.selections[itemId] = 'none';
        } else {
            this.selections[itemId] = val;
        }
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
            const produtoKey = Number(key);
            const action = this.selections[produtoKey];
            // saleItemId expected by backend must be the sale_item id, not produto id
            // resolve saleItemId from saleDetails.itens; do NOT fallback to produtoKey to avoid sending wrong id
            let saleItemId = this.saleItemByProdutoId[produtoKey] || null;
            if ((!saleItemId || saleItemId == null) && this.saleDetails && Array.isArray(this.saleDetails.itens)) {
                const found = this.saleDetails.itens.find((it: any) => it.produto_id === produtoKey || it.produtoId === produtoKey);
                if (found) {
                    saleItemId = found.item_id ?? found.id ?? null;
                }
            }
            if (!saleItemId) {
                console.debug('saleDetails.itens for debugging identify failure', this.saleDetails?.itens, { produtoKey });
                alert('Não foi possível identificar o item de venda correspondente para o produto selecionado. Ação ignorada. Por favor, cole o conteúdo de saleDetails.itens do console para eu analisar.');
                continue;
            }
            let qty = Number(this.quantities[produtoKey]) || 1;
            // validate against original sold quantity before sending
            let origItem: any = null;
            if (this.saleDetails && Array.isArray(this.saleDetails.itens)) {
                origItem = this.saleDetails.itens.find((it: any) => (it.id === saleItemId || it.item_id === saleItemId || it.produto_id === produtoKey || it.produtoId === produtoKey));
            }
            const origQty = origItem ? (origItem.quantidade ?? origItem.quantidade_vendida ?? origItem.quantity ?? 0) : undefined;
            if (origQty !== undefined && qty > origQty) {
                // auto-clamp to original sold quantity and notify user
                const old = qty;
                qty = origQty;
                console.info(`Quantidade solicitada (${old}) maior que vendida; ajustada para ${origQty}`);
                // lightweight user feedback
                alert(`Quantidade solicitada era maior que a vendida; ajustei para ${origQty}.`);
            }
            // debug: log original item qty if available
            try {
                const orig = (this.saleDetails && Array.isArray(this.saleDetails.itens)) ? this.saleDetails.itens.find((it: any) => ((it.item_id ?? it.id) === saleItemId || it.produto_id === produtoKey || it.produtoId === produtoKey)) : null;
                console.debug('Adjusting sale item', { produtoKey, saleItemId, requestedQty: qty, originalQty: orig ? orig.quantidade : undefined, origItem: orig });
            } catch (e) { console.debug('Debug failed', e); }
            if (action === 'return') {
                // re-check original sold quantity server-side snapshot from saleDetails
                const origCheck = (this.saleDetails && Array.isArray(this.saleDetails.itens)) ? this.saleDetails.itens.find((it: any) => (it.item_id === saleItemId || it.id === saleItemId || it.produto_id === produtoKey)) : null;
                const origQtyCheck = origCheck ? (origCheck.quantidade ?? origCheck.quantidade_vendida ?? origCheck.quantity ?? 0) : undefined;
                console.debug('Return check', { produtoKey, saleItemId, requestedQty: Number(qty), origQtyCheck, origCheck });
                if (origQtyCheck === undefined) { alert('Não foi possível validar quantidade original da venda. Ação cancelada.'); continue; }
                if (Number(qty) > origQtyCheck) { alert(`Quantidade a devolver maior que a vendida (solicitado: ${qty}, vendido: ${origQtyCheck})`); continue; }
                const payload = {
                    type: 'return',
                    saleItemId: saleItemId,
                    quantity: Number(qty),
                    paymentMethod: this.paymentMethodByItem[produtoKey] || 'dinheiro',
                    notes: this.notesByItem[produtoKey] || '',
                    payments: (this.paymentsByItem[produtoKey] || []).map(p => ({ metodo: p.metodo, valor: Number(p.valor || 0) }))
                };
                console.debug('POST adjustment payload', payload);
                calls.push(this.api.postSaleAdjustment(this.saleDetails.id, payload));
            } else if (action === 'exchange') {
                const replacementId = this.replacementProductIds[produtoKey];
                // include priceDifference if user set it in valueAdjustments
                const adjPayload: any = {
                    type: 'exchange',
                    saleItemId: saleItemId,
                    quantity: qty,
                    replacementProductId: replacementId,
                    paymentMethod: this.paymentMethodByItem[produtoKey] || 'dinheiro',
                    notes: this.notesByItem[produtoKey] || '',
                    payments: (this.paymentsByItem[produtoKey] || []).map(p => ({ metodo: p.metodo, valor: Number(p.valor || 0) }))
                };
                const va = this.valueAdjustments[produtoKey];
                if (va && va.amount && va.type) {
                    adjPayload.priceDifference = va.type === 'charge' ? Number(va.amount) : -Number(va.amount);
                }
                // check original qty for exchange as well
                const origCheck2 = (this.saleDetails && Array.isArray(this.saleDetails.itens)) ? this.saleDetails.itens.find((it: any) => (it.item_id === saleItemId || it.id === saleItemId || it.produto_id === produtoKey)) : null;
                const origQtyCheck2 = origCheck2 ? (origCheck2.quantidade ?? origCheck2.quantidade_vendida ?? origCheck2.quantity ?? 0) : undefined;
                console.debug('Exchange check', { produtoKey, saleItemId, requestedQty: Number(qty), origQtyCheck2, origCheck2 });
                if (origQtyCheck2 === undefined) { alert('Não foi possível validar quantidade original da venda. Ação cancelada.'); continue; }
                if (Number(qty) > origQtyCheck2) { alert(`Quantidade a devolver maior que a vendida (solicitado: ${qty}, vendido: ${origQtyCheck2})`); continue; }
                console.debug('POST adjustment payload', adjPayload);
                calls.push(this.api.postSaleAdjustment(this.saleDetails.id, adjPayload));
            }
        }

        if (calls.length === 0) { alert('Nenhuma ação selecionada'); return; }

        // execute all and surface errors to the user
        const promises = calls.map((obs: any) => lastValueFrom(obs).then((r: any) => ({ status: 'fulfilled', value: r })).catch((e: any) => ({ status: 'rejected', reason: e })));
        Promise.all(promises).then((results: any[]) => {
            const rejected = results.filter(r => r.status === 'rejected');
            if (rejected.length === 0) {
                alert('Ações processadas');
                this.close.emit();
            } else {
                // try to extract server message from first rejection
                const first = rejected[0];
                let msg = 'Erro ao processar ações';
                try {
                    const err = first.reason;
                    if (err && err.error && err.error.error) msg = String(err.error.error);
                    else if (err && err.message) msg = String(err.message);
                } catch {
                    /* ignore */
                }
                alert(msg);
            }
        }).catch(() => { alert('Erro ao processar ações'); });
    }

    cancel(): void { this.close.emit(); }
}


