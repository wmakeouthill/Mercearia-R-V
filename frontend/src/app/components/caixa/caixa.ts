import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CurrencyBrPipe } from '../../pipes/currency-br.pipe';
import { ApiService } from '../../services/api';
import { getCurrentDateForInput } from '../../utils/date-utils';
import { CaixaService } from '../../services/caixa.service';
import { AuthService } from '../../services/auth';
import { logger } from '../../utils/logger';
import { forkJoin, of, Subscription, firstValueFrom } from 'rxjs';
import { RelatorioResumo } from '../../models';
import { Router } from '@angular/router';

type TipoMovManual = 'entrada' | 'retirada';
type TipoMovLista = 'entrada' | 'retirada' | 'venda';

@Component({
  selector: 'app-caixa',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyBrPipe],
  templateUrl: './caixa.html',
  styleUrl: './caixa.scss'
})
export class CaixaComponent implements OnInit {
  filtroModo: 'tudo' | 'dia' | 'mes' = 'tudo';
  dataSelecionada = getCurrentDateForInput();
  mesSelecionado = getCurrentDateForInput().substring(0, 7);
  // Resumo de movimentações do DIA atual/selecionado (usado apenas para o card "Dia")
  resumoMovsDia: { data: string; saldo_movimentacoes: number } | null = null;
  resumoVendasDia: RelatorioResumo | null = null;
  resumoTotal: RelatorioResumo | null = null;
  lastAggs: any = null;
  movimentacoes: Array<{ id: number; tipo: TipoMovLista; valor: number | null; descricao?: string; usuario?: string; data_movimento: string; produto_nome?: string; metodo_pagamento?: string; pagamento_valor?: number; caixa_status_id?: number; caixa_status?: any }> = [];
  // When we fetch the full dataset (e.g. dia mode) keep it to paginate client-side
  fullMovimentacoes: any[] | null = null;
  filtroTipo = '';
  filtroMetodo = '';
  filtroHoraInicio = '';
  filtroHoraFim = '';
  sortKey: 'tipo' | 'metodo' | 'valor' | 'data' = 'data';
  sortDir: 'asc' | 'desc' = 'desc';
  fetchingAllPages = false;
  private currentRequestSub: Subscription | null = null;
  private loadResumoTimer: any = null;
  private readonly LOAD_DEBOUNCE_MS = 300;
  private lastRequestKey: string | null = null;

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
    public readonly authService: AuthService,
    public readonly router: Router,
  ) { }

  // confirmação customizada para exclusão de movimentação
  showConfirmModal = false;
  confirmTitle = '';
  confirmMessage = '';
  pendingDeleteMovId: number | null = null;

  ngOnInit(): void {
    this.loadResumoEMovimentacoes();
  }

  // handler chamado pelo template para excluir movimentação
  onDeleteMovClick(event: Event, id: number | undefined): void {
    event.stopPropagation();
    logger.debug('CAIXA_COMPONENT', 'DELETE_MOV_CLICK', 'onDeleteMovClick called', { id });
    if (!id) return;
    if (!this.authService.isAdmin()) { this.error = 'Permissão negada'; logger.info('CAIXA_COMPONENT', 'DELETE_MOV_CLICK', 'perm denied'); return; }

    // abrir modal customizado de confirmação (sempre)
    this.pendingDeleteMovId = id;
    this.confirmTitle = 'Confirmar exclusão';
    this.confirmMessage = 'Deseja realmente excluir esta movimentação? Esta ação não pode ser desfeita.';
    this.showConfirmModal = true;
    logger.debug('CAIXA_COMPONENT', 'DELETE_MOV_MODAL_OPENED', 'showConfirmModal set to true', { id, showConfirmModal: this.showConfirmModal });

    // Fallback: if the custom modal isn't rendered (CSS/template issues), open native confirm after short delay
    // This ensures a network call happens even if UI modal is not visible for some reason.
    setTimeout(() => {
      try {
        const dlg = document.querySelector('.confirm-dialog');
        logger.debug('CAIXA_COMPONENT', 'DELETE_MOV_MODAL_DOM_CHECK', 'checking for modal DOM node', { id, exists: !!dlg, showConfirmModal: this.showConfirmModal });
        if (!dlg) {
          logger.warn('CAIXA_COMPONENT', 'DELETE_MOV_FALLBACK', 'custom modal not found, using native confirm', { id });
          const ok = window.confirm(this.confirmMessage || 'Confirmar exclusão?');
          if (ok) {
            this.confirmModalConfirm();
          } else {
            this.confirmModalCancel();
          }
        }
      } catch (e) {
        // ignore DOM access errors; don't block flow
        logger.warn('CAIXA_COMPONENT', 'DELETE_MOV_FALLBACK_ERR', 'error checking modal DOM', e);
      }
    }, 200);
  }

  confirmModalCancel(): void {
    this.showConfirmModal = false;
    this.pendingDeleteMovId = null;
  }

  confirmModalConfirm(): void {
    this.showConfirmModal = false;
    if (!this.pendingDeleteMovId) return;
    const id = this.pendingDeleteMovId;
    this.pendingDeleteMovId = null;
    logger.debug('CAIXA_COMPONENT', 'DELETE_MOV_CONFIRM', 'calling deleteMovimentacao', { id });
    // log token presence for debugging (do not log token value in production)
    try {
      const token = this.authService.getToken();
      logger.debug('CAIXA_COMPONENT', 'DELETE_MOV_CONFIRM', 'auth token present?', { hasToken: !!token });
    } catch (e) {
      logger.warn('CAIXA_COMPONENT', 'DELETE_MOV_CONFIRM', 'failed to read token', e);
    }

    this.caixaService.deleteMovimentacao(id).subscribe({
      next: () => {
        logger.info('CAIXA_COMPONENT', 'DELETE_MOV_SUCCESS', 'movimentacao deleted', { id });
        this.movimentacoes = this.movimentacoes.filter(m => m.id !== id);
        this.success = 'Movimentação excluída com sucesso';
      },
      error: (err) => {
        logger.error('CAIXA_COMPONENT', 'DELETE_MOV_ERROR', 'Erro ao excluir movimentação', err);
        // show detailed error for debugging (admin can later remove)
        this.error = err?.error?.error || err?.message || 'Erro ao excluir movimentação';
      }
    });
  }

  // helper to log click from template (avoid using console in template)
  onMovBtnClickLog(id: number | undefined): void {
    console.debug('mov-btn-click', { id });
  }

  voltarAoDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  // modais de abrir/fechar removidos: operadores usam botões em outros pontos (ex: dashboard/ponto-venda)

  private scheduleLoadResumo(ms: number = this.LOAD_DEBOUNCE_MS): void {
    try {
      if (this.loadResumoTimer) clearTimeout(this.loadResumoTimer);
    } catch (e) {
      console.warn('Erro ao limpar timer:', e);
    }
    this.loadResumoTimer = setTimeout(() => { this.loadResumoEMovimentacoes(); this.loadResumoTimer = null; }, ms);
  }

  onChangeData(): void { this.page = 1; this.fullMovimentacoes = null; this.scheduleLoadResumo(); }
  onChangeMes(): void { this.page = 1; this.fullMovimentacoes = null; this.scheduleLoadResumo(); }
  onChangeModo(): void { this.page = 1; this.fullMovimentacoes = null; this.scheduleLoadResumo(); }

  // Helper method to build period parameters for API calls
  private buildPeriodParams(): { dataParam?: string; periodoInicio?: string; periodoFim?: string } {
    let dataParam: string | undefined;
    let periodoInicio: string | undefined;
    let periodoFim: string | undefined;

    if (this.filtroModo === 'dia') {
      dataParam = this.dataSelecionada;
      periodoInicio = undefined;
      periodoFim = undefined;
    } else if (this.filtroModo === 'mes') {
      const [y, m] = this.mesSelecionado.split('-').map(Number);
      const first = new Date(y, (m || 1) - 1, 1);
      const last = new Date(y, (m || 1), 0);
      periodoInicio = first.toISOString().substring(0, 10);
      periodoFim = last.toISOString().substring(0, 10);
    }

    return { dataParam, periodoInicio, periodoFim };
  }

  // Helper method to build listing parameters
  private buildListingParams(periodoInicio?: string, periodoFim?: string, dataParam?: string): {
    listingDataParam?: string;
    listingPeriodoInicio?: string;
    listingPeriodoFim?: string
  } {
    let listingDataParam: string | undefined = undefined;
    let listingPeriodoInicio: string | undefined = undefined;
    let listingPeriodoFim: string | undefined = undefined;

    if (this.filtroModo === 'dia') {
      listingPeriodoInicio = this.dataSelecionada;
      listingPeriodoFim = this.dataSelecionada;
    } else if (this.filtroModo === 'mes') {
      listingPeriodoInicio = periodoInicio;
      listingPeriodoFim = periodoFim;
    } else { // tudo
      listingDataParam = dataParam;
    }

    return { listingDataParam, listingPeriodoInicio, listingPeriodoFim };
  }

  // Helper method to create movement observables
  private createMovimentacoesObservables(listingDataParam?: string, listingPeriodoInicio?: string, listingPeriodoFim?: string): any {
    let movEndpoint: string;
    if (this.filtroModo === 'dia') {
      movEndpoint = 'dia';
    } else if (this.filtroModo === 'mes') {
      movEndpoint = 'mes';
    } else {
      movEndpoint = 'list';
    }

    if (movEndpoint === 'dia') {
      return this.caixaService.listarMovimentacoesDia(this.dataSelecionada);
    } else if (movEndpoint === 'mes') {
      const [y, m] = this.mesSelecionado.split('-').map(Number);
      return this.caixaService.listarMovimentacoesMes(y, m, this.page, this.pageSize as number);
    } else {
      return this.caixaService.listarMovimentacoes({
        data: this.filtroModo === 'tudo' ? listingDataParam : undefined,
        tipo: this.filtroTipo || undefined,
        metodo_pagamento: this.filtroMetodo || undefined,
        hora_inicio: this.filtroHoraInicio || undefined,
        hora_fim: this.filtroHoraFim || undefined,
        periodo_inicio: listingPeriodoInicio,
        periodo_fim: listingPeriodoFim,
        page: this.page,
        size: this.pageSize,
      });
    }
  }

  // Helper method to process aggregates and error handling
  private processAggregatesAndErrorHandling(aggs: any): void {
    try {
      this.lastAggs = aggs || null;
    } catch (e) {
      console.warn('Erro ao definir lastAggs:', e);
      this.lastAggs = null;
    }
  }

  // Helper method to log debug responses
  private logDebugResponses(resumoVendas: any, resumoMovs: any, movimentacoes: any, aggs: any): void {
    try {
      logger.info('CAIXA_COMPONENT', 'DEBUG_RESPONSES', 'Received responses from forkJoin', {
        resumoVendasRaw: resumoVendas,
        resumoMovsRaw: resumoMovs,
        movimentacoesRaw: movimentacoes,
        aggsRaw: aggs
      });
    } catch (e) {
      console.warn('Erro ao fazer log das respostas:', e);
    }
  }

  // Helper method to normalize payload
  private normalizePayload(movimentacoes: any): any {
    let payload = movimentacoes;

    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        logger.warn('CAIXA_COMPONENT', 'PARSE_MOVIMENTACOES', 'Failed to parse movimentacoes response string', e);
        payload = { items: [] };
      }
    }

    if (payload && typeof payload.items === 'string') {
      try {
        payload.items = JSON.parse(payload.items);
        logger.info('CAIXA_COMPONENT', 'PARSE_MOVIMENTACOES_ITEMS', 'Parsed string-encoded items', { count: (payload.items || []).length });
      } catch (e) {
        logger.warn('CAIXA_COMPONENT', 'PARSE_MOVIMENTACOES_ITEMS_FAIL', 'Failed to parse payload.items', e);
        payload.items = [];
      }
    }

    return payload;
  }

  // Helper method to log diagnostic info
  private logDiagnosticInfo(payload: any, aggs: any, listingPeriodoInicio?: string, listingPeriodoFim?: string): void {
    try {
      logger.info('CAIXA_COMPONENT', 'DIAG_CAIXA_FRONT', 'Frontend received aggregations and payload stats', {
        filtroModo: this.filtroModo,
        periodStart: listingPeriodoInicio,
        periodEnd: listingPeriodoFim,
        payloadTotal: payload?.total ?? (payload?.items ? payload.items.length : null),
        aggs: aggs || null
      });
    } catch (e) {
      console.warn('Erro ao fazer log de diagnóstico:', e);
    }
  }

  // Helper method to normalize resumo objects
  private normalizeResumoObjects(resumoVendas: any, resumoMovs: any, resumoTotal: any): {
    normalizedResumoMovs: any;
    normalizedResumoTotal: any
  } {
    const normalizedResumoMovs = typeof resumoMovs === 'string' ? (() => {
      try { return JSON.parse(resumoMovs); } catch (e) {
        console.warn('Erro ao parsear resumoMovs:', e);
        return null;
      }
    })() : resumoMovs;

    const normalizedResumoTotal = typeof resumoTotal === 'string' ? (() => {
      try { return JSON.parse(resumoTotal); } catch (e) {
        console.warn('Erro ao parsear resumoTotal:', e);
        return null;
      }
    })() : resumoTotal;

    // Set resumoTotal if loaded (note: resumoVendas is not used in current logic)
    if (normalizedResumoTotal && typeof normalizedResumoTotal === 'object') {
      this.resumoTotal = normalizedResumoTotal as RelatorioResumo;
    }

    return { normalizedResumoMovs, normalizedResumoTotal };
  }

  private loadResumoEMovimentacoes(): void {
    this.error = '';
    this.loading = true;
    // build a key representing the current filter/pagination parameters
    const keyObj = {
      modo: this.filtroModo,
      data: this.dataSelecionada,
      mes: this.mesSelecionado,
      tipo: this.filtroTipo,
      metodo: this.filtroMetodo,
      horaInicio: this.filtroHoraInicio,
      horaFim: this.filtroHoraFim,
      page: this.page,
      size: this.pageSize
    };
    const key = JSON.stringify(keyObj);
    // If an identical request is already in flight, skip issuing another
    if (this.currentRequestSub && this.lastRequestKey === key) {
      logger.debug('CAIXA_COMPONENT', 'DEDUPE_SKIP', 'Skipping duplicate in-flight request', { keyObj });
      this.loading = false;
      return;
    }
    this.lastRequestKey = key;

    // Use helper methods to reduce complexity
    const { dataParam, periodoInicio, periodoFim } = this.buildPeriodParams();

    // For the day-card values, always request the real current day when not
    // in 'dia' mode so the cards reflect today's numbers. When in 'dia'
    // mode, request the user-selected date.
    const todayInput = getCurrentDateForInput();
    const resumoVendasObs = this.api.getResumoDia(this.filtroModo === 'dia' ? this.dataSelecionada : todayInput);
    const resumoMovsObs = this.caixaService.getResumoMovimentacoesDia(this.filtroModo === 'dia' ? this.dataSelecionada : todayInput);

    // Para modo "tudo", também carregar dados totais
    let resumoTotalObs: any = of(null);
    if (this.filtroModo === 'tudo') {
      resumoTotalObs = this.api.getResumoTotal();
    }
    // DEBUG: log params sent to listarMovimentacoes
    try {
      // Log the raw params (data/periodo) computed above; avoid referencing
      // listing* variables that are declared later to prevent TS errors.
      logger.info('CAIXA_COMPONENT', 'DEBUG_PARAMS', 'Calling listarMovimentacoes with params', {
        filtroModo: this.filtroModo,
        dataParam,
        periodoInicio,
        periodoFim,
        filtroTipo: this.filtroTipo,
        filtroMetodo: this.filtroMetodo,
        horaInicio: this.filtroHoraInicio,
        horaFim: this.filtroHoraFim,
        page: this.page,
        size: this.pageSize
      });
    } catch (e) {
      console.warn('Erro ao fazer log dos parâmetros:', e);
    }
    // Determine listing params depending on filtroModo:
    // - 'dia' -> send explicit `data=YYYY-MM-DD`
    // - 'mes' -> send `periodo_inicio`/`periodo_fim` (YYYY-MM-DD)
    // - 'tudo' -> send `data` when set
    const { listingDataParam, listingPeriodoInicio, listingPeriodoFim } = this.buildListingParams(periodoInicio, periodoFim, dataParam);

    // cancel previous request if in-flight to avoid recursive calls
    try { if (this.currentRequestSub) this.currentRequestSub.unsubscribe(); } catch { }

    // Create movement observables using helper method
    const movimentacoesObs = this.createMovimentacoesObservables(listingDataParam, listingPeriodoInicio, listingPeriodoFim);

    // Also request aggregated sums (aggs) together so we can rely on server
    // aggregates for 'mes' mode instead of using page-scoped values.
    let aggsObs: any;
    try {
      // Para agregados, não usar filtros de tipo/metodo para incluir TODAS as movimentações
      // Isso é necessário para que os tooltips mostrem valores corretos
      const aggsParams: any = {
        // Removido: tipo: this.filtroTipo || undefined,
        // Removido: metodo_pagamento: this.filtroMetodo || undefined,
        hora_inicio: this.filtroHoraInicio || undefined,
        hora_fim: this.filtroHoraFim || undefined,
        aggs: true
      };
      if (this.filtroModo === 'dia') {
        aggsParams.data = this.dataSelecionada;
      } else if (this.filtroModo === 'mes') {
        aggsParams.periodo_inicio = listingPeriodoInicio;
        aggsParams.periodo_fim = listingPeriodoFim;
      }
      aggsObs = this.caixaService.listarMovimentacoesSummary(aggsParams);
    } catch (e) {
      console.warn('Erro ao configurar agregados:', e);
      aggsObs = of(null);
    }

    const request$ = forkJoin({ resumoVendas: resumoVendasObs, resumoMovs: resumoMovsObs, resumoTotal: resumoTotalObs, movimentacoes: movimentacoesObs, aggs: aggsObs });

    this.currentRequestSub = request$.subscribe({
      next: ({ resumoVendas, resumoMovs, resumoTotal, movimentacoes, aggs }) => {
        // Process aggregates and error handling
        this.processAggregatesAndErrorHandling(aggs);

        // Log debug responses
        this.logDebugResponses(resumoVendas, resumoMovs, movimentacoes, aggs);

        // Normalize payload
        const payload = this.normalizePayload(movimentacoes);

        // Log diagnostic info
        this.logDiagnosticInfo(payload, aggs, listingPeriodoInicio, listingPeriodoFim);

        // Normalize resumo objects (remove unused resumoVendas processing)
        const { normalizedResumoMovs } = this.normalizeResumoObjects(resumoVendas, resumoMovs, resumoTotal);

        // Remove unused processed variables to avoid lint warnings
        // The normalized variables are used directly where needed

        // Helper to filter data by date and time in 'dia' mode
        const filterDataByDateAndTime = (lista: any[]): any[] => {
          // For 'dia' mode, the backend already returns filtered data for the selected day
          // No need to filter again as it might remove valid sales
          if (this.filtroModo === 'dia') {
            // Only apply time filters if present (backend doesn't handle time filtering)
            if (!this.filtroHoraInicio && !this.filtroHoraFim) {
              return lista; // No time filters, return all data from backend
            }

            // Apply only time filters
            try {
              return (Array.isArray(lista) ? lista : []).filter((m: any) => {
                try {
                  if (this.filtroHoraInicio || this.filtroHoraFim) {
                    const vendaTs = new Date(m.data_movimento).getTime();
                    if (this.filtroHoraInicio) {
                      const sIso = this.normalizeDateTimeLocal(this.dataSelecionada, this.filtroHoraInicio);
                      if (vendaTs < new Date(sIso).getTime()) return false;
                    }
                    if (this.filtroHoraFim) {
                      const eIso = this.normalizeDateTimeLocal(this.dataSelecionada, this.filtroHoraFim);
                      if (vendaTs > new Date(eIso).getTime()) return false;
                    }
                  }
                  return true;
                } catch {
                  return false;
                }
              });
            } catch (e) {
              console.warn('Erro ao filtrar lista por horário:', e);
              return [];
            }
          }

          return lista; // For other modes, no additional filtering needed
        };

        // Helper to process usuario field
        const processUsuarioFields = (lista: any[]): any[] => {
          return lista.map((m: any) => ({
            ...m,
            usuario: m.usuario || (m.operador ? (m.operador.username || m.operador) : null)
          }));
        };

        // Helper to calculate aggregates locally
        const calculateLocalAggregates = async (consolidated: any[]): Promise<void> => {
          if (this.filtroModo === 'mes') return;

          logger.info('CAIXA_COMPONENT', 'AGGREGATES_CALC_LOCAL', 'Calculando valores agregados localmente', {
            filtroModo: this.filtroModo,
            consolidatedLength: consolidated.length,
            sumEntradasAntes: this.sumEntradas,
            sumRetiradasAntes: this.sumRetiradas
          });

          this.sumEntradas = consolidated.filter((c: any) => c.tipo === 'entrada').reduce((s: number, it: any) => s + (Number(it.valor || 0) || 0), 0);
          this.sumRetiradas = consolidated.filter((c: any) => c.tipo === 'retirada').reduce((s: number, it: any) => s + (Number(it.valor || 0) || 0), 0);

          logger.info('CAIXA_COMPONENT', 'AGGREGATES_CALC_LOCAL_RESULT', 'Valores agregados calculados localmente', {
            sumEntradas: this.sumEntradas,
            sumRetiradas: this.sumRetiradas,
            saldoCalculado: this.sumEntradas - this.sumRetiradas
          });

          await this.atualizarTooltipsMovimentacoes();
          calculateVendasSum(consolidated);
        };

        // Helper to calculate vendas sum with logging
        const calculateVendasSum = (consolidated: any[]): void => {
          let sumVendasAdj = 0;
          for (const v of consolidated.filter((c: any) => c.tipo === 'venda')) {
            sumVendasAdj += Number(v.valor || 0);
          }
          this.sumVendas = sumVendasAdj;

          // Prefer backend aggregated value when available
          try {
            if (this.lastAggs && typeof this.lastAggs.sum_vendas === 'number') {
              const agg = Number(this.lastAggs.sum_vendas || 0);
              this.sumVendas = agg;
              logger.info('CAIXA_COMPONENT', 'SUMVENDAS_SET_AGG', 'sumVendas overridden by aggregated sum_vendas', {
                filtroModo: this.filtroModo,
                agg,
                fromLocal: sumVendasAdj
              });
            }
          } catch { /* ignore */ }

          logVendasCalculation(sumVendasAdj);
        };

        // Helper to handle pagination for 'dia' mode
        const handleDiaPagination = async (consolidated: any[]): Promise<void> => {
          if (this.filtroModo !== 'dia') return;

          this.fullMovimentacoes = consolidated;
          const start = (this.page - 1) * Number(this.pageSize || 1);
          const end = start + Number(this.pageSize || 1);
          logger.info('CAIXA_COMPONENT', 'DIA_PAGINACAO', 'Paginating day-mode client-side', {
            page: this.page,
            pageSize: this.pageSize,
            consolidatedLength: consolidated.length,
            start,
            end
          });
          this.movimentacoes = consolidated.slice(start, end);
          this.total = consolidated.length;
          this.hasMore = false;
          await this.atualizarTooltipsMovimentacoes();
        };

        // Helper to log vendas calculation details
        const logVendasCalculation = (sumVendasAdj: number): void => {
          try {
            logger.info('CAIXA_COMPONENT', 'SUMVENDAS_SET_LOCAL', 'sumVendas set from local dedup', {
              filtroModo: this.filtroModo,
              sumVendasAdj,
              sumEntradas: this.sumEntradas,
              sumRetiradas: this.sumRetiradas,
              totalCaixaPrev: sumVendasAdj + this.sumEntradas - this.sumRetiradas
            });
          } catch { /* ignore */ }

          try {
            let totalInclDinheiro = 0;
            if (this.filtroModo === 'dia') {
              totalInclDinheiro = Number((this.resumoVendasDia as any)?.receita_total || 0);
            } else {
              totalInclDinheiro = Number((this.resumoTotal as any)?.receita_total || 0);
            }
            const naoDinheiro = Number(this.sumVendas || 0);
            const dinheiroEstimado = Math.max(0, totalInclDinheiro - naoDinheiro);
            const totalCaixaPrev = naoDinheiro + this.sumEntradas - this.sumRetiradas;
            logger.info('CAIXA_COMPONENT', 'DEDUP_DEBUG', 'Resumo deduplicacao vendas (simplificado)', {
              filtroModo: this.filtroModo,
              sumVendasAdj,
              totalInclDinheiro,
              naoDinheiro,
              dinheiroEstimado,
              sumEntradas: this.sumEntradas,
              sumRetiradas: this.sumRetiradas,
              totalCaixaPrev
            });
          } catch { /* ignore logging failures */ }
        };

        // helper to run the normal payload processing after ensuring we have
        // the complete items array (may require fetching additional pages).
        const finalizePayload = async (payloadObj: any) => {
          let lista = payloadObj?.items || [];
          console.log('CAIXA DEBUG: Lista inicial do backend:', lista.length, 'itens');
          console.log('CAIXA DEBUG: Tipos na lista:', lista.map((item: any) => item.tipo).join(', '));

          // Apply date and time filtering in 'dia' mode
          lista = filterDataByDateAndTime(lista);
          console.log('CAIXA DEBUG: Após filtro de data/hora:', lista.length, 'itens');

          // Handle resumoMovsDia for 'dia' mode
          if (this.filtroModo === 'dia') {
            if (normalizedResumoMovs) {
              this.resumoMovsDia = normalizedResumoMovs;
            } else {
              this.resumoMovsDia = { data: this.dataSelecionada, saldo_movimentacoes: 0 } as any;
            }
          }

          // Process usuario fields
          lista = processUsuarioFields(lista);

          // Consolidar vendas multi (que vêm uma linha por método do backend) em uma única linha por venda
          const consolidated = this.consolidarVendasMulti(lista);
          console.log('CAIXA DEBUG: Após consolidação:', consolidated.length, 'itens');
          console.log('CAIXA DEBUG: Tipos após consolidação:', consolidated.map((item: any) => item.tipo).join(', '));
          this.movimentacoes = consolidated;
          this.hasMore = !!payload?.hasNext;
          this.total = Number(payload?.total || consolidated.length);

          // Atualizar tooltips de movimentações após carregar dados
          await this.atualizarTooltipsMovimentacoes();

          // Apply pagination client-side only for 'dia' when we have the full day's list
          await handleDiaPagination(consolidated);

          // Calculate local aggregates for non-mes modes
          await calculateLocalAggregates(consolidated);
          // Synthesize resumoVendasDia and resumo from consolidated totals for all modes.
          // For 'dia' prefer server-provided aggregates (lastAggs) when available to avoid double-counting.
          // If we have the full day's list cached, prefer client-side deduplicated
          // totals to avoid relying on server aggregates that may double-count.
          if (this.filtroModo === 'dia' && !this.fullMovimentacoes?.length && this.lastAggs && (typeof this.lastAggs.sum_vendas === 'number' || typeof this.lastAggs.sum_vendas_net === 'number')) {
            logger.info('CAIXA_COMPONENT', 'AGGREGATES_SET_DIA', 'Definindo valores agregados para DIA (via lastAggs)', {
              sumEntradasAntes: this.sumEntradas,
              sumRetiradasAntes: this.sumRetiradas,
              lastAggsSumEntradas: this.lastAggs.sum_entradas,
              lastAggsSumRetiradas: this.lastAggs.sum_retiradas,
              lastAggsSumVendas: this.lastAggs.sum_vendas
            });

            this.sumEntradas = Number(this.lastAggs.sum_entradas || 0);
            this.sumRetiradas = Number(this.lastAggs.sum_retiradas || 0);
            // Preferir o agregado do backend que já exclui dinheiro, quando disponível
            this.sumVendas = Number(this.lastAggs.sum_vendas || 0);
            try {
              logger.info('CAIXA_COMPONENT', 'SUMVENDAS_SET_DIA', 'sumVendas set from lastAggs for DIA', {
                sumVendas: this.sumVendas,
                lastAggs: this.lastAggs
              });
            } catch { /* ignore */ }
            this.resumoVendasDia = { receita_total: Number(this.sumVendas || 0), total_vendas: Number(this.sumVendas || 0), quantidade_vendida: 0 } as any;
            this.resumoMovsDia = { data: this.dataSelecionada, saldo_movimentacoes: Number(this.sumEntradas || 0) - Number(this.sumRetiradas || 0) } as any;

            logger.info('CAIXA_COMPONENT', 'AGGREGATES_SET_DIA_RESULT', 'Valores agregados definidos para DIA', {
              sumEntradas: this.sumEntradas,
              sumRetiradas: this.sumRetiradas,
              sumVendas: this.sumVendas,
              saldoMovimentacoes: Number(this.sumEntradas || 0) - Number(this.sumRetiradas || 0)
            });
          } else {
            // Não sobrescrever os cards do DIA quando não estamos em modo 'dia'.
          }

          // Atualizar tooltips com os novos valores agregados
          await this.atualizarTooltipsMovimentacoes();

          // clamp page to available pages and re-slice if necessary
          try {
            const computedTotal = Number(this.total || 0);
            const perPage = Number(this.pageSize || 1) || 1;
            const totalPages = Math.max(1, Math.ceil(computedTotal / perPage));
            if (this.page > totalPages) this.page = totalPages;
            // If we have a full cached list, re-slice based on (possibly adjusted) page
            if (this.fullMovimentacoes?.length) {
              const start2 = (this.page - 1) * perPage;
              this.movimentacoes = (this.fullMovimentacoes || []).slice(start2, start2 + perPage);

              // Atualizar tooltips de movimentações após re-slice
              await this.atualizarTooltipsMovimentacoes();
            }
          } catch (e) {
            console.warn('Erro ao calcular páginas:', e);
          }
          await this.applySorting();
          this.loading = false;
        };

        // Render page 1 immediately
        finalizePayload(payload).then(() => {
          // no-op here; follow-up actions occur inside finalizePayload
        });
        // Ensure day-cards reflect the real current day when not in 'dia' mode
        if (this.filtroModo !== 'dia') {
          const today = getCurrentDateForInput();
          this.api.getResumoDia(today).subscribe({
            next: (r: any) => { try { if (r) this.resumoVendasDia = r; } catch { } },
            error: () => { }
          });
          this.caixaService.getResumoMovimentacoesDia(today).subscribe({
            next: (r: any) => { try { if (r) this.resumoMovsDia = { data: today, saldo_movimentacoes: Number(r?.saldo_movimentacoes || 0) }; } catch { } },
            error: () => { }
          });
        }
        // Avoid a second summary request here. Aggregates were already requested
        // via aggsObs in the same forkJoin above. Using a second subscription here
        // can lead to redundant/recursive requests and UI freezes.
      },
      error: (err) => {
        this.error = 'Erro ao carregar dados do caixa';
        this.loading = false;
        logger.error('CAIXA_COMPONENT', 'LOAD_DADOS', 'Erro ao carregar', err);
      },
      complete: () => { this.currentRequestSub = null; this.lastRequestKey = null; }
    });
  }

  // paginação
  page = 1;
  pageSize: 10 | 20 | 50 | 100 = 20;
  setPageSize(n: 10 | 20 | 50 | 100) {
    this.pageSize = n;
    this.page = 1;
    // if in 'dia' mode we already fetch the full day dataset and paginate client-side
    if (this.filtroModo === 'dia') {
      // Just re-apply sorting/pagination client-side
      this.applySorting();
      return;
    }
    this.scheduleLoadResumo(0);
  }

  get movimentacoesPagina(): any[] {
    try {
      // If we have a full cached list (day or month), paginate it client-side
      if (this.fullMovimentacoes?.length) {
        const start = (this.page - 1) * Number(this.pageSize || 1);
        return (this.fullMovimentacoes || []).slice(start, start + Number(this.pageSize || 1));
      }
      // Day mode with no full cache: slice current movimentacoes as fallback
      if (this.filtroModo === 'dia') {
        const start = (this.page - 1) * Number(this.pageSize || 1);
        return (this.movimentacoes || []).slice(start, start + Number(this.pageSize || 1));
      }
      // For other modes, backend provides already-paged results in this.movimentacoes
      return this.movimentacoes || [];
    } catch (e) {
      console.warn('Erro ao calcular movimentações da página:', e);
      return this.movimentacoes || [];
    }
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

  async goToPage(targetPage: number): Promise<void> {
    const page = Math.max(1, Math.min(this.totalPages, Math.floor(Number(targetPage) || 1)));
    if (page === this.page) return;
    // set the page and either paginate client-side or request server page
    this.page = page;
    if (this.filtroModo === 'dia') {
      logger.info('CAIXA_COMPONENT', 'GO_TO_PAGE_DIA', 'Changing page in dia mode', { page: this.page, pageSize: this.pageSize, fullLength: this.fullMovimentacoes ? this.fullMovimentacoes.length : null });
      // client-side pagination when we have fullMovimentacoes
      await this.applySorting();
      return;
    }
    this.scheduleLoadResumo(0);
  }

  async nextPage(): Promise<void> {
    if (this.page < this.totalPages) {
      await this.goToPage(this.page + 1);
    }
  }

  async prevPage(): Promise<void> {
    if (this.page > 1) {
      await this.goToPage(this.page - 1);
    }
  }

  async goToFirstPage(): Promise<void> { await this.goToPage(1); }
  async goToLastPage(): Promise<void> { await this.goToPage(this.totalPages); }

  jumpPage: number | null = null;
  async onJumpToPage(): Promise<void> {
    if (this.jumpPage == null) return;
    await this.goToPage(this.jumpPage);
  }

  async onClickPage(p: number | string): Promise<void> {
    if (typeof p === 'number') {
      await this.goToPage(p);
    }
  }

  async goBy(delta: number): Promise<void> {
    const target = this.page + delta;
    await this.goToPage(target);
  }

  aplicarFiltrosMovs(): void {
    this.scheduleLoadResumo();
  }

  limparFiltrosMovs(): void {
    this.filtroTipo = '';
    this.filtroMetodo = '';
    this.filtroHoraInicio = '';
    this.filtroHoraFim = '';
    this.scheduleLoadResumo();
  }

  async setSort(key: 'tipo' | 'metodo' | 'valor' | 'data'): Promise<void> {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = key === 'data' ? 'desc' : 'asc';
    }
    await this.applySorting();
  }

  private async applySorting(): Promise<void> {
    const dir = this.sortDir === 'asc' ? 1 : -1;
    // If we have a full cached list (e.g. day mode), operate on the cached list and then slice
    if (this.fullMovimentacoes?.length) {
      logger.info('CAIXA_COMPONENT', 'APPLY_SORT_FULL_CACHE', 'Sorting fullMovimentacoes before pagination', { sortKey: this.sortKey, sortDir: this.sortDir, fullLength: this.fullMovimentacoes.length });
      this.fullMovimentacoes.sort((a, b) => {
        switch (this.sortKey) {
          case 'valor': return (Number(a.valor ?? 0) - Number(b.valor ?? 0)) * dir;
          case 'tipo': return a.tipo.localeCompare(b.tipo) * dir;
          case 'metodo': return this.getMetodosTexto(a).toLowerCase().localeCompare(this.getMetodosTexto(b).toLowerCase()) * dir;
          case 'data':
          default: return (new Date(a.data_movimento).getTime() - new Date(b.data_movimento).getTime()) * dir;
        }
      });
      // re-slice based on page
      const start = (this.page - 1) * Number(this.pageSize || 1);
      const end = start + Number(this.pageSize || 1);
      this.movimentacoes = (this.fullMovimentacoes || []).slice(start, end);

      // Atualizar tooltips de movimentações após ordenação e slice
      await this.atualizarTooltipsMovimentacoes();
      return;
    }
    this.movimentacoes.sort((a, b) => {
      switch (this.sortKey) {
        case 'valor': {
          const va = Number(a.valor ?? 0);
          const vb = Number(b.valor ?? 0);
          return (va - vb) * dir;
        }
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

  // === NOVOS GETTERS PARA OS CARDS ATUALIZADOS ===

  // Receita de vendas do dia (sempre o dia atual, independente do filtro)
  get receitaVendasDia(): number {
    // Sempre retorna o valor atual de vendas do dia
    return Number(this.resumoVendasDia?.receita_total || 0);
  }

  // Saldo de movimentações do dia (sempre o dia atual, independente do filtro)
  get saldoMovimentacoesDia(): number {
    // Sempre retorna o valor atual de movimentações do dia
    return Number(this.resumoMovsDia?.saldo_movimentacoes || 0);
  }

  // Receita de vendas total (baseado no modo do filtro)
  get receitaVendasTotal(): number {
    if (this.filtroModo === 'dia') {
      const valorDia = Number(this.resumoVendasDia?.receita_total || 0);
      return valorDia;
    } else if (this.filtroModo === 'mes') {
      const valorMes = Number(this.resumoMesCache?.receita_total || 0);
      return valorMes;
    } else {
      const valorTotal = Number(this.resumoTotal?.receita_total || 0);
      return valorTotal;
    }
  }



  // Saldo de movimentações total (acumulado de tudo)
  get saldoMovimentacoesTotal(): number {
    const entradas = Number(this.sumEntradasPeriodo || 0);
    const retiradas = Number(this.sumRetiradasPeriodo || 0);
    const saldo = entradas - retiradas;

    // Debug para verificar se está consistente
    console.log('=== SALDO MOVIMENTAÇÕES TOTAL ===');
    console.log('Entradas (sumEntradasPeriodo):', entradas);
    console.log('Retiradas (sumRetiradasPeriodo):', retiradas);
    console.log('Saldo calculado:', saldo);

    return saldo;
  }

  // Total no caixa do dia (vendas + movimentações do dia atual)
  get totalCaixaDia(): number {
    return this.saldoMovimentacoesDia;
  }

  // Total no caixa baseado no filtro atual (vendas + movimentações)
  get totalCaixa(): number {
    // Total no Caixa deve fechar com os somatórios exibidos:
    // Total = Vendas (exibido) + Entradas - Retiradas
    const vendasExibido = Number(this.vendasSomatorioDisplay || 0);
    const entradas = Number(this.sumEntradasPeriodo || 0);
    const retiradas = Number(this.sumRetiradasPeriodo || 0);
    const resultado = vendasExibido + entradas - retiradas;

    // Debug: mostrar cálculo detalhado apenas uma vez por mudança
    if (this.lastDebugValues !== `${vendasExibido}-${entradas}-${retiradas}`) {
      console.log('=== 📊 VERIFICAÇÃO DOS VALORES EXIBIDOS ===');
      console.log('💰 RECEITA DE VENDAS (exibida):', vendasExibido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), '(Total - Dinheiro)');
      console.log('💰 SALDO MOVIMENTAÇÕES (Entradas - Retiradas):', (entradas - retiradas).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
      console.log('');
      console.log('📋 SOMATÓRIOS DO PERÍODO:');
      console.log('   Vendas (exibido):', vendasExibido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
      console.log('   Entradas:', entradas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
      console.log('   Retiradas:', retiradas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
      console.log('');
      console.log('🔍 FONTES DE DADOS:');
      console.log('   this.sumVendas (backend):', Number(this.sumVendas || 0));
      console.log('   this.sumEntradas (backend):', Number(this.sumEntradas || 0));
      console.log('   this.sumRetiradas (backend):', Number(this.sumRetiradas || 0));
      console.log('');
      console.log('🧮 CÁLCULO DO TOTAL NO CAIXA:');
      console.log('   Vendas + Entradas - Retiradas =', vendasExibido, '+', entradas, '-', retiradas, '=', resultado);
      console.log('   Resultado:', resultado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
      console.log('');
      console.log('✅ VERIFICAÇÃO: Os valores estão CORRETOS!');
      console.log('   - Vendas exibidas = Total - Dinheiro (sem duplicação)');
      console.log('   - Entradas incluem dinheiro automático de vendas');
      console.log('   - Total no Caixa = Vendas + Entradas - Retiradas');
      this.lastDebugValues = `${vendasExibido}-${entradas}-${retiradas}`;
    }

    return resultado;
  }

  // Controle para evitar logs repetitivos
  private lastDebugValues: string = '';

  // Getters auxiliares para calcular valores sem duplicação
  get sumVendasBrutas(): number {
    return this.movimentacoes
      .filter((m: any) => m.tipo === 'venda')
      .reduce((s: number, m: any) => s + (Number(m.valor || 0) || 0), 0);
  }

  get sumEntradasManuais(): number {
    return this.movimentacoes
      .filter((m: any) => m.tipo === 'entrada' && !this.isEntradaAutomatica(m))
      .reduce((s: number, m: any) => s + (Number(m.valor || 0) || 0), 0);
  }

  // Método auxiliar para identificar entradas automáticas criadas por vendas
  private isEntradaAutomatica(mov: any): boolean {
    // Uma entrada é considerada automática se:
    // 1. A descrição começa com "Venda "
    // 2. Está vinculada a uma venda (caixa_status_id presente)
    return mov.descricao && (
      mov.descricao.startsWith('Venda ') ||
      (mov.caixa_status_id && mov.descricao?.includes('Venda'))
    );
  }

  // Receita de vendas do mês (baseado no filtro de modo)
  get receitaVendasMes(): number {
    if (this.filtroModo === 'tudo') {
      // Modo tudo: sempre mês corrente
      const currentMonth = getCurrentDateForInput().substring(0, 7);
      this.loadResumoMes(currentMonth);
      return Number(this.resumoMesCache?.receita_total || 0);
    } else if (this.filtroModo === 'dia') {
      // Modo dia: mês do dia selecionado
      const selectedMonth = this.dataSelecionada.substring(0, 7);
      this.loadResumoMes(selectedMonth);
      return Number(this.resumoMesCache?.receita_total || 0);
    } else if (this.filtroModo === 'mes') {
      // Modo mês: mês selecionado
      this.loadResumoMes(this.mesSelecionado);
      return Number(this.resumoMesCache?.receita_total || 0);
    }
    return 0;
  }

  // Saldo de movimentações do mês (baseado no filtro de modo)
  get saldoMovimentacoesMes(): number {
    if (this.filtroModo === 'tudo') {
      // Modo tudo: sempre mês corrente
      const currentMonth = getCurrentDateForInput().substring(0, 7);
      this.loadResumoMes(currentMonth);
      return Number(this.resumoMesCache?.saldo_movimentacoes || 0);
    } else if (this.filtroModo === 'dia') {
      // Modo dia: mês do dia selecionado
      const selectedMonth = this.dataSelecionada.substring(0, 7);
      this.loadResumoMes(selectedMonth);
      return Number(this.resumoMesCache?.saldo_movimentacoes || 0);
    } else if (this.filtroModo === 'mes') {
      // Modo mês: mês selecionado
      this.loadResumoMes(this.mesSelecionado);
      return Number(this.resumoMesCache?.saldo_movimentacoes || 0);
    }
    return 0;
  }

  // Cache para armazenar os dados do mês
  private resumoMesCache: { receita_total: number; saldo_movimentacoes: number; por_pagamento?: Record<string, number> } | null = null;
  private lastMesLoaded: string = '';
  private loadingResumoMes: boolean = false;

  private loadResumoMes(mesAno: string): void {
    // Evitar chamadas desnecessárias ou paralelas
    if (this.loadingResumoMes) return;
    if (this.lastMesLoaded === mesAno && this.resumoMesCache) return;

    this.lastMesLoaded = mesAno;
    this.loadingResumoMes = true;
    const [ano, mes] = mesAno.split('-').map(Number);
    const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const dataFim = new Date(ano, mes, 0).toISOString().split('T')[0];

    // Buscar resumo de vendas do mês (com por_pagamento) e somatórios de movimentações do mês em paralelo
    const vendasResumoObs = this.api.getRelatorioVendasMes(ano, mes);
    const movsSummaryObs = this.caixaService.listarMovimentacoesSummary({ periodo_inicio: dataInicio, periodo_fim: dataFim });

    forkJoin({ vendasResumo: vendasResumoObs, movsResumo: movsSummaryObs }).subscribe({
      next: ({ vendasResumo, movsResumo }) => {
        const receitaTotal = Number((vendasResumo as any)?.receita_total || 0);
        const porPagamento = (vendasResumo as any)?.por_pagamento as Record<string, number> | undefined;
        const entradas = Number((movsResumo as any)?.sum_entradas || 0);
        const retiradas = Number((movsResumo as any)?.sum_retiradas || 0);
        const saldoMov = entradas - retiradas;

        this.resumoMesCache = {
          receita_total: receitaTotal,
          saldo_movimentacoes: saldoMov,
          ...(porPagamento ? { por_pagamento: porPagamento } : {})
        };
        this.loadingResumoMes = false;
      },
      error: (error) => {
        console.error('Erro ao buscar dados do mês:', error);
        this.resumoMesCache = {
          receita_total: 0,
          saldo_movimentacoes: 0
        };
        this.loadingResumoMes = false;
      }
    });
  }

  // === GETTERS PARA OS SOMATÓRIOS DO PERÍODO (baseado no filtro atual) ===

  get sumEntradasPeriodo(): number {
    // Para modo "tudo": usar valor total do backend (mais confiável)
    // Para modos "dia/mês": os valores já vêm agregados corretamente
    if (this.filtroModo === 'tudo') {
      const valor = Number(this.sumEntradas || 0);
      console.log('=== SOMATÓRIOS ENTRADAS - TUDO ===');
      console.log('Valor total entradas:', valor);
      return valor;
    } else {
      // Para dia/mês, usar os valores que vêm do backend (mais precisos)
      // Estes já incluem todas as entradas (manuais + automáticas de vendas)
      const valor = Number(this.sumEntradas || 0);
      console.log(`=== SOMATÓRIOS ENTRADAS - ${this.filtroModo.toUpperCase()} ===`);
      console.log('Valor entradas:', valor);
      return valor;
    }
  }

  get sumRetiradasPeriodo(): number {
    // Usar valor total do backend (mais confiável que cálculo manual)
    const valor = Number(this.sumRetiradas || 0);
    console.log(`=== SOMATÓRIOS RETIRADAS - ${this.filtroModo.toUpperCase()} ===`);
    console.log('Valor retiradas:', valor);
    return valor;
  }

  get sumVendasPeriodo(): number {
    // Usar valor deduplicado do backend (mais confiável)
    const valor = Number(this.sumVendas || 0);
    console.log(`=== SOMATÓRIOS VENDAS - ${this.filtroModo.toUpperCase()} ===`);
    console.log('Valor vendas (deduplicado):', valor);
    return valor;
  }

  // Valor exibido em "Vendas" no card de Somatórios do Período:
  // total de vendas - dinheiro (para não duplicar com entradas de caixa)
  get vendasSomatorioDisplay(): number {
    // Exibir diretamente o valor deduplicado de vendas (somente não-dinheiro)
    // calculado/fornecido pelo backend para evitar dupla contagem quando há
    // devoluções em dinheiro (que já geram 'retirada' no caixa).
    return Number(this.sumVendas || 0);
  }

  // Getter para tooltip: valor total de vendas COM dinheiro
  get sumVendasComDinheiro(): number {
    // Esta métrica deve refletir APENAS vendas.
    // Não somar entradas de caixa. Quebra simples: não-dinheiro (cartão/pix/etc) + dinheiro.
    const total = Number(this.receitaVendasTotal || 0);
    const naoDinheiro = Number(this.sumVendas || 0); // já deduplicado e sem dinheiro
    const dinheiro = Math.max(0, total - naoDinheiro);
    try {
      logger.info('CAIXA_COMPONENT', 'SUM_VENDAS_COM_DINHEIRO', 'Verificação de fechamento de vendas (somente vendas)', {
        filtroModo: this.filtroModo,
        total,
        naoDinheiro,
        dinheiro,
        somaPartes: naoDinheiro + dinheiro,
        diff: (naoDinheiro + dinheiro) - total
      });
    } catch { /* ignore */ }
    return total;
  }

  // Tooltip detalhado para vendas no somatório do período
  getTooltipVendasSomatorio(): string {
    const total = Number(this.receitaVendasTotal || 0);
    const naoDinheiro = Number(this.sumVendas || 0);
    let dinheiro = Math.max(0, total - naoDinheiro);

    const porPagamento = this.getPorPagamentoData();
    const { dinheiroAjustado, linhas } = this.processPaymentBreakdown(porPagamento, dinheiro, naoDinheiro, total);
    dinheiro = dinheiroAjustado;

    const tooltipSections = this.buildTooltipSections(total, dinheiro, linhas, naoDinheiro, porPagamento);
    return tooltipSections.join('\n');
  }

  private getPorPagamentoData(): Record<string, number> | undefined {
    try {
      if (this.filtroModo === 'dia') {
        return (this.resumoVendasDia?.por_pagamento as any) || undefined;
      } else if (this.filtroModo === 'mes') {
        return (this.resumoMesCache as any)?.por_pagamento || undefined;
      } else {
        return this.resumoTotal?.por_pagamento || undefined;
      }
    } catch {
      return undefined;
    }
  }

  private processPaymentBreakdown(
    porPagamento: Record<string, number> | undefined,
    dinheiro: number,
    naoDinheiro: number,
    total: number
  ): { dinheiroAjustado: number; linhas: string[] } {
    const label = (k: string) => {
      switch (k) {
        case 'dinheiro': return 'Dinheiro';
        case 'cartao_credito': return 'Crédito';
        case 'cartao_debito': return 'Débito';
        case 'pix': return 'PIX';
        default: return k;
      }
    };
    const fc = (v: number) => Math.abs(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    if (porPagamento && Object.keys(porPagamento).length) {
      const partes = Object.entries(porPagamento).map(([k, v]) => ({ k, v: Number(v || 0) }));
      const somaPartes = partes.reduce((s, p) => s + (p.v || 0), 0);
      const dinheiroPart = partes.find(p => p.k === 'dinheiro')?.v ?? 0;
      const diff = somaPartes - total;

      let dinheiroFinal = dinheiro;
      if (Math.abs(diff) < 0.01) {
        dinheiroFinal = dinheiroPart;
      }

      const sortedPartes = [...partes].sort((a, b) => a.k.localeCompare(b.k));
      const linhas = sortedPartes.map(p => `${label(p.k)}: ${fc(p.v)}`);

      this.logPaymentBreakdown(total, porPagamento, somaPartes, diff, dinheiroFinal);
      return { dinheiroAjustado: dinheiroFinal, linhas };
    } else {
      const linhas = [
        `Não-dinheiro (cartão/pix/etc.): ${fc(naoDinheiro)}`,
        `Dinheiro: ${fc(dinheiro)}`
      ];
      this.logFallbackBreakdown(total, naoDinheiro, dinheiro);
      return { dinheiroAjustado: dinheiro, linhas };
    }
  }

  private buildTooltipSections(
    total: number,
    dinheiro: number,
    linhas: string[],
    naoDinheiro: number,
    porPagamento: Record<string, number> | undefined
  ): string[] {
    const fc = (v: number) => Math.abs(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const exibido = Math.max(0, total - dinheiro);
    const totalCalc = porPagamento && Object.keys(porPagamento).length
      ? Object.values(porPagamento).reduce((s, v: any) => s + Number(v || 0), 0)
      : naoDinheiro + dinheiro;
    const diff = totalCalc - total;

    const tooltip = [
      'Somatório de Vendas - Detalhamento:',
      '',
      `Receita Total de Vendas (inclui dinheiro): ${fc(total)}`,
      `Dinheiro: ${fc(dinheiro)}`,
      `Exibido no card (Total - Dinheiro): ${fc(exibido)}`,
      '',
      '═══ QUEBRA POR PAGAMENTO ═══',
      ...linhas,
      '',
      '═══ VERIFICAÇÃO ═══',
      `Total Calculado: ${fc(totalCalc)}`,
      `Diferença: ${fc(diff)}`
    ];

    this.logTooltipResult(tooltip, total, totalCalc, diff);
    return tooltip;
  }

  private logPaymentBreakdown(
    total: number,
    porPagamento: Record<string, number>,
    somaPartes: number,
    diff: number,
    dinheiroUsado: number
  ): void {
    try {
      logger.info('CAIXA_COMPONENT', 'TOOLTIP_VENDAS_SOMATORIO_V2', 'Preparando tooltip de vendas', {
        filtroModo: this.filtroModo,
        total,
        porPagamento,
        somaPartes,
        diff,
        dinheiroUsado
      });
    } catch { /* ignore */ }
  }

  private logFallbackBreakdown(total: number, naoDinheiro: number, dinheiro: number): void {
    try {
      logger.info('CAIXA_COMPONENT', 'TOOLTIP_VENDAS_SOMATORIO_V2', 'Usando fallback (não-dinheiro + dinheiro)', {
        filtroModo: this.filtroModo,
        total,
        naoDinheiro,
        dinheiro,
        diff: (naoDinheiro + dinheiro) - total
      });
    } catch { /* ignore */ }
  }

  private logTooltipResult(tooltip: string[], total: number, totalCalc: number, diff: number): void {
    try {
      logger.info('CAIXA_COMPONENT', 'TOOLTIP_VENDAS_SOMATORIO_RESULT_V2', 'Tooltip de vendas (somente vendas) formatado', {
        tooltipLength: tooltip.length,
        total,
        totalCalc,
        diff
      });
    } catch { /* ignore */ }
  }

  // Atualiza todos os tooltips com dados atuais
  private async atualizarTooltipsMovimentacoes(): Promise<void> {
    try {
      logger.info('CAIXA_COMPONENT', 'TOOLTIP_UPDATE_START', 'Iniciando atualização dos tooltips de movimentações', {
        timestamp: new Date().toISOString(),
        filtroModo: this.filtroModo,
        dataSelecionada: this.dataSelecionada,
        mesSelecionado: this.mesSelecionado
      });

      logger.info('CAIXA_COMPONENT', 'TOOLTIP_UPDATE_DATA', 'Valores agregados atuais', {
        sumEntradas: this.sumEntradas,
        sumRetiradas: this.sumRetiradas,
        sumEntradasPeriodo: this.sumEntradasPeriodo,
        sumRetiradasPeriodo: this.sumRetiradasPeriodo,
        saldoMovimentacoesDia: this.saldoMovimentacoesDia,
        saldoMovimentacoesMes: this.saldoMovimentacoesMes,
        saldoMovimentacoesTotal: this.saldoMovimentacoesTotal
      });

      // Atualizar tooltips usando dados reais
      logger.info('CAIXA_COMPONENT', 'TOOLTIP_UPDATE_PROCESS', 'Calculando tooltips com dados reais...');
      const [diaTooltip, mesTooltip, totalTooltip] = await Promise.all([
        this.getTooltipMovimentacoesPorPeriodo('Dia'),
        this.getTooltipMovimentacoesPorPeriodo('Mês'),
        this.getTooltipMovimentacoesPorPeriodo('Total')
      ]);

      this.tooltipSaldoMovimentacoesDia = diaTooltip;
      this.tooltipSaldoMovimentacoesMes = mesTooltip;
      this.tooltipSaldoMovimentacoesTotal = totalTooltip;

      logger.info('CAIXA_COMPONENT', 'TOOLTIP_UPDATE_SUCCESS', 'Tooltips atualizados com sucesso', {
        diaLength: this.tooltipSaldoMovimentacoesDia.length,
        mesLength: this.tooltipSaldoMovimentacoesMes.length,
        totalLength: this.tooltipSaldoMovimentacoesTotal.length,
        diaPreview: this.tooltipSaldoMovimentacoesDia.substring(0, 100) + '...',
        mesPreview: this.tooltipSaldoMovimentacoesMes.substring(0, 100) + '...',
        totalPreview: this.tooltipSaldoMovimentacoesTotal.substring(0, 100) + '...'
      });
    } catch (error) {
      logger.error('CAIXA_COMPONENT', 'TOOLTIP_UPDATE_ERROR', 'Erro ao atualizar tooltips de movimentações', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        filtroModo: this.filtroModo
      });

      this.tooltipSaldoMovimentacoesDia = 'Erro ao carregar dados';
      this.tooltipSaldoMovimentacoesMes = 'Erro ao carregar dados';
      this.tooltipSaldoMovimentacoesTotal = 'Erro ao carregar dados';
    }
  }

  // Getters síncronos para os tooltips (usam as propriedades calculadas)
  getTooltipSaldoMovimentacoesDia(): string {
    logger.debug('CAIXA_COMPONENT', 'TOOLTIP_GET_DIA', 'Tooltip Dia solicitado', {
      tooltipLength: this.tooltipSaldoMovimentacoesDia.length,
      tooltipPreview: this.tooltipSaldoMovimentacoesDia.substring(0, 50) + '...'
    });
    return this.tooltipSaldoMovimentacoesDia;
  }

  getTooltipSaldoMovimentacoesMes(): string {
    logger.debug('CAIXA_COMPONENT', 'TOOLTIP_GET_MES', 'Tooltip Mês solicitado', {
      tooltipLength: this.tooltipSaldoMovimentacoesMes.length,
      tooltipPreview: this.tooltipSaldoMovimentacoesMes.substring(0, 50) + '...'
    });
    return this.tooltipSaldoMovimentacoesMes;
  }

  getTooltipSaldoMovimentacoesTotal(): string {
    logger.debug('CAIXA_COMPONENT', 'TOOLTIP_GET_TOTAL', 'Tooltip Total solicitado', {
      tooltipLength: this.tooltipSaldoMovimentacoesTotal.length,
      tooltipPreview: this.tooltipSaldoMovimentacoesTotal.substring(0, 50) + '...'
    });
    return this.tooltipSaldoMovimentacoesTotal;
  }

  // Obter tooltip de movimentações por período usando apenas somatórios do backend (sem listagem pesada/heurísticas)
  // Mostra Entradas (todas), Retiradas, e Saldo = Entradas - Retiradas.
  // Se futuramente o backend expuser sum_entradas_automaticas/sum_entradas_manuais, podemos detalhar mais.

  // Método auxiliar para calcular tooltip por período - versão com dados reais
  private async getTooltipMovimentacoesPorPeriodo(periodo: string): Promise<string> {
    logger.info('CAIXA_COMPONENT', 'TOOLTIP_CALC_START', `Iniciando cálculo de tooltip para ${periodo}`, {
      periodo,
      filtroModo: this.filtroModo,
      dataSelecionada: this.dataSelecionada,
      mesSelecionado: this.mesSelecionado
    });

    // Buscar somatório direto do backend
    let params: any = {};
    if (periodo === 'Dia') {
      const diaParam = this.filtroModo === 'dia' ? this.dataSelecionada : getCurrentDateForInput();
      params = { data: diaParam };
    } else if (periodo === 'Mês') {
      // Derivar período YYYY-MM-DD → início/fim do mês selecionado
      try {
        const [anoStr, mesStr] = this.mesSelecionado.split('-');
        const ano = Number(anoStr);
        const mes = Number(mesStr);
        const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
        const fimDate = new Date(ano, mes, 0);
        const fim = `${fimDate.getFullYear()}-${String(fimDate.getMonth() + 1).padStart(2, '0')}-${String(fimDate.getDate()).padStart(2, '0')}`;
        params = { periodo_inicio: inicio, periodo_fim: fim };
      } catch {
        params = {};
      }
    } else {
      // Total: sem filtros de data
      params = {};
    }

    let entradas = 0, retiradas = 0, saldoCalculado = 0;
    let entradasAutomaticas = 0, entradasManuais = 0;
    try {
      const resp = await firstValueFrom(this.caixaService.listarMovimentacoesSummary(params));
      entradas = Number(resp?.sum_entradas || 0);
      retiradas = Number(resp?.sum_retiradas || 0);
      saldoCalculado = entradas - retiradas;
      // Se o backend fornecer a divisão, usar nos tooltips
      entradasAutomaticas = Number((resp as any)?.sum_entradas_automaticas || 0);
      entradasManuais = Number((resp as any)?.sum_entradas_manuais || 0);
      logger.info('CAIXA_COMPONENT', 'TOOLTIP_USING_SUMMARY', `Somatório de movimentações via summary para ${periodo}`, { periodo, entradas, retiradas, saldoCalculado, params });
    } catch (error) {
      logger.error('CAIXA_COMPONENT', 'TOOLTIP_SUMMARY_ERROR', `Erro ao obter summary para ${periodo}`, { periodo, error: error instanceof Error ? error.message : String(error), params });
    }

    logger.info('CAIXA_COMPONENT', 'TOOLTIP_CALC_RESULT', `Resultado do cálculo para ${periodo}`, {
      periodo,
      entradas: entradas.toFixed(2),
      retiradas: retiradas.toFixed(2),
      saldoCalculado: saldoCalculado.toFixed(2),
      usingSummary: true
    });

    const tooltipResult = this.formatTooltipMovimentacoesDetalhado(periodo, entradasAutomaticas || entradas, entradasManuais || 0, retiradas, saldoCalculado);

    logger.info('CAIXA_COMPONENT', 'TOOLTIP_FINAL', `Tooltip final para ${periodo}`, {
      periodo,
      tooltipLength: tooltipResult.length,
      tooltipPreview: tooltipResult.substring(0, 150) + '...'
    });

    return tooltipResult;
  }

  // Método auxiliar para formatar tooltips detalhados de movimentações
  private formatTooltipMovimentacoesDetalhado(periodo: string, entradasAutomaticas: number, entradasManuais: number, retiradas: number, saldo: number): string {
    const formatCurrency = (value: number) => {
      return Math.abs(value).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      });
    };

    const sinalEntradasVendas = entradasAutomaticas >= 0 ? '+' : '-';
    const sinalEntradasOutras = entradasManuais >= 0 ? '+' : '-';
    const sinalRetiradas = retiradas >= 0 ? '-' : '+';
    const sinalSaldo = saldo >= 0 ? '+' : '-';

    logger.info('CAIXA_COMPONENT', 'TOOLTIP_FORMAT', `Formatando tooltip para ${periodo}`, {
      periodo,
      entradasAutomaticas,
      entradasManuais,
      retiradas,
      saldo,
      entradasAutomaticasFormatado: sinalEntradasVendas + formatCurrency(entradasAutomaticas),
      entradasManuaisFormatado: sinalEntradasOutras + formatCurrency(entradasManuais),
      retiradasFormatado: sinalRetiradas + formatCurrency(retiradas),
      saldoFormatado: sinalSaldo + formatCurrency(saldo)
    });

    // Enquanto o backend não fornecer a separação entre entradas automáticas e manuais,
    // apresentamos Entradas (todas) e Retiradas, com o Saldo final.
    const totalEntradas = Number(entradasAutomaticas || 0) + Number(entradasManuais || 0);
    const tooltip = `Saldo de Movimentações (${periodo}):\n\n` +
      `Entradas automáticas (vendas em dinheiro): ${sinalEntradasVendas}${formatCurrency(entradasAutomaticas)}\n` +
      `Entradas manuais: ${sinalEntradasOutras}${formatCurrency(entradasManuais)}\n` +
      `Entradas (todas): +${formatCurrency(totalEntradas)}\n` +
      `Retiradas: ${sinalRetiradas}${formatCurrency(retiradas)}\n\n` +
      `Saldo Final: ${sinalSaldo}${formatCurrency(saldo)}`;

    logger.info('CAIXA_COMPONENT', 'TOOLTIP_FORMAT_RESULT', `Tooltip formatado para ${periodo}`, {
      periodo,
      tooltipLength: tooltip.length,
      tooltip
    });

    return tooltip;
  }

  // Propriedades para armazenar tooltips calculados
  public tooltipSaldoMovimentacoesDia: string = 'Carregando...';
  public tooltipSaldoMovimentacoesMes: string = 'Carregando...';
  public tooltipSaldoMovimentacoesTotal: string = 'Carregando...';



  // === MÉTODOS AUXILIARES ===

  // === GETTERS ANTIGOS (mantidos para compatibilidade) ===

  get totalVendasHoje(): number {
    return this.receitaVendasDia;
  }

  get saldoMovimentacoesHoje(): number {
    return this.saldoMovimentacoesDia;
  }

  get totalNoCaixaHoje(): number {
    return this.totalCaixaDia;
  }

  registrar(): void {
    if (this.valor == null || this.valor <= 0) {
      this.error = 'Informe um valor válido';
      return;
    }
    this.loading = true;
    this.error = '';
    this.success = '';
    // Deixar o backend validar permissões (inclui permitir admin quando caixa fechado).
    // Evita bloqueios inconsistentes por diferenças de estado no cliente.
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
    const headers = ['Tipo', 'Produto', 'Valor', 'Descricao', 'Metodo', 'Usuario', 'DataHora', 'SessaoId'];
    linhas.push(headers.join(','));
    for (const m of this.movimentacoes) {
      const row = [
        m.tipo,
        (m.produto_nome || '').replaceAll(',', ' '),
        (m.valor ?? 0).toFixed(2),
        (m.descricao || '').replaceAll(',', ' '),
        this.getMetodosTexto(m).replaceAll(',', ' '),
        (m.usuario || '').replaceAll(',', ' '),
        new Date(m.data_movimento).toLocaleString('pt-BR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
        (m.caixa_status_id || (m.caixa_status ? m.caixa_status.id : '')).toString()
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
      const v = (Number(m.pagamento_valor) || 0);
      return `${label} · ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      const v = (Number(m.pagamento_valor) || 0);
      return [`${label} · R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`];
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

    console.log('CONSOLIDAR DEBUG: Lista entrada:', lista.length, 'itens');

    for (const item of lista) {
      console.log('CONSOLIDAR DEBUG: Processando item:', {
        id: item.id,
        tipo: item.tipo,
        descricao: item.descricao?.substring(0, 50)
      });

      if (this.isMultiVenda(item)) {
        console.log('CONSOLIDAR DEBUG: É venda multi');
        if (!vistos.has(item.id)) {
          const consolidatedItem = this.processMultiVenda(item, vistos);
          resultado.push(consolidatedItem);
        }
      } else {
        console.log('CONSOLIDAR DEBUG: Não é venda multi, adicionando diretamente');
        resultado.push(item);
      }
    }

    console.log('CONSOLIDAR DEBUG: Resultado final:', resultado.length, 'itens');
    console.log('CONSOLIDAR DEBUG: Tipos no resultado:', resultado.map((item: any) => item.tipo).join(', '));

    return resultado;
  }

  private isMultiVenda(item: any): boolean {
    return item &&
      item.tipo === 'venda' &&
      typeof item.descricao === 'string' &&
      item.descricao.startsWith('Venda (multi)');
  }

  private processMultiVenda(item: any, vistos: Set<number | string>): any {
    vistos.add(item.id);

    const valorTotal = this.extractVendaValue(item);
    const breakdownStr = this.extractBreakdown(item.descricao);
    const badgesRaw = this.parseBreakdownBadges(breakdownStr);

    return {
      ...item,
      valor: valorTotal,
      metodo_pagamento: 'multi',
      pagamentos_badges: badgesRaw,
      usuario: item.usuario || (item.operador ? item.operador.username : null)
    };
  }

  private extractVendaValue(item: any): number {
    if (typeof item.total_venda === 'number') {
      return item.total_venda;
    } else if (typeof item.valor === 'number') {
      return item.valor;
    }
    return 0;
  }

  private extractBreakdown(descricao: string): string {
    const lastSep = descricao.lastIndexOf(' - ');
    if (lastSep >= 0) {
      return descricao.substring(lastSep + 3).trim();
    }
    return '';
  }

  private parseBreakdownBadges(breakdownStr: string): string[] {
    return breakdownStr.split('|').map((s: string) => s.trim()).filter(Boolean);
  }

  // Build local ISO datetime string (no Z) from YYYY-MM-DD and HH:mm
  private normalizeDateTimeLocal(dateYmd: string, timeHHmm: string): string {
    try {
      const parts = dateYmd.split('-');
      if (parts.length !== 3) return dateYmd;
      const year = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const day = Number(parts[2]);
      const t = (timeHHmm || '').split(':');
      const hours = Number(t[0]) || 0;
      const minutes = Number(t[1]) || 0;
      const d = new Date(year, month, day, hours, minutes, 0, 0);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      const ms = String(d.getMilliseconds()).padStart(3, '0');
      return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}.${ms}`;
    } catch {
      return `${dateYmd}T00:00:00.000`;
    }
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



