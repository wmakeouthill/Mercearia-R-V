import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { CaixaService } from '../../services/caixa.service';
import { logger } from '../../utils/logger';
import { forkJoin } from 'rxjs';
import { RelatorioResumo } from '../../models';
import { Router } from '@angular/router';
import { getCurrentDateForInput } from '../../utils/date-utils';

type TipoMovManual = 'entrada' | 'retirada';
type TipoMovLista = 'entrada' | 'retirada' | 'venda';

@Component({
  selector: 'app-caixa',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './caixa.html',
  styleUrl: './caixa.scss'
})
export class CaixaComponent implements OnInit {
  filtroModo: 'tudo' | 'dia' | 'mes' = 'tudo';
  dataSelecionada = getCurrentDateForInput();
  mesSelecionado = getCurrentDateForInput().substring(0, 7);
  resumo: { data: string; saldo_movimentacoes: number } | null = null;
  resumoVendasDia: RelatorioResumo | null = null;
  movimentacoes: Array<{ id: number; tipo: TipoMovLista; valor: number; descricao?: string; usuario?: string; data_movimento: string; produto_nome?: string; metodo_pagamento?: string; pagamento_valor?: number }> = [];
  filtroTipo = '';
  filtroMetodo = '';
  filtroHoraInicio = '';
  filtroHoraFim = '';
  sortKey: 'tipo' | 'metodo' | 'valor' | 'data' = 'data';
  sortDir: 'asc' | 'desc' = 'desc';

  tipo: TipoMovManual = 'entrada';
  valor: number | null = null;
  descricao = '';
  loading = false;
  error = '';
  success = '';
  sumEntradas = 0;
  sumRetiradas = 0;
  sumVendas = 0;
  hasMore = false;
  total = 0;

  constructor(
    private readonly api: ApiService,
    private readonly caixaService: CaixaService,
    public readonly router: Router,
  ) { }

  ngOnInit(): void {
    this.loadResumoEMovimentacoes();
  }

  voltarAoDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  // modais de abrir/fechar removidos: operadores usam botões em outros pontos (ex: dashboard/ponto-venda)

  onChangeData(): void { this.page = 1; this.loadResumoEMovimentacoes(); }
  onChangeMes(): void { this.page = 1; this.loadResumoEMovimentacoes(); }
  onChangeModo(): void { this.page = 1; this.loadResumoEMovimentacoes(); }

  private loadResumoEMovimentacoes(): void {
    this.error = '';
    this.loading = true;
    let dataParam: string | undefined;
    let periodoInicio: string | undefined;
    let periodoFim: string | undefined;
    if (this.filtroModo === 'dia') {
      dataParam = this.dataSelecionada;
    } else if (this.filtroModo === 'mes') {
      const [y, m] = this.mesSelecionado.split('-').map(Number);
      const first = new Date(y, (m || 1) - 1, 1);
      const last = new Date(y, (m || 1), 0);
      periodoInicio = first.toISOString().substring(0, 10);
      periodoFim = last.toISOString().substring(0, 10);
    }

    forkJoin({
      resumoVendas: this.api.getResumoDia(this.dataSelecionada),
      resumoMovs: this.caixaService.getResumoMovimentacoesDia(dataParam),
      movimentacoes: this.caixaService.listarMovimentacoes({
        data: dataParam,
        tipo: this.filtroTipo || undefined,
        metodo_pagamento: this.filtroMetodo || undefined,
        hora_inicio: this.filtroHoraInicio || undefined,
        hora_fim: this.filtroHoraFim || undefined,
        periodo_inicio: periodoInicio,
        periodo_fim: periodoFim,
        page: this.page,
        size: this.pageSize,
      })
    }).subscribe({
      next: ({ resumoVendas, resumoMovs, movimentacoes }) => {
        this.resumoVendasDia = resumoVendas;
        this.resumo = resumoMovs as any;
        const payload = movimentacoes as any;
        let lista = payload?.items || [];
        // garantir que o campo usuario seja preenchido com operador quando disponível
        lista = lista.map((m: any) => ({
          ...m,
          usuario: m.usuario || (m.operador ? (m.operador.username || m.operador) : null)
        }));
        // Consolidar vendas multi (que vêm uma linha por método do backend) em uma única linha por venda
        this.movimentacoes = this.consolidarVendasMulti(lista);
        this.hasMore = !!payload?.hasNext;
        this.total = Number(payload?.total || 0);
        this.sumEntradas = Number(payload?.sum_entradas || 0);
        this.sumRetiradas = Number(payload?.sum_retiradas || 0);
        this.sumVendas = Number(payload?.sum_vendas || 0);
        this.applySorting();
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Erro ao carregar dados do caixa';
        this.loading = false;
        logger.error('CAIXA_COMPONENT', 'LOAD_DADOS', 'Erro ao carregar', err);
      }
    });
  }

  // paginação
  page = 1;
  pageSize: 20 | 50 | 100 = 20;
  setPageSize(n: 20 | 50 | 100) {
    this.pageSize = n;
    this.page = 1;
    this.loadResumoEMovimentacoes();
  }

