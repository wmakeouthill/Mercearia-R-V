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
        this.backupLoading = true;
        this.apiService.createBackup({ format }).subscribe({
            next: (res) => { this.backupLoading = false; this.success = `Backup criado: ${res.filename}`; this.loadBackups(); },
            error: (err) => { this.backupLoading = false; this.error = err.error?.error || 'Erro ao criar backup'; }
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
        this.restoreTarget = backup;
        this.restoreInput = '';
        // show browser confirm modal for now with info; will open custom modal-like UI
        const ok = confirm(`Você vai restaurar o backup:\n\nNome: ${backup.name}\nCriado em: ${backup.createdAt}\n\nConfirma?`);
        if (!ok) return;
        // Ask for exact phrase
        const phrase = prompt('Digite a frase para confirmar: "' + this.restoreConfirmPhrase + '"');
        if (phrase !== this.restoreConfirmPhrase) {
            alert('Frase de confirmação incorreta. Restauração cancelada.');
            return;
        }
        this.backupLoading = true;
        this.apiService.restoreBackup(backup.name).subscribe({
            next: () => { this.backupLoading = false; this.success = `Backup ${backup.name} restaurado.`; },
            error: (err) => { this.backupLoading = false; this.error = err.error?.error || 'Erro ao restaurar backup'; }
        });
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


