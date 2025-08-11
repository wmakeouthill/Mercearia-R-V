import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { extractLocalDate, formatDateBR, parseDate } from '../../utils/date-utils';
import { Venda, MetodoPagamento } from '../../models';
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
  vendasFiltradas: Venda[] = [];
  dataFiltro = '';
  produtoFiltro = '';
  metodoPagamentoFiltro = '';
  loading = false;
  error = '';

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly imageService: ImageService,
    private readonly router: Router
  ) { }

  ngOnInit(): void {
    logger.info('HISTORICO_VENDAS', 'INIT', 'Componente iniciado');
    this.loadVendas();
    this.loadVendasCompletas();
  }

  loadVendas(): void {
    this.loading = true;
    this.error = '';

    this.apiService.getVendas().subscribe({
      next: (vendas) => {
        // Garantir que vendas sempre seja um array
        this.vendas = Array.isArray(vendas) ? vendas : [];
        // Ordenar por data mais recente primeiro (fallback por id)
        this.vendas.sort((a, b) => {
          const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
          if (timeDiff !== 0) return timeDiff;
          return (b.id || 0) - (a.id || 0);
        });
        this.vendasFiltradas = [...this.vendas];
        this.loading = false;
        logger.info('HISTORICO_VENDAS', 'LOAD_VENDAS', 'Vendas carregadas', { count: this.vendas.length });
      },
      error: (error: any) => {
        this.error = 'Erro ao carregar vendas';
        this.loading = false;
        // Garantir arrays vazios em caso de erro
        this.vendas = [];
        this.vendasFiltradas = [];
        logger.error('HISTORICO_VENDAS', 'LOAD_VENDAS', 'Erro ao carregar vendas', error);
      }
    });
  }

  loadVendasCompletas(): void {
    this.apiService.getVendasCompletas().subscribe({
      next: (vendasCompletas: any[]) => {
        // Explodir itens para linhas de tabela e incluir resumo de pagamentos no nome do produto
        const linhas: Venda[] = [];
        for (const v of vendasCompletas) {
          const data = v.data_venda;
          const pagamentos: Array<{ metodo: MetodoPagamento; valor: number }> = (v.pagamentos || []);
          const metodoResumo = this.buildPagamentoResumo(pagamentos);
          const itens = v.itens || [];
          for (const it of itens) {
            const linha: Venda = {
              id: v.id,
              produto_id: it.produto_id,
              quantidade_vendida: it.quantidade,
              preco_total: it.preco_total,
              data_venda: data,
              metodo_pagamento: 'dinheiro',
              produto_nome: it.produto_nome,
              produto_imagem: it.produto_imagem,
              pagamentos_resumo: metodoResumo,
            } as any;
            linhas.push(linha);
          }
        }
        // Mesclar e reordenar
        this.vendas = [...linhas, ...(this.vendas || [])].sort((a, b) => {
          const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
          if (timeDiff !== 0) return timeDiff;
          return (b.id || 0) - (a.id || 0);
        });
        this.vendasFiltradas = [...this.vendas];
        logger.info('HISTORICO_VENDAS', 'LOAD_VENDAS_COMPLETAS', 'Vendas checkout carregadas', { count: vendasCompletas.length });
      },
      error: (error: any) => {
        logger.warn('HISTORICO_VENDAS', 'LOAD_VENDAS_COMPLETAS', 'Erro ao carregar vendas checkout', error);
      }
    });
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

      // Filtro por produto
      if (this.produtoFiltro?.trim()) {
        const produtoNome = (venda.produto_nome || '').toLowerCase();
        const termoBusca = this.produtoFiltro.toLowerCase().trim();
        matchProduto = produtoNome.includes(termoBusca);
      }

      // Filtro por método de pagamento
      if (this.metodoPagamentoFiltro?.trim()) {
        matchMetodoPagamento = venda.metodo_pagamento === this.metodoPagamentoFiltro;
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
    if (confirm('Tem certeza que deseja excluir esta venda?')) {
      this.apiService.deleteVenda(id).subscribe({
        next: () => {
          this.vendas = this.vendas.filter(v => v.id !== id);
          this.vendasFiltradas = this.vendasFiltradas
            .filter(v => v.id !== id)
            .sort((a, b) => {
              const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
              if (timeDiff !== 0) return timeDiff;
              return (b.id || 0) - (a.id || 0);
            });
          logger.info('HISTORICO_VENDAS', 'DELETE_VENDA', 'Venda excluída', { id });
        },
        error: (error: any) => {
          logger.error('HISTORICO_VENDAS', 'DELETE_VENDA', 'Erro ao excluir venda', error);
          alert('Erro ao excluir venda');
        }
      });
    }
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

  getImageUrl(imageName: string | null | undefined): string {
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
