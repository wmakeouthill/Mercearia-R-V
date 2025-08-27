import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CurrencyBrPipe } from '../../pipes/currency-br.pipe';
import { ApiService } from '../../services/api';
import { extractLocalDate, getCurrentDateForInput } from '../../utils/date-utils';
import { CaixaService } from '../../services/caixa.service';
import { AuthService } from '../../services/auth';
import { logger } from '../../utils/logger';
import { forkJoin, of, Subscription } from 'rxjs';
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
  resumo: { data: string; saldo_movimentacoes: number } | null = null;
  resumoVendasDia: RelatorioResumo | null = null;
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
    try { if (this.loadResumoTimer) clearTimeout(this.loadResumoTimer); } catch (e) { }
    this.loadResumoTimer = setTimeout(() => { this.loadResumoEMovimentacoes(); this.loadResumoTimer = null; }, ms);
  }

  onChangeData(): void { this.page = 1; this.fullMovimentacoes = null; this.scheduleLoadResumo(); }
  onChangeMes(): void { this.page = 1; this.fullMovimentacoes = null; this.scheduleLoadResumo(); }
  onChangeModo(): void { this.page = 1; this.fullMovimentacoes = null; this.scheduleLoadResumo(); }

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
    let dataParam: string | undefined;
    let periodoInicio: string | undefined;
    let periodoFim: string | undefined;
    if (this.filtroModo === 'dia') {
      // For 'dia' mode, prefer sending `data=YYYY-MM-DD` to the listing
      // and to resumo-dia. Do not set periodo_inicio/periodo_fim to avoid
      // confusion in debug logs and ensure backend uses the LocalDate path.
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

    // For the day-card values, always request the real current day when not
    // in 'dia' mode so the cards reflect today's numbers. When in 'dia'
    // mode, request the user-selected date.
    const todayInput = getCurrentDateForInput();
    const resumoVendasObs = this.api.getResumoDia(this.filtroModo === 'dia' ? this.dataSelecionada : todayInput);
    const resumoMovsObs = this.caixaService.getResumoMovimentacoesDia(this.filtroModo === 'dia' ? this.dataSelecionada : todayInput);
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
      // ignore logger errors
    }
    // Determine listing params depending on filtroModo:
    // - 'dia' -> send explicit `data=YYYY-MM-DD`
    // - 'mes' -> send `periodo_inicio`/`periodo_fim` (YYYY-MM-DD)
    // - 'tudo' -> send `data` when set
    let listingDataParam: string | undefined = undefined;
    let listingPeriodoInicio: string | undefined = undefined;
    let listingPeriodoFim: string | undefined = undefined;
    // from/to not used by client now; kept for legacy if needed
    let listingFrom: string | undefined = undefined;
    let listingTo: string | undefined = undefined;
    if (this.filtroModo === 'dia') {
      // For 'dia' mode, send both LocalDate period AND explicit UTC instants
      // (from/to) computed from America/Sao_Paulo midnight..23:59:59.999 so the
      // backend can match either path and return the same rows as 'tudo'.
      listingPeriodoInicio = this.dataSelecionada;
      listingPeriodoFim = this.dataSelecionada;
      // Do not compute/send from/to here; prefer LocalDate parameters only.
      listingFrom = undefined;
      listingTo = undefined;
    } else if (this.filtroModo === 'mes') {
      listingPeriodoInicio = periodoInicio;
      listingPeriodoFim = periodoFim;
    } else { // tudo
      listingDataParam = dataParam;
    }

    // cancel previous request if in-flight to avoid recursive calls
    try { if (this.currentRequestSub) this.currentRequestSub.unsubscribe(); } catch { }

    // decide which backend listing endpoint to call depending on mode
    const movEndpoint = this.filtroModo === 'dia' ? 'dia' : (this.filtroModo === 'mes' ? 'mes' : 'list');
    let movimentacoesObs: any;
    if (movEndpoint === 'dia') {
      movimentacoesObs = this.caixaService.listarMovimentacoesDia(this.dataSelecionada);
    } else if (movEndpoint === 'mes') {
      // Call month endpoint with pagination parameters so backend returns
      // paged results and UI pagination controls work.
      const [y, m] = this.mesSelecionado.split('-').map(Number);
      movimentacoesObs = this.caixaService.listarMovimentacoesMes(y, m, this.page, this.pageSize as number);
    } else {
      movimentacoesObs = this.caixaService.listarMovimentacoes({
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

    // Also request aggregated sums (aggs) together so we can rely on server
    // aggregates for 'mes' mode instead of using page-scoped values.
    let aggsObs: any = of(null);
    try {
      const aggsParams: any = {
        tipo: this.filtroTipo || undefined,
        metodo_pagamento: this.filtroMetodo || undefined,
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
      aggsObs = of(null);
    }

    const request$ = forkJoin({ resumoVendas: resumoVendasObs, resumoMovs: resumoMovsObs, movimentacoes: movimentacoesObs, aggs: aggsObs });

    this.currentRequestSub = request$.subscribe({
      next: ({ resumoVendas, resumoMovs, movimentacoes, aggs }) => {
        // store last aggregates for use in getters to avoid double-counting
        try { this.lastAggs = aggs || null; } catch (e) { this.lastAggs = null; }
        // DEBUG: log raw responses
        try {
          logger.info('CAIXA_COMPONENT', 'DEBUG_RESPONSES', 'Received responses from forkJoin', {
            resumoVendasRaw: resumoVendas,
            resumoMovsRaw: resumoMovs,
            movimentacoesRaw: movimentacoes,
            aggsRaw: aggs
          });
        } catch (e) {
          // ignore
        }
        // some responses may arrive double-encoded as JSON strings (observed in logs).
        // Coerce into an object if needed.
        let payload: any = movimentacoes as any;
        // Normalize payload: sometimes the backend or an intermediary
        // double-encodes the response. Handle these cases robustly so the
        // UI receives an object with an `items` array.
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload);
          } catch (e) {
            logger.warn('CAIXA_COMPONENT', 'PARSE_MOVIMENTACOES', 'Failed to parse movimentacoes response string', e);
            payload = { items: [] };
          }
        }
        // If payload is an object but items is a JSON string, parse it too.
        if (payload && typeof payload.items === 'string') {
          try {
            payload.items = JSON.parse(payload.items);
            logger.info('CAIXA_COMPONENT', 'PARSE_MOVIMENTACOES_ITEMS', 'Parsed string-encoded items', { count: (payload.items || []).length });
          } catch (e) {
            logger.warn('CAIXA_COMPONENT', 'PARSE_MOVIMENTACOES_ITEMS_FAIL', 'Failed to parse payload.items', e);
            payload.items = [];
          }
        }
        // Diagnostic front-end aggs log to correlate with backend DIAG_CAIXA_AGGS
        try {
          logger.info('CAIXA_COMPONENT', 'DIAG_CAIXA_FRONT', 'Frontend received aggregations and payload stats', {
            filtroModo: this.filtroModo,
            periodStart: listingPeriodoInicio,
            periodEnd: listingPeriodoFim,
            payloadTotal: payload?.total ?? (payload?.items ? payload.items.length : null),
            aggs: aggs || null
          });
        } catch (e) { /* ignore logging failures */ }
        // resumo objects may also be string-encoded
        if (typeof resumoVendas === 'string') {
          try { resumoVendas = JSON.parse(resumoVendas); } catch { resumoVendas = null as any; }
        }
        if (typeof resumoMovs === 'string') {
          try { resumoMovs = JSON.parse(resumoMovs); } catch { resumoMovs = null as any; }
        }

        // helper to run the normal payload processing after ensuring we have
        // the complete items array (may require fetching additional pages).
        const finalizePayload = (payloadObj: any) => {
          let lista = payloadObj?.items || [];
          // We'll prefer recomputing aggregates from the final list when in
          // 'dia' mode because we fetch the full dataset and apply client-side
          // filtering to match the 'tudo' dataset filtered by date.
          if (this.filtroModo === 'dia') {
            // filter by selected local date
            try {
              lista = (Array.isArray(lista) ? lista : []).filter((m: any) => {
                try {
                  const mvDateLocal = extractLocalDate(m.data_movimento);
                  if (mvDateLocal !== this.dataSelecionada) return false;
                  // apply hora filters if present
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
              lista = [];
            }
            // prefer backend resumo when available, otherwise synthesize from filtered list
            if (resumoMovs) {
              this.resumo = resumoMovs as any;
            } else {
              this.resumo = { data: this.dataSelecionada, saldo_movimentacoes: 0 } as any;
            }
          } else {
            if (resumoMovs) {
              this.resumo = resumoMovs as any;
            } else {
              this.resumo = { data: periodoInicio || 'periodo', saldo_movimentacoes: Number(payload?.sum_entradas || 0) - Number(payload?.sum_retiradas || 0) } as any;
            }
          }

          // garantir que o campo usuario seja preenchido com operador quando disponível
          lista = lista.map((m: any) => ({
            ...m,
            usuario: m.usuario || (m.operador ? (m.operador.username || m.operador) : null)
          }));
          // Consolidar vendas multi (que vêm uma linha por método do backend) em uma única linha por venda
          const consolidated = this.consolidarVendasMulti(lista);
          this.movimentacoes = consolidated;
          this.hasMore = !!payload?.hasNext;
          this.total = Number(payload?.total || consolidated.length);
          // If backend pagination is by payment rows, consolidation can reduce
          // number of visible rows. If consolidated length < pageSize and there
          // are more pages, fetch subsequent pages until we accumulate enough
          // consolidated rows to fill the requested page (or no more pages).
          // Only auto-fetch additional pages to fill a page when in 'tudo' mode.
          // For 'mes' we must respect server pagination and not merge pages.
          if (this.filtroModo === 'tudo' && consolidated.length < Number(this.pageSize || 1) && payload?.hasNext) {
            const self = this;
            const params = {
              data: this.filtroModo === 'tudo' ? listingDataParam : undefined,
              tipo: this.filtroTipo || undefined,
              metodo_pagamento: this.filtroMetodo || undefined,
              hora_inicio: this.filtroHoraInicio || undefined,
              hora_fim: this.filtroHoraFim || undefined,
              periodo_inicio: listingPeriodoInicio,
              periodo_fim: listingPeriodoFim,
              size: this.pageSize
            };
            const needed = Number(this.pageSize || 1) - consolidated.length;
            const fetchNext = (nextPage: number) => {
              this.caixaService.listarMovimentacoes({ ...params, page: nextPage, size: this.pageSize }).subscribe({
                next: (more: any) => {
                  let morePayload: any = more;
                  if (typeof morePayload === 'string') {
                    try { morePayload = JSON.parse(morePayload); } catch { morePayload = { items: [] }; }
                  }
                  const moreItems = Array.isArray(morePayload?.items) ? morePayload.items : [];
                  // append and recompute
                  lista = lista.concat(moreItems);
                  const newConsol = self.consolidarVendasMulti(lista);
                  self.movimentacoes = newConsol.slice(0, Number(self.pageSize || 1));
                  // stop if we've filled the page or no further pages
                  if (newConsol.length >= Number(self.pageSize || 1) || !morePayload?.hasNext) {
                    // update totals
                    self.total = Number(payload?.total || newConsol.length);
                    self.hasMore = !!morePayload?.hasNext;
                    self.applySorting();
                    return;
                  }
                  // else fetch next
                  fetchNext(nextPage + 1);
                },
                error: () => {
                  // ignore fetch errors and leave current consolidated as-is
                  this.applySorting();
                }
              });
            };
            // start fetching from next page
            fetchNext(this.page + 1);
          }
          // Apply pagination client-side only for 'dia' when we have the full day's list.
          if (this.filtroModo === 'dia') {
            // cache full day's list for client-side pagination
            this.fullMovimentacoes = consolidated;
            const start = (this.page - 1) * Number(this.pageSize || 1);
            const end = start + Number(this.pageSize || 1);
            logger.info('CAIXA_COMPONENT', 'DIA_PAGINACAO', 'Paginating day-mode client-side', { page: this.page, pageSize: this.pageSize, consolidatedLength: consolidated.length, start, end });
            this.movimentacoes = consolidated.slice(start, end);
            this.total = consolidated.length;
            this.hasMore = false;
          }
          // Recompute sums from consolidated list to reflect client-side filtering
          // NOTE: for 'mes' mode prefer server-provided aggregates (summaryObs)
          // because `consolidated` may contain only the current page. Only
          // recompute here when not in 'mes' mode.
          if (this.filtroModo !== 'mes') {
            this.sumEntradas = consolidated.filter((c: any) => c.tipo === 'entrada').reduce((s: number, it: any) => s + (Number(it.valor || 0) || 0), 0);
            this.sumRetiradas = consolidated.filter((c: any) => c.tipo === 'retirada').reduce((s: number, it: any) => s + (Number(it.valor || 0) || 0), 0);

            // Adjust sumVendas to avoid double-counting cash that is already represented
            // as a caixa 'entrada' movimentacao. Strategy:
            // - Build a map of entrada amounts per caixa_status_id (consume matches)
            // - For each venda, if multi-payment (pagamentos_badges) parse parts and
            //   exclude dinheiro parts that match an existing entrada for the same
            //   caixa_status_id. For single-method vendas, exclude the whole venda
            //   if a matching entrada exists.
            const entradasBySession = new Map<string, number[]>();
            for (const e of consolidated.filter((c: any) => c.tipo === 'entrada' && c.caixa_status_id != null)) {
              const key = String(e.caixa_status_id);
              const arr = entradasBySession.get(key) || [];
              arr.push(Number(e.valor || 0));
              entradasBySession.set(key, arr);
            }

            const parseBadgeValue = (badge: string): number => {
              try {
                // badge format: 'Dinheiro · R$ 20,00' or similar
                const parts = badge.split('·');
                const valPart = parts.length > 1 ? parts[1] : parts[0];
                let cleaned = String(valPart).replace(/[^0-9,\.]/g, '').trim();
                // remove thousands separators and normalize decimal
                cleaned = cleaned.replace(/\./g, '').replace(/,/g, '.');
                const n = parseFloat(cleaned);
                return isNaN(n) ? 0 : n;
              } catch {
                return 0;
              }
            };

            let sumVendasAdj = 0;
            for (const v of consolidated.filter((c: any) => c.tipo === 'venda')) {
              let contribution = 0;
              const sessionKey = v.caixa_status_id != null ? String(v.caixa_status_id) : null;
              if (Array.isArray(v.pagamentos_badges) && v.pagamentos_badges.length) {
                // multi-payment: parse each badge
                for (const b of v.pagamentos_badges) {
                  const parts = String(b).split('·');
                  const metodo = parts[0] ? parts[0].trim().toLowerCase() : '';
                  const val = parseBadgeValue(b);
                  if (metodo === 'dinheiro' && sessionKey) {
                    const arr = entradasBySession.get(sessionKey) || [];
                    const idx = arr.findIndex(a => Math.abs(a - val) < 0.01);
                    if (idx >= 0) {
                      arr.splice(idx, 1); // consume
                      entradasBySession.set(sessionKey, arr);
                      continue; // skip this cash part
                    }
                  }
                  contribution += val;
                }
              } else {
                // single-payment: use metodo_pagamento and valor
                const metodo = (v.metodo_pagamento || '').toLowerCase();
                const val = Number(v.valor || 0);
                if (metodo === 'dinheiro' && sessionKey) {
                  const arr = entradasBySession.get(sessionKey) || [];
                  const idx = arr.findIndex(a => Math.abs(a - val) < 0.01);
                  if (idx >= 0) {
                    arr.splice(idx, 1);
                    entradasBySession.set(sessionKey, arr);
                    contribution = 0;
                  } else {
                    contribution = val;
                  }
                } else {
                  contribution = val;
                }
              }
              sumVendasAdj += contribution;
            }
            this.sumVendas = sumVendasAdj;
          }
          // Synthesize resumoVendasDia and resumo from consolidated totals for all modes.
          // For 'dia' prefer server-provided aggregates (lastAggs) when available to avoid double-counting.
          // If we have the full day's list cached, prefer client-side deduplicated
          // totals to avoid relying on server aggregates that may double-count.
          if (this.filtroModo === 'dia' && (!this.fullMovimentacoes || !this.fullMovimentacoes.length) && this.lastAggs && typeof this.lastAggs.sum_vendas === 'number') {
            this.sumEntradas = Number(this.lastAggs.sum_entradas || 0);
            this.sumRetiradas = Number(this.lastAggs.sum_retiradas || 0);
            this.sumVendas = Number(this.lastAggs.sum_vendas || 0);
            this.resumoVendasDia = { receita_total: Number(this.sumVendas || 0), total_vendas: Number(this.sumVendas || 0), quantidade_vendida: 0 } as any;
            this.resumo = { data: this.dataSelecionada, saldo_movimentacoes: Number(this.sumEntradas || 0) - Number(this.sumRetiradas || 0) } as any;
          } else {
            this.resumoVendasDia = { receita_total: Number(this.sumVendas || 0), total_vendas: Number(this.sumVendas || 0), quantidade_vendida: 0 } as any;
            if (this.filtroModo === 'dia') {
              this.resumo = { data: this.dataSelecionada, saldo_movimentacoes: Number(this.sumEntradas || 0) - Number(this.sumRetiradas || 0) } as any;
            } else if (this.filtroModo === 'mes') {
              this.resumo = { data: this.mesSelecionado, saldo_movimentacoes: Number(this.sumEntradas || 0) - Number(this.sumRetiradas || 0) } as any;
            } else { // tudo
              this.resumo = { data: 'Total', saldo_movimentacoes: Number(this.sumEntradas || 0) - Number(this.sumRetiradas || 0) } as any;
            }
          }

          // clamp page to available pages and re-slice if necessary
          try {
            const computedTotal = Number(this.total || 0);
            const perPage = Number(this.pageSize || 1) || 1;
            const totalPages = Math.max(1, Math.ceil(computedTotal / perPage));
            if (this.page > totalPages) this.page = totalPages;
            // If we have a full cached list, re-slice based on (possibly adjusted) page
            if (this.fullMovimentacoes && this.fullMovimentacoes.length) {
              const start2 = (this.page - 1) * perPage;
              this.movimentacoes = (this.fullMovimentacoes || []).slice(start2, start2 + perPage);
            }
          } catch (e) { /* ignore clamp errors */ }
          this.applySorting();
          this.loading = false;
        };

        // Render page 1 immediately
        finalizePayload(payload);
        // Ensure day-cards reflect the real current day when not in 'dia' mode
        if (this.filtroModo !== 'dia') {
          const today = getCurrentDateForInput();
          this.api.getResumoDia(today).subscribe({
            next: (r: any) => { try { if (r) this.resumoVendasDia = r; } catch { } },
            error: () => { }
          });
          this.caixaService.getResumoMovimentacoesDia(today).subscribe({
            next: (r: any) => { try { if (r) this.resumo = { data: today, saldo_movimentacoes: Number(r?.saldo_movimentacoes || 0) }; } catch { } },
            error: () => { }
          });
        }
        // Instead of fetching every page, request aggregated sums in one call
        // to avoid many requests. Use the listing endpoint with aggs=true.
        const aggsParams: any = {
          tipo: this.filtroTipo || undefined,
          metodo_pagamento: this.filtroMetodo || undefined,
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

        try {
          // Prefer the dedicated summary endpoint to get aggregates in one call
          const summaryObs = this.filtroModo === 'dia' || this.filtroModo === 'mes'
            ? this.caixaService.listarMovimentacoesSummary({
              data: this.filtroModo === 'dia' ? this.dataSelecionada : undefined,
              periodo_inicio: this.filtroModo === 'mes' ? listingPeriodoInicio : undefined,
              periodo_fim: this.filtroModo === 'mes' ? listingPeriodoFim : undefined,
              tipo: this.filtroTipo || undefined,
              metodo_pagamento: this.filtroMetodo || undefined,
              hora_inicio: this.filtroHoraInicio || undefined,
              hora_fim: this.filtroHoraFim || undefined,
            })
            : this.caixaService.listarMovimentacoesSummary({ tipo: this.filtroTipo || undefined, metodo_pagamento: this.filtroMetodo || undefined });

          summaryObs.subscribe({
            next: (aggResp: any) => {
              try {
                if (aggResp) {
                  this.sumEntradas = Number(aggResp?.sum_entradas || 0);
                  this.sumRetiradas = Number(aggResp?.sum_retiradas || 0);
                  this.sumVendas = Number(aggResp?.sum_vendas || 0);
                  // Do not overwrite the day-specific cards (`resumo`/`resumoVendasDia`) here: they
                  // must always reflect the current real day (fetched above). Keep only the
                  // aggregate sums (sumEntradas/sumRetiradas/sumVendas) for reporting purposes.
                }
              } catch (e) { logger.warn('CAIXA_COMPONENT', 'AGGS_PARSE_FAIL', 'Failed to parse summary response', e); }
            },
            error: (err) => { logger.warn('CAIXA_COMPONENT', 'AGGS_FAIL', 'Summary call failed', err); }
          });
        } catch (e) {
          logger.warn('CAIXA_COMPONENT', 'AGGS_SUBSCRIBE_FAIL', 'Failed to subscribe to summary call', e);
        }
        return;
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
      if (this.fullMovimentacoes && this.fullMovimentacoes.length) {
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

  goToPage(targetPage: number): void {
    const page = Math.max(1, Math.min(this.totalPages, Math.floor(Number(targetPage) || 1)));
    if (page === this.page) return;
    // set the page and either paginate client-side or request server page
    this.page = page;
    if (this.filtroModo === 'dia') {
      logger.info('CAIXA_COMPONENT', 'GO_TO_PAGE_DIA', 'Changing page in dia mode', { page: this.page, pageSize: this.pageSize, fullLength: this.fullMovimentacoes ? this.fullMovimentacoes.length : null });
      // client-side pagination when we have fullMovimentacoes
      this.applySorting();
      return;
    }
    this.scheduleLoadResumo(0);
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
    this.scheduleLoadResumo();
  }

  limparFiltrosMovs(): void {
    this.filtroTipo = '';
    this.filtroMetodo = '';
    this.filtroHoraInicio = '';
    this.filtroHoraFim = '';
    this.scheduleLoadResumo();
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
    // If we have a full cached list (e.g. day mode), operate on the cached list and then slice
    if (this.fullMovimentacoes && this.fullMovimentacoes.length) {
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

  get totalVendasHoje(): number {
    // Quando o usuário aplica filtros no modo 'dia', preferir o somatório retornado
    // pela listagem paginada (sumVendas) que considera filtros por tipo/método/hora.
    if (this.filtroModo === 'dia' && (this.filtroTipo || this.filtroMetodo || this.filtroHoraInicio || this.filtroHoraFim)) {
      return Number(this.sumVendas || 0);
    }
    // prefer server resumoVendasDia (order totals) when available, otherwise fallback
    if (this.filtroModo === 'dia' && this.lastAggs && typeof this.lastAggs.sum_vendas === 'number') {
      // The backend 'sum_vendas' already attempts to dedupe cash duplicates; prefer it
      return Number(this.lastAggs.sum_vendas || this.resumoVendasDia?.receita_total || 0);
    }
    return Number(this.resumoVendasDia?.receita_total || 0);
  }

  get saldoMovimentacoesHoje(): number {
    // Preferir somatório calculado pelo endpoint de listagem quando filtros ativos
    if (this.filtroModo === 'dia' && (this.filtroTipo || this.filtroMetodo || this.filtroHoraInicio || this.filtroHoraFim)) {
      return Number((this.sumEntradas || 0) - (this.sumRetiradas || 0));
    }
    return Number(this.resumo?.saldo_movimentacoes || 0);
  }

  get totalNoCaixaHoje(): number {
    if (this.filtroModo === 'dia') {
      // Prefer server-provided aggregates for day mode when available to avoid double-counting
      if (this.lastAggs && typeof this.lastAggs.sum_vendas === 'number' && typeof this.lastAggs.sum_entradas === 'number' && typeof this.lastAggs.sum_retiradas === 'number') {
        const vendas = Number(this.lastAggs.sum_vendas || 0);
        const movs = Number(this.lastAggs.sum_entradas || 0) - Number(this.lastAggs.sum_retiradas || 0);
        return vendas + movs;
      }
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



