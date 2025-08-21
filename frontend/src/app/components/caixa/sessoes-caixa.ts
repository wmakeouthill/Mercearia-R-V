import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CaixaService } from '../../services/caixa.service';
import { StatusCaixa } from '../../models';

@Component({
  selector: 'app-caixa-sessoes',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sessoes-caixa.html',
  styleUrls: ['./caixa.scss']
})
export class SessoesCaixaComponent implements OnInit {
  status: StatusCaixa | null = null;
  loading = false;
  error = '';
  // pagination/table
  items: any[] = [];
  total = 0;
  hasNext = false;
  page = 1;
  size = 20;
  get lastPage(): number { return Math.max(1, Math.ceil((this.total || 0) / (this.size || 1))); }

  get totalPages(): number {
    const totalItems = Number(this.total || 0);
    const perPage = Number(this.size || 1);
    const pages = Math.ceil(totalItems / perPage);
    return Math.max(1, pages || 1);
  }

  get paginationItems(): Array<number | string> {
    const totalPages = this.totalPages;
    const currentPage = this.page;
    const siblings = 2;
    const range: Array<number | string> = [];
    if (totalPages <= 1) return [1];
    range.push(1);
    const leftSibling = Math.max(2, currentPage - siblings);
    const rightSibling = Math.min(totalPages - 1, currentPage + siblings);
    if (leftSibling > 2) range.push('…');
    for (let i = leftSibling; i <= rightSibling; i++) range.push(i);
    if (rightSibling < totalPages - 1) range.push('…');
    if (totalPages > 1) range.push(totalPages);
    return range;
  }

  goToPage(targetPage: number): void {
    const page = Math.max(1, Math.min(this.totalPages, Math.floor(Number(targetPage) || 1)));
    if (page === this.page) return;
    this.page = page;
    this.loadPage(this.page);
  }

  goBy(delta: number) { this.goToPage(this.page + delta); }
  nextPage() { if (this.page < this.totalPages) this.goToPage(this.page + 1); }
  prevPage() { if (this.page > 1) this.goToPage(this.page - 1); }
  goToFirstPage(): void { this.goToPage(1); }
  goToLastPage(): void { this.goToPage(this.totalPages); }

  constructor(private readonly caixaService: CaixaService, private readonly router: Router) { }

  ngOnInit(): void {
    this.loadPage(1);
  }

  loadPage(page: number): void {
    this.loading = true;
    this.error = '';
    this.caixaService.listarSessoes({ page, size: this.size }).subscribe({
      next: s => {
        this.items = s.items || [];
        this.total = s.total || 0;
        this.hasNext = s.hasNext || false;
        this.page = s.page || page;
        // normalize usernames for display
        this.items = this.items.map((it: any) => ({
          ...it,
          aberto_por: it.aberto_por_username || it.aberto_por || null,
          fechado_por: it.fechado_por_username || it.fechado_por || null
        }));
        this.loading = false;
      },
      error: e => { this.error = 'Falha ao carregar sessões'; this.loading = false; }
    });
  }

  voltar(): void { this.router.navigate(['/caixa']); }
}


