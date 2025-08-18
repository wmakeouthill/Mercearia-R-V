import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { extractLocalDate, extractYearMonth, formatDateBR, formatTimeBR, getCurrentDateForInput, formatDateYMD, parseDate } from '../../utils/date-utils';
import { RelatorioVendas, Venda, MetodoPagamento, RelatorioResumo } from '../../models';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
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
  vendasFiltradas: any[] = [];
  expandedRows = new Set<string>();
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
    // por padrão não filtrar por data para mostrar todas as vendas
    this.filtroData = '';
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

    forkJoin({
      legado: this.apiService.getVendas().pipe(catchError(() => of([]))),
      checkout: this.apiService.getVendasCompletas().pipe(catchError(() => of([])))
    }).subscribe(({ legado, checkout }) => {
      // Legado
      const legacyArr = Array.isArray(legado) ? legado : [];
      // ensure unique row id for legacy entries
      legacyArr.forEach((row: any, idx: number) => {
        row._isCheckout = false;
        row.row_id = `legacy-${row.id ?? idx}`;
      });
      this.vendasLegado = [...legacyArr].sort((a, b) => {
        const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
        if (timeDiff !== 0) return timeDiff;
        return (b.id || 0) - (a.id || 0);
      });

      // Checkout -> uma linha por ordem (agregada)
      const linhas: Venda[] = [];
      const vendasCompletas = Array.isArray(checkout) ? checkout : [];
      logger.info('RELATORIO_VENDAS', 'LOAD_CHECKOUT_RAW', 'Payload de checkout recebido', {
        numOrdens: vendasCompletas.length
      });
      let rowCounter = 0;
      for (const v of vendasCompletas) {
        const data = v.data_venda;
        const pagamentos: Array<{ metodo: MetodoPagamento; valor: number }> = (v.pagamentos || []);
        const itens = v.itens || [];
        const metodoResumo = this.buildPagamentoResumo(pagamentos);
        const metodosSet = new Set<MetodoPagamento>();
        for (const p of pagamentos) if (p?.metodo) metodosSet.add(p.metodo);

        const totalQuantidade = Array.isArray(itens) ? itens.reduce((s: number, it: any) => s + (Number(it.quantidade) || 0), 0) : 0;
        let totalValor = (v.total_final ?? v.totalFinal ?? 0) as number;
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
        (linha as any).row_id = `checkout-${v.id}-${rowCounter++}`;
        (linha as any)._isCheckout = true;
        linhas.push(linha);

        logger.info('RELATORIO_VENDAS', 'MAP_CHECKOUT_ORDEM', 'Ordem mapeada', {
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

      this.mergeAndRecompute();
      this.loading = false;
      logger.info('RELATORIO_VENDAS', 'LOAD_ALL', 'Vendas unificadas carregadas', {
        legado: this.vendasLegado.length,
        checkout: this.vendasCheckout.length,
        total: (this.vendasLegado.length + this.vendasCheckout.length)
      });
      // Estatística de quantas linhas têm múltiplos métodos
      const multiLinhas = this.vendasCheckout.filter(v => Array.isArray((v as any).metodos_multi) && (v as any).metodos_multi.length > 1).length;
      logger.info('RELATORIO_VENDAS', 'CHECK_MULTI', 'Resumo de vendas com múltiplos pagamentos', {
        linhasCheckout: this.vendasCheckout.length,
        linhasMulti: multiLinhas
      });
    });
  }

  private mergeAndRecompute(): void {
    this.vendas = [...(this.vendasCheckout || []), ...(this.vendasLegado || [])].sort((a, b) => {
      const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
      if (timeDiff !== 0) return timeDiff;
      return (b.id || 0) - (a.id || 0);
    });
    this.vendasFiltradas = this.computeVendasFiltradas();
    // Debug: log sample vendasFiltradas to verify itens presence for expand button
    try {
      logger.debug('RELATORIO_VENDAS', 'POST_MERGE_SAMPLE', 'Sample vendasFiltradas', this.vendasFiltradas.slice(0, 50).map(v => ({ id: v.id, row_id: (v as any).row_id, itensLen: Array.isArray((v as any).itens) ? (v as any).itens.length : 0, metodos_multi: Array.isArray((v as any).metodos_multi) ? (v as any).metodos_multi.length : 0 })));
    } catch (e) { console.debug('RELATORIO_VENDAS: failed to log sample', e); }
    this.calcularEstatisticas(this.vendasFiltradas);
    this.gerarRelatorios(this.vendasFiltradas);
  }

  toggleExpand(rowId: string): void {
    logger.debug('RELATORIO_VENDAS', 'TOGGLE_EXPAND', 'toggleExpand called', { rowId, before: Array.from(this.expandedRows) });
    if (!rowId) return;
    if (this.expandedRows.has(rowId)) {
      this.expandedRows.delete(rowId);
    } else {
      this.expandedRows.add(rowId);
    }
    logger.debug('RELATORIO_VENDAS', 'TOGGLE_EXPAND', 'toggleExpand updated', { rowId, after: Array.from(this.expandedRows) });
  }

  calcularEstatisticas(vendasFiltradas?: Venda[]): void {
    const list = vendasFiltradas ?? this.computeVendasFiltradas();
    this.totalVendas = list.length;
    this.receitaTotal = list.reduce((total, venda) => total + venda.preco_total, 0);
    this.mediaVendas = this.totalVendas > 0 ? this.receitaTotal / this.totalVendas : 0;

    // Encontrar melhor dia
    const vendasPorDia = list.reduce((acc, venda) => {
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

  gerarRelatorios(vendasFiltradas?: Venda[]): void {
    this.gerarRelatorioDiario(vendasFiltradas);
    this.gerarRelatorioMensal(vendasFiltradas);
  }

  gerarRelatorioDiario(vendasFiltradas?: Venda[]): void {
    const list = vendasFiltradas ?? this.computeVendasFiltradas();
    const vendasPorDia = list.reduce((acc, venda) => {
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

  gerarRelatorioMensal(vendasFiltradas?: Venda[]): void {
    const list = vendasFiltradas ?? this.computeVendasFiltradas();
    const vendasPorMes = list.reduce((acc, venda) => {
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
    this.vendasFiltradas = this.computeVendasFiltradas();
    this.calcularEstatisticas(this.vendasFiltradas);
    this.gerarRelatorios(this.vendasFiltradas);
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
    this.vendasFiltradas = this.computeVendasFiltradas();
    this.calcularEstatisticas(this.vendasFiltradas);
    this.gerarRelatorios(this.vendasFiltradas);
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

  irParaGraficos(): void {
    this.router.navigate(['/relatorios/graficos']);
  }

  private computeVendasFiltradas(): Venda[] {
    if (!Array.isArray(this.vendas)) return [];
    return [...this.vendas]
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
    // Quando o agrupamento gera 'YYYY-MM-DD', usar formatação própria
    if (/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return formatDateYMD(data);
    }
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
