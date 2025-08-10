import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, BehaviorSubject, timer, throwError, of } from 'rxjs';
import { tap, catchError, switchMap, first, retry, retryWhen, delay, take, timeout } from 'rxjs/operators';
import { Produto, Venda, RelatorioVendas } from '../models';
import { logger } from '../utils/logger';
import { environment } from '../../environments/environment';
import { BackendDetectorService } from './backend-detector';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private baseUrl = environment.apiUrl;
  private backendUrlSubject = new BehaviorSubject<string>(environment.apiUrl);
  private isDetecting = false;
  private connectionStatus = new BehaviorSubject<boolean>(true);
  private reconnectionAttempts = 0;
  private maxReconnectionAttempts = 5;
  private connectionCheckInterval: any;

  constructor(
    private http: HttpClient,
    private backendDetector: BackendDetectorService
  ) {
    // Em produção, tentar detectar o backend automaticamente
    if (environment.production) {
      this.detectBackend();
    }

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
    // Verificar conexão a cada 30 segundos
    this.connectionCheckInterval = setInterval(() => {
      this.checkConnection();
    }, 30000);
  }

  private checkConnection(): void {
    // Fazer uma requisição leve para verificar se o backend está respondendo
    this.http.get(`${this.baseUrl.replace('/api', '')}/health`).pipe(
      timeout(5000),
      catchError(() => {
        // Se health check falhar, tentar endpoint de teste
        return this.http.get(`${this.baseUrl.replace('/api', '')}/test`).pipe(
          timeout(5000),
          catchError(() => of(null))
        );
      })
    ).subscribe({
      next: (response) => {
        if (response) {
          // Conexão está funcionando
          if (!this.connectionStatus.value) {
            console.log('✅ Conexão com backend restaurada!');
            this.connectionStatus.next(true);
            this.reconnectionAttempts = 0;
          }
        } else {
          this.handleConnectionLoss();
        }
      },
      error: () => {
        this.handleConnectionLoss();
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
      if (environment.production) {
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
            this.scheduleReconnection();
          }
        });
      } else {
        this.checkConnection();
      }
    }, delay);
  }

  private makeRequest<T>(requestFn: () => Observable<T>, operation: string): Observable<T> {
    return requestFn().pipe(
      timeout(30000), // 30 segundos de timeout
      retryWhen(errors =>
        errors.pipe(
          take(3), // Máximo 3 tentativas
          delay(1000) // 1 segundo entre tentativas
        )
      ),
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

  updateEstoque(id: number, quantidade: number): Observable<Produto> {
    return this.makeRequest(
      () => this.http.put<Produto>(`${this.baseUrl}/produtos/${id}/estoque`, { quantidade }),
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

  // Método para a nova estrutura de vendas (com itens)
  createVendaWithItens(venda: { itens: Array<{ produtoId: number, quantidade: number, precoUnitario: number }>, metodoPagamento: string }): Observable<Venda> {
    return this.makeRequest(
      () => this.http.post<Venda>(`${this.baseUrl}/vendas`, venda),
      'CREATE_VENDA'
    );
  }

  // Método para a estrutura atual de vendas (individual)
  createVenda(venda: { produto_id: number, quantidade_vendida: number, preco_total: number, data_venda: string, metodo_pagamento: string }): Observable<Venda> {
    return this.makeRequest(
      () => this.http.post<Venda>(`${this.baseUrl}/vendas`, venda),
      'CREATE_VENDA'
    );
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

  // Gerenciamento de usuários
  getUsers(): Observable<any[]> {
    return this.makeRequest<any[]>(
      () => this.http.get<any[]>(`${this.baseUrl}/auth/users`),
      'GET_USERS'
    );
  }

  createUser(userData: { username: string; password: string; role: string }): Observable<any> {
    return this.makeRequest<any>(
      () => this.http.post<any>(`${this.baseUrl}/auth/users`, userData),
      'CREATE_USER'
    );
  }

  updateUser(id: number, userData: { username: string; password?: string; role: string }): Observable<any> {
    return this.makeRequest<any>(
      () => this.http.put<any>(`${this.baseUrl}/auth/users/${id}`, userData),
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
