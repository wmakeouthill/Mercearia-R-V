import { Component, OnInit, HostListener } from '@angular/core';
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
  // Filtros adicionais: hora (0-23) e dia da semana (0=Dom .. 6=Sab)
  selectedHora: number | null = null;
  selectedDiaSemana: number | null = null;
  // Resumo calculado (getter) dos filtros ativos que impactam receita por método / top itens
  get resumoFiltros(): string[] {
    const r: string[] = [];
    if (this.selectedDiaSerie) r.push('Dia ' + this.formatDia(this.selectedDiaSerie));
    if (this.selectedDiaSemana != null) r.push('Semana ' + this.nomeDiaSemana(this.selectedDiaSemana));
    if (this.selectedHora != null) r.push(('0' + this.selectedHora).slice(-2) + 'h');
    return r;
  }
  chartOptionsBar: any;
  chartOptionsLine: any;
  chartOptionsPie: any;

  carregando = true;
  erro = '';

  constructor(private readonly api: ApiService, private readonly router: Router) { }

  ngOnInit(): void {
    this.restaurarFiltrosPersistidos();
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
        // Se falhou ao carregar vendas legado (backend pode ter removido endpoint), tentar prosseguir apenas com checkout
        logger.warn('GRAFICOS_VENDAS', 'LOAD_LEGADO_FAIL', 'Falha ao carregar vendas legado, tentando apenas vendas completas (checkout)', { err });
        this.vendasLegado = [];
        // Tentar buscar somente o checkout para não impedir os gráficos
        this.api.getVendasCompletas().subscribe({
          next: completas => {
            this.vendasCheckout = this.mapCheckoutParaLinhas(completas);
            this.unificarVendas();
            this.definirAnos();
            this.recalcularTudo();
            this.carregando = false;
          },
          error: errC => {
            logger.error('GRAFICOS_VENDAS', 'LOAD_CHECKOUT_FAIL_AFTER_LEGADO', 'Erro ao carregar checkout após falha no legado', { errC, originalErr: err });
            this.vendasCheckout = [];
            this.unificarVendas();
            this.definirAnos();
            this.recalcularTudo();
            this.carregando = false;
            this.erro = 'Falha ao carregar vendas';
          }
        });
      }
    });
  }

  private mapCheckoutParaLinhas(raw: any[]): Venda[] {
    if (!Array.isArray(raw)) return [];
    const linhas: Venda[] = [];
    for (const ordem of raw) {
      const pagamentos = Array.isArray(ordem?.pagamentos) ? ordem.pagamentos : [];
      const itens = Array.isArray(ordem?.itens) ? ordem.itens : [];
      const ajustes = Array.isArray(ordem?.ajustes) ? ordem.ajustes : (Array.isArray(ordem?.adjustments) ? ordem.adjustments : []);
      const { metodoSum, pagamentosResumo } = this._extrairResumoPagamentos(pagamentos);
      const returnedMap = this._mapAjustesRetornos(ajustes);
      const { linhasItens, brutoPedido, returnedTotalPedido } = this._construirLinhasItens(ordem, itens, pagamentos, pagamentosResumo, metodoSum, returnedMap);
      for (const li of linhasItens as any[]) { (li as any)._isCheckout = true; }
      linhas.push(...linhasItens);
      this._finalizarPedido(ordem, linhasItens, brutoPedido, returnedTotalPedido);
    }
    const ordenadas = linhas.sort((a, b) => parseDate(a.data_venda).getTime() - parseDate(b.data_venda).getTime());
    // Log resumo pós-mapeamento
    try {
      const bruto = ordenadas.reduce((s, v: any) => s + (Number(v.preco_total) || 0), 0);
      const liquido = ordenadas.reduce((s, v: any) => s + this.getNetValor(v), 0);
      const devolvido = ordenadas.reduce((s, v: any) => s + (Number(v.returned_total) || 0), 0);
      logger.info('GRAFICOS_VENDAS', 'MAP_CHECKOUT_SUMMARY', 'Resumo linhas checkout', {
        linhas: ordenadas.length,
        bruto,
        liquido,
        devolvido
      });
    } catch { /* ignore */ }
    return ordenadas;
  }

  private _extrairResumoPagamentos(pagamentos: any[]): { metodoSum: Record<string, number>; pagamentosResumo: string } {
    const metodoSum: Record<string, number> = {};
    for (const p of pagamentos) {
      const m = p.metodo;
      metodoSum[m] = (metodoSum[m] || 0) + Number(p.valor || 0);
    }
    const pagamentosResumo = Object.keys(metodoSum).map(m => `${m}: R$ ${metodoSum[m].toFixed(2)}`).join(' + ');
    return { metodoSum, pagamentosResumo };
  }

  private _mapAjustesRetornos(ajustes: any[]): Record<number, number> {
    const returnedQtyPorItem: Record<number, number> = {};
    for (const aj of ajustes) {
      if (aj?.type === 'return') {
        const sid = Number(aj.sale_item_id);
        const q = Number(aj.quantity || 0);
        if (sid) returnedQtyPorItem[sid] = (returnedQtyPorItem[sid] || 0) + q;
      }
    }
    return returnedQtyPorItem;
  }

  private _construirLinhasItens(ordem: any, itens: any[], pagamentos: any[], pagamentosResumo: string, metodoSum: Record<string, number>, returnedMap: Record<number, number>) {
    const linhasItens: Venda[] = [];
    let returnedTotalPedido = 0;
    // mapa auxiliar: preco unitário por sale_item_id
    const unitBySid: Record<number, number> = {};
    try {
      for (const it of itens) {
        const sid = Number(it?.id || it?.sale_item_id || it?.saleItemId || 0);
        const unit = Number(it?.preco_unitario || it?.precoUnitario || 0) || 0;
        if (sid) unitBySid[sid] = unit;
      }
    } catch { /* ignore */ }
    for (let idx = 0; idx < itens.length; idx++) {
      const it = itens[idx];
      const saleItemId = Number(it?.id || it?.sale_item_id || it?.saleItemId);
      const qtdVendida = Number(it.quantidade);
      const precoTotalItem = Number(it.preco_total);
      const qtdDevolvida = saleItemId ? (returnedMap[saleItemId] || 0) : 0;
      const valorDevolvidoItem = qtdVendida > 0 ? (precoTotalItem * (qtdDevolvida / qtdVendida)) : 0;
      returnedTotalPedido += valorDevolvidoItem;
      const linha: Venda = {
        id: ordem.id,
        produto_id: it.produto_id,
        quantidade_vendida: qtdVendida,
        preco_total: precoTotalItem,
        data_venda: ordem?.data_venda,
        metodo_pagamento: pagamentos[0]?.metodo || 'dinheiro',
        produto_nome: this._annotateProdutoNome(it.produto_nome, qtdDevolvida, qtdVendida),
        produto_imagem: it.produto_imagem,
        pagamentos_resumo: pagamentosResumo
      } as any;
      if (qtdDevolvida > 0) {
        (linha as any).returned_quantity = qtdDevolvida;
        (linha as any).returned_total = valorDevolvidoItem;
      }
      if (idx === 0) {
        (linha as any).metodos_sum = metodoSum;
        (linha as any).pedido_linha_principal = true;
      }
      linhasItens.push(linha);
    }
    // Mapear trocas por item e somatório por método do pedido
    try {
      const ajustes: any[] = Array.isArray(ordem?.ajustes) ? ordem.ajustes : (Array.isArray(ordem?.adjustments) ? ordem.adjustments : []);
      const idToIndex: Record<number, number> = {};
      for (let i = 0; i < itens.length; i++) {
        const sid = Number(itens[i]?.id || itens[i]?.sale_item_id || itens[i]?.saleItemId || 0);
        if (sid) idToIndex[sid] = i;
      }
      const exchangeMethodSum: Record<string, number> = {};
      const returnMethodSum: Record<string, number> = {};
      for (const a of ajustes) {
        const t = String(a?.type || a?.tipo || '').toLowerCase();
        if (t === 'exchange' || t === 'troca') {
          let diffRaw: any = a.difference ?? a.diferenca ?? a.price_difference ?? (a as any).priceDifference ?? (a as any).valor_diferenca ?? a.amount ?? a.valor ?? 0;
          if (typeof diffRaw === 'string') {
            const cleaned = diffRaw.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
            const parsed = Number(cleaned); if (!isNaN(parsed)) diffRaw = parsed;
          }
          const diffNum = Number(diffRaw) || 0;
          const sid = Number(a.sale_item_id || a.saleItemId || 0);
          let idxItem: number | null = null;
          if (sid && idToIndex[sid] != null) idxItem = idToIndex[sid];
          if (idxItem == null) {
            const rpid = Number((a as any).replacement_product_id || (a as any).replacementProductId || 0);
            if (rpid) {
              idxItem = (linhasItens as any[]).findIndex(li => Number((li as any).produto_id || 0) === rpid);
              if (idxItem !== null && idxItem < 0) idxItem = null;
            }
          }
          if (idxItem == null) {
            // fallback: maior preco_total
            let maxVal = -Infinity; let idxMax = 0;
            for (let i = 0; i < linhasItens.length; i++) {
              const val = Number((linhasItens[i] as any).preco_total || 0) || 0;
              if (val > maxVal) { maxVal = val; idxMax = i; }
            }
            idxItem = idxMax;
          }
          const alvo = linhasItens[idxItem as number] as any;
          alvo.exchange_difference_total = Number(alvo.exchange_difference_total || 0) + diffNum;
          const pm = String((a as any).payment_method || (a as any).metodo_pagamento || '').toLowerCase();
          if (pm) exchangeMethodSum[pm] = (exchangeMethodSum[pm] || 0) + diffNum;
        } else if (t === 'return' || t === 'devolucao') {
          const pm = String((a as any).payment_method || (a as any).metodo_pagamento || '').toLowerCase();
          let valRaw: any = (a as any).amount ?? (a as any).valor ?? (a as any).refund_amount ?? (a as any).valor_reembolso;
          if (valRaw == null) {
            const sid = Number(a.sale_item_id || a.saleItemId || 0);
            const q = Number((a as any).quantity || (a as any).quantidade || 0) || 0;
            const unit = unitBySid[sid] || 0;
            valRaw = unit * q;
          }
          if (typeof valRaw === 'string') {
            const cleaned = valRaw.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
            const parsed = Number(cleaned);
            if (!isNaN(parsed)) valRaw = parsed;
          }
          const valNum = Number(valRaw) || 0;
          if (pm && valNum) returnMethodSum[pm] = (returnMethodSum[pm] || 0) + valNum;
        }
      }
      if (linhasItens.length > 0) {
        (linhasItens[0] as any).exchange_method_sum = exchangeMethodSum; // guardar no principal
        (linhasItens[0] as any).return_method_sum = returnMethodSum; // guardar no principal
      }
    } catch { /* ignore */ }
    const brutoPedido = itens.reduce((s: number, it: any) => s + Number(it.preco_total || 0), 0);
    return { linhasItens, brutoPedido, returnedTotalPedido };
  }

  private _finalizarPedido(ordem: any, linhasItens: Venda[], brutoPedido: number, returnedTotalPedido: number) {
    if (!linhasItens.length) return;
    const principal = linhasItens[0];
    const returnedTotalBackend = Number(ordem?.returned_total ?? ordem?.returnedTotal ?? 0) || 0;
    const netTotalBackend = Number(ordem?.net_total ?? ordem?.preco_total_liquido ?? ordem?.total_liquido ?? NaN);
    const returnedTotal = returnedTotalBackend > 0 ? returnedTotalBackend : returnedTotalPedido;
    if (returnedTotal > 0) (principal as any).returned_total = returnedTotal;
    const netCalcBase = !isNaN(netTotalBackend) ? netTotalBackend : Math.max(0, brutoPedido - returnedTotal);
    // Somar diferença de troca (adicional/troco) do pedido ao valor líquido
    let exchangeDiffTotal = 0;
    try {
      const ajustes: any[] = Array.isArray(ordem?.ajustes) ? ordem.ajustes : Array.isArray(ordem?.adjustments) ? ordem.adjustments : [];
      for (const a of ajustes) {
        const t = String(a?.type || a?.tipo || '').toLowerCase();
        if (t === 'exchange' || t === 'troca') {
          let diffRaw: any = a.difference ?? a.diferenca ?? a.price_difference ?? (a as any).priceDifference ?? (a as any).valor_diferenca ?? a.amount ?? a.valor ?? 0;
          if (typeof diffRaw === 'string') {
            const cleaned = diffRaw.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
            const parsed = Number(cleaned);
            if (!isNaN(parsed)) diffRaw = parsed;
          }
          exchangeDiffTotal += Number(diffRaw) || 0;
        }
      }
    } catch { /* ignore */ }
    const netCalc = Number(netCalcBase) + Number(exchangeDiffTotal || 0);
    (principal as any).preco_total_liquido = netCalc;
    (principal as any).net_total = netCalc;
    (principal as any)._bruto_pedido = brutoPedido;
    (principal as any)._net_pedido = netCalc;
    if (returnedTotal > 0) {
      const zero = netCalc <= 0.00001;
      (principal as any).produto_nome = this._annotateStatusPedido(principal.produto_nome || 'Pedido', zero ? 'full' : 'partial');
    }
    // Garantir que soma dos itens fecha com líquido do pedido
    try {
      const sumItems = linhasItens.reduce((s: number, it: any) => {
        const bruto = Number(it.preco_total || 0) || 0;
        const devolvido = Number(it.returned_total || 0) || 0;
        const exch = Number(it.exchange_difference_total || 0) || 0;
        return s + (bruto - devolvido + exch);
      }, 0);
      const delta = Number((principal as any).net_total || 0) - sumItems;
      if (Math.abs(delta) > 0.0001) {
        // Atribuir delta ao item com maior preco_total
        let idxMax = -1; let maxVal = -Infinity;
        for (let i = 0; i < linhasItens.length; i++) {
          const val = Number(((linhasItens[i] as any).preco_total) || 0) || 0;
          if (val > maxVal) { maxVal = val; idxMax = i; }
        }
        if (idxMax >= 1) {
          const tgt = linhasItens[idxMax] as any;
          tgt.exchange_difference_total = Number(tgt.exchange_difference_total || 0) + delta;
        }
      }
    } catch { /* ignore */ }
  }

  private _annotateProdutoNome(nome: string, qtdDevolvida: number, qtdVendida: number): string {
    if (!qtdDevolvida) return nome;
    if (qtdDevolvida >= qtdVendida) return `${nome} (Devolvido qtd: ${qtdDevolvida})`;
    return `${nome} (Devolvido qtd: ${qtdDevolvida}/${qtdVendida})`;
  }

  private _annotateStatusPedido(nome: string, tipo: 'full' | 'partial'): string {
    if (tipo === 'full') return `${nome} (Devolvido)`;
    return `${nome} (Devolvido parcial)`;
  }

  private getNetValor(v: any): number {
    try {
      if (!v) return 0;
      const bruto = Number(v.preco_total || 0) || 0;
      const direto = Number(v.preco_total_liquido ?? v.net_total ?? NaN);
      if (!isNaN(direto)) return direto;
      const ret = Number(v.returned_total || 0) || 0;
      return Math.max(0, bruto - ret);
    } catch { return 0; }
  }

  private unificarVendas() {
    this.vendas = [...this.vendasLegado, ...this.vendasCheckout];
    // ordenar por data crescente para série temporal
    this.vendas.sort((a, b) => parseDate(a.data_venda).getTime() - parseDate(b.data_venda).getTime());
    try {
      const bruto = this.vendas.reduce((s, v: any) => s + (Number(v.preco_total) || 0), 0);
      const liquido = this.vendas.reduce((s, v: any) => s + this.getNetValor(v), 0);
      const devolvido = this.vendas.reduce((s, v: any) => s + (Number(v.returned_total) || 0), 0);
      logger.info('GRAFICOS_VENDAS', 'UNIFICAR_VENDAS', 'Resumo unificado', { linhas: this.vendas.length, bruto, liquido, devolvido });
    } catch { /* ignore */ }
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
      // Ao mudar granularidade, se sair de 'dia' limpar filtro de dia específico (não faz sentido em granularidade maior)
      if (g !== 'dia') this.selectedDiaSerie = null;
      this.salvarFiltros();
      this.recalcularTudo();
    }
  }

  voltarRelatorio() {
    this.router.navigate(['/relatorios']);
  }

  recalcularTudo() {
    try {
      const baseGlobal = this.vendasFiltradas(); // base geral (datas / ano / granularidade)
      try {
        const brutoG = baseGlobal.reduce((s, v: any) => s + (Number(v.preco_total) || 0), 0);
        const liquidoG = baseGlobal.reduce((s, v: any) => s + this.getNetValor(v), 0);
        logger.info('GRAFICOS_VENDAS', 'RECALC_BASE_GLOBAL', 'Base filtrada', { linhas: baseGlobal.length, bruto: brutoG, liquido: liquidoG, granularidade: this.granularidade });
      } catch { /* ignore */ }
      // Série temporal mostra sempre a base global
      this.gerarSerieTemporal(baseGlobal);

      // Base para gráficos de hora e diaSemana: afetados somente por seleção de dia da série temporal
      const baseTempo = (this.granularidade === 'dia' && this.selectedDiaSerie)
        ? baseGlobal.filter(v => extractLocalDate(v.data_venda) === this.selectedDiaSerie)
        : baseGlobal;
      this.gerarVendasPorHora(baseTempo);
      this.gerarVendasPorDiaSemana(baseTempo);

      // Base para receita por método e top itens: aplicar todos os filtros combinados
      let baseDetalhe = baseTempo; // já inclui filtro de diaSerie se houver
      if (this.selectedDiaSemana != null) {
        baseDetalhe = baseDetalhe.filter(v => parseDate(v.data_venda).getDay() === this.selectedDiaSemana);
      }
      if (this.selectedHora != null) {
        baseDetalhe = baseDetalhe.filter(v => parseDate(v.data_venda).getHours() === this.selectedHora);
      }
      this.gerarReceitaPorMetodo(baseDetalhe);
      this.gerarItensMaisVendidos(baseDetalhe);
      try {
        const brutoDet = baseDetalhe.reduce((s, v: any) => s + (Number(v.preco_total) || 0), 0);
        const liquidoDet = baseDetalhe.reduce((s, v: any) => s + this.getNetValor(v), 0);
        logger.info('GRAFICOS_VENDAS', 'RECALC_DETALHE', 'Bases detalhe pós-filtros', {
          linhas: baseDetalhe.length,
          bruto: brutoDet,
          liquido: liquidoDet,
          filtros: this.resumoFiltros
        });
      } catch { /* ignore */ }
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
      const isPrincipal = (v as any).pedido_linha_principal === true;
      if (!isPrincipal) continue;
      const d = parseDate(v.data_venda);
      arr[d.getHours()] += this.getNetValor(v);
    }
    try {
      const total = arr.reduce((a, b) => a + b, 0);
      logger.info('GRAFICOS_VENDAS', 'CHART_HORA', 'Resumo', { horasComValor: arr.filter(v => v > 0).length, totalLiquido: total });
    } catch { /* ignore */ }
    const labels = arr.map((_, h) => h.toString().padStart(2, '0') + 'h');
    const highlightColor = '#FF9800';
    const baseColor = 'rgba(0,46,89,0.65)';
    const backgroundColor = this.selectedHora == null ? baseColor : arr.map((_, i) => i === this.selectedHora ? highlightColor : baseColor);
    this.vendasPorHoraData = {
      labels,
      datasets: [{
        label: 'Receita',
        data: arr,
        backgroundColor,
        hoverBackgroundColor: 'rgba(0,46,89,0.85)',
        borderRadius: 6,
        maxBarThickness: 38
      }]
    };
  }

  private gerarVendasPorDiaSemana(base: Venda[]) {
    const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const soma = new Array(7).fill(0);
    for (const v of base) {
      const isPrincipal = (v as any).pedido_linha_principal === true;
      if (!isPrincipal) continue;
      const d = parseDate(v.data_venda);
      soma[d.getDay()] += this.getNetValor(v);
    }
    try {
      logger.info('GRAFICOS_VENDAS', 'CHART_DIA_SEMANA', 'Resumo', { diasComValor: soma.filter(v => v > 0).length, totalLiquido: soma.reduce((a, b) => a + b, 0) });
    } catch { /* ignore */ }
    const highlightColor = '#FF9800';
    const baseColor = 'rgba(219,194,125,0.75)';
    const backgroundColor = this.selectedDiaSemana == null ? baseColor : soma.map((_, i) => i === this.selectedDiaSemana ? highlightColor : baseColor);
    this.vendasPorDiaSemanaData = {
      labels: nomes,
      datasets: [{
        label: 'Receita',
        data: soma,
        backgroundColor,
        hoverBackgroundColor: 'rgba(219,194,125,0.95)',
        borderRadius: 6,
        maxBarThickness: 44
      }]
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
    // Nova estratégia: somar diretamente pagamentos + trocas - devoluções por método (linha principal)
    const vistos = new Set<any>();
    for (const v of base) {
      const raw: any = v as any;
      if (raw._isCheckout === true && raw.pedido_linha_principal !== true) continue;
      if (vistos.has(v.id)) continue; // uma linha por pedido
      // montaremos um mapa local e garantiremos que feche com o líquido do pedido
      const local: Record<string, number> = { dinheiro: 0, cartao_credito: 0, cartao_debito: 0, pix: 0 };
      const basePag = (raw.metodos_sum || raw.pagamentos_sum) as Record<string, number> | undefined;
      if (basePag) {
        Object.entries(basePag).forEach(([met, valor]) => {
          const key = normalizar(met);
          local[key] = (local[key] || 0) + (Number(valor || 0) || 0);
        });
      } else {
        const key = normalizar(raw.metodo_pagamento);
        local[key] = (local[key] || 0) + this.getNetValor(v);
      }
      const exSum = raw.exchange_method_sum as Record<string, number> | undefined;
      if (exSum) {
        Object.entries(exSum).forEach(([met, valor]) => {
          const key = normalizar(met);
          local[key] = (local[key] || 0) + (Number(valor || 0) || 0);
        });
      }
      const retSum = raw.return_method_sum as Record<string, number> | undefined;
      if (retSum) {
        Object.entries(retSum).forEach(([met, valor]) => {
          const key = normalizar(met);
          local[key] = (local[key] || 0) - (Number(valor || 0) || 0);
        });
      }
      // fechar delta com o líquido do pedido
      const expected = this.getNetValor(v);
      const localSum = Object.values(local).reduce((a, b) => a + (Number(b) || 0), 0);
      let delta = Math.round((expected - localSum) * 100) / 100;
      if (Math.abs(delta) >= 0.01) {
        let fallback = 'dinheiro';
        const keys = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'];
        if (!keys.some(k => (local[k] || 0) > 0)) {
          fallback = normalizar(raw.metodo_pagamento);
        } else if ((local['dinheiro'] || 0) > 0) {
          fallback = 'dinheiro';
        } else {
          let maxK: any = 'dinheiro'; let maxV = -Infinity;
          for (const k of keys) { const val = Number(local[k] || 0); if (val > maxV) { maxV = val; maxK = k; } }
          fallback = maxK;
        }
        local[fallback] = Number(local[fallback] || 0) + delta;
        // re-checar arredondamento de centavos residuais
        const check = Object.values(local).reduce((a, b) => a + (Number(b) || 0), 0);
        delta = Math.round((expected - check) * 100) / 100;
        if (Math.abs(delta) >= 0.01) {
          local[fallback] = Number(local[fallback] || 0) + delta;
        }
      }
      // acumular no total
      Object.entries(local).forEach(([k, vnum]) => { soma[k] = (soma[k] || 0) + (Number(vnum) || 0); });
      vistos.add(v.id);
    }
    // Garantir números válidos
    Object.keys(soma).forEach(k => { if (!isFinite(soma[k])) soma[k] = 0; });
    try {
      const totalCalc = Object.values(soma).reduce((a, b) => a + b, 0);
      (window as any)._ultimaSomaMetodos = { ...soma, total: totalCalc };
      logger.info('GRAFICOS_VENDAS', 'CHART_METODO', 'Resumo metodos (direto)', { ...soma, total: totalCalc });
    } catch { /* ignore */ }

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
      const raw: any = v as any;
      // Contar todas as linhas de item (principal ou não)
      const baseNome = v.produto_nome || `#${v.produto_id}`;
      const nome = String(baseNome).replace(/\s*\(Devolvido.*\)$/i, '');
      if (!map.has(nome)) map.set(nome, { receita: 0 });
      const bruto = Number(raw.preco_total || 0) || 0;
      const devolvido = Number(raw.returned_total || 0) || 0;
      const exch = Number(raw.exchange_difference_total || 0) || 0;
      const add = (bruto - devolvido) + exch;
      map.get(nome)!.receita += add;
    }
    const allItems = [...map.entries()].map(([nome, v]) => ({ nome, receita: v.receita }));
    try {
      const totalItens = allItems.reduce((s, it) => s + it.receita, 0);
      logger.info('GRAFICOS_VENDAS', 'ITEMS_LIQUID_SUMMARY', 'Resumo itens líquidos (antes do corte)', {
        itens: allItems.length,
        total: totalItens,
        amostras: allItems.slice(0, 20)
      });
    } catch { /* ignore */ }
    const top = allItems
      .sort((a, b) => b.receita - a.receita)
      .slice(0, 10);
    this.itensMaisVendidosData = {
      labels: top.map(t => t.nome),
      datasets: [{ label: 'Receita', data: top.map(t => t.receita), backgroundColor: 'rgba(0,46,89,0.55)', hoverBackgroundColor: 'rgba(0,46,89,0.8)', borderRadius: 6, maxBarThickness: 52 }]
    };
    try {
      logger.info('GRAFICOS_VENDAS', 'CHART_TOP_ITENS', 'Resumo', { itensConsiderados: map.size, topCount: top.length, topTotal: top.reduce((s, i) => s + i.receita, 0) });
    } catch { /* ignore */ }
  }

  formatDia(labelISO: string): string {
    // converte YYYY-MM-DD para dd/mm/aa
    const [ano, mes, dia] = labelISO.split('-');
    return `${dia}/${mes}/${ano.slice(2)}`;
  }

  private gerarSerieTemporal(base: Venda[]) {
    const grupos = new Map<string, number>();
    for (const v of base) {
      const isPrincipal = (v as any).pedido_linha_principal === true;
      if (!isPrincipal) continue;
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
      grupos.set(chave, (grupos.get(chave) || 0) + this.getNetValor(v));
    }
    try {
      const total = Array.from(grupos.values()).reduce((a, b) => a + b, 0);
      logger.info('GRAFICOS_VENDAS', 'CHART_SERIE_TEMPORAL', 'Resumo', { pontos: grupos.size, totalLiquido: total, granularidade: this.granularidade });
    } catch { /* ignore */ }
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
    this.salvarFiltros();
    // Ao mudar seleção de data, manter outros filtros; recalc
    this.recalcularTudo();
  }

  // Clique em barra de hora
  onHoraClick(evt: any) {
    const active = evt?.active as any[];
    if (!active?.length || !this.vendasPorHoraData) return;
    const idx = active[0].index;
    if (idx == null) return;
    this.selectedHora = this.selectedHora === idx ? null : idx;
    this.salvarFiltros();
    // Recalcular apenas gráficos dependentes (receita por método e itens) e destacar barras
    this.recalcularTudo();
  }

  // Clique em barra de dia da semana
  onDiaSemanaClick(evt: any) {
    const active = evt?.active as any[];
    if (!active?.length || !this.vendasPorDiaSemanaData) return;
    const idx = active[0].index;
    if (idx == null) return;
    this.selectedDiaSemana = this.selectedDiaSemana === idx ? null : idx;
    this.salvarFiltros();
    this.recalcularTudo();
  }

  limparFiltroHora() { this.selectedHora = null; this.salvarFiltros(); this.recalcularTudo(); }
  limparFiltroDiaSemana() { this.selectedDiaSemana = null; this.salvarFiltros(); this.recalcularTudo(); }
  limparTodosFiltros() {
    this.selectedHora = null;
    this.selectedDiaSemana = null;
    if (this.granularidade === 'dia') {
      this.selectedDiaSerie = null;
    }
    this.salvarFiltros();
    this.recalcularTudo();
  }

  // Nome do dia da semana abreviado para resumo
  private nomeDiaSemana(idx: number): string { return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][idx] || ''; }

  // Persistência simples em localStorage
  private salvarFiltros() {
    try {
      const payload = {
        granularidade: this.granularidade,
        selectedDiaSerie: this.selectedDiaSerie,
        selectedHora: this.selectedHora,
        selectedDiaSemana: this.selectedDiaSemana,
        dataInicio: this.dataInicio,
        dataFim: this.dataFim,
        ano: this.anoSelecionado
      };
      localStorage.setItem('gv_filtros', JSON.stringify(payload));
    } catch { /* ignore */ }
  }
  private restaurarFiltrosPersistidos() {
    try {
      const raw = localStorage.getItem('gv_filtros');
      if (!raw) return;
      const parsed = JSON.parse(raw || '{}');
      if (parsed.granularidade) this.granularidade = parsed.granularidade;
      this.selectedDiaSerie = parsed.selectedDiaSerie || null;
      this.selectedHora = parsed.selectedHora ?? null;
      this.selectedDiaSemana = parsed.selectedDiaSemana ?? null;
      this.dataInicio = parsed.dataInicio || '';
      this.dataFim = parsed.dataFim || '';
      this.anoSelecionado = parsed.ano;
    } catch { /* ignore */ }
  }

  // Tecla ESC limpa todos filtros
  @HostListener('document:keydown', ['$event'])
  handleKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      if (this.selectedDiaSerie || this.selectedHora != null || this.selectedDiaSemana != null) {
        this.limparTodosFiltros();
      }
    }
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