  get totalPages(): number {
    const totalItems = Number(this.total || 0);
    const perPage = Number(this.pageSize || 1);
    const pages = Math.ceil(totalItems / perPage);
    return Math.max(1, pages || 1);
  }

  get paginationItems(): Array<number | string> {
    const totalPages = this.totalPages;
    const currentPage = this.page;
    const siblings = 2; // quantidade de páginas vizinhas a exibir

    const range: Array<number | string> = [];
    if (totalPages <= 1) return [1];

    range.push(1);

    const leftSibling = Math.max(2, currentPage - siblings);
    const rightSibling = Math.min(totalPages - 1, currentPage + siblings);

    if (leftSibling > 2) {
      range.push('…');
    }

    for (let i = leftSibling; i <= rightSibling; i++) {
      range.push(i);
    }

    if (rightSibling < totalPages - 1) {
      range.push('…');
    }

    if (totalPages > 1) {
      range.push(totalPages);
    }
    return range;
  }

  goToPage(targetPage: number): void {
    const page = Math.max(1, Math.min(this.totalPages, Math.floor(Number(targetPage) || 1)));
    if (page === this.page) return;
    this.page = page;
    this.loadResumoEMovimentacoes();
  }

  nextPage() {
    if (this.page < this.totalPages) {
      this.goToPage(this.page + 1);
    }
  }

  prevPage() {
    if (this.page > 1) {
      this.goToPage(this.page - 1);
    }
  }

  goToFirstPage(): void { this.goToPage(1); }
  goToLastPage(): void { this.goToPage(this.totalPages); }

  jumpPage: number | null = null;
  onJumpToPage(): void {
    if (this.jumpPage == null) return;
    this.goToPage(this.jumpPage);
  }

  onClickPage(p: number | string): void {
    if (typeof p === 'number') {
      this.goToPage(p);
    }
  }

  goBy(delta: number): void {
    const target = this.page + delta;
    this.goToPage(target);
  }

  aplicarFiltrosMovs(): void {
    this.loadResumoEMovimentacoes();
  }

  limparFiltrosMovs(): void {
    this.filtroTipo = '';
    this.filtroMetodo = '';
    this.filtroHoraInicio = '';
    this.filtroHoraFim = '';
    this.loadResumoEMovimentacoes();
  }

