import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError, timer, from } from 'rxjs';
import { catchError, timeout, retry, map, switchMap, take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class BackendDetectorService {
  private readonly possibleUrls = this.buildPossibleUrls();

  private currentWorkingUrl: string | null = null;
  private detectionInProgress = false;

  constructor(private readonly http: HttpClient) { }

  private buildPossibleUrls(): string[] {
    // Em ambiente empacotado (Electron), forçar apenas a porta 3000 local
    try {
      if (typeof navigator !== 'undefined' && navigator.userAgent?.includes('Electron')) {
        return ['http://127.0.0.1:3000'];
      }
    } catch (e) {
      // Log the error so we don't silently swallow exceptions (fixes SonarQube S2486)
      // This is a non-fatal check; continue building other possible URLs.
      // Using console.debug to avoid noisy logs in production.
      console.debug('backend-detector: navigator check failed', e);
    }

    const ports = [3000, 3001, 3002];
    const maybeHost = typeof window !== 'undefined' ? (window.location?.hostname ?? '') : '';
    const hosts = [
      '127.0.0.1',
      'localhost',
      maybeHost
    ].filter((h): h is string => Boolean(h));

    const urls: string[] = [];
    for (const host of hosts) {
      for (const port of ports) {
        urls.push(`http://${host}:${port}`);
      }
    }
    // Garantir algumas opções clássicas
    urls.push('http://0.0.0.0:3000');
    return Array.from(new Set(urls));
  }

  /**
   * Detecta automaticamente qual URL do backend está funcionando
   */
  detectBackendUrl(): Observable<string> {
    // If preload provided a backend URL (Electron), prefer it immediately
    try {
      const win: any = (window as any);
      if (win && typeof win.electronAPI?.getBackendUrl === 'function') {
        // getBackendUrl is untyped on the preload side; cast to Promise<string> so RxJS operators have correct types
        return from(win.electronAPI.getBackendUrl() as Promise<string>).pipe(
          map((url: string) => url)
        );
      }
    } catch (e) {
      // Log the error so we don't silently swallow exceptions (fixes SonarQube S2486)
      console.debug('backend-detector: electronAPI getBackendUrl check failed', e);
    }

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
    // Tentar health, depois test, depois root sequencialmente
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
        let message: string;
        if (error && error.name === 'TimeoutError') {
          message = 'Timeout';
        } else if (error && typeof error.status === 'number') {
          message = `HTTP ${error.status}`;
        } else if (error && typeof error.message === 'string') {
          message = error.message;
        } else {
          message = 'Erro desconhecido';
        }
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
