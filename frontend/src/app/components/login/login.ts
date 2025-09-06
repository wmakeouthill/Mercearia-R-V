import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';
import { LoginRequest } from '../../models';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent {
  credentials: LoginRequest = {
    username: '',
    password: ''
  };

  loading = false;
  error = '';
  backendStatus = '';
  isDev = false;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {
    // Verificar se está em modo de desenvolvimento
    this.isDev = (window as any).electronAPI?.isDev || false;
    logger.info('LOGIN', 'INIT', 'Componente iniciado', { isDev: this.isDev });

    // Testar localStorage se em Electron
    if ((window as any).electronAPI?.testLocalStorage) {
      const test = (window as any).electronAPI.testLocalStorage();
      logger.info('LOGIN', 'STORAGE_TEST', 'Teste localStorage', test);
      if (!test.success) {
        this.error = 'Problema com localStorage: ' + test.error;
      }
    }
  }

  async testBackendConnection(): Promise<void> {
    try {
      this.backendStatus = 'Testando conexão...';
      const result = await (window as any).electronAPI?.testBackendConnection();
      this.backendStatus = `Backend OK - Status: ${result.status}`;
      logger.info('LOGIN', 'TEST_BACKEND', 'Backend ok', { status: result?.status, ready: result?.data?.ready });
    } catch (error: any) {
      this.backendStatus = `Erro: ${error.message}`;
      logger.error('LOGIN', 'TEST_BACKEND', 'Erro ao testar backend', error);
    }
  }

  onSubmit(): void {
    this.loading = true;
    this.error = '';

    this.authService.login(this.credentials)
      .then(() => {
        logger.info('LOGIN', 'LOGIN_OK', 'Login realizado com sucesso', { username: this.credentials.username });
        this.router.navigate(['/dashboard']);
      })
      .catch((error) => {
        this.error = error.message || 'Erro ao fazer login';
        logger.error('LOGIN', 'LOGIN_FAIL', 'Erro no login', error);
      })
      .finally(() => {
        this.loading = false;
      });
  }
}
