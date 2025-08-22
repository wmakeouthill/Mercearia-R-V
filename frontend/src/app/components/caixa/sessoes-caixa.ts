import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CaixaService } from '../../services/caixa.service';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { StatusCaixa } from '../../models';

@Component({
  selector: 'app-caixa-sessoes',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sessoes-caixa.html',
  styleUrls: ['./caixa.scss', './sessoes-caixa.scss']
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
  // filtros
  filtroPeriodoInicio: string | null = null;
  filtroPeriodoFim: string | null = null;
  filtroMes: string | null = null;
  filtroUsuarioAbertura: string | null = null;
  filtroUsuarioFechamento: string | null = null;
  filtroStatus: string | null = '';
  jumpPage = 1;
  // subjects for debounced user input
  private filtroUsuarioAbertura$ = new Subject<string>();
  private filtroUsuarioFechamento$ = new Subject<string>();
  private subscriptions: Subscription[] = [];
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

  constructor(private readonly caixaService: CaixaService, private readonly router: Router, private readonly api: ApiService, public readonly authService: AuthService) { }

  // excluir sessão (cliente): pede confirmação e chama API
  onDeleteSessionClick(sessionId: number): void {
    console.debug('SessoesCaixaComponent.onDeleteSessionClick', { sessionId });
    if (!sessionId) return;
    if (!this.authService.isAdmin()) { alert('Somente administradores podem excluir sessões'); console.warn('delete session: perm denied'); return; }
    if (!confirm('Confirma exclusão desta sessão? Esta ação removerá apenas o registro da sessão.')) return;
    this.api.deleteAny(`/caixa/sessoes/${sessionId}`).subscribe({
      next: () => {
        console.info('Sessão excluída', sessionId);
        // remover otimisticamente da lista para refletir imediatamente na UI
        this.items = this.items.filter(i => i.id !== sessionId);
        // recarregar página atual para garantir consistência
        this.loadPage(this.page);
      },
      error: (err) => { console.error('Erro ao excluir sessão', err); alert('Erro ao excluir sessão: ' + (err?.error?.error || err?.message || 'desconhecido')); }
    });
  }

  // helper to log click from template (avoid using console in template)
  onSessBtnClickLog(id: number | undefined): void {
    console.debug('sessao-btn-click', { id });
  }

  // modal state
  modalOpen = false;
  modalData: any = null;

  openReconciliation(sessionId: number): void {
    this.modalOpen = true;
    this.modalData = null;
    this.caixaService.getReconciliation(sessionId).subscribe({
      next: data => { this.modalData = data; setTimeout(() => this.showDialog(), 0); },
      error: () => { this.modalData = { error: 'Falha ao carregar reconciliação' }; setTimeout(() => this.showDialog(), 0); }
    });
  }

  closeModal(): void { this.modalOpen = false; this.modalData = null; }

  exportCsv(): void {
    if (!this.modalData) return;
    const lines: string[] = [];
    lines.push('Tipo,ID,Descricao,Valor,Usuario,Data');
    for (const m of this.modalData.movimentacoes || []) {
      lines.push([m.tipo, m.id, (m.descricao || '').replace(/,/g, ' '), (m.valor || 0).toFixed(2), (m.usuario || ''), new Date(m.data_movimento).toISOString()].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconcil_${this.modalData.id || 'session'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Dialog control
  private dialogEl: HTMLDialogElement | null = null;
  showDialog(): void {
    const el = document.querySelector('dialog.recon-dialog') as HTMLDialogElement | null;
    if (!el) return;
    this.dialogEl = el;
    try { if (!el.open) el.showModal(); } catch (e) { /* fallback */ }
  }
  closeDialog(ev?: any): void {
    if (this.dialogEl && this.dialogEl.open) {
      try { this.dialogEl.close(); } catch (e) { /* ignore */ }
    }
    this.modalOpen = false;
    this.modalData = null;
  }
  onDialogClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.tagName.toLowerCase() === 'dialog') {
      this.closeDialog();
    }
  }

  // tooltip state for sale details
  saleTooltip: { visible: boolean; left: number; top: number; order?: any } = { visible: false, left: 0, top: 0 };

  openVendaDetalhada(ev: MouseEvent, id: number): void {
    ev.preventDefault();
    ev.stopPropagation();
    const x = ev.clientX + 8;
    const y = ev.clientY + 8;

    // toggle: close if same id already visible
    if (this.saleTooltip.visible && this.saleTooltip.order && this.saleTooltip.order.id === id) {
      this.closeSaleTooltip();
      // restore dialog z-index
      const el = document.querySelector('dialog.recon-dialog') as HTMLDialogElement | null;
      if (el) el.style.zIndex = '';
      return;
    }

    this.saleTooltip = { visible: false, left: x, top: y };
    this.api.getOrderById(id).subscribe({
      next: (order) => {
        // create tooltip element appended to body to avoid stacking-context issues
        this.createBodyTooltip(x, y, order);
      },
      error: () => {
        const order = this.modalData?.vendas?.find((o: any) => o.id === id);
        if (order) this.createBodyTooltip(x, y, order);
        else alert('Falha ao obter detalhes da venda');
      }
    });
  }

  closeSaleTooltip(): void {
    this.saleTooltip = { visible: false, left: 0, top: 0 };
    // remove body tooltip if exists
    const el = document.getElementById('body-sale-tooltip');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  private createBodyTooltip(left: number, top: number, order: any): void {
    // create a small modal dialog positioned near cursor to guarantee it's above the main dialog
    // remove existing
    const prev = document.getElementById('body-sale-tooltip');
    if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

    const dlg = document.createElement('dialog');
    dlg.id = 'body-sale-tooltip';
    dlg.className = 'mini-recon-dialog';
    dlg.style.padding = '8px';
    dlg.style.border = 'none';
    dlg.style.borderRadius = '8px';
    dlg.style.maxWidth = '420px';
    dlg.style.zIndex = '2147483647';
    dlg.innerHTML = `<div class="tooltip-card"><h4>Venda #${order.id}</h4><table>`;
    let rows = '';
    rows += '<tr><th>Produto</th><th>Qtd</th><th>Preço Unit.</th><th>Total</th></tr>';
    for (const it of (order.itens || [])) {
      const precoUnit = (it.preco_unitario != null && it.preco_unitario !== 0) ? Number(it.preco_unitario) : (it.preco_total && it.quantidade ? Number(it.preco_total) / Number(it.quantidade) : 0);
      rows += `<tr><td>${(it.produto_nome || it.produto_id) || ''}</td><td>${it.quantidade || ''}</td><td>R$ ${precoUnit.toFixed(2)}</td><td>R$ ${Number(it.preco_total || 0).toFixed(2)}</td></tr>`;
    }
    dlg.innerHTML = `<div class="tooltip-card"><h4>Venda #${order.id}</h4><table>${rows}</table><div style="text-align:right;margin-top:8px"><button class="btn-primary" id="mini-close">Fechar</button></div></div>`;

    // append and position
    document.body.appendChild(dlg);
    // position roughly near cursor; if near edges adjust
    const vw = window.innerWidth; const vh = window.innerHeight;
    const approxLeft = Math.min(Math.max(8, left), vw - 440);
    const approxTop = Math.min(Math.max(8, top), vh - 200);
    dlg.style.left = approxLeft + 'px';
    dlg.style.top = approxTop + 'px';
    try {
      // use native modal to ensure stacking above other dialogs
      (dlg as any).showModal();
    } catch (e) {
      // fallback: set visible block
      dlg.style.display = 'block';
      dlg.style.position = 'fixed';
    }

    // make mini-dialog draggable by its header
    try {
      const header = dlg.querySelector('h4');
      if (header) {
        header.style.cursor = 'move';
        let dragging = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;

        const onPointerMove = (ev: MouseEvent) => {
          if (!dragging) return;
          ev.preventDefault();
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          let newLeft = startLeft + dx;
          let newTop = startTop + dy;
          // clamp to viewport
          const maxLeft = window.innerWidth - dlg.offsetWidth - 8;
          const maxTop = window.innerHeight - dlg.offsetHeight - 8;
          newLeft = Math.max(8, Math.min(newLeft, maxLeft));
          newTop = Math.max(8, Math.min(newTop, maxTop));
          dlg.style.left = newLeft + 'px';
          dlg.style.top = newTop + 'px';
        };

        const onPointerUp = () => {
          dragging = false;
          document.removeEventListener('mousemove', onPointerMove);
          document.removeEventListener('mouseup', onPointerUp);
        };

        const onPointerDown = (ev: MouseEvent) => {
          ev.preventDefault();
          dragging = true;
          startX = ev.clientX;
          startY = ev.clientY;
          startLeft = parseInt(dlg.style.left || '0', 10);
          startTop = parseInt(dlg.style.top || '0', 10);
          document.addEventListener('mousemove', onPointerMove);
          document.addEventListener('mouseup', onPointerUp);
        };

        header.addEventListener('mousedown', onPointerDown);
        // cleanup on close
        const cleanupDrag = () => {
          header.removeEventListener('mousedown', onPointerDown);
          document.removeEventListener('mousemove', onPointerMove);
          document.removeEventListener('mouseup', onPointerUp);
        };
        // attach cleanup to close function later by storing on element
        (dlg as any).__cleanupDrag = cleanupDrag;
      }
    } catch (err) { /* ignore drag setup errors */ }

    // close handlers: click on dlg backdrop or on main dialog should close
    const closeFn = () => {
      try { (dlg as any).close(); } catch (e) { /* ignore */ }
      if (dlg && dlg.parentNode) dlg.parentNode.removeChild(dlg);
      document.removeEventListener('click', docClick);
      if (mainDialog && mainDialogClick) mainDialog.removeEventListener('click', mainDialogClick);
      if (dlgBackdropClick) dlg.removeEventListener('click', dlgBackdropClick);
      // cleanup drag handlers if present
      try { if ((dlg as any).__cleanupDrag) (dlg as any).__cleanupDrag(); } catch (ignored) { }
    };

    const docClick = (ev: any) => {
      // only used as fallback when dialog isn't modal
      if (!dlg.contains(ev.target)) closeFn();
    };
    document.addEventListener('click', docClick);

    // click on dialog backdrop
    const dlgBackdropClick = (ev: MouseEvent) => {
      if (ev.target === dlg) closeFn();
    };
    dlg.addEventListener('click', dlgBackdropClick);

    // close when clicking the main recon dialog as user asked
    const mainDialog = document.querySelector('dialog.recon-dialog') as HTMLElement | null;
    const mainDialogClick = (ev: MouseEvent) => { closeFn(); };
    if (mainDialog) mainDialog.addEventListener('click', mainDialogClick);

    const btn = dlg.querySelector('#mini-close');
    if (btn) btn.addEventListener('click', closeFn);
  }

  getKeys(obj: any): string[] {
    return obj ? Object.keys(obj) : [];
  }

  getMethodLabel(key: string): string {
    switch (key) {
      case 'dinheiro': return 'Dinheiro 💵';
      case 'cartao_credito': return 'Crédito 💳';
      case 'cartao_debito': return 'Débito 💳';
      case 'pix': return 'PIX ⚡';
      default: return key;
    }
  }

  ngOnInit(): void {
    // subscribe to debounced user filters
    this.subscriptions.push(
      this.filtroUsuarioAbertura$.pipe(debounceTime(500)).subscribe(val => {
        this.filtroUsuarioAbertura = val || null;
        this.page = 1;
        this.loadPage(this.page);
      })
    );
    this.subscriptions.push(
      this.filtroUsuarioFechamento$.pipe(debounceTime(500)).subscribe(val => {
        this.filtroUsuarioFechamento = val || null;
        this.page = 1;
        this.loadPage(this.page);
      })
    );

    this.loadPage(1);
  }

  ngOnDestroy(): void {
    for (const s of this.subscriptions) s.unsubscribe();
    this.filtroUsuarioAbertura$.complete();
    this.filtroUsuarioFechamento$.complete();
  }

  loadPage(page: number): void {
    this.loading = true;
    this.error = '';
    const params: any = { page, size: this.size };
    if (this.filtroPeriodoInicio) params.periodo_inicio = this.filtroPeriodoInicio;
    if (this.filtroPeriodoFim) params.periodo_fim = this.filtroPeriodoFim;
    if (this.filtroMes) params.mes = this.normalizeMesInput(this.filtroMes);
    if (this.filtroUsuarioAbertura) params.aberto_por = this.filtroUsuarioAbertura;
    if (this.filtroUsuarioFechamento) params.fechado_por = this.filtroUsuarioFechamento;
    if (this.filtroStatus) params.status = this.filtroStatus;

    this.caixaService.listarSessoes(params).subscribe({
      next: s => {
        let items = s.items || [];
        this.total = s.total || 0;
        this.hasNext = s.hasNext || false;
        this.page = s.page || page;
        // normalize usernames for display
        items = items.map((it: any) => ({
          ...it,
          aberto_por: it.aberto_por_username || it.aberto_por || null,
          fechado_por: it.fechado_por_username || it.fechado_por || null
        }));

        // apply client-side filters as a fallback when backend doesn't filter fully
        this.items = this.applyClientFilters(items);
        this.loading = false;
      },
      error: e => { this.error = 'Falha ao carregar sessões'; this.loading = false; }
    });
  }

  private applyClientFilters(items: any[]): any[] {
    return items.filter(it => {
      // filtro periodo (by data_abertura)
      if (this.filtroPeriodoInicio) {
        const inicio = new Date(this.filtroPeriodoInicio);
        const d = new Date(it.data_abertura);
        if (d < inicio) return false;
      }
      if (this.filtroPeriodoFim) {
        const fim = new Date(this.filtroPeriodoFim);
        const d = new Date(it.data_abertura);
        // include whole day
        fim.setHours(23, 59, 59, 999);
        if (d > fim) return false;
      }
      // filtro mes (YYYY-MM)
      if (this.filtroMes) {
        const [y, m] = this.filtroMes.split('-').map(Number);
        const d = new Date(it.data_abertura);
        if (d.getFullYear() !== y || (d.getMonth() + 1) !== m) return false;
      }
      // filtro usuario abertura
      if (this.filtroUsuarioAbertura) {
        const q = String(this.filtroUsuarioAbertura).toLowerCase();
        if (!String(it.aberto_por || '').toLowerCase().includes(q)) return false;
      }
      // filtro usuario fechamento
      if (this.filtroUsuarioFechamento) {
        const q = String(this.filtroUsuarioFechamento).toLowerCase();
        if (!String(it.fechado_por || '').toLowerCase().includes(q)) return false;
      }
      // filtro status
      if (this.filtroStatus) {
        if (this.filtroStatus === 'aberto' && !it.aberto) return false;
        if (this.filtroStatus === 'fechado' && it.aberto) return false;
      }
      return true;
    });
  }

  onSizeChange(): void {
    this.page = 1;
    this.loadPage(this.page);
  }

  onFiltroUsuarioAberturaChange(value: string): void {
    this.filtroUsuarioAbertura$.next(value || '');
  }

  onFiltroUsuarioFechamentoChange(value: string): void {
    this.filtroUsuarioFechamento$.next(value || '');
  }

  toNumber(v: any): number { return Number(v); }

  aplicarFiltros(): void {
    this.page = 1;
    this.loadPage(this.page);
  }

  limparFiltros(): void {
    this.filtroPeriodoInicio = null; this.filtroPeriodoFim = null; this.filtroMes = null; this.filtroUsuarioAbertura = null; this.filtroUsuarioFechamento = null; this.filtroStatus = '';
    this.page = 1;
    this.loadPage(this.page);
  }

  // helpers for filters: normalize month input (YYYY-MM) to API-friendly format (YYYY-MM)
  private normalizeMesInput(mes: string | null): string | null {
    if (!mes) return null;
    // already in YYYY-MM from <input type="month">
    return mes;
  }

  voltar(): void { this.router.navigate(['/caixa']); }
}


