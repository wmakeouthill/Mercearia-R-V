import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { extractLocalDate, formatDateBR, parseDate } from '../../utils/date-utils';
import { Venda, MetodoPagamento } from '../../models';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-historico-vendas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './historico-vendas.html',
  styleUrl: './historico-vendas.scss'
})
export class HistoricoVendasComponent implements OnInit {
  vendas: Venda[] = [];
  private vendasLegado: Venda[] = [];
  private vendasCheckout: Venda[] = [];
  vendasFiltradas: any[] = [];
  expandedRows = new Set<string>();
  dataFiltro = '';
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

  constructor(
    private readonly apiService: ApiService,
    public readonly authService: AuthService,
    private readonly imageService: ImageService,
    public readonly router: Router
  ) { }

  ngOnInit(): void {
    logger.info('HISTORICO_VENDAS', 'INIT', 'Componente iniciado');
    this.loadAllVendas();
  }

  private loadAllVendas(): void {
    this.loading = true;
    this.error = '';

    forkJoin({
      legado: this.apiService.getVendas().pipe(catchError(() => of([]))),
      checkout: this.apiService.getVendasCompletas().pipe(catchError(() => of([])))
    }).subscribe(({ legado, checkout }) => {
      logger.info('HISTORICO_VENDAS', 'LOAD_CHECKOUT_RAW', 'Payload de checkout recebido', {
        numOrdens: Array.isArray(checkout) ? checkout.length : 0
      });
      // Legacy
      const arr = Array.isArray(legado) ? legado : [];
      // ensure unique row id for legacy entries (avoid duplicate track keys)
      arr.forEach((row: any, idx: number) => {
        row._isCheckout = false;
        row.row_id = `legacy-${row.id ?? idx}`;
      });
      this.vendasLegado = [...arr].sort((a, b) => {
        const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
        if (timeDiff !== 0) return timeDiff;
        return (b.id || 0) - (a.id || 0);
      });

      // Checkout -> uma linha por ordem (agregada) com resumo de pagamentos
      const linhas: Venda[] = [];
      const vendasCompletas = Array.isArray(checkout) ? checkout : [];
      let rowCounter = 0;
      for (const v of vendasCompletas) {
        const data = v.data_venda;
        const pagamentos: Array<{ metodo: MetodoPagamento; valor: number }> = (v.pagamentos || []);
        const metodoResumo = this.buildPagamentoResumo(pagamentos);
        const metodosSet = new Set<MetodoPagamento>();
        for (const p of pagamentos) if (p?.metodo) metodosSet.add(p.metodo);
        const itens = v.itens || [];

        // agregar quantidade e total
        const totalQuantidade = Array.isArray(itens) ? itens.reduce((s: number, it: any) => s + (Number(it.quantidade) || 0), 0) : 0;
        let totalValor = (v.total_final ?? v.totalFinal ?? v.totalFinal ?? 0) as number;
        if (!totalValor || totalValor === 0) {
          totalValor = Array.isArray(itens) ? itens.reduce((s: number, it: any) => s + (Number(it.preco_total || it.precoTotal) || 0), 0) : 0;
        }

        const produtoNome = Array.isArray(itens) && itens.length > 0
          ? itens.map((it: any) => it.produto_nome || it.produtoNome || '').join(', ')
          : (`Pedido #${v.id} (${itens.length} itens)`);

        const produtoImagem = Array.isArray(itens) && itens.length > 0 ? itens[0].produto_imagem : null;

        const linha: Venda = {
          id: v.id,
          produto_id: v.id,
          quantidade_vendida: totalQuantidade,
          preco_total: totalValor,
          data_venda: data,
          metodo_pagamento: 'dinheiro',
          produto_nome: produtoNome,
          produto_imagem: produtoImagem,
          pagamentos_resumo: metodoResumo,
        } as any;
        (linha as any).itens = itens;
        (linha as any).metodos_multi = Array.from(metodosSet);
        (linha as any)._isCheckout = true;
        (linha as any).row_id = `checkout-${v.id}-${rowCounter++}`;
        linhas.push(linha);

        logger.info('HISTORICO_VENDAS', 'MAP_CHECKOUT_ORDEM', 'Ordem mapeada', {
          ordemId: v.id,
          itens: itens.length,
          pagamentos: pagamentos.length,
          resumo: metodoResumo
        });
      }
      this.vendasCheckout = [...linhas].sort((a, b) => {
        const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
        if (timeDiff !== 0) return timeDiff;
        return (b.id || 0) - (a.id || 0);
      });

      // Mesclar e filtrar
      this.mergeAndFilter();
      this.loading = false;
      // Debug: log first rows to inspect row_id/_isCheckout/pagamentos_resumo
      try {
        logger.debug('HISTORICO_VENDAS', 'POST_MERGE_SAMPLE', 'Sample vendasFiltradas', this.vendasFiltradas.slice(0, 10).map(v => ({ id: v.id, row_id: (v as any).row_id, _isCheckout: (v as any)._isCheckout, pagamentos_resumo: (v as any).pagamentos_resumo, metodo_pagamento: v.metodo_pagamento })));
      } catch (e) {
        console.debug('HISTORICO_VENDAS: failed to log sample', e);
      }
      logger.info('HISTORICO_VENDAS', 'LOAD_ALL', 'Vendas unificadas carregadas', {
        legado: this.vendasLegado.length,
        checkout: this.vendasCheckout.length,
        total: (this.vendasLegado.length + this.vendasCheckout.length)
      });
      const multiLinhas = this.vendasCheckout.filter(v => Array.isArray((v as any).metodos_multi) && (v as any).metodos_multi.length > 1).length;
      logger.info('HISTORICO_VENDAS', 'CHECK_MULTI', 'Resumo de vendas com múltiplos pagamentos', {
        linhasCheckout: this.vendasCheckout.length,
        linhasMulti: multiLinhas
      });
    });
  }

