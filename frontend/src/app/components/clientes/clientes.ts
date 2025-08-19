import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { Router } from '@angular/router';

@Component({
    selector: 'app-clientes',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './clientes.html',
    styleUrl: './clientes.scss'
})
export class ClientesComponent implements OnInit {
    clientes: any[] = [];
    loading = false;
    error = '';
    expanded = new Set<number>();
    vendasPorCliente: Record<number, any[]> = {};
    search = '';

    constructor(private readonly api: ApiService, private readonly router: Router) { }

    ngOnInit(): void {
        this.loadClientes();
    }

    loadClientes(): void {
        this.loading = true;
        this.error = '';
        this.api.getClientes(this.search).subscribe({
            next: (r) => { this.clientes = r; this.loading = false; },
            error: () => { this.error = 'Erro ao carregar clientes'; this.loading = false; }
        });
    }

    toggleExpand(id: number): void {
        if (this.expanded.has(id)) {
            this.expanded.delete(id);
            return;
        }
        this.expanded.add(id);
        if (!this.vendasPorCliente[id]) {
            this.api.getClienteVendas(id, 10).subscribe({ next: v => this.vendasPorCliente[id] = v, error: _ => this.vendasPorCliente[id] = [] });
        }
    }

    goBack(): void { this.router.navigate(['/administracao']); }
}


