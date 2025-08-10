import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Router } from '@angular/router';
import { Usuario, LoginRequest, LoginResponse, JwtPayload } from '../models';
import { logger } from '../utils/logger';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject = new BehaviorSubject<Usuario | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(private router: Router) {
    this.loadUserFromStorage();
  }

  private loadUserFromStorage(): void {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        this.currentUserSubject.next(user);
      } catch (error) {
        this.clearAuth();
      }
    }
  }

  login(credentials: LoginRequest): Promise<boolean> {
    return new Promise((resolve, reject) => {
      logger.info('AUTH_SERVICE', 'LOGIN', 'Tentativa de login', { username: credentials.username });

      // Chamada real à API
      fetch(`${environment.apiUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(credentials)
      })
        .then(response => {
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

          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(user));
          this.currentUserSubject.next(user);

          logger.info('AUTH_SERVICE', 'LOGIN', 'Login realizado com sucesso', {
            username: user.username,
            role: user.role
          });

          resolve(true);
        })
        .catch(error => {
          logger.error('AUTH_SERVICE', 'LOGIN', 'Erro no login', error);
          reject(error);
        });
    });
  }

  logout(): void {
    logger.info('AUTH_SERVICE', 'LOGOUT', 'Logout realizado');
    this.clearAuth();
    this.router.navigate(['/login']);
  }

  private clearAuth(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.currentUserSubject.next(null);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
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
    return user ? (user.role === 'admin' || Boolean(user.pode_controlar_caixa)) : false;
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
      const response = await fetch(`${environment.apiUrl}/auth/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
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

        localStorage.setItem('user', JSON.stringify(user));
        this.currentUserSubject.next(user);
      }
    } catch (error) {
      logger.error('AUTH_SERVICE', 'RELOAD_USER', 'Erro ao recarregar usuário', error);
    }
  }
}
