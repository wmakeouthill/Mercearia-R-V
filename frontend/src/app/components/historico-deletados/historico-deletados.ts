import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { logger } from '../../utils/logger';
import { MetodoPagamento } from '../../models';
import { formatDateBR, parseDate } from '../../utils/date-utils';

@Component({
    selector: 'app-historico-deletados',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './historico-deletados.html',
    styleUrl: './historico-deletados.scss'
})
export class HistoricoDeletadosComponent implements OnInit {
    loading = false;
    error = '';
    deletions: any[] = [];
    vendasFiltradas: any[] = [];
    expandedRows = new Set<string>();
    // pagination
    page = 1;
    pageSize: 20 | 50 | 100 = 20;
    total = 0;
    hasNext = false;
    jumpPage: number | null = null;

    get totalPages(): number {
        const pages = Math.ceil((Number(this.total) || 0) / Number(this.pageSize || 1));
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
        this.loadDeletions();
    }
    nextPage() { if (this.page < this.totalPages) this.goToPage(this.page + 1); }
    prevPage() { if (this.page > 1) this.goToPage(this.page - 1); }
    goBy(delta: number): void { this.goToPage(this.page + delta); }
    goToFirstPage(): void { this.goToPage(1); }
    goToLastPage(): void { this.goToPage(this.totalPages); }
    setPageSize(n: 20 | 50 | 100) { this.pageSize = n; this.page = 1; this.loadDeletions(); }

    onJumpToPage(): void {
        if (this.jumpPage == null) return;
        this.goToPage(this.jumpPage);
    }

    onClickPage(p: number | string): void {
        if (typeof p === 'number') this.goToPage(p);
    }

    constructor(
        private readonly apiService: ApiService,
        public readonly authService: AuthService,
        private readonly imageService: ImageService,
        private readonly router: Router
    ) { }

    ngOnInit(): void {
        this.loadDeletions();
    }

    private loadDeletions(): void {
        this.loading = true;
        this.error = '';
        this.apiService.getDeletedSalesPage(this.page - 1, this.pageSize).subscribe({
            next: (resp: any) => {
                const items = resp?.items || [];
                this.deletions = items;
                this.total = Number(resp?.total || 0);
                this.hasNext = !!resp?.hasNext;
                this.vendasFiltradas = this.mapDeletionsToVendas(this.deletions);
                this.loading = false;
            },
            error: (err) => {
                logger.error('HISTORICO_DELETADOS', 'LOAD', 'Erro ao carregar auditoria', err);
                this.error = err?.error?.error || 'Erro ao carregar auditoria';
                this.loading = false;
            }
        });
    }



