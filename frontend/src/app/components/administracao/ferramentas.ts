import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { NotificationService } from '../../services/notification.service';
import { formatDateBR } from '../../utils/date-utils';

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
  logs: { id?: number; timestamp: string; level: string; logger: string; message: string; user?: string; observation?: string }[] = [];
  // pagination for audit logs
  logsPage = 1;
  logsPageSize: 3 | 5 = 3;
  logsTotal = 0;
  get logsTotalPages(): number {
    const total = Number(this.logsTotal || 0);
    const perPage = Number(this.logsPageSize || 1);
    return Math.max(1, Math.ceil(total / perPage));
  }
  get logsPageItems() {
    const start = (this.logsPage - 1) * this.logsPageSize;
    return (this.logs || []).slice(start, start + this.logsPageSize);
  }
  get logsPaginationItems(): Array<number | string> {
    const total = this.logsTotalPages;
    const current = this.logsPage;
    const maxButtons = 4;
    if (total <= maxButtons) return Array.from({ length: total }, (_, i) => i + 1);

    // sliding window of up to maxButtons centered on current as possible
    let start = Math.max(1, Math.min(current - Math.floor(maxButtons / 2), total - maxButtons + 1));
    let end = start + maxButtons - 1;
    // build items and add ellipsis markers when there are hidden pages
    const items: Array<number | string> = [];
    if (start > 1) items.push('…');
    for (let i = start; i <= end; i++) items.push(i);
    if (end < total) items.push('…');
    return items;
  }

  logsGoBy(delta: number): void {
    const next = this.logsPage + delta;
    this.logsPage = Math.max(1, Math.min(this.logsTotalPages, next));
  }

  logsPrevPage(): void { this.logsGoBy(-1); }
  logsNextPage(): void { this.logsGoBy(1); }
  logsGoToFirstPage(): void { this.logsPage = 1; }
  logsGoToLastPage(): void { this.logsPage = this.logsTotalPages; }
  logsOnClickPage(p: number | string): void { if (typeof p === 'number') this.logsPage = p; }
  showRestoreModal = false;
  showDeleteModal = false;
  deleteTarget: any = null;
  deleteInput = '';
  showBackupModal = false;
  backupModalMessage = '';

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly notificationService: NotificationService,
    public readonly router: Router
  ) { }

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
        const mapped = (list || []).map((l: any) => ({
          id: l.id || l.ID || undefined,
          timestamp: (l.created_at || l.createdAt || l.timestamp) || '',
          level: l.action || l.level || '',
          logger: l.username || l.logger || '',
          message: l.observation || l.message || '',
          user: l.username || '',
          observation: l.observation || ''
        }));
        this.logs = mapped;
        this.logsTotal = mapped.length;
        // ensure current page is within bounds
        if (this.logsPage > this.logsTotalPages) this.logsPage = this.logsTotalPages;
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
          this.notificationService.notify({ type: 'success', message: `Backup ${res.filename} criado.` });
          this.loadBackups();
          setTimeout(() => { this.showBackupModal = false; this.backupModalMessage = ''; }, 1200);
        }, remaining);
      },
      error: (err) => {
        this.backupLoading = false;
        this.showBackupModal = false;
        this.backupModalMessage = '';
        const msg = err.error?.error || 'Erro ao criar backup';
        this.notificationService.notify({ type: 'error', message: msg });
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
      error: (err) => { this.notificationService.notify({ type: 'error', message: err.error?.error || 'Erro ao baixar backup' }); }
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
      next: () => { this.backupLoading = false; this.notificationService.notify({ type: 'success', message: `Backup ${this.restoreTarget.name} restaurado.` }); this.showRestoreModal = false; this.loadBackups(); },
      error: (err) => { this.backupLoading = false; const msg = err.error?.error || 'Erro ao restaurar backup'; this.notificationService.notify({ type: 'error', message: msg }); this.showRestoreModal = false; }
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
      next: () => { this.backupLoading = false; this.notificationService.notify({ type: 'success', message: `Backup ${this.deleteTarget.name} apagado.` }); this.showDeleteModal = false; this.loadBackups(); },
      error: (err) => { this.backupLoading = false; const msg = err.error?.error || 'Erro ao apagar backup'; this.notificationService.notify({ type: 'error', message: msg }); this.showDeleteModal = false; }
    });
  }

  cancelDelete(): void {
    this.showDeleteModal = false;
    this.deleteTarget = null;
    this.deleteInput = '';
  }

  deleteLogEntry(id: number): void {
    if (!confirm('Deseja apagar esta entrada de auditoria?')) return;
    // Use POST delete endpoint (some setups route static resources and block DELETE requests)
    this.apiService.postAny(`/admin/actions/${id}/delete`).subscribe({
      next: () => { this.notificationService.notify({ type: 'success', message: `Entrada de auditoria ${id} apagada.` }); this.loadAuditLogs(); },
      error: (err) => { const msg = err.error?.error || 'Erro ao apagar entrada'; this.notificationService.notify({ type: 'error', message: msg }); }
    });
  }

  confirmAndReset(): void {
    if (this.confirmationInput !== this.resetConfirmationPhrase) {
      this.notificationService.notify({ type: 'error', message: 'A frase de confirmação não corresponde exatamente.' });
      return;
    }
    if (!confirm('Confirma executar o reset selecionado? Esta ação é irreversível.')) return;
    this.loading = true;
    const payload: any = { mode: this.resetMode, confirmationPhrase: this.confirmationInput };
    if (this.observationInput && this.observationInput.trim().length > 0) payload.observation = this.observationInput.trim();

    this.apiService.resetDatabase(payload).subscribe({
      next: () => { this.loading = false; this.notificationService.notify({ type: 'success', message: 'Reset executado com sucesso.' }); setTimeout(() => window.location.reload(), 1500); },
      error: (err) => { this.loading = false; const msg = err.error?.error || 'Erro ao executar reset'; this.notificationService.notify({ type: 'error', message: msg }); }
    });
  }

  formatTimestamp(ts: string): string {
    if (!ts) return '';
    return formatDateBR(ts, true);
  }
}