  private mergeAndFilter(): void {
    // Mesclar as duas fontes e ordenar
    this.vendas = [...(this.vendasCheckout || []), ...(this.vendasLegado || [])].sort((a, b) => {
      const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
      if (timeDiff !== 0) return timeDiff;
      return (b.id || 0) - (a.id || 0);
    });
    this.filterVendas();
  }

  toggleExpand(rowId: string): void {
    if (!rowId) return;
    if (this.expandedRows.has(rowId)) this.expandedRows.delete(rowId);
    else this.expandedRows.add(rowId);
  }

  filterVendas(): void {
    // Garantir que vendas sempre seja um array válido
    if (!Array.isArray(this.vendas)) {
      this.vendas = [];
      this.vendasFiltradas = [];
      return;
    }

    this.vendasFiltradas = this.vendas.filter(venda => {
      if (!venda) return false; // Filtrar vendas nulas/undefined

      let matchData = true;
      let matchProduto = true;
      let matchMetodoPagamento = true;

      // Filtro por data
      if (this.dataFiltro) {
        try {
          const vendaDataLocal = extractLocalDate(venda.data_venda);
          matchData = vendaDataLocal === this.dataFiltro;
        } catch {
          matchData = false;
        }
      }

      // Filtro por produto (suporta vendas agregadas de checkout com vários itens)
      if (this.produtoFiltro?.trim()) {
        const termoBusca = this.produtoFiltro.toLowerCase().trim();
        const produtoNomePrincipal = (venda.produto_nome || '').toLowerCase();
        const itensArr = (venda as any).itens || [];
        const itensConcat = Array.isArray(itensArr) ? itensArr.map((it: any) => (it.produto_nome || it.produtoNome || '')).join(' ').toLowerCase() : '';
        matchProduto = produtoNomePrincipal.includes(termoBusca) || itensConcat.includes(termoBusca);
      }

      // Filtro por método de pagamento (suporta múltiplos métodos nas vendas do checkout)
      if (this.metodoPagamentoFiltro?.trim()) {
        const metodosMulti: MetodoPagamento[] | undefined = (venda as any).metodos_multi;
        if (Array.isArray(metodosMulti) && metodosMulti.length > 0) {
          matchMetodoPagamento = metodosMulti.includes(this.metodoPagamentoFiltro as MetodoPagamento);
        } else {
          matchMetodoPagamento = venda.metodo_pagamento === this.metodoPagamentoFiltro;
        }
      }

      return matchData && matchProduto && matchMetodoPagamento;
    }).sort((a, b) => {
      const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
      if (timeDiff !== 0) return timeDiff;
      return (b.id || 0) - (a.id || 0);
    });
  }

  limparFiltros(): void {
    this.dataFiltro = '';
    this.produtoFiltro = '';
    this.metodoPagamentoFiltro = '';
    this.vendasFiltradas = [...this.vendas].sort((a, b) => {
      const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
      if (timeDiff !== 0) return timeDiff;
      return (b.id || 0) - (a.id || 0);
    });
  }

