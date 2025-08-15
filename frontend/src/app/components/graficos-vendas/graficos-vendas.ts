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

// Plugin simples para desenhar valores sobre barras e pontos
const valueLabelPlugin = {
  id: 'valueLabel',
  afterDatasetsDraw(chart: Chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset: any, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      meta.data.forEach((element: any, index: number) => {
        const value = dataset.data[index];
        if (value == null) return;
        ctx.save();
        ctx.font = '600 10px "Segoe UI", sans-serif';
        ctx.fillStyle = '#002E59';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const { x, y } = element.tooltipPosition();
        let valStr: string;
        if (typeof value === 'number') {
          if (value >= 1000) {
            valStr = value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
          } else {
            valStr = value.toFixed(0);
          }
        } else {
          valStr = String(value);
        }
        ctx.fillText(valStr, x, y - 4);
        ctx.restore();
      });
    });
  }
};

Chart.register(...registerables, valueLabelPlugin);

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
  vendas: Venda[] = [];

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
      }
    };
    this.chartOptionsBar = common;
    this.chartOptionsLine = {
      ...common,
      elements: { line: { borderWidth: 2 }, point: { radius: 3, hoverRadius: 5, backgroundColor: '#DBC27D', borderColor: '#002E59', borderWidth: 1 } }
    };
    this.chartOptionsPie = {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#002E59', font: { weight: '600' } } },
        tooltip: { callbacks: { label: (ctx: any) => `${ctx.label}: R$ ${Number(ctx.parsed).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` } }
      }
    };
  }

  private carregar() {
    this.carregando = true;
    this.api.getVendas().subscribe({
      next: vs => {
        this.vendas = Array.isArray(vs) ? vs : [];
        this.recalcularTudo();
        this.carregando = false;
      },
      error: err => {
        this.erro = 'Falha ao carregar vendas';
        this.carregando = false;
        logger.error('GRAFICOS_VENDAS', 'LOAD_FAIL', 'Erro ao carregar vendas', { err });
      }
    });
  }

  alterarGranularidade(g: Granularidade) {
    if (this.granularidade !== g) {
      this.granularidade = g;
      this.gerarSerieTemporal();
    }
  }

  voltarRelatorio() {
    this.router.navigate(['/relatorios']);
  }

  private recalcularTudo() {
    try {
      this.gerarVendasPorHora();
      this.gerarVendasPorDiaSemana();
      this.gerarReceitaPorMetodo();
      this.gerarItensMaisVendidos();
      this.gerarSerieTemporal();
    } catch (e) {
      logger.error('GRAFICOS_VENDAS', 'RECALC', 'Erro ao recalcular', { e });
    }
  }

  private gerarVendasPorHora() {
    const arr = new Array(24).fill(0);
    for (const v of this.vendas) {
      const d = parseDate(v.data_venda);
      arr[d.getHours()] += v.preco_total;
    }
    this.vendasPorHoraData = {
      labels: arr.map((_, h) => h.toString().padStart(2, '0') + 'h'),
      datasets: [{ label: 'Receita', data: arr, backgroundColor: 'rgba(0,46,89,0.65)', hoverBackgroundColor: 'rgba(0,46,89,0.85)', borderRadius: 6, maxBarThickness: 38 }]
    };
  }

  private gerarVendasPorDiaSemana() {
    const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const soma = new Array(7).fill(0);
    for (const v of this.vendas) {
      const d = parseDate(v.data_venda);
      soma[d.getDay()] += v.preco_total;
    }
    this.vendasPorDiaSemanaData = {
      labels: nomes,
      datasets: [{ label: 'Receita', data: soma, backgroundColor: 'rgba(219,194,125,0.75)', hoverBackgroundColor: 'rgba(219,194,125,0.95)', borderRadius: 6, maxBarThickness: 44 }]
    };
  }

  private gerarReceitaPorMetodo() {
    const soma: Record<string, number> = { dinheiro: 0, cartao_credito: 0, cartao_debito: 0, pix: 0 };
    for (const v of this.vendas) soma[v.metodo_pagamento] += v.preco_total;
    this.receitaPorMetodoData = {
      labels: ['Dinheiro', 'Cartão Crédito', 'Cartão Débito', 'PIX'],
      datasets: [
        {
          label: 'Receita',
          data: [soma['dinheiro'], soma['cartao_credito'], soma['cartao_debito'], soma['pix']],
          backgroundColor: ['#28A745', '#003366', '#17A2B8', '#DBC27D']
        }
      ]
    };
  }

  private gerarItensMaisVendidos() {
    const map = new Map<string, { receita: number }>();
    for (const v of this.vendas) {
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

  private gerarSerieTemporal() {
    const grupos = new Map<string, number>();
    for (const v of this.vendas) {
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
    const labels = [...grupos.keys()].sort((a, b) => a.localeCompare(b));
    const data = labels.map(l => grupos.get(l) || 0);
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
