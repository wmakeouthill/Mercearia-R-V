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

// Plugin para desenhar valores sobre barras, pontos e fatias de pizza.
// Para pizza: agora TODAS as fatias usam rótulo externo (% + valor) para consistência visual.
const valueLabelPlugin = {
  id: 'valueLabel',
  afterDatasetsDraw(chart: Chart) {
    const { ctx, chartArea } = chart as any;
    const canvasTop = 0; // topo do canvas
    function resolveY(existing: Array<{ y: number; h: number; }>, targetY: number, height: number, chartH: number): number {
      let y = targetY;
      let attempts = 0;
      let dir = y < chartH / 2 ? -1 : 1;
      while (existing.some(u => Math.abs(y - u.y) < (u.h + 2)) && attempts < 24) {
        y += dir * 8;
        if (y < 18) { y = 18; dir = 1; }
        if (y > chartH - 18) { y = chartH - 18; dir = -1; }
        attempts++;
      }
      return Math.min(Math.max(y, 18), chartH - 18);
    }
    function drawOneExterior(ctx: CanvasRenderingContext2D, chart: any, lbl: any, used: Array<{ y: number; h: number; }>) {
      const arc = lbl.arc; const angle = lbl.angle; const outer = arc.outerRadius;
      const startPtX = arc.x + Math.cos(angle) * outer;
      const startPtY = arc.y + Math.sin(angle) * outer;
      const mid = computeMidPoint(arc, angle, chart, used);
      const side = Math.cos(angle) >= 0 ? 1 : -1;
      const metrics = measureLabel(ctx, lbl.lines);
      const textX = computeTextX(mid.x, metrics.maxW, side, arc, chart, arc.circumference);
      const endX = textX - side * 2; // gap menor para aproximar texto
      drawConnector(ctx, startPtX, startPtY, mid.x, mid.y, endX, lbl.color);
      drawLabelLines(ctx, lbl.lines, textX, mid.y, side, lbl.color);
    }

    function computeMidPoint(arc: any, angle: number, chart: any, used: Array<{ y: number; h: number; }>) {
      const radialExtra = 6;
      const midPtX = arc.x + Math.cos(angle) * (arc.outerRadius + radialExtra);
      let midPtY = arc.y + Math.sin(angle) * (arc.outerRadius + radialExtra);
      midPtY = resolveY(used, midPtY, 28, chart.height);
      used.push({ y: midPtY, h: 28 });
      return { x: midPtX, y: midPtY };
    }

    function measureLabel(ctx: CanvasRenderingContext2D, lines: string[]) {
      ctx.save(); ctx.font = '600 11px "Segoe UI", sans-serif';
      const w = lines.map(l => ctx.measureText(l).width);
      ctx.restore();
      return { maxW: Math.max(...w) };
    }

    function computeTextX(midX: number, maxW: number, side: number, arc: any, chart: any, circumference: number) {
      const margin = 4; const gapFromPie = 4; const pieRight = arc.x + arc.outerRadius; const pieLeft = arc.x - arc.outerRadius;
      const frac = Math.max(circumference / (Math.PI * 2), 0);
      const MIN_HORIZ = 6; const MAX_HORIZ = 17; // encurtado
      // Menor fatia -> bem curto. Aumenta levemente com o tamanho + largura do texto.
      const desiredHoriz = MIN_HORIZ + (Math.min(frac, 0.22) / 0.22) * (MAX_HORIZ - MIN_HORIZ);
      let x = midX + side * desiredHoriz;
      if (side === 1) {
        if (x < pieRight + gapFromPie) x = pieRight + gapFromPie;
        if (x + maxW > chart.width - margin) x = chart.width - margin - maxW;
      } else {
        if (x > pieLeft - gapFromPie) x = pieLeft - gapFromPie;
        if (x - maxW < margin) x = margin + maxW;
      }
      return x;
    }

    function drawConnector(ctx: CanvasRenderingContext2D, sx: number, sy: number, mx: number, my: number, ex: number, color: string) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(mx, my); ctx.lineTo(ex, my); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fill();
      ctx.restore();
    }

    function drawLabelLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, midY: number, side: number, color: string) {
      ctx.save();
      ctx.font = '600 11px "Segoe UI", sans-serif'; ctx.fillStyle = color; ctx.textAlign = side === 1 ? 'left' : 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(lines[0], x, midY - 7);
      ctx.fillText(lines[1], x, midY + 9);
      ctx.restore();
    }
    function drawExterior(ctx: CanvasRenderingContext2D, chart: any, labels: Array<{ lines: string[]; color: string; angle: number; arc: any; }>) {
      const used: Array<{ y: number; h: number; }> = []; labels.sort((a, b) => a.angle - b.angle);
      labels.forEach(l => { if (l.arc && l.arc.circumference !== 0) drawOneExterior(ctx, chart, l, used); });
    }
    chart.data.datasets.forEach((dataset: any, datasetIndex: number) => {
      const meta: any = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      // Barras e linhas (lógica existente)
      if (['bar', 'line'].includes(meta.type)) {
        meta.data.forEach((element: any, index: number) => {
          const rawVal = dataset.data[index];
          if (rawVal == null) return;
          let x: number; let yTop: number;
          if (meta.type === 'bar') {
            x = element.x;
            yTop = element.y; // menor y = topo
          } else { // line/point
            const pos = element.tooltipPosition();
            x = pos.x; yTop = pos.y;
          }
          let valStr: string;
          if (typeof rawVal === 'number') {
            valStr = rawVal >= 1000 ? rawVal.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : rawVal.toFixed(0);
          } else {
            valStr = String(rawVal);
          }
          let drawY = yTop - 8;
          if (yTop <= chartArea.top + 0.5) {
            drawY = chartArea.top - 8;
          }
          if (drawY < canvasTop + 2) drawY = canvasTop + 2;
          ctx.save();
          ctx.font = '600 10px "Segoe UI", sans-serif';
          ctx.fillStyle = '#002E59';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(valStr, x, drawY);
          ctx.restore();
        });
        return; // nada a fazer para pizza neste bloco
      }
      // Pizza: desenhar percentuais delicados dentro das fatias
      if (meta.type === 'pie') {
        const arcs = meta.data;
        if (!arcs?.length) return;
        const total = (dataset.data as any[]).reduce((s, v) => s + (Number(v) || 0), 0) || 1;
        const bgArray = dataset.backgroundColor as any[];
        const exteriorLabels: Array<{ lines: string[]; color: string; angle: number; arc: any; }> = [];
        const LARGE_INTERNAL_THRESHOLD = 0.28; // permitir médio-grandes internas
        arcs.forEach((arc: any, index: number) => {
          if (!arc || arc.circumference === 0) return;
          const rawVal = Number(dataset.data[index]);
          if (!rawVal) return;
          const pct = rawVal / total;
          const pctStr = pct >= 0.10 ? (pct * 100).toFixed(0) + '%' : (pct * 100).toFixed(1) + '%';
          const valorStr = 'R$ ' + rawVal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const colorHex = bgArray?.[index] || '#666';
          const lum = hexLuminance(colorHex);
          const textColor = lum < 0.55 ? 'rgba(255,255,255,0.92)' : '#14303F';
          // Testar se cabe internamente para grandes
          let drewInternal = false;
          if (pct >= LARGE_INTERNAL_THRESHOLD) {
            const angleSpan = arc.endAngle - arc.startAngle;
            const testRadius = Math.max(arc.outerRadius - 4, arc.outerRadius * 0.9);
            const arcLength = angleSpan * testRadius; // usar raio maior para estimar espaço real
            ctx.save(); ctx.font = '600 11px "Segoe UI", sans-serif';
            const w1 = ctx.measureText(pctStr).width; const w2 = ctx.measureText(valorStr).width; ctx.restore();
            const maxW = Math.max(w1, w2) + 8;
            if (arcLength >= maxW) {
              const angle = (arc.startAngle + arc.endAngle) / 2;
              const r = arc.innerRadius + (arc.outerRadius - arc.innerRadius) * 0.60;
              let x = arc.x + Math.cos(angle) * r;
              const y = arc.y + Math.sin(angle) * r;
              ctx.save();
              ctx.font = '600 11px "Segoe UI", sans-serif';
              ctx.fillStyle = textColor;
              ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              const marginIn = 6; const lineMax = maxW - 8;
              if (x - lineMax / 2 < marginIn) x = marginIn + lineMax / 2;
              if (x + lineMax / 2 > chart.width - marginIn) x = chart.width - marginIn - lineMax / 2;
              ctx.fillText(pctStr, x, y - 6);
              ctx.fillText(valorStr, x, y + 8);
              ctx.restore();
              drewInternal = true;
            }
          }
          if (!drewInternal) {
            const externalColor = '#14303F'; // força cor escura sempre visível fora
            exteriorLabels.push({ lines: [pctStr, valorStr], color: externalColor, angle: (arc.startAngle + arc.endAngle) / 2, arc });
          }
        });
        // Resto: desenhar externos
        drawExterior(ctx, chart, exteriorLabels);
      }
    });
  }
};

