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
                this.api.getProdutos().subscribe({ next: (ps) => { this.saleDetails.produtosDisponiveis = (ps || []).map((p: any) => ({ id: p.id, nome: p.nome, quantidade_estoque: p.quantidade_estoque })); }, error: () => { this.saleDetails.produtosDisponiveis = []; } });
                this.loading = false;
            }, error: () => { this.loading = false; }
        });
    }

    onReplacementFocus(itemId: number): void {
        this.showReplacementList[itemId] = true;
        this.replacementFiltered[itemId] = this.saleDetails?.produtosDisponiveis || [];
    }

    onReplacementSearch(itemId: number): void {
        const q = (this.replacementSearch[itemId] || '').toLowerCase();
        if (!q) {
            this.replacementFiltered[itemId] = this.saleDetails.produtosDisponiveis || [];
            return;
        }
        this.replacementFiltered[itemId] = (this.saleDetails.produtosDisponiveis || []).filter((p: any) => (p.nome || '').toLowerCase().includes(q));
    }

    selectReplacement(itemId: number, product: any): void {
        this.replacementProductIds[itemId] = product.id;
        this.replacementSearch[itemId] = product.nome;
        this.showReplacementList[itemId] = false;
    }

    hideReplacementListDelayed(itemId: number): void {
        setTimeout(() => { this.showReplacementList[itemId] = false; }, 150);
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