    private mapDeletionsToVendas(deletions: any[]): any[] {
        const rows: any[] = [];
        let rowCounter = 0;
        for (const d of deletions || []) {
            const saleType = d.saleType || 'legacy';
            let payload: any = null;
            try { payload = JSON.parse(d.payload); } catch { payload = d.payload; }
            if (saleType === 'checkout' && payload && Array.isArray(payload.itens)) {
                const pagamentos = Array.isArray(payload.pagamentos) ? payload.pagamentos : [];
                const metodoResumo = this.buildPagamentoResumo(pagamentos.map((p: any) => ({ metodo: p.metodo, valor: p.valor })));
                const metodosSet = new Set<MetodoPagamento>();
                for (const p of pagamentos) if (p?.metodo) metodosSet.add(p.metodo);

                const itens = payload.itens || [];
                const totalQuantidade = Array.isArray(itens) ? itens.reduce((s: number, it: any) => s + (Number(it.quantidade) || 0), 0) : 0;
                let totalValor = Number(payload.total_final ?? payload.totalFinal ?? payload.total ?? 0) || 0;
                if (!totalValor) {
                    totalValor = Array.isArray(itens) ? itens.reduce((s: number, it: any) => s + (Number(it.preco_total || it.precoTotal) || 0), 0) : 0;
                }

                const produtoNome = Array.isArray(itens) && itens.length > 0
                    ? itens.map((it: any) => it.produto_nome || it.produtoNome || '').join(', ')
                    : (`Pedido #${payload.id || d.saleId}`);

                const linha: any = {
                    id: payload.id || d.saleId,
                    produto_id: payload.id || d.saleId,
                    quantidade_vendida: totalQuantidade,
                    preco_total: totalValor,
                    data_venda: payload.data_venda || payload.dataVenda || '',
                    metodo_pagamento: 'dinheiro',
                    produto_nome: produtoNome,
                    produto_imagem: (itens[0] && (itens[0].produto_imagem || itens[0].produtoImagem)) || null,
                    pagamentos_resumo: metodoResumo,
                };
                (linha as any).itens = itens;
                (linha as any).metodos_multi = Array.from(metodosSet);
                (linha as any)._isCheckout = true;
                (linha as any).row_id = `deleted-checkout-${payload.id || d.saleId}-${rowCounter++}`;
                (linha as any)._deletionId = d.id;
                rows.push(linha);
            } else if (payload) {
                // legacy single sale -> wrap into itens array for expand
                const itens = [{
                    produto_id: payload.produto_id || payload.produtoId || 0,
                    produto_nome: payload.produto_nome || payload.produtoNome || '',
                    quantidade: payload.quantidade_vendida || payload.quantidade || 0,
                    preco_unitario: payload.preco_unitario || payload.precoUnitario || 0,
                    preco_total: payload.preco_total || payload.precoTotal || 0,
                    produto_imagem: payload.produto_imagem || payload.produtoImagem || null
                }];

                const linha: any = {
                    id: payload.id || d.saleId,
                    produto_id: payload.produto_id || payload.produtoId || 0,
                    quantidade_vendida: payload.quantidade_vendida || payload.quantidade || 0,
                    preco_total: payload.preco_total || payload.precoTotal || 0,
                    data_venda: payload.data_venda || payload.dataVenda || '',
                    metodo_pagamento: payload.metodo_pagamento || payload.metodoPagamento || 'dinheiro',
                    produto_nome: payload.produto_nome || payload.produtoNome || ('Produto #' + (payload.produto_id || payload.produtoId || '')),
                    produto_imagem: payload.produto_imagem || payload.produtoImagem || null,
                };
                (linha as any).itens = itens;
                (linha as any)._isCheckout = false;
                (linha as any).row_id = `deleted-legacy-${linha.id}-${rowCounter++}`;
                (linha as any)._deletionId = d.id;
                rows.push(linha);
            }
        }

        return rows.sort((a, b) => {
            try {
                const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
                if (timeDiff !== 0) return timeDiff;
            } catch { }
            return (b.id || 0) - (a.id || 0);
        });
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
                const nomes: any = {
                    'dinheiro': 'Dinheiro',
                    'cartao_credito': 'Cartão de Crédito',
                    'cartao_debito': 'Cartão de Débito',
                    'pix': 'PIX'
                };
                const valorFmt = v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                partes.push(`${nomes[m] || m} R$ ${valorFmt}`);
            }
        }
        return partes.join(' + ');
    }

    getImageUrl(imageName: string | null | undefined): string {
        return this.imageService.getImageUrl(imageName);
    }

    onImageError(event: any): void {
        const fallbackUrl = this.imageService.getImageUrl(null);
        if (event.target.src !== fallbackUrl) {
            event.target.src = fallbackUrl;
        }
    }

    formatarData(data: string): string {
        return formatDateBR(data, true);
    }

    voltarAoHistorico(): void {
        this.router.navigate(['/vendas/historico']);
    }

    formatPayload(payload: string): string {
        try {
            const obj = JSON.parse(payload);
            return JSON.stringify(obj, null, 2);
        } catch {
            return payload || '';
        }
    }

    restoreDeletion(deletionId: number): void {
        logger.debug('HISTORICO_DELETADOS', 'RESTORE_CLICK', 'restoreDeletion called', { deletionId, isAdmin: this.authService.isAdmin() });
        if (!this.authService.isAdmin()) {
            this.error = 'Permissão negada: somente administradores podem restaurar vendas';
            logger.warn('HISTORICO_DELETADOS', 'RESTORE_DENIED', 'Usuário não é admin');
            return;
        }
        if (!deletionId) {
            this.error = 'ID de deleção inválido';
            logger.warn('HISTORICO_DELETADOS', 'RESTORE_INVALID_ID', 'deletionId ausente');
            return;
        }

        this.loading = true;
        this.error = '';
        this.apiService.restoreDeletedSale(deletionId).subscribe({
            next: () => {
                logger.debug('HISTORICO_DELETADOS', 'RESTORE_SUCCESS', 'Restauração bem sucedida', { deletionId });
                this.loadDeletions();
            },
            error: (err) => {
                logger.error('HISTORICO_DELETADOS', 'RESTORE', 'Erro ao restaurar venda', err);
                this.error = err?.error?.error || 'Falha ao restaurar venda';
                this.loading = false;
            }
        });
    }

    deleteAuditRecord(deletionId: number): void {
        if (!this.authService.isAdmin()) {
            this.error = 'Permissão negada: somente administradores podem excluir registros de auditoria';
            return;
        }
        if (!deletionId) return;
        this.loading = true;
        this.apiService.deleteAuditSale(deletionId).subscribe({
            next: () => {
                this.loadDeletions();
            },
            error: (err) => {
                logger.error('HISTORICO_DELETADOS', 'DELETE_AUDIT', 'Erro ao excluir registro de auditoria', err);
                this.error = err?.error?.error || 'Falha ao excluir registro de auditoria';
                this.loading = false;
            }
        });
    }

    toggleExpand(rowId: string): void {
        if (!rowId) return;
        if (this.expandedRows.has(rowId)) this.expandedRows.delete(rowId);
        else this.expandedRows.add(rowId);
    }
}


