import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap, catchError, retry, timeout } from 'rxjs/operators';
import { StatusCaixa } from '../models';
import { environment } from '../../environments/environment';
import { logger } from '../utils/logger';

@Injectable({
  providedIn: 'root'
})
export class CaixaService {
  private readonly baseUrl = environment.apiUrl;
  private readonly statusCaixaSubject = new BehaviorSubject<StatusCaixa | null>(null);
  public statusCaixa$ = this.statusCaixaSubject.asObservable();

  constructor(private readonly http: HttpClient) {
    this.loadStatusCaixa();
  }

  listarMovimentacoesDia(data: string): Observable<{ items: any[]; total: number; hasNext: boolean; page: number; size: number; sum_entradas: number; sum_retiradas: number; sum_vendas: number }> {
    const url = `${this.baseUrl}/caixa/movimentacoes/dia?data=${encodeURIComponent(data)}`;
    return this.makeRequest('LISTAR_MOVIMENTACOES_DIA', () => this.http.get<any>(url));
  }

  listarMovimentacoesMes(ano: number, mes: number): Observable<{ items: any[]; total: number; hasNext: boolean; page: number; size: number; sum_entradas?: number; sum_retiradas?: number; sum_vendas?: number }> {
    const m = String(mes).padStart(2, '0');
    const url = `${this.baseUrl}/caixa/movimentacoes/mes?ano=${ano}&mes=${m}`;
    return this.makeRequest('LISTAR_MOVIMENTACOES_MES', () => this.http.get<any>(url));
  }

  /**
   * Wrapper para requisições HTTP com tratamento de erro e retry
   */
  private makeRequest<T>(operation: string, requestFn: () => Observable<T>): Observable<T> {
    return requestFn().pipe(
      timeout(15000), // 15 segundos de timeout
      retry(2), // 2 tentativas
      tap(response => {
        logger.info('CAIXA_SERVICE', operation, 'Requisição bem-sucedida', { response });
      }),
      catchError(error => {
        logger.error('CAIXA_SERVICE', operation, 'Erro na requisição', error);
        throw error;
      })
    );
  }

  /**
   * Carrega o status atual do caixa
   */
  loadStatusCaixa(): void {
    this.getStatusCaixa().subscribe({
      next: (status) => {
        // Forçar emissão mesmo se o valor for igual
        this.statusCaixaSubject.next(status);
        logger.info('CAIXA_SERVICE', 'LOAD_STATUS', 'Status do caixa carregado', { aberto: status.aberto });
      },
      error: (error) => {
        logger.error('CAIXA_SERVICE', 'LOAD_STATUS', 'Erro ao carregar status do caixa', error);
      }
    });
  }

  /**
   * Obtém o status atual do caixa
   */
  getStatusCaixa(): Observable<StatusCaixa> {
    return this.makeRequest('GET_STATUS',
      () => this.http.get<StatusCaixa>(`${this.baseUrl}/caixa/status`)
    );
  }

  /**
   * Obtém relatório de reconciliação para uma sessão específica
   */
  getReconciliation(sessionId: number): Observable<any> {
    return this.makeRequest('GET_RECONCILIATION', () => this.http.get<any>(`${this.baseUrl}/caixa/session/${sessionId}/reconciliation`));
  }

  listarMovimentacoes(params: {
    data?: string,
    tipo?: string,
    metodo_pagamento?: string,
    hora_inicio?: string,
    hora_fim?: string,
    periodo_inicio?: string,
    periodo_fim?: string,
    all?: boolean,
    from?: string,
    to?: string,
    page?: number,
    size?: number,
  }): Observable<{ items: any[]; total: number; hasNext: boolean; page: number; size: number; sum_entradas: number; sum_retiradas: number; sum_vendas: number }> {
    const queryParams: string[] = [];

    // Normalize date/period into explicit from/to ISO UTC timestamps (Z)
    // so backend can use timestamp-range queries reliably. Use local
    // Date construction then toISOString() to emit Z-suffixed instants.
    const toIsoUtc = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0, ms = 0) => {
      // month is 1-based here
      const dt = new Date(y, (m || 1) - 1, d, hh, mm, ss, ms);
      return dt.toISOString();
    };

