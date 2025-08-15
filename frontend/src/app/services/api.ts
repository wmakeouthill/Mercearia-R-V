import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError, of, timer } from 'rxjs';
import { tap, catchError, timeout, mergeMap } from 'rxjs/operators';
import { Produto, Venda, RelatorioVendas, CheckoutRequest, VendaCompletaResponse, RelatorioResumo } from '../models';
import { logger } from '../utils/logger';
import { environment } from '../../environments/environment';
import { BackendDetectorService } from './backend-detector';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = environment.apiUrl;
  private readonly backendUrlSubject = new BehaviorSubject<string>(environment.apiUrl);
  private isDetecting = false;
  private readonly connectionStatus = new BehaviorSubject<boolean>(true);
  private reconnectionAttempts = 0;
  private readonly maxReconnectionAttempts = 5;
  private connectionCheckInterval: any;
  private consecutiveHealthFailures = 0;
  private readonly healthFailureThreshold = 2; // só considerar queda após 2 falhas seguidas

  constructor(
    private readonly http: HttpClient,
    private readonly backendDetector: BackendDetectorService
  ) {
    // Detectar backend em qualquer ambiente para evitar race no boot
    this.detectBackend();

    // Iniciar monitoramento de conexão
    this.startConnectionMonitoring();
  }

  private detectBackend(): void {
    if (this.isDetecting) return;

    this.isDetecting = true;
    console.log('🔍 Detectando backend em produção...');

    this.backendDetector.detectBackendUrl().subscribe({
      next: (backendUrl) => {
        const apiUrl = `${backendUrl}/api`;
        console.log('✅ Backend detectado! URL da API:', apiUrl);
        this.baseUrl = apiUrl;
        this.backendUrlSubject.next(apiUrl);
        this.isDetecting = false;
        this.connectionStatus.next(true);
        this.reconnectionAttempts = 0;
      },
      error: (error) => {
        console.error('❌ Erro ao detectar backend:', error);
        console.log('💡 Usando URL padrão:', this.baseUrl);
        this.isDetecting = false;
        this.connectionStatus.next(false);

        // Tentar reconectar após delay
        this.scheduleReconnection();
      }
    });
  }

  private startConnectionMonitoring(): void {
    // Checagem mais rápida no início para evitar janela sem backend
    const initialDelayMs = 1000;
    const intervalMs = environment.production ? 30000 : 10000;
    setTimeout(() => {
      this.connectionCheckInterval = setInterval(() => {
        this.checkConnection();
      }, intervalMs);
    }, initialDelayMs);
  }

  private checkConnection(): void {
    const base = this.baseUrl.replace('/api', '');
    this.http.get(`${base}/health`).pipe(
      timeout(8000),
      catchError(() => this.http.get(`${base}/test`).pipe(timeout(8000), catchError(() => of(null))))
    ).subscribe({
      next: (response) => {
        if (response) {
          this.consecutiveHealthFailures = 0;
          if (!this.connectionStatus.value) {
            console.log('✅ Conexão com backend restaurada!');
            this.connectionStatus.next(true);
            this.reconnectionAttempts = 0;
          }
        } else {
          this.consecutiveHealthFailures++;
          if (this.consecutiveHealthFailures >= this.healthFailureThreshold) {
            this.handleConnectionLoss();
          }
        }
      },
      error: () => {
        this.consecutiveHealthFailures++;
        if (this.consecutiveHealthFailures >= this.healthFailureThreshold) {
          this.handleConnectionLoss();
        }
      }
    });
  }

  private handleConnectionLoss(): void {
    if (this.connectionStatus.value) {
      console.log('❌ Conexão com backend perdida');
      this.connectionStatus.next(false);
    }
    this.scheduleReconnection();
  }

  private scheduleReconnection(): void {
    if (this.reconnectionAttempts >= this.maxReconnectionAttempts) {
      console.error('🚫 Máximo de tentativas de reconexão atingido');
      return;
    }

    this.reconnectionAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectionAttempts), 30000); // Backoff exponencial, máximo 30s

    console.log(`🔄 Tentativa de reconexão ${this.reconnectionAttempts}/${this.maxReconnectionAttempts} em ${delay}ms`);

    setTimeout(() => {
      // Sempre tentar auto-detecção na reconexão para ser mais agressivo
      this.backendDetector.forceDetection().subscribe({
        next: (backendUrl) => {
          const apiUrl = `${backendUrl}/api`;
          console.log('✅ Reconectado ao backend:', apiUrl);
          this.baseUrl = apiUrl;
          this.backendUrlSubject.next(apiUrl);
          this.connectionStatus.next(true);
          this.reconnectionAttempts = 0;
        },
        error: () => {
          // fallback: checar conexão com base atual
          this.checkConnection();
          this.scheduleReconnection();
        }
      });
    }, delay);
  }

  private makeRequest<T>(requestFn: () => Observable<T>, operation: string): Observable<T> {
    return requestFn().pipe(
      timeout(30000), // 30 segundos de timeout
      // Retry manual com scan/delay para erros transitórios (status 0 ou >= 500)
      catchError((error: HttpErrorResponse) => {
        (error as any).__retryAttempt = 1;
        throw error;
      }),
      // Aplicar backoff simples para erros transitórios
      mergeMap((value: any) => of(value)),
      tap((response: any) => {
        logger.logApiResponse('API_SERVICE', operation, this.baseUrl, response, true);
        // Marcar conexão como ativa em caso de sucesso
        if (!this.connectionStatus.value) {
          this.connectionStatus.next(true);
          this.reconnectionAttempts = 0;
        }
      }),
      catchError((error: HttpErrorResponse) => {
        logger.logApiError('API_SERVICE', operation, this.baseUrl, error);

        // Se for erro de conexão, tentar reconectar
        if (error.status === 0 || error.status >= 500) {
          this.handleConnectionLoss();
          const attempt = (error as any).__retryAttempt || 1;
          if (attempt <= 3) {
            const nextError = { ...error } as any;
            nextError.__retryAttempt = attempt + 1;
            return timer(1000).pipe(mergeMap(() => requestFn()));
          }
        }

        return throwError(() => error);
      })
    );
  }

  // Observable para monitorar status da conexão
  getConnectionStatus(): Observable<boolean> {
    return this.connectionStatus.asObservable();
  }

  // Observable para monitorar mudanças na URL do backend
  getBackendUrl(): Observable<string> {
    return this.backendUrlSubject.asObservable();
  }

  // Forçar reconexão manual
  forceReconnection(): void {
    console.log('🔄 Forçando reconexão manual...');
    this.reconnectionAttempts = 0;
    if (environment.production) {
      this.detectBackend();
    } else {
      this.checkConnection();
    }
  }

  // PRODUTOS
  getProdutos(): Observable<Produto[]> {
    return this.makeRequest(
      () => this.http.get<Produto[]>(`${this.baseUrl}/produtos`),
      'GET_PRODUTOS'
    );
  }

  getProduto(id: number): Observable<Produto> {
    return this.getProdutoById(id);
  }

  getProdutoById(id: number): Observable<Produto> {
    return this.makeRequest(
      () => this.http.get<Produto>(`${this.baseUrl}/produtos/${id}`),
      'GET_PRODUTO_BY_ID'
    );
  }

  searchProdutoByCodigo(codigo: string): Observable<Produto> {
    return this.makeRequest(
      () => this.http.get<Produto>(`${this.baseUrl}/produtos/codigo/${codigo}`),
      'SEARCH_PRODUTO_BY_CODIGO'
    );
  }

  createProduto(produto: Omit<Produto, 'id'>): Observable<Produto> {
    return this.makeRequest(
      () => this.http.post<Produto>(`${this.baseUrl}/produtos`, produto),
      'CREATE_PRODUTO'
    );
  }

  criarProduto(produto: Produto): Observable<Produto> {
    return this.createProduto(produto);
  }

  updateProduto(id: number, produto: Partial<Produto>): Observable<Produto> {
    return this.makeRequest(
      () => this.http.put<Produto>(`${this.baseUrl}/produtos/${id}`, produto),
      'UPDATE_PRODUTO'
    );
  }

  atualizarProduto(id: number, produto: Produto): Observable<Produto> {
    return this.updateProduto(id, produto);
  }

  updateEstoque(id: number, quantidade: number): Observable<any> {
    return this.makeRequest(
      () => this.http.put<any>(`${this.baseUrl}/produtos/${id}/estoque`, { quantidade_estoque: quantidade }),
      'UPDATE_ESTOQUE'
    );
  }

  deleteProduto(id: number): Observable<void> {
    return this.makeRequest(
      () => this.http.delete<void>(`${this.baseUrl}/produtos/${id}`),
      'DELETE_PRODUTO'
    );
  }

  // VENDAS
  getVendas(): Observable<Venda[]> {
    return this.makeRequest(
      () => this.http.get<Venda[]>(`${this.baseUrl}/vendas`),
      'GET_VENDAS'
    );
  }

  // Vendas completas (novo modelo com itens e pagamentos)
  getVendasCompletas(): Observable<any[]> {
    return this.makeRequest(
      () => this.http.get<any[]>(`${this.baseUrl}/checkout`),
      'GET_VENDAS_COMPLETAS'
    );
  }

  private postVenda(payload: any): Observable<Venda> {
    return this.makeRequest(
      () => this.http.post<Venda>(`${this.baseUrl}/vendas`, payload),
      'CREATE_VENDA'
    );
  }

  // Método para a nova estrutura de vendas (com itens)
  createVendaWithItens(checkout: CheckoutRequest): Observable<VendaCompletaResponse> {
    return this.makeRequest(
      () => this.http.post<VendaCompletaResponse>(`${this.baseUrl}/checkout`, checkout),
      'CHECKOUT_VENDA'
    );
  }

  // Método para a estrutura atual de vendas (individual)
  createVenda(venda: { produto_id: number, quantidade_vendida: number, preco_total: number, data_venda: string, metodo_pagamento: string }): Observable<Venda> {
    return this.postVenda(venda);
  }

  deleteVenda(id: number): Observable<void> {
    return this.makeRequest(
      () => this.http.delete<void>(`${this.baseUrl}/vendas/${id}`),
      'DELETE_VENDA'
    );
  }

  // RELATÓRIOS
  getRelatorioVendasDia(data?: string): Observable<RelatorioVendas> {
    const url = data
      ? `${this.baseUrl}/vendas/relatorios/dia?data=${data}`
      : `${this.baseUrl}/vendas/relatorios/dia`;

    return this.makeRequest(
      () => this.http.get<RelatorioVendas>(url),
      'GET_RELATORIO_VENDAS_DIA'
    );
  }

  getRelatorioVendasMes(ano?: number, mes?: number): Observable<RelatorioVendas> {
    let url = `${this.baseUrl}/vendas/relatorios/mes`;
    if (ano && mes) {
      url += `?ano=${ano}&mes=${mes}`;
    }

    return this.makeRequest(
      () => this.http.get<RelatorioVendas>(url),
      'GET_RELATORIO_VENDAS_MES'
    );
  }

  // Novos: obter resumo+breakdown direto do backend
  getResumoDia(data?: string): Observable<RelatorioResumo> {
    const url = data ? `${this.baseUrl}/vendas/relatorios/dia?data=${data}` : `${this.baseUrl}/vendas/relatorios/dia`;
    return this.makeRequest(
      () => this.http.get<RelatorioResumo>(url),
      'GET_RESUMO_DIA'
    );
  }

  getResumoMesAtual(): Observable<RelatorioResumo> {
    return this.makeRequest(
      () => this.http.get<RelatorioResumo>(`${this.baseUrl}/vendas/relatorios/mes`),
      'GET_RESUMO_MES'
    );
  }

  // Gerenciamento de usuários
  getUsers(): Observable<any[]> {
    return this.makeRequest<any[]>(
      () => this.http.get<any[]>(`${this.baseUrl}/auth/users`),
      'GET_USERS'
    );
  }

  createUser(userData: { username: string; password: string; role: string; pode_controlar_caixa?: boolean }): Observable<any> {
    const payload: any = {
      username: userData.username,
      password: userData.password,
      role: userData.role,
    };
    if (typeof userData.pode_controlar_caixa === 'boolean') {
      payload.podeControlarCaixa = userData.pode_controlar_caixa;
    }
    return this.makeRequest<any>(
      () => this.http.post<any>(`${this.baseUrl}/auth/users`, payload),
      'CREATE_USER'
    );
  }

  updateUser(id: number, userData: { username: string; password?: string; role: string; pode_controlar_caixa?: boolean }): Observable<any> {
    const payload: any = {
      username: userData.username,
      role: userData.role,
    };
    if (typeof userData.pode_controlar_caixa === 'boolean') {
      payload.podeControlarCaixa = userData.pode_controlar_caixa;
    }
    if (userData.password && userData.password.trim().length > 0) {
      payload.password = userData.password;
    }
    return this.makeRequest<any>(
      () => this.http.put<any>(`${this.baseUrl}/auth/users/${id}`, payload),
      'UPDATE_USER'
    );
  }

  deleteUser(id: number): Observable<any> {
    return this.makeRequest<any>(
      () => this.http.delete<any>(`${this.baseUrl}/auth/users/${id}`),
      'DELETE_USER'
    );
  }

  changePassword(passwordData: { currentPassword: string; newPassword: string }): Observable<any> {
    return this.makeRequest<any>(
      () => this.http.post<any>(`${this.baseUrl}/auth/change-password`, passwordData),
      'CHANGE_PASSWORD'
    );
  }

  // Cleanup quando o serviço for destruído
  ngOnDestroy(): void {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }
  }
}
