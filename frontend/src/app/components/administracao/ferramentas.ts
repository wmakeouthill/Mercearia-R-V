import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-ferramentas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ferramentas.html',
  styleUrl: './ferramentas.scss'
})
export class FerramentasComponent implements OnInit {
  currentUser: any = null;
  loading = false;
  error = '';
  success = '';

  // confirmação
  readonly resetConfirmationPhrase = "Desejo com certeza, apagar todos os dados do banco de dados e fazer um reset geral dos dados do aplicativo.";
  confirmationInput = '';
  resetMode: 'ALL' | 'EXCEPT_PRODUCTS' = 'ALL';
  observationInput = '';

  backups: { name: string; createdAt: string }[] = [];
  backupLoading = false;
  logs: { timestamp: string; level: string; logger: string; message: string; user?: string; observation?: string }[] = [];
  showRestoreModal = false;
  showDeleteModal = false;
  deleteTarget: any = null;
  deleteInput = '';
  showBackupModal = false;
  backupModalMessage = '';

  constructor(private readonly apiService: ApiService, private readonly authService: AuthService, public readonly router: Router) { }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    if (!this.authService.isAdmin()) {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.loadBackups();
  }

  loadBackups(): void {
    this.apiService.listBackups().subscribe({
      next: (list) => { this.backups = list; },
      error: () => { /* ignore */ }
    });
    this.loadAuditLogs();
  }

  loadAuditLogs(): void {
    this.apiService.getAuditLogs().subscribe({
      next: (list) => {
        this.logs = (list || []).map((l: any) => ({
          timestamp: (l.created_at || l.createdAt || l.timestamp) || '',
          level: l.action || l.level || '',
          logger: l.username || l.logger || '',
          message: l.observation || l.message || '',
          user: l.username || '',
          observation: l.observation || ''
        }));
      },
      error: () => { /* ignore */ }
    });
  }

  createBackup(format: 'custom' | 'plain' = 'custom'): void {
    // abrir modal de confirmação simples
    if (!confirm('Tem certeza que deseja criar um backup agora?')) return;
    this.backupLoading = true;
    this.showBackupModal = true;
    this.backupModalMessage = 'Criando backup... aguarde';
    const start = Date.now();
    this.apiService.createBackup({ format }).subscribe({
      next: (res) => {
        // garantir ao menos 800ms de feedback visual para o usuário
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, 800 - elapsed);
        setTimeout(() => {
          this.backupLoading = false;
          this.backupModalMessage = `Backup criado: ${res.filename}`;
          this.success = `Backup criado: ${res.filename}`;
          this.loadBackups();
          setTimeout(() => { this.showBackupModal = false; this.backupModalMessage = ''; }, 1200);
        }, remaining);
      },
      error: (err) => {
        this.backupLoading = false;
        this.showBackupModal = false;
        this.backupModalMessage = '';
        this.error = err.error?.error || 'Erro ao criar backup';
      }
    });
  }

  downloadBackup(name: string): void {
    this.apiService.downloadBackup(name).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: (err) => { this.error = err.error?.error || 'Erro ao baixar backup'; }
    });
  }

  // open restore confirmation modal
  restoreTarget: any = null; // selected backup
  restoreConfirmPhrase = "Desejo restaurar este backup e sobrescrever o banco de dados.";
  restoreInput = '';

  openRestoreConfirm(backup: any): void {
    // open custom modal: set target and show modal
    this.restoreTarget = backup;
    this.restoreInput = '';
    // show modal by toggling flag
    this.showRestoreModal = true;
  }

  // called when modal confirm clicked
  confirmRestore(): void {
    if (!this.restoreTarget) return;
    const payload: any = {};
    if (this.restoreInput && this.restoreInput.trim().length > 0) payload.observation = this.restoreInput.trim();
    this.backupLoading = true;
    this.apiService.restoreBackup(this.restoreTarget.name, payload).subscribe({
      next: () => { this.backupLoading = false; this.success = `Backup ${this.restoreTarget.name} restaurado.`; this.showRestoreModal = false; this.loadBackups(); },
      error: (err) => { this.backupLoading = false; this.error = err.error?.error || 'Erro ao restaurar backup'; this.showRestoreModal = false; }
    });
  }

  cancelRestore(): void {
    this.showRestoreModal = false;
    this.restoreTarget = null;
    this.restoreInput = '';
  }

  openDeleteConfirm(backup: any): void {
    this.deleteTarget = backup;
    this.deleteInput = '';
    this.showDeleteModal = true;
  }

  confirmDelete(): void {
    if (!this.deleteTarget) return;
    const payload: any = {};
    if (this.deleteInput && this.deleteInput.trim().length > 0) payload.observation = this.deleteInput.trim();
    this.backupLoading = true;
    this.apiService.deleteBackup(this.deleteTarget.name, payload).subscribe({
      next: () => { this.backupLoading = false; this.success = `Backup ${this.deleteTarget.name} apagado.`; this.showDeleteModal = false; this.loadBackups(); },
      error: (err) => { this.backupLoading = false; this.error = err.error?.error || 'Erro ao apagar backup'; this.showDeleteModal = false; }
    });
  }

  cancelDelete(): void {
    this.showDeleteModal = false;
    this.deleteTarget = null;
    this.deleteInput = '';
  }

  confirmAndReset(): void {
    if (this.confirmationInput !== this.resetConfirmationPhrase) {
      this.error = 'A frase de confirmação não corresponde exatamente.';
      return;
    }
    if (!confirm('Confirma executar o reset selecionado? Esta ação é irreversível.')) return;
    this.loading = true;
    const payload: any = { mode: this.resetMode, confirmationPhrase: this.confirmationInput };
    if (this.observationInput && this.observationInput.trim().length > 0) payload.observation = this.observationInput.trim();

    this.apiService.resetDatabase(payload).subscribe({
      next: () => { this.loading = false; this.success = 'Reset executado com sucesso.'; setTimeout(() => window.location.reload(), 1500); },
      error: (err) => { this.loading = false; this.error = err.error?.error || 'Erro ao executar reset'; }
    });
  }
}