    // Prefer sending explicit from/to in UTC for both single-day and
    // periodo ranges so backend receives timestamp-range queries in the
    // same format it uses for 'tudo' timestamp queries.
    // Preserve explicit LocalDate parameters when provided so backend
    // can route to the LocalDate code path and avoid timezone shifts.
    if (params.periodo_inicio && params.periodo_fim) {
      queryParams.push(`periodo_inicio=${encodeURIComponent(params.periodo_inicio)}`);
      queryParams.push(`periodo_fim=${encodeURIComponent(params.periodo_fim)}`);
    } else if (params.data) {
      // when data is provided as YYYY-MM-DD, send as-is
      queryParams.push(`data=${encodeURIComponent(params.data)}`);
    }
    if (params.tipo) queryParams.push(`tipo=${encodeURIComponent(params.tipo)}`);
    if (params.metodo_pagamento) queryParams.push(`metodo_pagamento=${encodeURIComponent(params.metodo_pagamento)}`);
    if (params.hora_inicio) queryParams.push(`hora_inicio=${encodeURIComponent(params.hora_inicio)}`);
    if (params.hora_fim) queryParams.push(`hora_fim=${encodeURIComponent(params.hora_fim)}`);
    if (params.all === true) queryParams.push(`all=true`);
    // include explicit timestamp bounds if provided (from/to are ISO strings with offset/Z)
    if (params.from) queryParams.push(`from=${encodeURIComponent(params.from)}`);
    if (params.to) queryParams.push(`to=${encodeURIComponent(params.to)}`);
    if (params.page != null) queryParams.push(`page=${params.page}`);
    if (params.size != null) queryParams.push(`size=${params.size}`);
    const query = queryParams.length ? `?${queryParams.join('&')}` : '';
    const url = `${this.baseUrl}/caixa/movimentacoes${query}`;
    return this.makeRequest('LISTAR_MOVIMENTACOES', () => this.http.get<any>(url));
  }

  listarSessoes(params: { page?: number; size?: number; periodo_inicio?: string; periodo_fim?: string; mes?: string; aberto_por?: string; fechado_por?: string; status?: string } = {}): Observable<{ items: any[]; total: number; hasNext: boolean; page: number; size: number }> {
    const queryParams: string[] = [];
    if (params.page != null) queryParams.push(`page=${params.page}`);
    if (params.size != null) queryParams.push(`size=${params.size}`);
    if (params.periodo_inicio) queryParams.push(`periodo_inicio=${encodeURIComponent(params.periodo_inicio)}`);
    if (params.periodo_fim) queryParams.push(`periodo_fim=${encodeURIComponent(params.periodo_fim)}`);
    if (params.mes) queryParams.push(`mes=${encodeURIComponent(params.mes)}`);
    if (params.aberto_por) queryParams.push(`aberto_por=${encodeURIComponent(params.aberto_por)}`);
    if (params.fechado_por) queryParams.push(`fechado_por=${encodeURIComponent(params.fechado_por)}`);
    if (params.status) queryParams.push(`status=${encodeURIComponent(params.status)}`);
    const query = queryParams.length ? `?${queryParams.join('&')}` : '';
    const url = `${this.baseUrl}/caixa/sessoes${query}`;
    return this.makeRequest('LISTAR_SESSOES', () => this.http.get<any>(url));
  }

  adicionarMovimentacao(mov: { tipo: 'entrada' | 'retirada'; valor: number; descricao?: string }): Observable<{ message: string }> {
    // Ainda que o backend valide permissões, recarregamos o status após tentativa
    return this.makeRequest('ADICIONAR_MOVIMENTACAO', () => this.http.post<{ message: string }>(`${this.baseUrl}/caixa/movimentacoes`, mov)).pipe(
      tap(() => {
        this.loadStatusCaixa();
      })
    );
  }

  getResumoMovimentacoesDia(data?: string): Observable<{ data: string; saldo_movimentacoes: number }> {
    const url = data ? `${this.baseUrl}/caixa/resumo-dia?data=${data}` : `${this.baseUrl}/caixa/resumo-dia`;
    return this.makeRequest('RESUMO_MOVIMENTACOES_DIA', () => this.http.get<{ data: string; saldo_movimentacoes: number }>(url));
  }

  /**
   * Abre o caixa
   */
  abrirCaixa(payload: { saldo_inicial: number; terminal_id?: string }): Observable<{ message: string }> {
    // Abrir caixa agora aceita saldoInicial e terminalId no corpo
    return this.makeRequest('ABRIR_CAIXA',
      () => this.http.post<{ message: string }>(`${this.baseUrl}/caixa/abrir`, { saldo_inicial: payload.saldo_inicial, terminal_id: payload.terminal_id })
    ).pipe(
      tap(() => {
        this.loadStatusCaixa(); // Recarregar status após abrir
        logger.info('CAIXA_SERVICE', 'ABRIR_CAIXA', 'Caixa aberto com sucesso');
      })
    );
  }

  /**
   * Fecha o caixa
   */
  fecharCaixa(payload: { saldo_contado: number; observacoes?: string }): Observable<{ message: string }> {
    return this.makeRequest('FECHAR_CAIXA',
      // backend espera campo camelCase 'saldoContado' no corpo (FecharRequest.saldoContado)
      () => this.http.post<{ message: string }>(`${this.baseUrl}/caixa/fechar`, { saldoContado: payload.saldo_contado, observacoes: payload.observacoes })
    ).pipe(
      tap(() => {
        this.loadStatusCaixa(); // Recarregar status após fechar
        logger.info('CAIXA_SERVICE', 'FECHAR_CAIXA', 'Caixa fechado com sucesso');
      })
    );
  }

  /**
   * Exclui uma movimentação manual (entrada/retirada) pelo id. Apenas admin.
   */
  deleteMovimentacao(id: number): Observable<{ message?: string }> {
    const url = `${this.baseUrl}/caixa/movimentacoes/${id}`;
    return this.makeRequest('DELETE_MOVIMENTACAO', () => this.http.delete<any>(url));
  }

  /**
   * Configura horários obrigatórios (apenas admin)
   */
  configurarHorarios(horarios: {
    horario_abertura_obrigatorio?: string;
    horario_fechamento_obrigatorio?: string;
  }): Observable<{ message: string }> {
    return this.makeRequest('CONFIGURAR_HORARIOS',
      () => this.http.put<{ message: string }>(`${this.baseUrl}/caixa/horarios`, horarios)
    ).pipe(
      tap(() => {
        this.loadStatusCaixa(); // Recarregar status após configurar
        logger.info('CAIXA_SERVICE', 'CONFIGURAR_HORARIOS', 'Horários configurados com sucesso', horarios);
      })
    );
  }

  /**
   * Verifica se o caixa está aberto
   */
  isCaixaAberto(): boolean {
    return this.statusCaixaSubject.value?.aberto ?? false;
  }

  /**
   * Obtém o status atual do caixa (valor atual)
   */
  getCurrentStatus(): StatusCaixa | null {
    return this.statusCaixaSubject.value;
  }

  /**
   * Verifica se deve abrir/fechar automaticamente baseado nos horários
   */
  verificarHorariosAutomaticos(): void {
    const status = this.getCurrentStatus();
    if (!(status?.horario_abertura_obrigatorio) || !(status?.horario_fechamento_obrigatorio)) {
      return;
    }

    const agora = new Date();
    const horaAtual = agora.toTimeString().substring(0, 5); // HH:MM

    const horaAbertura = status.horario_abertura_obrigatorio;
    const horaFechamento = status.horario_fechamento_obrigatorio;

    // Se chegou na hora de abrir e está fechado
    if (horaAtual === horaAbertura && !status.aberto) {
      this.abrirCaixa({ saldo_inicial: status?.saldo_inicial ?? 0 }).subscribe({
        next: () => {
          logger.info('CAIXA_SERVICE', 'ABERTURA_AUTOMATICA', 'Caixa aberto automaticamente');
        },
        error: (error) => {
          logger.error('CAIXA_SERVICE', 'ABERTURA_AUTOMATICA', 'Erro na abertura automática', error);
        }
      });
    }

    // Se chegou na hora de fechar e está aberto
    if (horaAtual === horaFechamento && status.aberto) {
      this.fecharCaixa({ saldo_contado: status?.saldo_esperado ?? 0 }).subscribe({
        next: () => {
          logger.info('CAIXA_SERVICE', 'FECHAMENTO_AUTOMATICO', 'Caixa fechado automaticamente');
        },
        error: (error) => {
          logger.error('CAIXA_SERVICE', 'FECHAMENTO_AUTOMATICO', 'Erro no fechamento automático', error);
        }
      });
    }
  }
}
