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
    vendasPage: Record<number, number> = {};
    vendasSize: Record<number, number> = {};
    vendasHasMore: Record<number, boolean> = {};
    search = '';
    // data filters for vendas
    fromDate: string | null = null;
    toDate: string | null = null;

    // edit state
    editingClientId: number | null = null;
    editingClient: any = null;

    constructor(private readonly api: ApiService, private readonly router: Router) { }

    ngOnInit(): void {
        this.loadClientes();
    }

    loadClientes(): void {
        this.loading = true;
        this.error = '';
        // if searching, use quick search (no pagination)
        if (this.search && this.search.trim()) {
            this.api.getClientes(this.search).subscribe({ next: (r) => { this.clientes = r; this.loading = false; }, error: () => { this.error = 'Erro ao carregar clientes'; this.loading = false; } });
            return;
        }
        // paged load
        this.api.getClientesPage(this.page - 1 || 0, this.pageSize || 20).subscribe({
            next: (r: any) => {
                this.clientes = r.items || [];
                this.total = Number(r.total || 0);
                this.hasNextClients = !!r.hasNext;
                this.loading = false;
            }, error: () => { this.error = 'Erro ao carregar clientes'; this.loading = false; }
        });
    }

    // pagination for clients list
    page = 1;
    pageSize: 20 | 50 | 100 = 20;
    total = 0;
    hasNextClients = false;
    setPageSize(n: 20 | 50 | 100) { this.pageSize = n; this.page = 1; this.loadClientes(); }
    goToPage(p: number) { this.page = p; this.loadClientes(); }
    nextClientsPage() { if (this.hasNextClients) { this.page++; this.loadClientes(); } }
    prevClientsPage() { if (this.page > 1) { this.page--; this.loadClientes(); } }

    toggleExpand(id: number): void {
        if (this.expanded.has(id)) {
            this.expanded.delete(id);
            return;
        }
        this.expanded.add(id);
        const page = this.vendasPage[id] ?? 0;
        const size = this.vendasSize[id] ?? 10;
        if (!this.vendasPorCliente[id]) {
            this.loadVendasClientePage(id, page, size);
        }
    }

    private loadVendasClientePage(id: number, page: number, size: number): void {
        this.api.getClienteVendas(id, page, size, this.fromDate || undefined, this.toDate || undefined).subscribe({
            next: (v: any[]) => {
                // backend currently returns up to `size` items; we set hasMore if returned length == size
                this.vendasPorCliente[id] = v.map((it: any) => {
                    if (it.data_venda) it.data_venda = new Date(it.data_venda).toLocaleString();
                    if (!it.itens) it.itens = [];
                    return it;
                });
                this.vendasPage[id] = page;
                this.vendasSize[id] = size;
                this.vendasHasMore[id] = (v && v.length === size);
            }, error: () => {
                this.vendasPorCliente[id] = [];
                this.vendasHasMore[id] = false;
            }
        });
    }

    prevPageCliente(id: number): void {
        const cur = this.vendasPage[id] ?? 0;
        if (cur <= 0) return;
        this.loadVendasClientePage(id, cur - 1, this.vendasSize[id] ?? 10);
    }

    nextPageCliente(id: number): void {
        if (!this.vendasHasMore[id]) return;
        const cur = this.vendasPage[id] ?? 0;
        this.loadVendasClientePage(id, cur + 1, this.vendasSize[id] ?? 10);
    }

    // --- Edit cliente ---
    startEditCliente(c: any): void {
        this.editingClientId = c.id;
        this.editingClient = { nome: c.nome, email: c.email, telefone: c.telefone };
    }

    cancelEdit(): void {
        this.editingClientId = null;
        this.editingClient = null;
    }

    saveEditCliente(): void {
        if (!this.editingClientId) return;
        this.api.updateCliente(this.editingClientId, this.editingClient).subscribe({
            next: () => {
                // refresh clients list and reset edit state
                this.loadClientes();
                this.cancelEdit();
            }, error: () => { this.error = 'Erro ao atualizar cliente'; }
        });
    }

    deleteCliente(id: number | undefined): void {
        if (!id) return;
        if (!confirm('Deseja realmente excluir este cliente?')) return;
        this.api.deleteCliente(id).subscribe({ next: () => { this.loadClientes(); }, error: () => { this.error = 'Erro ao deletar cliente'; } });
    }

    goBack(): void { this.router.navigate(['/administracao']); }
}


