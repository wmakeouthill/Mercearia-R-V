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
        // if searching, use paged search to keep response shape consistent
        if (this.search?.trim()) {
            this.api.getClientesPage(0, this.pageSize || 20, this.search).subscribe({ next: (r: any) => { console.debug('LOAD_CLIENTES_SEARCH_RESPONSE', r); this.clientes = r.items || r; this.total = Number(r.total || 0); this.hasNextClients = !!r.hasNext; this.loading = false; }, error: (err) => { console.error('LOAD_CLIENTES_SEARCH_ERROR', err); this.error = 'Erro ao carregar clientes'; this.loading = false; } });
            return;
        }
        // paged load
        this.api.getClientesPage((this.page - 1) || 0, this.pageSize || 20).subscribe({
            next: (r: any) => {
                console.debug('LOAD_CLIENTES_PAGE_RESPONSE', r);
                this.clientes = r.items || [];
                this.total = Number(r.total || 0);
                this.hasNextClients = !!r.hasNext;
                this.loading = false;
            }, error: (err) => { console.error('LOAD_CLIENTES_PAGE_ERROR', err); this.error = 'Erro ao carregar clientes'; this.loading = false; }
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

    get totalPages(): number {
        const totalItems = Number(this.total || 0);
        const perPage = Number(this.pageSize || 1);
        const pages = Math.ceil(totalItems / perPage);
        return Math.max(1, pages || 1);
    }

    get paginationItems(): Array<number | string> {
        const totalPages = this.totalPages;
        const currentPage = this.page;
        const siblings = 2; // quantidade de páginas vizinhas a exibir

        const range: Array<number | string> = [];
        if (totalPages <= 1) return [1];

        range.push(1);

        const leftSibling = Math.max(2, currentPage - siblings);
        const rightSibling = Math.min(totalPages - 1, currentPage + siblings);

        if (leftSibling > 2) {
            range.push('…');
        }

        for (let i = leftSibling; i <= rightSibling; i++) {
            range.push(i);
        }

        if (rightSibling < totalPages - 1) {
            range.push('…');
        }

        if (totalPages > 1) {
            range.push(totalPages);
        }
        return range;
    }

    toggleExpand(id: number): void {
        if (this.expanded.has(id)) {
            this.expanded.delete(id);
            return;
        }
        this.expanded.add(id);
        const page = this.vendasPage[id] ?? 0;
        const size = this.vendasSize[id] ?? 10;
        if (!this.vendasPorCliente[id]) {
            // load first page when expanding
            this.loadVendasClientePage(id, page, size);
        }
    }

    loadVendasClientePage(id: number, page: number, size: number): void {
        // API accepts a 'limit' param; backend doesn't support page param yet. We request (page+1)*size + 1
        // so we can detect whether there are more items and slice the page client-side.
        const requestedLimit = (page + 1) * size + 1;
        this.api.getClienteVendas(id, requestedLimit, this.fromDate || undefined, this.toDate || undefined).subscribe({
            next: (resp: any[]) => {
                const raw = resp || [];
                const start = page * size;
                const pageItems = raw.slice(start, start + size);
                this.vendasPorCliente[id] = pageItems.map((it: any) => {
                    if (it.data_venda) it.data_venda = new Date(it.data_venda).toLocaleString();
                    // normalize itens: legacy sales may not have itens array
                    if (!it.itens || !Array.isArray(it.itens) || it.itens.length === 0) {
                        const single = {
                            id: null,
                            produto_id: it.produto_id || null,
                            produto_nome: it.produto_nome || null,
                            produto_imagem: it.produto_imagem || null,
                            quantidade: it.quantidade_vendida ?? it.quantidade ?? 1,
                            preco_unitario: (it.preco_unitario ?? null),
                            preco_total: it.preco_total ?? null
                        };
                        it.itens = [single];
                    }
                    it._showItems = it._showItems || false;
                    return it;
                });
                this.vendasPage[id] = page;
                this.vendasSize[id] = size;
                // hasMore if raw has more than (page+1)*size items
                this.vendasHasMore[id] = raw.length > (page + 1) * size;
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


