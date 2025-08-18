import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { logger } from '../../utils/logger';

@Component({
    selector: 'app-historico-deletados',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './historico-deletados.html',
    styleUrl: './historico-deletados.scss'
})
export class HistoricoDeletadosComponent implements OnInit {
    loading = false;
    error = '';
    deletions: any[] = [];

    constructor(
        private readonly apiService: ApiService,
        public readonly authService: AuthService
    ) { }

    ngOnInit(): void {
        this.loadDeletions();
    }

    private loadDeletions(): void {
        this.loading = true;
        this.error = '';
        this.apiService.getDeletedSales().subscribe({
            next: (list) => {
                this.deletions = Array.isArray(list) ? list : [];
                this.loading = false;
            },
            error: (err) => {
                logger.error('HISTORICO_DELETADOS', 'LOAD', 'Erro ao carregar auditoria', err);
                this.error = err?.error?.error || 'Erro ao carregar auditoria';
                this.loading = false;
            }
        });
    }

    formatPayload(payload: string): string {
        try {
            const obj = JSON.parse(payload);
            return JSON.stringify(obj, null, 2);
        } catch {
            return payload || '';
        }
    }
}


