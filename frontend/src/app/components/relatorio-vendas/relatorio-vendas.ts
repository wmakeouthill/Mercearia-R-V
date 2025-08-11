import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { extractLocalDate, extractYearMonth, formatDateBR, formatTimeBR, getCurrentDateForInput, formatDateYMD, parseDate } from '../../utils/date-utils';
import { RelatorioVendas, Venda, MetodoPagamento, RelatorioResumo, VendaCompletaResponse } from '../../models';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-relatorio-vendas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './relatorio-vendas.html',
  styleUrl: './relatorio-vendas.scss'
})
export class RelatorioVendasComponent implements OnInit {
  vendas: Venda[] = [];
  private vendasLegado: Venda[] = [];
  private vendasCheckout: Venda[] = [];
  relatorioDiario: RelatorioVendas[] = [];
  relatorioMensal: RelatorioVendas[] = [];
  resumoDia?: RelatorioResumo;
  resumoMes?: RelatorioResumo;
  filtroPeriodo: 'dia' | 'mes' = 'dia';
  filtroData: string = '';
  filtroNomeProduto: string = '';
  filtroMetodoPagamento: string = '';
  loading = false;
  error = '';
  isAdmin = false;

  // Estatísticas
  totalVendas = 0;
  receitaTotal = 0;
  mediaVendas = 0;
  melhorDia = '';
  melhorDiaReceita = 0;

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly imageService: ImageService,
    private readonly router: Router
  ) { }

  ngOnInit(): void {
    logger.info('RELATORIO_VENDAS', 'INIT', 'Componente iniciado');
    this.isAdmin = this.authService.isAdmin();
    this.filtroData = this.getDataAtual();
    this.loadVendas();
    this.loadResumos();
  }
  loadResumos(): void {
    this.apiService.getResumoDia().subscribe({
      next: (res) => {
        this.resumoDia = res;
      },
      error: () => { }
    });
    this.apiService.getResumoMesAtual().subscribe({
      next: (res) => {
        this.resumoMes = res;
      },
      error: () => { }
    });
  }


  getDataAtual(): string {
    return getCurrentDateForInput();
  }

  loadVendas(): void {
    this.loading = true;
    this.error = '';

    this.apiService.getVendas().subscribe({
      next: (vendas) => {
        this.vendasLegado = [...vendas].sort((a, b) => {
          const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
          if (timeDiff !== 0) return timeDiff;
          return (b.id || 0) - (a.id || 0);
        });
        this.mergeAndRecompute();
        this.loading = false;
        logger.info('RELATORIO_VENDAS', 'LOAD_VENDAS', 'Vendas (legado) carregadas', { count: this.vendasLegado.length });
      },
      error: (error: any) => {
        logger.warn('RELATORIO_VENDAS', 'LOAD_VENDAS', 'Erro ao carregar vendas (legado). Continuando.', error);
      }
    });

    // Carregar vendas completas (novo modelo) e incorporar em memória como linhas agregadas por item
    this.apiService.getVendasCompletas().subscribe({
      next: (vendasCompletas: VendaCompletaResponse[]) => {
        const linhas: Venda[] = [];
        for (const v of vendasCompletas) {
          const data = v.data_venda;
          const pagamentos: Array<{ metodo: MetodoPagamento; valor: number }> = (v.pagamentos || []);
          const itens = v.itens || [];
          // Resumo ordenado e com valores
          const metodoResumo = this.buildPagamentoResumo(pagamentos);
          const metodosSet = new Set<MetodoPagamento>();
          for (const p of pagamentos) {
            metodosSet.add(p.metodo);
          }
          for (const it of itens) {
            const linha: Venda = {
              id: v.id,
              produto_id: it.produto_id,
              quantidade_vendida: it.quantidade,
              preco_total: it.preco_total,
              data_venda: data,
              metodo_pagamento: 'dinheiro', // placeholder para não quebrar filtros
              produto_nome: it.produto_nome,
              produto_imagem: it.produto_imagem,
              pagamentos_resumo: metodoResumo,
            } as any;
            (linha as any).metodos_multi = Array.from(metodosSet);
            linhas.push(linha);
          }
        }
        // Guardar separado e mesclar de forma determinística
        this.vendasCheckout = [...linhas].sort((a, b) => {
          const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
          if (timeDiff !== 0) return timeDiff;
          return (b.id || 0) - (a.id || 0);
        });
        this.mergeAndRecompute();
        this.loading = false;
        logger.info('RELATORIO_VENDAS', 'LOAD_VENDAS_COMPLETAS', 'Vendas (checkout) carregadas', { count: vendasCompletas.length });
      },
      error: (error: any) => {
        logger.warn('RELATORIO_VENDAS', 'LOAD_VENDAS_COMPLETAS', 'Erro ao carregar vendas completas', error);
      }
    });
  }

  private mergeAndRecompute(): void {
    this.vendas = [...(this.vendasCheckout || []), ...(this.vendasLegado || [])].sort((a, b) => {
      const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
      if (timeDiff !== 0) return timeDiff;
      return (b.id || 0) - (a.id || 0);
    });
    this.calcularEstatisticas();
    this.gerarRelatorios();
  }

  calcularEstatisticas(): void {
    const vendasFiltradas = this.getVendasFiltradas();
    this.totalVendas = vendasFiltradas.length;
    this.receitaTotal = vendasFiltradas.reduce((total, venda) => total + venda.preco_total, 0);
    this.mediaVendas = this.totalVendas > 0 ? this.receitaTotal / this.totalVendas : 0;

    // Encontrar melhor dia
    const vendasPorDia = vendasFiltradas.reduce((acc, venda) => {
      const data = extractLocalDate(venda.data_venda);
      if (!acc[data]) {
        acc[data] = 0;
      }
      acc[data] += venda.preco_total;
      return acc;
    }, {} as Record<string, number>);

    let melhorDia = '';
    let melhorReceita = 0;
    for (const [data, receita] of Object.entries(vendasPorDia)) {
      if (receita > melhorReceita) {
        melhorReceita = receita;
        melhorDia = data;
      }
    }

    this.melhorDia = melhorDia;
    this.melhorDiaReceita = melhorReceita;
  }

  gerarRelatorios(): void {
    this.gerarRelatorioDiario();
    this.gerarRelatorioMensal();
  }

  gerarRelatorioDiario(): void {
    const vendasFiltradas = this.getVendasFiltradas();
    const vendasPorDia = vendasFiltradas.reduce((acc, venda) => {
      const data = extractLocalDate(venda.data_venda);
      if (!acc[data]) {
        acc[data] = {
          data: data,
          total_vendas: 0,
          quantidade_vendida: 0,
          receita_total: 0
        };
      }
      acc[data].total_vendas++;
      acc[data].quantidade_vendida += venda.quantidade_vendida;
      acc[data].receita_total += venda.preco_total;
      return acc;
    }, {} as Record<string, RelatorioVendas>);

    this.relatorioDiario = Object.values(vendasPorDia).sort((a, b) => b.data.localeCompare(a.data));
  }

  private buildPagamentoResumo(pagamentos: Array<{ metodo: MetodoPagamento; valor: number }>): string {
    if (!Array.isArray(pagamentos) || pagamentos.length === 0) return '';
    const order: MetodoPagamento[] = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'];
    // Somar por método para robustez
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

  gerarRelatorioMensal(): void {
    const vendasFiltradas = this.getVendasFiltradas();
    const vendasPorMes = vendasFiltradas.reduce((acc, venda) => {
      const mes = extractYearMonth(venda.data_venda);

      if (!acc[mes]) {
        acc[mes] = {
          data: mes,
          total_vendas: 0,
          quantidade_vendida: 0,
          receita_total: 0
        };
      }
      acc[mes].total_vendas++;
      acc[mes].quantidade_vendida += venda.quantidade_vendida;
      acc[mes].receita_total += venda.preco_total;
      return acc;
    }, {} as Record<string, RelatorioVendas>);

    this.relatorioMensal = Object.values(vendasPorMes).sort((a, b) => b.data.localeCompare(a.data));
  }

  aplicarFiltros(): void {
    // Recalcular estatísticas e relatórios com todos os filtros
    this.calcularEstatisticas();
    this.gerarRelatorios();
    logger.info('RELATORIO_VENDAS', 'APLICAR_FILTROS', 'Filtros aplicados', {
      periodo: this.filtroPeriodo,
      data: this.filtroData,
      nome: this.filtroNomeProduto,
      metodo: this.filtroMetodoPagamento
    });
  }

  limparFiltros(): void {
    this.filtroData = '';
    this.filtroNomeProduto = '';
    this.filtroMetodoPagamento = '';
    this.calcularEstatisticas();
    this.gerarRelatorios();
  }

  exportarRelatorio(): void {
    const dados = this.filtroPeriodo === 'dia' ? this.relatorioDiario : this.relatorioMensal;
    const csv = this.converterParaCSV(dados);
    this.downloadCSV(csv, `relatorio-vendas-${this.filtroPeriodo}-${this.filtroData}.csv`);
  }

  private converterParaCSV(dados: RelatorioVendas[]): string {
    const headers = ['Data', 'Total de Vendas', 'Quantidade Vendida', 'Receita Total'];
    const linhas = dados.map(item => [
      item.data,
      item.total_vendas.toString(),
      item.quantidade_vendida.toString(),
      `R$ ${item.receita_total.toFixed(2)}`
    ]);

    return [headers, ...linhas].map(linha => linha.join(',')).join('\n');
  }

  private downloadCSV(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  voltarAoDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  getVendasFiltradas(): Venda[] {
    if (!Array.isArray(this.vendas)) return [];

    return this.vendas
      .filter(v => !!v?.data_venda)
      .filter(v => this.passaFiltroData(v))
      .filter(v => this.passaFiltroNome(v))
      .filter(v => this.passaFiltroMetodo(v))
      .sort((a, b) => this.ordenarPorDataEId(a, b));
  }

  private ordenarPorDataEId(a: Venda, b: Venda): number {
    const timeDiff = parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (b.id || 0) - (a.id || 0);
  }

  private passaFiltroData(venda: Venda): boolean {
    if (!this.filtroData) return true;
    try {
      const vendaDataLocal = extractLocalDate(venda.data_venda);
      return vendaDataLocal === this.filtroData;
    } catch (error) {
      logger.warn('RELATORIO_VENDAS', 'FILTER_INVALID_DATE', 'Data de venda inválida ao aplicar filtro', { venda, error: String(error) });
      return false;
    }
  }

  private passaFiltroNome(venda: Venda): boolean {
    const termo = this.filtroNomeProduto?.trim();
    if (!termo) return true;
    const nomeProduto = venda.produto_nome?.toLowerCase() ?? '';
    return nomeProduto.includes(termo.toLowerCase());
  }

  private passaFiltroMetodo(venda: Venda): boolean {
    const filtro = this.filtroMetodoPagamento?.trim() as MetodoPagamento | undefined;
    if (!filtro) return true;
    const metodosMulti: MetodoPagamento[] | undefined = (venda as any).metodos_multi;
    if (Array.isArray(metodosMulti) && metodosMulti.length > 0) {
      return metodosMulti.includes(filtro);
    }
    return venda.metodo_pagamento === filtro;
  }

  formatarData(data: string): string {
    return formatDateBR(data);
  }

  formatarHora(data: string): string {
    return formatTimeBR(data);
  }

  formatarMelhorDia(data: string): string {
    return formatDateYMD(data);
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
