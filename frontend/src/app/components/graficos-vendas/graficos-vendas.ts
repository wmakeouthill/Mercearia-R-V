import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartData, registerables, Chart } from 'chart.js';
import { NgChartsModule } from 'ng2-charts';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { Venda } from '../../models';
import { parseDate, extractLocalDate } from '../../utils/date-utils';
import { logger } from '../../utils/logger';

// Plugin simples para desenhar valores sobre barras e pontos (evita corte e tenta ficar acima)
const valueLabelPlugin = {
  id: 'valueLabel',
  afterDatasetsDraw(chart: Chart) {
    const { ctx, chartArea } = chart as any;
    const canvasTop = 0; // topo do canvas
    chart.data.datasets.forEach((dataset: any, datasetIndex: number) => {
      const meta: any = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      // Só desenhar para barras e linhas (evitar pizza)
      if (!['bar', 'line'].includes(meta.type)) return;
      meta.data.forEach((element: any, index: number) => {
        const rawVal = dataset.data[index];
        if (rawVal == null) return;
        let x: number; let yTop: number;
        if (meta.type === 'bar') {
          // Para barra vertical (indexAxis default) o topo é element.y
          x = element.x;
          yTop = element.y; // menor y = topo
        } else { // line/point
          const pos = element.tooltipPosition();
          x = pos.x; yTop = pos.y;
        }
        // Converter valor para string
        let valStr: string;
        if (typeof rawVal === 'number') {
          valStr = rawVal >= 1000 ? rawVal.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : rawVal.toFixed(0);
        } else {
          valStr = String(rawVal);
        }
        // Posição alvo: acima do topo da barra / ponto
        let drawY = yTop - 8;
        // Se a barra encosta o chartArea.top, queremos ficar no padding acima (fora da barra)
        if (yTop <= chartArea.top + 0.5) {
          drawY = chartArea.top - 8; // acima da área de plotagem
        }
        // Segurança: não permitir sair do canvas totalmente
        if (drawY < canvasTop + 2) drawY = canvasTop + 2;
        ctx.save();
        ctx.font = '600 10px "Segoe UI", sans-serif';
        ctx.fillStyle = '#002E59';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(valStr, x, drawY);
        ctx.restore();
      });
    });
  }
};

// Plugin para melhorar precisão do hover em fatias pequenas de pizza
const betterPieHoverPlugin = {
  id: 'betterPieHover',
  afterEvent(chart: any, args: any) {
    if (chart.config.type !== 'pie') return;
    const e = args.event; if (e?.type !== 'mousemove') return;
    const meta = chart.getDatasetMeta(0); const arcs = meta?.data; if (!arcs?.length) return;
    const cssX = e.native?.offsetX ?? e.x;
    const cssY = e.native?.offsetY ?? e.y;

    let hitIndex = detectNative(chart, e);
    hitIndex ??= detectInRange(arcs, cssX, cssY);
    hitIndex ??= detectWithTolerance(arcs, cssX, cssY);
    if (hitIndex === chart._lastActiveBetterPieIndex) return;
    updateActive(chart, hitIndex, cssX, cssY);
  }
};

function detectNative(chart: any, e: any): number | null {
  const els = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true);
  return els?.length ? els[0].index : null;
}

function detectInRange(arcs: any[], x: number, y: number): number | null {
  for (let i = 0; i < arcs.length; i++) if (arcs[i].inRange(x, y, 'mouse')) return i;
  return null;
}