  excluirVenda(id: number): void {
    const venda = this.vendas.find(v => v.id === id);
    if (!venda) return;

    if ((venda as any)._isCheckout) {
      this.apiService.deleteCheckoutOrder(id).subscribe({
        next: () => {
          this.removeVendaFromLists(id);
          logger.info('HISTORICO_VENDAS', 'DELETE_CHECKOUT_ORDER', 'Ordem de checkout excluída', { id });
        },
        error: (error: any) => {
          logger.error('HISTORICO_VENDAS', 'DELETE_CHECKOUT_ORDER', 'Erro ao excluir ordem de checkout', error);
          alert('Erro ao excluir venda de checkout');
        }
      });
      return;
    }

    this.apiService.deleteVenda(id).subscribe({
      next: () => {
        this.removeVendaFromLists(id);
        logger.info('HISTORICO_VENDAS', 'DELETE_VENDA', 'Venda excluída', { id });
      },
      error: (error: any) => {
        logger.error('HISTORICO_VENDAS', 'DELETE_VENDA', 'Erro ao excluir venda', error);
        alert('Erro ao excluir venda');
      }
    });
  }

  private removeVendaFromLists(id: number): void {
    this.vendas = this.vendas.filter(v => v.id !== id);
    this.vendasFiltradas = this.vendasFiltradas
      .filter(v => v.id !== id)
      .sort((a, b) => {
        const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
        if (timeDiff !== 0) return timeDiff;
        return (b.id || 0) - (a.id || 0);
      });
  }

  // helper called from template to ensure event propagation handled correctly
  onDeleteClick(event: Event, id: number | undefined): void {
    event.stopPropagation();
    console.debug('HISTORICO_VENDAS: delete click', { id });
    if (!id) return;
    const venda = this.vendas.find(v => v.id === id);
    if (!venda) return;
    this.pendingDeleteId = id;
    this.pendingIsCheckout = !!(venda as any)._isCheckout;
    this.confirmTitle = 'Confirmar exclusão';
    this.confirmMessage = this.pendingIsCheckout
      ? 'Deseja realmente excluir esta venda de checkout? Esta ação restaurará o estoque.'
      : 'Deseja realmente excluir esta venda?';
    this.showConfirmModal = true;
  }

  confirmModalCancel(): void {
    this.showConfirmModal = false;
    this.pendingDeleteId = null;
  }

  confirmModalConfirm(): void {
    this.showConfirmModal = false;
    if (this.pendingDeleteId) {
      this.excluirVenda(this.pendingDeleteId);
    }
    this.pendingDeleteId = null;
  }

  formatarData(data: string): string {
    return formatDateBR(data, true); // incluir hora
  }

  getMetodoPagamentoNome(metodo: MetodoPagamento): string {
    const nomes = {
      'dinheiro': 'Dinheiro',
      'cartao_credito': 'Cartão de Crédito',
      'cartao_debito': 'Cartão de Débito',
      'pix': 'PIX'
    };
    return nomes[metodo] || metodo;
  }

  getMetodoPagamentoIcone(metodo: MetodoPagamento): string {
    const icones = {
      'dinheiro': '💵',
      'cartao_credito': '💳',
      'cartao_debito': '🏧',
      'pix': '📱'
    };
    return icones[metodo] || '💰';
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
        const nome = this.getMetodoPagamentoNome(m);
        const valorFmt = v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        partes.push(`${nome} R$ ${valorFmt}`);
      }
    }
    return partes.join(' + ');
  }

  getReceitaTotal(): number {
    if (!Array.isArray(this.vendasFiltradas)) return 0;
    return this.vendasFiltradas.reduce((total, venda) => {
      return total + (venda?.preco_total || 0);
    }, 0);
  }

  getQuantidadeTotal(): number {
    if (!Array.isArray(this.vendasFiltradas)) return 0;
    return this.vendasFiltradas.reduce((total, venda) => {
      return total + (venda?.quantidade_vendida || 0);
    }, 0);
  }

  getTicketMedio(): number {
    if (!Array.isArray(this.vendasFiltradas) || this.vendasFiltradas.length === 0) return 0;
    return this.getReceitaTotal() / this.vendasFiltradas.length;
  }

  voltarAoDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  getImageUrl(imageName: any): string {
    return this.imageService.getImageUrl(imageName);
  }

  onImageError(event: any): void {
    // Se a imagem falhar ao carregar, tentar carregar a imagem padrão
    const fallbackUrl = this.imageService.getImageUrl(null);
    if (event.target.src !== fallbackUrl) {
      event.target.src = fallbackUrl;
    }
  }
}
