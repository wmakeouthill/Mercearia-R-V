import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { Usuario, LoginRequest, LoginResponse } from '../models';
import { logger } from '../utils/logger';
import { SafeStorage } from '../utils/storage';
import { environment } from '../../environments/environment';
import { BackendDetectorService } from './backend-detector';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly currentUserSubject = new BehaviorSubject<Usuario | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(
    private readonly router: Router,
    private readonly backendDetector: BackendDetectorService
  ) {
    // Testar localStorage antes de carregar
    this.testLocalStorage();
    this.loadUserFromStorage();
  }

  private testLocalStorage(): void {
    try {
      const testKey = '__auth_test__';
      const testValue = 'test_value_' + Date.now();

      logger.info('AUTH_SERVICE', 'STORAGE_TEST', 'Testando localStorage...');

      // Testar escrita
      localStorage.setItem(testKey, testValue);

      // Testar leitura
      const retrieved = localStorage.getItem(testKey);

      // Testar remoção
      localStorage.removeItem(testKey);

      if (retrieved === testValue) {
        logger.info('AUTH_SERVICE', 'STORAGE_TEST', 'localStorage funcional');
      } else {
        logger.error('AUTH_SERVICE', 'STORAGE_TEST', 'localStorage não retornou valor correto', {
          expected: testValue,
          received: retrieved
        });
      }
    } catch (error) {
      logger.error('AUTH_SERVICE', 'STORAGE_TEST', 'Erro crítico no localStorage', error);
    }
  }

  private loadUserFromStorage(): void {
    const token = SafeStorage.getItem('token');
    const userStr = SafeStorage.getItem('user');

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        this.currentUserSubject.next(user);
        logger.info('AUTH_SERVICE', 'LOAD_USER', 'Usuário carregado do storage', { username: user.username });
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Falha ao parsear usuário do storage');
        logger.warn('AUTH_SERVICE', 'LOAD_USER', 'JSON inválido no storage', err);
        this.clearAuth();
      }
    } else {
      logger.info('AUTH_SERVICE', 'LOAD_USER', 'Nenhum usuário encontrado no storage');
    }
  }

  private async getApiUrl(): Promise<string> {
    const current = this.backendDetector.getCurrentUrl();
    if (current) {
      return `${current}/api`;
    }
    try {
      const detected = await firstValueFrom(this.backendDetector.detectBackendUrl());
      return `${detected}/api`;
    } catch {
      return environment.apiUrl;
    }
  }

  login(credentials: LoginRequest): Promise<boolean> {
    return new Promise((resolve, reject) => {
      logger.info('AUTH_SERVICE', 'LOGIN', 'Tentativa de login', { username: credentials.username });

      this.getApiUrl()
        .then((apiUrl) => {
          logger.debug('AUTH_SERVICE', 'LOGIN_REQUEST', 'Calling login endpoint', {
            apiUrl,
            username: credentials.username
          });
          return fetch(`${apiUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials)
          });
        })
        .then((response) => {
          if (!response.ok) {
            logger.error('AUTH_SERVICE', 'LOGIN', 'Credenciais inválidas', { username: credentials.username });
            throw new Error('Credenciais inválidas');
          }
          return response.json();
        })
        .then((data: LoginResponse) => {
          const user: Usuario = {
            id: data.user.id,
            username: data.user.username,
            role: data.user.role as 'admin' | 'user',
            pode_controlar_caixa: data.user.pode_controlar_caixa
          };

          const tokenSaved = SafeStorage.setItem('token', data.token);
          const userSaved = SafeStorage.setItem('user', JSON.stringify(user));

          if (!tokenSaved || !userSaved) {
            logger.error('AUTH_SERVICE', 'LOGIN', 'Falha ao salvar dados de autenticação no storage');
            throw new Error('Falha ao salvar dados de autenticação');
          }

          this.currentUserSubject.next(user);

          logger.info('AUTH_SERVICE', 'LOGIN', 'Login realizado com sucesso', {
            username: user.username,
            role: user.role
          });

          resolve(true);
        })
        .catch((error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          logger.error('AUTH_SERVICE', 'LOGIN', 'Erro no login', err);
          reject(err);
        });
    });
  }

  logout(): void {
    logger.info('AUTH_SERVICE', 'LOGOUT', 'Logout realizado');
    this.clearAuth();
    this.router.navigate(['/login']);
  }

  private clearAuth(): void {
    SafeStorage.removeItem('token');
    SafeStorage.removeItem('user');
    this.currentUserSubject.next(null);
    logger.info('AUTH_SERVICE', 'CLEAR_AUTH', 'Dados de autenticação removidos');
  }

  getToken(): string | null {
    return SafeStorage.getItem('token');
  }

  getUserRole(): string | null {
    const user = this.currentUserSubject.value;
    return user ? user.role : null;
  }

  isLoggedIn(): boolean {
    return this.currentUserSubject.value !== null;
  }

  isAdmin(): boolean {
    return this.getUserRole() === 'admin';
  }

  podeControlarCaixa(): boolean {
    const user = this.getCurrentUser();
    return user ? user.role === 'admin' || Boolean(user.pode_controlar_caixa) : false;
  }

  getCurrentUser(): Usuario | null {
    return this.currentUserSubject.value;
  }

  /**
   * Recarrega as informações do usuário atual do backend
   * Útil quando as permissões podem ter sido alteradas por um admin
   */
  async reloadCurrentUser(): Promise<void> {
    const token = this.getToken();
    if (!token) {
      return;
    }

    try {
      const apiUrl = await this.getApiUrl();
      const response = await fetch(`${apiUrl}/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const userData = await response.json();
        const user: Usuario = {
          id: userData.id,
          username: userData.username,
          role: userData.role as 'admin' | 'user',
          pode_controlar_caixa: userData.pode_controlar_caixa
        };

        SafeStorage.setItem('user', JSON.stringify(user));
        this.currentUserSubject.next(user);
        logger.info('AUTH_SERVICE', 'RELOAD_USER', 'Usuário atualizado com sucesso');
      }
    } catch (error) {
      logger.error('AUTH_SERVICE', 'RELOAD_USER', 'Erro ao recarregar usuário', error);
    }
  }
}