function detectWithTolerance(arcs: any[], x: number, y: number): number | null {
  const centerX = arcs[0].x, centerY = arcs[0].y;
  const dx = x - centerX, dy = y - centerY;
  const ang = ((Math.atan2(dy, dx) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const dist = Math.hypot(dx, dy);
  for (let i = 0; i < arcs.length; i++) {
    const a: any = arcs[i];
    const startRaw = a.startAngle, endRaw = a.endAngle;
    const start = ((startRaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const end = ((endRaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const wedge = end >= start ? end - start : (Math.PI * 2 - start + end);
    const { extraRad, angleTol } = pieHitTolerances(wedge);
    const startTol = start - angleTol;
    const endTol = end + angleTol;
    const withinAngle = start <= end ? (ang >= startTol && ang <= endTol) : (ang >= startTol || ang <= endTol);
    if (!withinAngle) continue;
    if (dist >= a.innerRadius - extraRad && dist <= a.outerRadius + extraRad) return i;
  }
  return null;
}

function pieHitTolerances(wedge: number) {
  // wedge em radianos
  let extraRad: number;
  if (wedge < 0.08) extraRad = 8; else if (wedge < 0.12) extraRad = 5; else extraRad = 3;
  let angleTol: number;
  if (wedge < 0.06) angleTol = 0.045; else if (wedge < 0.10) angleTol = 0.03; else angleTol = 0;
  return { extraRad, angleTol };
}

function findArcHit(arcs: any[], mx: number, my: number, cx: number, cy: number): number | null {
  const dx = mx - cx, dy = my - cy;
  const angle = ((Math.atan2(dy, dx) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const dist = Math.hypot(dx, dy);
  const baseTol = 6;
  for (let i = 0; i < arcs.length; i++) {
    const a: any = arcs[i];
    const start = ((a.startAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const end = ((a.endAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const withinAngle = start <= end ? (angle >= start && angle <= end) : (angle >= start || angle <= end);
    if (!withinAngle) continue;
    const wedgeAngle = end >= start ? end - start : (Math.PI * 2 - start + end);
    let extra = 0;
    if (wedgeAngle < 0.06) extra = 10; else if (wedgeAngle < 0.12) extra = 6;
    const tol = baseTol + extra;
    if (dist >= a.innerRadius - tol && dist <= a.outerRadius + tol) return i;
  }
  return null;
}

function updateActive(chart: any, idx: number | null, mx: number, my: number) {
  if (idx == null) {
    chart.setActiveElements([]);
    chart.tooltip.setActiveElements([], { x: mx, y: my });
  } else {
    chart.setActiveElements([{ datasetIndex: 0, index: idx }]);
    chart.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: mx, y: my });
  }
  chart._lastActiveBetterPieIndex = idx;
  chart.update();
}

Chart.register(...registerables, valueLabelPlugin, betterPieHoverPlugin);

interface SerieTemporalPoint { label: string; valor: number; }
type Granularidade = 'dia' | 'mes' | 'trimestre' | 'semestre' | 'ano';

@Component({
  selector: 'app-graficos-vendas',
  standalone: true,
  imports: [CommonModule, NgChartsModule, FormsModule],
  templateUrl: './graficos-vendas.html',
  styleUrl: './graficos-vendas.scss'
})
export class GraficosVendasComponent implements OnInit {
  granularidade: Granularidade = 'dia';
  // Dados
  vendas: Venda[] = [];            // legado + checkout explodido
  vendasLegado: Venda[] = [];      // raw getVendas()
  vendasCheckout: Venda[] = [];    // itens explodidos de getVendasCompletas()

  // Filtros
  dataInicio: string = '';
  dataFim: string = '';
  anosDisponiveis: number[] = [];
  anoSelecionado?: number; // usado para mes/trimestre/semestre/ano

  // Chart datasets
  vendasPorHoraData?: ChartData<'bar'>;
  vendasPorDiaSemanaData?: ChartData<'bar'>;
  receitaPorMetodoData?: ChartData<'pie'>;
  itensMaisVendidosData?: ChartData<'bar'>;
  serieTemporalData?: ChartData<'line'>;
  chartOptionsBar: any;
  chartOptionsLine: any;
  chartOptionsPie: any;

  carregando = true;
  erro = '';

  constructor(private readonly api: ApiService, private readonly router: Router) { }

  ngOnInit(): void {
    this.carregar();
    this.initChartOptions();
  }

  private initChartOptions() {
    const currencyTick = (val: any) => {
      const num = Number(val);
      if (isNaN(num)) return val;
      if (num >= 1000) return 'R$ ' + (num / 1000).toFixed(1) + 'k';
      return 'R$ ' + num.toFixed(0);
    };
    const tooltipLabel = (ctx: any) => {
      const label = ctx.dataset.label ? ctx.dataset.label + ': ' : '';
      const v = ctx.parsed.y ?? ctx.parsed;
      return label + 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const common: any = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: tooltipLabel } }
      },
      scales: {
        x: { grid: { color: 'rgba(0,46,89,0.05)' }, ticks: { color: '#002E59', maxRotation: 45, minRotation: 0 } },
        y: { grid: { color: 'rgba(0,46,89,0.08)' }, ticks: { color: '#002E59', callback: currencyTick } }
      },
      layout: { padding: { top: 58, right: 10, left: 10, bottom: 8 } } // mais espaço superior p/ labels acima das barras
    };
    this.chartOptionsBar = { ...common };
    this.chartOptionsLine = {
      ...common,
      elements: { line: { borderWidth: 2 }, point: { radius: 3, hoverRadius: 5, backgroundColor: '#DBC27D', borderColor: '#002E59', borderWidth: 1 } }
    };
    this.chartOptionsPie = {
      responsive: true,
      interaction: { mode: 'nearest', intersect: true },
      layout: { padding: { top: 4, bottom: 4 } },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: 'rgba(0,46,89,0.75)',
            font: { weight: '500', size: 11 },
            usePointStyle: true,
            boxWidth: 10,
            padding: 12
          }
        },
        tooltip: { callbacks: { label: (ctx: any) => `${ctx.label}: R$ ${Number(ctx.parsed).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` } }
      },
      onHover: (evt: any, activeEls: any[]) => {
        const canvas: HTMLCanvasElement | null = evt?.native?.target || document.querySelector('#chartMetodo');
        if (canvas) {
          canvas.style.cursor = activeEls?.length ? 'pointer' : 'default';
        }
      },
      elements: { arc: { hoverOffset: 8 } },
      animation: { duration: 140 }
    };
  }

  private carregar() {
    this.carregando = true;
    // Carregar legado e checkout em paralelo
    this.api.getVendas().subscribe({
      next: legado => {
        this.vendasLegado = Array.isArray(legado) ? legado : [];
        // Depois de legado, buscar checkout
        this.api.getVendasCompletas().subscribe({
          next: completas => {
            this.vendasCheckout = this.mapCheckoutParaLinhas(completas);
            this.unificarVendas();
            this.definirAnos();
            this.recalcularTudo();
            this.carregando = false;
          },
          error: errC => {
            logger.error('GRAFICOS_VENDAS', 'LOAD_CHECKOUT_FAIL', 'Erro ao carregar checkout', { errC });
            this.vendasCheckout = [];
            this.unificarVendas();
            this.definirAnos();
            this.recalcularTudo();
            this.carregando = false;
          }
        });
      },
      error: err => {
        this.erro = 'Falha ao carregar vendas';
        this.carregando = false;
        logger.error('GRAFICOS_VENDAS', 'LOAD_FAIL', 'Erro ao carregar vendas', { err });
      }
    });
  }

  private mapCheckoutParaLinhas(raw: any[]): Venda[] {
    if (!Array.isArray(raw)) return [];
    const linhas: Venda[] = [];
    for (const ordem of raw) {
      const data = ordem?.data_venda;
      const pagamentos = Array.isArray(ordem?.pagamentos) ? ordem.pagamentos : [];
      const itens = Array.isArray(ordem?.itens) ? ordem.itens : [];
      const metodoSum: Record<string, number> = {};
      for (const p of pagamentos) {
        const m = p.metodo;
        metodoSum[m] = (metodoSum[m] || 0) + Number(p.valor || 0);
      }
      const pagamentosResumo = Object.keys(metodoSum).map(m => `${m}: R$ ${metodoSum[m].toFixed(2)}`).join(' + ');
      for (const it of itens) {
        const linha: Venda = {
          id: ordem.id,
          produto_id: it.produto_id,
          quantidade_vendida: it.quantidade,
          preco_total: it.preco_total,
          data_venda: data,
          metodo_pagamento: pagamentos[0]?.metodo || 'dinheiro',
          produto_nome: it.produto_nome,
          produto_imagem: it.produto_imagem,
          pagamentos_resumo: pagamentosResumo
        } as any;
        linhas.push(linha);
      }
    }
    return linhas.sort((a, b) => parseDate(a.data_venda).getTime() - parseDate(b.data_venda).getTime());
  }

  private unificarVendas() {
    this.vendas = [...this.vendasLegado, ...this.vendasCheckout];
    // ordenar por data crescente para série temporal
    this.vendas.sort((a, b) => parseDate(a.data_venda).getTime() - parseDate(b.data_venda).getTime());
  }

  private definirAnos() {
    const anos = new Set<number>();
    for (const v of this.vendas) anos.add(parseDate(v.data_venda).getFullYear());
    this.anosDisponiveis = [...anos].sort((a, b) => b - a); // descendente para ano mais recente primeiro
    if (!this.anoSelecionado && this.anosDisponiveis.length) this.anoSelecionado = this.anosDisponiveis[0];
  }

  aplicarFiltros() {
    this.recalcularTudo();
  }

  alterarGranularidade(g: Granularidade) {
    if (this.granularidade !== g) {
      this.granularidade = g;
      // Se mudou para modo agregado, garantir ano definido
      if (g !== 'dia' && !this.anoSelecionado && this.anosDisponiveis.length) {
        this.anoSelecionado = this.anosDisponiveis[0];
      }
      this.recalcularTudo();
    }
  }

  voltarRelatorio() {
    this.router.navigate(['/relatorios']);
  }

  private recalcularTudo() {
    try {
      const base = this.vendasFiltradas();
      this.gerarVendasPorHora(base);
      this.gerarVendasPorDiaSemana(base);
      this.gerarReceitaPorMetodo(base);
      this.gerarItensMaisVendidos(base);
      this.gerarSerieTemporal(base);
    } catch (e) {
      logger.error('GRAFICOS_VENDAS', 'RECALC', 'Erro ao recalcular', { e });
    }
  }

  private vendasFiltradas(): Venda[] {
    let list = this.vendas;
    if (this.dataInicio) {
      const ini = parseDate(this.dataInicio + 'T00:00:00');
      list = list.filter(v => parseDate(v.data_venda) >= ini);
    }
    if (this.dataFim) {
      const fim = parseDate(this.dataFim + 'T23:59:59');
      list = list.filter(v => parseDate(v.data_venda) <= fim);
    }
    if (this.granularidade !== 'dia' && this.anoSelecionado) {
      list = list.filter(v => parseDate(v.data_venda).getFullYear() === this.anoSelecionado);
    }
    return list;
  }

  private gerarVendasPorHora(base: Venda[]) {
    const arr = new Array(24).fill(0);
    for (const v of base) {
      const d = parseDate(v.data_venda);
      arr[d.getHours()] += v.preco_total;
    }
    this.vendasPorHoraData = {
      labels: arr.map((_, h) => h.toString().padStart(2, '0') + 'h'),
      datasets: [{ label: 'Receita', data: arr, backgroundColor: 'rgba(0,46,89,0.65)', hoverBackgroundColor: 'rgba(0,46,89,0.85)', borderRadius: 6, maxBarThickness: 38 }]
    };
  }

  private gerarVendasPorDiaSemana(base: Venda[]) {
    const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const soma = new Array(7).fill(0);
    for (const v of base) {
      const d = parseDate(v.data_venda);
      soma[d.getDay()] += v.preco_total;
    }
    this.vendasPorDiaSemanaData = {
      labels: nomes,
      datasets: [{ label: 'Receita', data: soma, backgroundColor: 'rgba(219,194,125,0.75)', hoverBackgroundColor: 'rgba(219,194,125,0.95)', borderRadius: 6, maxBarThickness: 44 }]
    };
  }

  private gerarReceitaPorMetodo(base: Venda[]) {
    const soma: Record<string, number> = { dinheiro: 0, cartao_credito: 0, cartao_debito: 0, pix: 0 };
    for (const v of base) soma[v.metodo_pagamento] += v.preco_total;
    this.receitaPorMetodoData = {
      labels: ['Dinheiro', 'Cartão Crédito', 'Cartão Débito', 'PIX'],
      datasets: [
        {
          label: 'Receita',
          data: [soma['dinheiro'], soma['cartao_credito'], soma['cartao_debito'], soma['pix']],
          backgroundColor: [
            '#CFE9D6', // Dinheiro (pastel verde)
            '#C3D4E6', // Crédito (pastel azul)
            '#C7ECE5', // Débito (pastel aqua)
            '#F2E4BF'  // PIX (pastel dourado)
          ],
          borderColor: 'rgba(0,0,0,0.05)',
          borderWidth: 1,
          hoverOffset: 10,
          hoverBorderColor: '#002E59',
          hoverBorderWidth: 1.2
        }
      ]
    };
  }

  private gerarItensMaisVendidos(base: Venda[]) {
    const map = new Map<string, { receita: number }>();
    for (const v of base) {
      const nome = v.produto_nome || `#${v.produto_id}`;
      if (!map.has(nome)) map.set(nome, { receita: 0 });
      map.get(nome)!.receita += v.preco_total;
    }
    const top = [...map.entries()].map(([nome, v]) => ({ nome, receita: v.receita }))
      .sort((a, b) => b.receita - a.receita).slice(0, 10);
    this.itensMaisVendidosData = {
      labels: top.map(t => t.nome),
      datasets: [{ label: 'Receita', data: top.map(t => t.receita), backgroundColor: 'rgba(0,46,89,0.55)', hoverBackgroundColor: 'rgba(0,46,89,0.8)', borderRadius: 6, maxBarThickness: 52 }]
    };
  }

  private formatDia(labelISO: string): string {
    // converte YYYY-MM-DD para dd/mm/aa
    const [ano, mes, dia] = labelISO.split('-');
    return `${dia}/${mes}/${ano.slice(2)}`;
  }

  private gerarSerieTemporal(base: Venda[]) {
    const grupos = new Map<string, number>();
    for (const v of base) {
      const d = parseDate(v.data_venda);
      const ano = d.getFullYear();
      const mes = d.getMonth(); // 0-11
      let chave: string;
      switch (this.granularidade) {
        case 'dia':
          chave = extractLocalDate(v.data_venda); break;
        case 'mes':
          chave = `${ano}-${(mes + 1).toString().padStart(2, '0')}`; break;
        case 'trimestre': {
          const tri = Math.floor(mes / 3) + 1; chave = `${ano}-T${tri}`; break;
        }
        case 'semestre': {
          const sem = mes < 6 ? 1 : 2; chave = `${ano}-S${sem}`; break;
        }
        case 'ano':
          chave = `${ano}`; break;
        default:
          chave = extractLocalDate(v.data_venda);
      }
      grupos.set(chave, (grupos.get(chave) || 0) + v.preco_total);
    }
    const keysOrdenadas = [...grupos.keys()].sort((a, b) => a.localeCompare(b));
    const isDia = this.granularidade === 'dia';
    const labels = isDia ? keysOrdenadas.map(k => this.formatDia(k)) : keysOrdenadas;
    const data = keysOrdenadas.map(k => grupos.get(k) || 0);
    this.serieTemporalData = {
      labels,
      datasets: [{ label: 'Receita', data, borderColor: '#002E59', backgroundColor: 'rgba(0,46,89,0.15)', fill: true, tension: 0.3 }]
    };
  }

  exportarPNG(id: string) {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLCanvasElement)) return;
    el.toBlob(b => { if (b) this.saveBlob(b, `${id}.png`); });
  }

  exportarCSV(tipo: string) {
    let csv = 'label,valor\n';
    const add = (pairs: SerieTemporalPoint[]) => pairs.forEach(p => csv += `${p.label},${p.valor}\n`);
    let nome = tipo;
    const extrair = (dataArr: any, labels: any[]): SerieTemporalPoint[] => labels.map((l, i) => ({ label: String(l), valor: Number(dataArr[i]) }));
    switch (tipo) {
      case 'hora':
        if (this.vendasPorHoraData) { nome = 'vendas-por-hora'; add(extrair(this.vendasPorHoraData.datasets[0].data, this.vendasPorHoraData.labels as any[])); }
        break;
      case 'dia-semana':
        if (this.vendasPorDiaSemanaData) { nome = 'vendas-por-dia-semana'; add(extrair(this.vendasPorDiaSemanaData.datasets[0].data, this.vendasPorDiaSemanaData.labels as any[])); }
        break;
      case 'metodo':
        if (this.receitaPorMetodoData) { nome = 'receita-por-metodo'; add(extrair(this.receitaPorMetodoData.datasets[0].data, this.receitaPorMetodoData.labels as any[])); }
        break;
      case 'itens':
        if (this.itensMaisVendidosData) { nome = 'itens-mais-vendidos'; add(extrair(this.itensMaisVendidosData.datasets[0].data, this.itensMaisVendidosData.labels as any[])); }
        break;
      case 'serie':
        if (this.serieTemporalData) { nome = `serie-${this.granularidade}`; add(extrair(this.serieTemporalData.datasets[0].data, this.serieTemporalData.labels as any[])); }
        break;
    }
    this.saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${nome}.csv`);
  }

  private saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
}
