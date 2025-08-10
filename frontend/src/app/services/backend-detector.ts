import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError, timer } from 'rxjs';
import { catchError, timeout, retry, map, switchMap, take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class BackendDetectorService {
  private possibleUrls = [
    // Tentar IPs primeiro em produção, depois localhost
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://0.0.0.0:3000',
    // Fallbacks para outras portas
    'http://127.0.0.1:3001',
    'http://localhost:3001'
  ];

  private currentWorkingUrl: string | null = null;
  private detectionInProgress = false;

  constructor(private http: HttpClient) { }

  /**
   * Detecta automaticamente qual URL do backend está funcionando
   */
  detectBackendUrl(): Observable<string> {
    if (this.currentWorkingUrl) {
      console.log(`🔄 Usando URL já detectada: ${this.currentWorkingUrl}`);
      return of(this.currentWorkingUrl);
    }

    if (this.detectionInProgress) {
      console.log('🔍 Detecção já em progresso, aguardando...');
      return timer(500).pipe(
        switchMap(() => this.detectBackendUrl()),
        take(1)
      );
    }

    return new Observable(observer => {
      this.detectionInProgress = true;
      this.tryUrls(0, observer);
    });
  }

  private tryUrls(index: number, observer: any): void {
    if (index >= this.possibleUrls.length) {
      this.detectionInProgress = false;
      observer.error('Nenhum backend disponível encontrado em todas as URLs testadas');
      return;
    }

    const url = this.possibleUrls[index];
    console.log(`🔍 Testando backend ${index + 1}/${this.possibleUrls.length}: ${url}`);

    // Primeiro tentar endpoint de health check, depois /test
    this.testEndpoint(url, '/health').pipe(
      catchError(() => this.testEndpoint(url, '/test')),
      catchError(() => this.testEndpoint(url, '/'))
    ).subscribe({
      next: (response) => {
        console.log(`✅ Backend encontrado e funcionando em: ${url}`, response);
        this.currentWorkingUrl = url;
        this.detectionInProgress = false;
        observer.next(url);
        observer.complete();
      },
      error: (error) => {
        console.log(`❌ Backend não disponível em: ${url} - ${error.message}`);
        // Tentar próxima URL após um pequeno delay
        setTimeout(() => {
          this.tryUrls(index + 1, observer);
        }, 300);
      }
    });
  }

  private testEndpoint(baseUrl: string, endpoint: string): Observable<any> {
    return this.http.get(`${baseUrl}${endpoint}`, {
      headers: { 'Content-Type': 'application/json' },
      // Configurações mais agressivas para detecção rápida
      observe: 'response'
    }).pipe(
      timeout(2000), // Timeout mais curto
      retry(1), // Apenas uma tentativa extra
      map(response => {
        if (response.status >= 200 && response.status < 300) {
          return response.body;
        }
        throw new Error(`Status ${response.status}`);
      }),
      catchError(error => {
        const message = error.name === 'TimeoutError' ? 'Timeout' :
          error.status ? `HTTP ${error.status}` :
            error.message || 'Erro desconhecido';
        return throwError(() => new Error(message));
      })
    );
  }

  /**
   * Testa se uma URL específica está funcionando
   */
  testUrl(baseUrl: string): Observable<boolean> {
    return new Observable<boolean>(observer => {
      console.log(`🧪 Testando URL específica: ${baseUrl}`);

      this.testEndpoint(baseUrl, '/health').pipe(
        catchError(() => this.testEndpoint(baseUrl, '/test')),
        catchError(() => this.testEndpoint(baseUrl, '/'))
      ).subscribe({
        next: () => {
          console.log(`✅ URL está funcionando: ${baseUrl}`);
          observer.next(true);
          observer.complete();
        },
        error: (error) => {
          console.log(`❌ URL não está funcionando: ${baseUrl} - ${error.message}`);
          observer.next(false);
          observer.complete();
        }
      });
    });
  }

  /**
   * Força uma nova detecção, ignorando cache
   */
  forceDetection(): Observable<string> {
    console.log('🔄 Forçando nova detecção de backend...');
    this.currentWorkingUrl = null;
    this.detectionInProgress = false;
    return this.detectBackendUrl();
  }

  /**
   * Verifica se a URL atual ainda está funcionando
   */
  verifyCurrentUrl(): Observable<boolean> {
    if (!this.currentWorkingUrl) {
      return of(false);
    }

    console.log(`🔍 Verificando URL atual: ${this.currentWorkingUrl}`);
    return this.testUrl(this.currentWorkingUrl).pipe(
      map(isWorking => {
        if (!isWorking) {
          console.log('❌ URL atual não está mais funcionando, limpando cache');
          this.currentWorkingUrl = null;
        }
        return isWorking;
      })
    );
  }

  /**
   * Retorna a URL atualmente em uso (se houver)
   */
  getCurrentUrl(): string | null {
    return this.currentWorkingUrl;
  }

  /**
   * Adiciona uma nova URL para testar (útil para configurações dinâmicas)
   */
  addTestUrl(url: string): void {
    if (!this.possibleUrls.includes(url)) {
      console.log(`➕ Adicionando nova URL para teste: ${url}`);
      this.possibleUrls.unshift(url); // Adicionar no início para ter prioridade
    }
  }

  /**
   * Lista todas as URLs que serão testadas
   */
  getTestUrls(): string[] {
    return [...this.possibleUrls];
  }
}