// Utilitário para luminância aproximada de um hex (#RRGGBB)
function hexLuminance(hex: string): number {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  // fórmula simples perceptiva
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Plugin de hover simplificado (usa apenas detecção nativa para evitar offsets)
const betterPieHoverPlugin = {
  id: 'betterPieHover',
  afterEvent(chart: any, args: any) {
    if (chart.config.type !== 'pie') return;
    const e = args.event; if (!e) return;
    if (!['mousemove', 'pointermove', 'mouseenter'].includes(e.type)) return;
    const els = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true);
    const hitIndex = els?.length ? els[0].index : null;
    if (hitIndex === chart._lastActiveBetterPieIndex) return;
    const native: any = e.native || e;
    updateActive(chart, hitIndex, native.x ?? native.clientX ?? 0, native.y ?? native.clientY ?? 0);
  }
};

// Plugin para reservar um espaçamento visual entre a pizza e a legenda, empurrando a pizza um pouco para cima
// sem afastar a legenda do bottom do canvas.
const pieLegendGapPlugin = {
  id: 'pieLegendGap',
  afterLayout(chart: any) {
    if (chart.config.type !== 'pie') return;
    const legend = chart.legend;
    if (!legend || !chart.chartArea) return;
    const desiredGap = 34; // gap menor para descer pizza+legenda mantendo respiro
    const currentGap = legend.top - chart.chartArea.bottom;
    const need = desiredGap - currentGap;
    if (need > 0) {
      // Reduz a área de desenho (bottom) para criar o gap; limita para não inverter
      chart.chartArea.bottom = Math.max(chart.chartArea.top + 50, chart.chartArea.bottom - need);
    }
  }
};

