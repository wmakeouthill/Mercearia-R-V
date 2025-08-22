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
                    timestamp: l.timestamp || '',
                    level: l.level || '',
                    logger: l.logger || '',
                    message: l.message || l.msg || ''
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

    restoreBackup(name: string): void {
        if (!confirm(`Restaurar backup '${name}' irá sobrescrever o banco atual. Deseja prosseguir?`)) return;
        this.backupLoading = true;
        this.apiService.restoreBackup(name).subscribe({
            next: () => { this.backupLoading = false; this.success = `Backup ${name} restaurado.`; },
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


