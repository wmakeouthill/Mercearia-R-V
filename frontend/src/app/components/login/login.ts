import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';
import { LoginRequest } from '../../models';

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
  }

  async testBackendConnection(): Promise<void> {
    try {
      this.backendStatus = 'Testando conexão...';
      const result = await (window as any).electronAPI?.testBackendConnection();
      this.backendStatus = `Backend OK - Status: ${result.status}`;
    } catch (error: any) {
      this.backendStatus = `Erro: ${error.message}`;
    }
  }

  onSubmit(): void {
    this.loading = true;
    this.error = '';

    this.authService.login(this.credentials)
      .then(() => {
        this.router.navigate(['/dashboard']);
      })
      .catch((error) => {
        this.error = error.message || 'Erro ao fazer login';
      })
      .finally(() => {
        this.loading = false;
      });
  }
}
