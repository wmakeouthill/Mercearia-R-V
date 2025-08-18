import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { logger } from '../../utils/logger';
import { Venda, MetodoPagamento } from '../../models';
import { extractLocalDate, formatDateBR, parseDate } from '../../utils/date-utils';

@Component({
    selector: 'app-historico-deletados',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './historico-deletados.html',
    styleUrl: './historico-deletados.scss'
})
export class HistoricoDeletadosComponent implements OnInit {
    loading = false;
    error = '';
    deletions: any[] = [];
    vendasFiltradas: any[] = [];

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
        this.apiService.getDeletedSales().subscribe({
            next: (list) => {
                this.deletions = Array.isArray(list) ? list : [];
                logger.debug('HISTORICO_DELETADOS', 'RAW_DELETIONS', 'Payload de auditoria recebido', this.deletions);
                this.vendasFiltradas = this.mapDeletionsToVendas(this.deletions);
                logger.debug('HISTORICO_DELETADOS', 'MAPPED_VENDAS', 'Vendas mapeadas a partir da auditoria', this.vendasFiltradas.slice(0, 50));
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

                for (const it of payload.itens) {
                    const linha: Venda = {
                        id: payload.id || d.saleId,
                        produto_id: it.produto_id || it.produtoId || 0,
                        quantidade_vendida: it.quantidade || it.quantidade || 0,
                        preco_total: it.preco_total || it.preco_total || 0,
                        data_venda: payload.data_venda || payload.dataVenda || '',
                        metodo_pagamento: 'dinheiro',
                        produto_nome: it.produto_nome || it.produto_nome || ('Produto #' + (it.produto_id || it.produtoId || '')),
                        produto_imagem: it.produto_imagem || it.produto_imagem || null,
                        pagamentos_resumo: metodoResumo
                    } as any;
                    (linha as any).metodos_multi = Array.from(metodosSet);
                    (linha as any)._isCheckout = true;
                    (linha as any).row_id = `deleted-checkout-${payload.id || d.saleId}-${it.produto_id || it.produtoId}-${rowCounter++}`;
                    (linha as any)._deletionId = d.id;
                    rows.push(linha);
                }
            } else if (payload) {
                const linha: Venda = {
                    id: payload.id || d.saleId,
                    produto_id: payload.produto_id || payload.produtoId || 0,
                    quantidade_vendida: payload.quantidade_vendida || payload.quantidade || 0,
                    preco_total: payload.preco_total || payload.precoTotal || 0,
                    data_venda: payload.data_venda || payload.dataVenda || '',
                    metodo_pagamento: payload.metodo_pagamento || payload.metodoPagamento || 'dinheiro',
                    produto_nome: payload.produto_nome || payload.produtoNome || ('Produto #' + (payload.produto_id || payload.produtoId || '')),
                    produto_imagem: payload.produto_imagem || payload.produtoImagem || null,
                } as any;
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
}