  setSort(key: 'tipo' | 'metodo' | 'valor' | 'data'): void {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = key === 'data' ? 'desc' : 'asc';
    }
    this.applySorting();
  }

  private applySorting(): void {
    const dir = this.sortDir === 'asc' ? 1 : -1;
    this.movimentacoes.sort((a, b) => {
      switch (this.sortKey) {
        case 'valor':
          return (a.valor - b.valor) * dir;
        case 'tipo':
          return (a.tipo.localeCompare(b.tipo)) * dir;
        case 'metodo': {
          const la = this.getMetodosTexto(a).toLowerCase();
          const lb = this.getMetodosTexto(b).toLowerCase();
          return la.localeCompare(lb) * dir;
        }
        case 'data':
        default:
          return (new Date(a.data_movimento).getTime() - new Date(b.data_movimento).getTime()) * dir;
      }
    });
  }

  getMetodoLabel(metodo: string): string {
    switch (metodo) {
      case 'dinheiro': return 'Dinheiro';
      case 'cartao_credito': return 'Crédito';
      case 'cartao_debito': return 'Débito';
      case 'pix': return 'PIX';
      default: return metodo || '';
    }
  }

  get totalVendasHoje(): number {
    return Number(this.resumoVendasDia?.receita_total || 0);
  }

  get saldoMovimentacoesHoje(): number {
    return Number(this.resumo?.saldo_movimentacoes || 0);
  }

  get totalNoCaixaHoje(): number {
    if (this.filtroModo === 'dia') {
      return this.totalVendasHoje + this.saldoMovimentacoesHoje;
    }
    const saldoMovPeriodo = (this.sumEntradas || 0) - (this.sumRetiradas || 0);
    return (this.sumVendas || 0) + saldoMovPeriodo;
  }

  registrar(): void {
    if (this.valor == null || this.valor <= 0) {
      this.error = 'Informe um valor válido';
      return;
    }
    this.loading = true;
    this.error = '';
    this.success = '';
    this.caixaService.adicionarMovimentacao({ tipo: this.tipo, valor: Number(this.valor), descricao: this.descricao || undefined })
      .subscribe({
        next: (resp) => {
          this.success = resp.message;
          this.valor = null;
          this.descricao = '';
          this.loading = false;
          this.loadResumoEMovimentacoes();
        },
        error: (error) => {
          this.error = error.error?.error || 'Erro ao registrar movimentação';
          this.loading = false;
        }
      });
  }

  exportarCsv(): void {
    const linhas: string[] = [];
    const headers = ['Tipo', 'Produto', 'Valor', 'Descricao', 'Metodo', 'Usuario', 'DataHora'];
    linhas.push(headers.join(','));
    for (const m of this.movimentacoes) {
      const row = [
        m.tipo,
        (m.produto_nome || '').replaceAll(',', ' '),
        (m.valor ?? 0).toFixed(2),
        (m.descricao || '').replaceAll(',', ' '),
        this.getMetodosTexto(m).replaceAll(',', ' '),
        (m.usuario || '').replaceAll(',', ' '),
        new Date(m.data_movimento).toLocaleString('pt-BR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
      ];
      linhas.push(row.join(','));
    }
    const csv = linhas.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `movimentacoes-caixa-${this.filtroModo}-${this.dataSelecionada}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  getMetodosTexto(m: { metodo_pagamento?: string; pagamento_valor?: number; descricao?: string; total_venda?: number }): string {
    const anyM: any = m as any;
    if (Array.isArray(anyM.pagamentos_badges) && anyM.pagamentos_badges.length) {
      return anyM.pagamentos_badges.map((b: string) => this.formatBadgeFromRaw(b)).join(' | ');
    }
    if (m?.total_venda != null && typeof m?.descricao === 'string') {
      const re = /\(([^)]+)\)/;
      const parenMatch = re.exec(m.descricao); // conteúdo entre parênteses
      if (parenMatch?.[1]) {
        return this.formatBadgeFromRaw(parenMatch[1]);
      }
      const parts = m.descricao.split(' - ');
      const last = parts[parts.length - 1];
      return last?.trim() || '';
    }
    const label = this.getMetodoLabel(m.metodo_pagamento || '');
    if (m.pagamento_valor != null) {
      return `${label} · R$ ${(Number(m.pagamento_valor) || 0).toFixed(2)}`;
    }
    return label || '-';
  }

  getMetodoBadges(m: { metodo_pagamento?: string; pagamento_valor?: number; descricao?: string; total_venda?: number }): string[] {
    const anyM: any = m as any;
    if (Array.isArray(anyM.pagamentos_badges) && anyM.pagamentos_badges.length) {
      return anyM.pagamentos_badges.map((b: string) => this.formatBadgeFromRaw(b));
    }
    if (m?.total_venda != null && typeof m?.descricao === 'string') {
      const re = /\(([^)]+)\)/;
      const parenMatch = re.exec(m.descricao);
      if (parenMatch?.[1]) {
        return [this.formatBadgeFromRaw(parenMatch[1])];
      }
      const parts = m.descricao.split(' - ');
      const last = (parts[parts.length - 1] || '').trim();
      return last.split('|').map(s => this.formatBadgeFromRaw(s)).filter(Boolean);
    }
    const label = this.getMetodoLabel(m.metodo_pagamento || '');
    if (!label) return [];
    if (m.pagamento_valor != null) {
      return [`${label} · R$ ${(Number(m.pagamento_valor) || 0).toFixed(2)}`];
    }
    return [label];
  }

  formatMesCompacto(ym: string): string {
    if (!ym || ym.length < 7) return '';
    const [yStr, mStr] = ym.split('-');
    const year = Number(yStr);
    const month = Number(mStr);
    if (!year || !month) return '';
    const dt = new Date(year, month - 1, 1);
    const mes = dt.toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
    const yy = String(year).slice(-2);
    return `${mes.charAt(0).toUpperCase()}${mes.slice(1)}/${yy}`;
  }

  /**
   * Agrupa vendas multi (descricao inicia com 'Venda (multi)') que chegam duplicadas (uma por método de pagamento)
   * em uma única linha por id, ajustando o campo valor para o total da venda.
   */
  private consolidarVendasMulti(lista: any[]): any[] {
    const resultado: any[] = [];
    const vistos = new Set<number | string>();
    for (const item of lista) {
      const isMulti = item && item.tipo === 'venda' && typeof item.descricao === 'string' && item.descricao.startsWith('Venda (multi)');
      if (isMulti) {
        if (vistos.has(item.id)) {
          continue; // já consolidado
        }
        vistos.add(item.id);
        let valorTotal = 0;
        if (typeof item.total_venda === 'number') {
          valorTotal = item.total_venda;
        } else if (typeof item.valor === 'number') {
          valorTotal = item.valor;
        }
        // Extrair breakdown (depois do último ' - ')
        let breakdownStr = '';
        const lastSep = item.descricao.lastIndexOf(' - ');
        if (lastSep >= 0) {
          breakdownStr = item.descricao.substring(lastSep + 3).trim();
        }
        const badgesRaw = breakdownStr.split('|').map((s: string) => s.trim()).filter(Boolean);
        const copia = { ...item, valor: valorTotal, metodo_pagamento: 'multi', pagamentos_badges: badgesRaw, usuario: item.usuario || (item.operador ? item.operador.username : null) };
        resultado.push(copia);
      } else {
        resultado.push(item);
      }
    }
    return resultado;
  }

  private formatBadgeFromRaw(entry: string): string {
    const cleaned = entry.replace(/total/i, '').trim();
    const idx = cleaned.indexOf('R$');
    if (idx > 0) {
      const metodo = cleaned.substring(0, idx).trim();
      const valor = cleaned.substring(idx).trim();
      return `${metodo} · ${valor}`;
    }
    return cleaned;
  }
}


