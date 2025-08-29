import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { CurrencyBrPipe } from '../../pipes/currency-br.pipe';
import { logger } from '../../utils/logger';

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
    saleItemByProdutoId: { [produtoId: number]: number } = {};
    saleItemOriginalQty: { [produtoId: number]: number } = {};

    replacementSearch: { [itemId: number]: string } = {};
    replacementFiltered: { [itemId: number]: any[] } = {};
    showReplacementList: { [itemId: number]: boolean } = {};
    replacementPosition: { [itemId: number]: { top?: string; left?: string; width?: string } } = {};
    replacementInputWidth: { [itemId: number]: number } = {};
    replacementHideTimer: { [itemId: number]: any } = {};
    replacementPage: { [itemId: number]: number } = {};
    replacementPageSize = 5;
    replacementTotalPages: { [itemId: number]: number } = {};
    replacementVisible: { [itemId: number]: any[] } = {};

    valueAdjustments: { [itemId: number]: { type: 'refund' | 'charge' | null, amount: number } } = {};

    paymentMethodByItem: { [itemId: number]: string } = {};
    notesByItem: { [itemId: number]: string } = {};
    paymentsByItem: { [itemId: number]: Array<{ metodo: string; valor: number }> } = {};
    private returnPaymentTouched: { [itemId: number]: boolean } = {};

    adjustedQuantities: { [saleItemId: number]: number } = {};
    remainingQuantityByProdutoId: { [produtoId: number]: number } = {};

    returnedQuantityBySaleItem: { [saleItemId: number]: number } = {};

    loading = false;
    submitting = false;

    constructor(private readonly api: ApiService) { }

    ngOnInit(): void { this.loadDetails(); }

    loadDetails(): void {
        this.loading = true;
        logger.debug('ADJ_FRONT', 'LOAD_DETAILS_START', 'Carregando detalhes da venda', { saleId: this.saleSummary?.id });
        this.api.getOrderById(this.saleSummary.id).subscribe({
            next: (r) => {
                logger.debug('ADJ_FRONT', 'LOAD_DETAILS_OK', 'Detalhes carregados', { saleId: this.saleSummary?.id, itens: (r.itens || []).length, adjustments: (r.adjustments || []).length });
                this.saleDetails = r;
                this.computeReturnedQuantities();
                (r.itens || []).forEach((it: any) => {
                    const prodId = Number(it.produto_id ?? it.produtoId ?? it.produto?.id ?? NaN);
                    this.selections[prodId] = 'none';
                    this.quantities[prodId] = it.quantidade ?? it.quantidade_vendida ?? it.quantity ?? 0;
                    this.replacementProductIds[prodId] = null;
                    this.replacementSearch[prodId] = '';
                    this.replacementFiltered[prodId] = [];
                    this.showReplacementList[prodId] = false;
                    this.valueAdjustments[prodId] = { type: null, amount: 0 };
                    const saleItemId = it.item_id ?? it.id ?? it.sale_item_id ?? it.saleItemId ?? null;
                    if (saleItemId != null) this.saleItemByProdutoId[prodId] = saleItemId;
                    this.saleItemOriginalQty[prodId] = this.quantities[prodId];
                    this.paymentMethodByItem[prodId] = 'dinheiro';
                    this.notesByItem[prodId] = '';
                    this.paymentsByItem[prodId] = [];
                    this.returnPaymentTouched[prodId] = false;
                });
                logger.debug('ADJ_FRONT', 'ITEMS_INIT', 'Itens inicializados', { count: (r.itens || []).length });
                try { this.computeAdjustedQuantities(); } catch { }
                this.api.getProdutos().subscribe({
                    next: (ps) => {
                        logger.debug('ADJ_FRONT', 'PRODUCTS_OK', 'Produtos disponíveis carregados', { count: (ps || []).length });
                        this.saleDetails.produtosDisponiveis = (ps || []).map((p: any) => ({ id: p.id, nome: p.nome, quantidade_estoque: p.quantidade_estoque, preco_venda: Number(p.preco_venda ?? p.precoVenda ?? p.preco) || 0 }));
                        (r.itens || []).forEach((it: any) => {
                            this.replacementFiltered[it.produto_id] = this.saleDetails.produtosDisponiveis || [];
                            this.replacementPage[it.produto_id] = 0;
                            this.updateReplacementPagination(it.produto_id);
                        });
                    }, error: () => { this.saleDetails.produtosDisponiveis = []; }
                });
                this.loading = false;
            },
            error: (e) => { this.loading = false; logger.error('ADJ_FRONT', 'LOAD_DETAILS_FAIL', 'Falha ao carregar detalhes', e); }
        });
    }

    private computeAdjustedQuantities(): void {
        this.adjustedQuantities = {};
        this.remainingQuantityByProdutoId = {};
        const adjustments = (this.saleDetails?.adjustments && Array.isArray(this.saleDetails.adjustments)) ? this.saleDetails.adjustments : [];
        for (const adj of adjustments) {
            try {
                const sid = adj.sale_item_id;
                const qty = Number(adj.quantity) || 0;
                if (sid != null) this.adjustedQuantities[sid] = (this.adjustedQuantities[sid] || 0) + qty;
            } catch { }
        }
        (this.saleDetails.itens || []).forEach((it: any) => {
            const prodId = Number(it.produto_id ?? it.produtoId ?? it.produto?.id ?? NaN);
            const saleItemId = it.item_id ?? it.id ?? it.sale_item_id ?? it.saleItemId ?? null;
            const origQty = Number(it.quantidade ?? it.quantidade_vendida ?? it.quantity ?? 0) || 0;
            const adjusted = saleItemId != null ? (this.adjustedQuantities[saleItemId] || 0) : 0;
            const remaining = Math.max(0, origQty - adjusted);
            this.remainingQuantityByProdutoId[prodId] = remaining;
            this.quantities[prodId] = Math.min(this.quantities[prodId] || 0, remaining) || remaining;
        });
    }

    private computeReturnedQuantities(): void {
        this.returnedQuantityBySaleItem = {};
        try {
            const adjs = Array.isArray(this.saleDetails?.adjustments) ? this.saleDetails.adjustments : [];
            for (const a of adjs) {
                if (a.type === 'return' && a.sale_item_id != null) {
                    const q = Number(a.quantity) || 0;
                    if (q > 0) this.returnedQuantityBySaleItem[a.sale_item_id] = (this.returnedQuantityBySaleItem[a.sale_item_id] || 0) + q;
                }
            }
        } catch { }
    }

    onReplacementFocus(itemId: number, event?: FocusEvent): void {
        this.showReplacementList[itemId] = true;
        this.replacementFiltered[itemId] = this.replacementFiltered[itemId] && this.replacementFiltered[itemId].length > 0 ? this.replacementFiltered[itemId] : (this.saleDetails?.produtosDisponiveis || []);
        this.replacementPage[itemId] ??= 0;
        this.clearHideTimer(itemId);
        this.updateReplacementPagination(itemId);
        try {
            const inputEl = (event?.target) as HTMLElement | null;
            if (inputEl) {
                const rect = inputEl.getBoundingClientRect();
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                const spaceBelow = viewportHeight - rect.bottom;
                const top = rect.bottom + window.scrollY;
                const left = rect.left + window.scrollX;
                this.replacementInputWidth[itemId] = rect.width;
                if (spaceBelow < 220) {
                    const aboveTop = rect.top + window.scrollY - Math.min(260, rect.height + 12) - 6;
                    const w = this.computeDropdownWidthForItems(this.replacementFiltered[itemId] || [], rect.width);
                    this.replacementPosition[itemId] = { top: `${aboveTop}px`, left: `${left}px`, width: `${w}px` };
                } else {
                    const w = this.computeDropdownWidthForItems(this.replacementFiltered[itemId] || [], rect.width);
                    this.replacementPosition[itemId] = { top: `${top}px`, left: `${left}px`, width: `${w}px` };
                }
            }
        } catch { }
    }

    onReplacementSearch(itemId: number): void {
        const q = (this.replacementSearch[itemId] || '').toLowerCase();
        const all = this.saleDetails?.produtosDisponiveis || [];
        this.replacementFiltered[itemId] = !q ? all : all.filter((p: any) => (p.nome || '').toLowerCase().includes(q));
        this.replacementPage[itemId] = 0;
        this.updateReplacementPagination(itemId);
    }

    selectReplacement(itemId: number, product: any): void {
        this.replacementProductIds[itemId] = product.id;
        this.replacementSearch[itemId] = product.nome;
        this.showReplacementList[itemId] = false;
        this.replacementFiltered[itemId] = this.saleDetails?.produtosDisponiveis || [];
        this.updateReplacementPagination(itemId);
        try {
            this.selections[itemId] = 'exchange';
            const qty = this.quantities[itemId] || 1;
            const orig = (this.saleDetails && Array.isArray(this.saleDetails.itens)) ? this.saleDetails.itens.find((it: any) => it.produto_id === itemId || it.produtoId === itemId) : null;
            let origUnit = 0;
            if (orig) {
                if (orig.preco_unitario != null) origUnit = orig.preco_unitario;
                else if (orig.precoUnitario != null) origUnit = orig.precoUnitario;
                else if (orig.preco_total != null && (orig.quantidade != null && orig.quantidade !== 0)) origUnit = orig.preco_total / (orig.quantidade || 1);
            }
            const replPrice = Number(product.preco_venda || product.precoVenda || product.preco || 0) || 0;
            const diffPerUnit = replPrice - origUnit;
            const totalDiff = diffPerUnit * qty;
            if (!this.valueAdjustments[itemId]) this.valueAdjustments[itemId] = { type: null, amount: 0 };
            if (Math.abs(totalDiff) < 0.001) { this.valueAdjustments[itemId].type = null; this.valueAdjustments[itemId].amount = 0; }
            else if (totalDiff > 0) { this.valueAdjustments[itemId].type = 'charge'; this.valueAdjustments[itemId].amount = Number(totalDiff.toFixed(2)); }
            else { this.valueAdjustments[itemId].type = 'refund'; this.valueAdjustments[itemId].amount = Number((Math.abs(totalDiff)).toFixed(2)); }
        } catch (e) { console.warn('Erro ao calcular diferença de preço para troca', e); }
    }

    getUnitPrice(item: any): number {
        if (!item) return 0;
        if (item.preco_unitario != null) return item.preco_unitario;
        if (item.precoUnitario != null) return item.precoUnitario;
        if (item.preco_total != null && item.quantidade != null && item.quantidade !== 0) return item.preco_total / item.quantidade;
        return 0;
    }
    getUnitPriceTooltip(item: any): string { const val = this.getUnitPrice(item) || 0; try { return (val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); } catch { return `R$ ${val.toFixed(2)}`; } }

    hideReplacementListDelayed(itemId: number): void { this.clearHideTimer(itemId); this.replacementHideTimer[itemId] = setTimeout(() => { this.showReplacementList[itemId] = false; this.clearHideTimer(itemId); }, 150); }
    clearHideTimer(itemId: number): void { const t = this.replacementHideTimer[itemId]; if (t) { clearTimeout(t); delete this.replacementHideTimer[itemId]; } }
    onDropdownMouseDown(itemId: number, event: MouseEvent): void { event.preventDefault(); this.clearHideTimer(itemId); this.showReplacementList[itemId] = true; }

    toggleSelection(itemId: number, val: 'none' | 'return' | 'exchange', ev: any): void {
        try { ev.preventDefault(); ev.stopPropagation(); } catch { }
        if (this.selections[itemId] === val) this.selections[itemId] = 'none'; else this.selections[itemId] = val;
        if (this.selections[itemId] === 'return') this.autoComputeReturnPayment(itemId);
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
    replacementPrev(itemId: number): void { const p = (this.replacementPage[itemId] || 0) - 1; this.replacementPage[itemId] = Math.max(0, p); this.updateReplacementPagination(itemId); }
    replacementNext(itemId: number): void { const p = (this.replacementPage[itemId] || 0) + 1; const max = (this.replacementTotalPages[itemId] || 1) - 1; this.replacementPage[itemId] = Math.min(max, p); this.updateReplacementPagination(itemId); }

    private computeDropdownWidthForItems(items: any[], inputWidth: number): number { try { let maxLabelLen = 0; for (const it of items) { const label = `${it.nome} R$ ${it.preco_venda}`; if (label.length > maxLabelLen) maxLabelLen = label.length; } return Math.max(inputWidth, Math.min(700, maxLabelLen * 8 + 80)); } catch { return inputWidth; } }

    confirmActions(): void {
        if (this.submitting) return;
        const selectedIds = Object.keys(this.selections).filter(k => this.selections[+k] !== 'none');
        if (selectedIds.length === 0) { alert('Nenhuma ação selecionada'); return; }
        const correlation = this.generateCorrelationId();
        const calls: any[] = [];
        for (const k of selectedIds) { const pid = Number(k); const action = this.selections[pid]; const call = this.prepareAdjustment(pid, action, correlation); if (call) calls.push(call); }
        if (calls.length === 0) { alert('Nenhuma ação válida'); return; }
        this.submitting = true;
        logger.info('ADJ_FRONT', 'BATCH_START', 'Enviando ajustes', { count: calls.length, correlation });
        const promises = calls.map(o => lastValueFrom(o).then((v: any) => ({ status: 'fulfilled', value: v })).catch((e: any) => ({ status: 'rejected', reason: e }))); Promise.all(promises).then(r => this.handleBatchResults(r)).catch(() => alert('Erro ao processar ações'));
    }

    private prepareAdjustment(produtoKey: number, action: string, correlation: string) {
        logger.debug('ADJ_FRONT', 'PROCESS_SELECTION', 'Processando seleção', { produtoKey, action, correlation });
        let saleItemId = this.saleItemByProdutoId[produtoKey] || null;
        if ((!saleItemId) && Array.isArray(this.saleDetails?.itens)) {
            const found = this.saleDetails!.itens.find((it: any) => it.produto_id === produtoKey || it.produtoId === produtoKey);
            saleItemId = found ? (found.item_id ?? found.id ?? null) : null;
        }
        if (!saleItemId) { logger.warn('ADJ_FRONT', 'SALE_ITEM_ID_RESOLVE_FAIL', 'Falha ao resolver sale item id', { produtoKey }); alert('Não foi possível identificar o item da venda.'); return null; }
        let qty = Number(this.quantities[produtoKey]) || 1;
        const remaining = this.remainingQuantityByProdutoId[produtoKey];
        if (remaining != null && qty > remaining) { qty = remaining; this.quantities[produtoKey] = remaining; }
        const origItem = Array.isArray(this.saleDetails?.itens) ? this.saleDetails!.itens.find((it: any) => (it.id === saleItemId || it.item_id === saleItemId || it.produto_id === produtoKey || it.produtoId === produtoKey)) : null;
        const origQty = origItem ? (origItem.quantidade ?? origItem.quantidade_vendida ?? origItem.quantity ?? 0) : undefined;
        if (origQty !== undefined && qty > origQty) { qty = origQty; this.quantities[produtoKey] = origQty; alert(`Quantidade solicitada maior que a vendida; ajustei para ${origQty}.`); }
        if (action === 'return') return this.buildReturnCall(produtoKey, saleItemId, qty, correlation);
        if (action === 'exchange') return this.buildExchangeCall(produtoKey, saleItemId, qty, correlation);
        return null;
    }

    onQuantityChange(produtoId: number): void { if (this.selections[produtoId] === 'return') this.autoComputeReturnPayment(produtoId); else if (this.selections[produtoId] === 'exchange') { const replId = this.replacementProductIds[produtoId]; if (replId) { const product = (this.saleDetails?.produtosDisponiveis || []).find((p: any) => p.id === replId); if (product) this.selectReplacement(produtoId, product); } } }

    private getSaleItemByProduto(produtoId: number): any { return Array.isArray(this.saleDetails?.itens) ? this.saleDetails!.itens.find((it: any) => (it.produto_id === produtoId || it.produtoId === produtoId)) : null; }
    private computeReturnRefundAmount(produtoId: number): number {
        const it = this.getSaleItemByProduto(produtoId);
        if (!it) return 0;
        const unit = this.getUnitPrice(it);
        const qty = Number(this.quantities[produtoId]) || 0;
        return Number((unit * qty).toFixed(2));
    }
    autoComputeReturnPayment(produtoId: number, explicitButton = false): void { try { const amount = this.computeReturnRefundAmount(produtoId); if (!this.returnPaymentTouched[produtoId] || explicitButton) { this.paymentsByItem[produtoId] = amount > 0 ? [{ metodo: 'dinheiro', valor: amount }] : []; this.paymentMethodByItem[produtoId] = 'dinheiro'; logger.debug('ADJ_FRONT', 'RETURN_AUTOFILL', 'Preenchimento automático de reembolso', { produtoId, amount, explicit: explicitButton }); } } catch (e) { logger.warn('ADJ_FRONT', 'RETURN_AUTOFILL_FAIL', 'Falha ao auto calcular reembolso', { produtoId, e }); } }
    getReturnRefundDisplay(produtoId: number): number { return this.computeReturnRefundAmount(produtoId); }
    markReturnPaymentTouched(produtoId: number): void { this.returnPaymentTouched[produtoId] = true; }

    private buildReturnCall(produtoKey: number, saleItemId: number, qty: number, correlation: string) {
        const origCheck = Array.isArray(this.saleDetails?.itens) ? this.saleDetails!.itens.find((it: any) => (it.item_id === saleItemId || it.id === saleItemId || it.produto_id === produtoKey)) : null;
        const origQtyCheck = origCheck ? (origCheck.quantidade ?? origCheck.quantidade_vendida ?? origCheck.quantity ?? 0) : undefined;
        if (origQtyCheck === undefined) { alert('Não foi possível validar quantidade original.'); return null; }
        if (qty > origQtyCheck) { alert(`Quantidade a devolver maior que a vendida (solicitado: ${qty}, vendido: ${origQtyCheck})`); return null; }
        const paymentsList = (this.paymentsByItem[produtoKey] || []).map(p => ({ metodo: p.metodo, valor: Number(p.valor || 0) }));
        const sumPayments = paymentsList.reduce((a, b) => a + (b.valor || 0), 0);
        const payload: any = { correlationId: correlation, type: 'return', saleItemId, quantity: Number(qty), paymentMethod: this.paymentMethodByItem[produtoKey] || 'dinheiro', notes: this.notesByItem[produtoKey] || '', payments: paymentsList };
        if (sumPayments <= 0.001) { delete payload.payments; logger.debug('ADJ_FRONT', 'RETURN_PAYMENTS_OMITTED', 'Pagamentos omitidos para fallback backend', { produtoKey, saleItemId, qty }); }
        logger.debug('ADJ_FRONT', 'RETURN_POST_PAYLOAD', 'Payload de devolução', payload);
        return this.api.postSaleAdjustment(this.saleDetails.id, payload);
    }

    private buildExchangeCall(produtoKey: number, saleItemId: number, qty: number, correlation: string) {
        const replacementId = this.replacementProductIds[produtoKey];
        const origCheck = Array.isArray(this.saleDetails?.itens) ? this.saleDetails!.itens.find((it: any) => (it.item_id === saleItemId || it.id === saleItemId || it.produto_id === produtoKey)) : null;
        const origQtyCheck = origCheck ? (origCheck.quantidade ?? origCheck.quantidade_vendida ?? origCheck.quantity ?? 0) : undefined;
        if (origQtyCheck === undefined) { alert('Não foi possível validar quantidade original.'); return null; }
        if (qty > origQtyCheck) { alert(`Quantidade a devolver maior que a vendida (solicitado: ${qty}, vendido: ${origQtyCheck})`); return null; }
        const adjPayload: any = { correlationId: correlation, type: 'exchange', saleItemId, quantity: qty, replacementProductId: replacementId, paymentMethod: this.paymentMethodByItem[produtoKey] || 'dinheiro', notes: this.notesByItem[produtoKey] || '', payments: (this.paymentsByItem[produtoKey] || []).map(p => ({ metodo: p.metodo, valor: Number(p.valor || 0) })) };
        const va = this.valueAdjustments[produtoKey];
        if (va?.amount && va.type) adjPayload.priceDifference = va.type === 'charge' ? Number(va.amount) : -Number(va.amount);
        logger.debug('ADJ_FRONT', 'EXCHANGE_POST_PAYLOAD', 'Payload de troca', adjPayload);
        return this.api.postSaleAdjustment(this.saleDetails.id, adjPayload);
    }

    private handleBatchResults(results: any[]) {
        logger.debug('ADJ_FRONT', 'BATCH_RESULTS', 'Resultados das requisições', { results });
        const rejected = results.filter(r => r.status === 'rejected');
        if (rejected.length === 0) {
            logger.info('ADJ_FRONT', 'ACTIONS_SUCCESS', 'Todas ações processadas com sucesso');
            this.loadDetails(); alert('Ajustes processados com sucesso'); this.close.emit();
        } else {
            logger.warn('ADJ_FRONT', 'ACTIONS_FAILURE', 'Falhas ao processar ações', { rejected });
            const first = rejected[0]; let msg = 'Erro ao processar ações';
            try { const err = first.reason; if (err?.error?.error) msg = String(err.error.error); else if (err?.message) msg = String(err.message); } catch { }
            alert(msg);
        }
        this.submitting = false;
    }

    private generateCorrelationId(): string { return 'FR-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8); }
    cancel(): void { this.close.emit(); }

    isItemFullyReturned(item: any): boolean {
        const saleItemId = item.item_id ?? item.id ?? item.sale_item_id ?? item.saleItemId;
        if (saleItemId == null) return false;
        const orig = Number(item.quantidade ?? item.quantidade_vendida ?? item.quantity ?? 0) || 0;
        const ret = this.returnedQuantityBySaleItem[saleItemId] || 0;
        return ret >= orig && orig > 0;
    }

    getReturnedPartialInfo(item: any): string | null {
        const saleItemId = item.item_id ?? item.id ?? item.sale_item_id ?? item.saleItemId;
        if (saleItemId == null) return null;
        const orig = Number(item.quantidade ?? item.quantidade_vendida ?? item.quantity ?? 0) || 0;
        if (orig === 0) return null;
        const ret = this.returnedQuantityBySaleItem[saleItemId] || 0;
        if (ret === 0) return null;
        if (ret >= orig) return 'Devolvido';
        return ret + '/' + orig + ' devolvido';
    }
}