// Plugin para encolher a pizza e abrir espaço consistente para rótulos externos
const pieShrinkPlugin = {
  id: 'pieShrink',
  beforeDatasetsDraw(chart: any) {
    if (chart.config.type !== 'pie') { return; }
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data) { return; }
    const factor = 0.56; // pizza menor para dar espaço aos rótulos externos
    meta.data.forEach((arc: any) => {
      if (!arc) return;
      arc._origOuterRadius ??= arc.outerRadius;
      arc.outerRadius = arc._origOuterRadius * factor;
    });
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

function detectWithTolerance(arcs: any[], x: number, y: number, angleBoost = 1): number | null {
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
    const startTol = start - angleTol * angleBoost;
    const endTol = end + angleTol * angleBoost;
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
  // Redesenhar leve sem recalcular layout completo melhora responsividade
  chart.draw();
}

Chart.register(...registerables, pieShrinkPlugin, valueLabelPlugin, betterPieHoverPlugin, pieLegendGapPlugin);

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
  // Mapeia as chaves (YYYY-MM-DD quando granularidade = 'dia') usadas internamente na série
  private serieTemporalRawKeys: string[] = [];
  // Dia selecionado via clique na série temporal (formato YYYY-MM-DD). Se null, nenhum filtro adicional.
  selectedDiaSerie: string | null = null;
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
      // Mais espaço superior para rótulos externos não serem cortados
      // Rebalancear: reduzir top para aproximar pizza do topo e aumentar bottom para descer legenda
      layout: { padding: { top: 18, bottom: 0, left: 0, right: 0 } },
      plugins: {
        legend: {
          position: 'bottom',
          fullSize: true,
          labels: {
            color: 'rgba(0,46,89,0.75)',
            font: { weight: '500', size: 11 },
            usePointStyle: true,
            boxWidth: 12,
            align: 'center',
            padding: 6,
            boxHeight: 12
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
      elements: { arc: { hoverOffset: 10 } },
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
      let idx = 0;
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
        if (idx === 0) {
          (linha as any).metodos_sum = metodoSum; // anexa apenas na primeira linha do pedido
          (linha as any).pedido_linha_principal = true;
        }
        linhas.push(linha);
        idx++;
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

  recalcularTudo() {
    try {
      const base = this.vendasFiltradas(); // base filtrada por datas / ano / granularidade
      // Para outros gráficos, se houver seleção de dia na série (apenas quando granularidade='dia'), aplicar filtro adicional
      const baseParaOutros = (this.granularidade === 'dia' && this.selectedDiaSerie)
        ? base.filter(v => extractLocalDate(v.data_venda) === this.selectedDiaSerie)
        : base;
      // Gráficos dependentes da seleção
      this.gerarVendasPorHora(baseParaOutros);
      this.gerarVendasPorDiaSemana(baseParaOutros);
      this.gerarReceitaPorMetodo(baseParaOutros);
      this.gerarItensMaisVendidos(baseParaOutros);
      // A série temporal sempre mostra o conjunto completo (não restringe ao ponto clicado)
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
    const normalizar = (m: any): string => {
      if (!m) return 'dinheiro';
      const s = String(m).toLowerCase().normalize('NFD').replace(/[^a-z0-9_]/g, '');
      if (s.includes('pix')) return 'pix';
      if (s.includes('debito')) return 'cartao_debito';
      if (s.includes('credito')) return 'cartao_credito';
      if (s.includes('din') || s.includes('cash') || s.includes('money')) return 'dinheiro';
      return s as any;
    };
    const pedidosProcessados = new Set<any>();
    for (const v of base) {
      const raw: any = v as any;
      if (raw.metodos_sum && !pedidosProcessados.has(v.id)) {
        // pedido com múltiplos métodos - usar soma detalhada
        Object.entries(raw.metodos_sum as Record<string, number>).forEach(([met, valor]) => {
          const key = normalizar(met);
          if (!(key in soma)) soma[key] = 0;
          soma[key] += valor;
        });
        pedidosProcessados.add(v.id);
      } else if (!raw.metodos_sum) {
        // legado ou venda simples
        const key = normalizar(raw.metodo_pagamento);
        if (!(key in soma)) soma[key] = 0;
        soma[key] += v.preco_total;
      }
    }
    // Garantir números válidos
    Object.keys(soma).forEach(k => { if (!isFinite(soma[k])) soma[k] = 0; });
    // Debug (pode remover depois) – só loga uma vez por recalculo
    try { (window as any)._ultimaSomaMetodos = soma; console.debug('[GRAFICOS] soma metodos', soma); } catch { }

    const labels: string[] = []; const dataVals: number[] = []; const bg: string[] = []; const bgHover: string[] = [];
    const push = (label: string, val: number, color: string, hover: string) => { labels.push(label); dataVals.push(val); bg.push(color); bgHover.push(hover); };
    push('Dinheiro', soma['dinheiro'] || 0, '#4CAF50', '#43A047');
    push('Cartão Crédito', soma['cartao_credito'] || 0, '#3F51B5', '#3949AB');
    push('Cartão Débito', soma['cartao_debito'] || 0, '#E53935', '#D32F2F');
    push('PIX', soma['pix'] || 0, '#FFB74D', '#FFA726');
    // Adiciona outros métodos detectados dinamicamente (exceto os já tratados)
    Object.keys(soma).filter(k => !['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'].includes(k)).forEach(k => {
      const val = soma[k]; if (val > 0) push(k.replace(/_/g, ' ').toUpperCase(), val, '#8D6E63', '#795548');
    });
    this.receitaPorMetodoData = {
      labels,
      datasets: [
        {
          label: 'Receita',
          data: dataVals,
          backgroundColor: bg,
          hoverBackgroundColor: bgHover,
          borderColor: '#ffffff',
          borderWidth: 1,
          hoverOffset: 12,
          hoverBorderColor: '#002E59',
          hoverBorderWidth: 1.6
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

  formatDia(labelISO: string): string {
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
    this.serieTemporalRawKeys = keysOrdenadas; // guardar para mapear clique -> chave
    // Destacar ponto selecionado (quando granularidade dia)
    let pointBackgroundColor: string | string[] | undefined;
    let pointRadius: number | number[] | undefined;
    if (isDia && this.selectedDiaSerie) {
      pointBackgroundColor = keysOrdenadas.map(k => k === this.selectedDiaSerie ? '#FF9800' : '#DBC27D');
      pointRadius = keysOrdenadas.map(k => k === this.selectedDiaSerie ? 6 : 3);
    }
    this.serieTemporalData = {
      labels,
      datasets: [{
        label: 'Receita',
        data,
        borderColor: '#002E59',
        backgroundColor: 'rgba(0,46,89,0.15)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor,
        pointRadius
      }]
    };
  }

  // Handler de clique na série temporal
  onSerieClick(evt: any) {
    if (!this.serieTemporalData || this.granularidade !== 'dia') return;
    const active = evt?.active as any[];
    if (!active?.length) {
      return;
    }
    const idx = active[0].index;
    const chave = this.serieTemporalRawKeys[idx]; // YYYY-MM-DD
    if (!chave) return;
    // Toggle seleção
    if (this.selectedDiaSerie === chave) {
      this.selectedDiaSerie = null;
    } else {
      this.selectedDiaSerie = chave;
    }
    this.recalcularTudo();
  }

  exportarPNG(id: string) {
    const src = document.getElementById(id);
    if (!(src instanceof HTMLCanvasElement)) return;
    // Criar canvas temporário para aplicar fundo branco (canvas original pode ter fundo transparente)
    const w = src.width, h = src.height;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0);
    tmp.toBlob(b => { if (b) this.saveBlob(b, `${id}.png`); }, 'image/png');
  }

  exportarCSV(tipo: string) {
    // Usar BOM para manter acentos em Excel / Windows e aspas para proteger vírgulas
    const linhas: string[] = ['label,valor'];
    const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
    const add = (pairs: SerieTemporalPoint[]) => pairs.forEach(p => linhas.push(`${quote(p.label)},${p.valor}`));
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
    const conteudo = '\uFEFF' + linhas.join('\r\n') + '\r\n'; // BOM + CRLF final
    this.saveBlob(new Blob([conteudo], { type: 'text/csv;charset=utf-8;' }), `${nome}.csv`);
  }

  private saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
}
