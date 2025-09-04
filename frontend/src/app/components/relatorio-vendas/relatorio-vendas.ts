import { Component, OnInit, OnDestroy, ElementRef, Renderer2, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CurrencyBrPipe } from '../../pipes/currency-br.pipe';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { extractLocalDate, extractYearMonth, formatDateBR, formatTimeBR, getCurrentDateForInput, formatDateYMD, parseDate } from '../../utils/date-utils';
import { RelatorioVendas, Venda, MetodoPagamento, RelatorioResumo } from '../../models';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { logger } from '../../utils/logger';
// PontoVendaComponent import removed (unused in this component)
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { EnviarNotaModalComponent } from '../enviar-nota-modal/enviar-nota-modal';
// pdfjs will be dynamically imported to avoid breaking lazy-loaded route initialization

@Component({
  selector: 'app-relatorio-vendas',
  standalone: true,
  imports: [CommonModule, FormsModule, EnviarNotaModalComponent, CurrencyBrPipe],
  templateUrl: './relatorio-vendas.html',
  styleUrl: './relatorio-vendas.scss'
})
export class RelatorioVendasComponent implements OnInit, OnDestroy {
  vendas: Venda[] = [];
  private vendasLegado: Venda[] = [];
  private vendasCheckout: Venda[] = [];
  vendasFiltradas: any[] = [];
  // pagination for detailed vendas table
  page = 1;
  pageSize: 10 | 20 | 30 | 40 | 50 = 10;
  total = 0;
  hasMore = false;
  jumpPage: number | null = null;

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

  goToPage(targetPage: number): void {
    const page = Math.max(1, Math.min(this.totalPages, Math.floor(Number(targetPage) || 1)));
    if (page === this.page) return;
    this.page = page;
    // update vendasFiltradas pagination state if needed
  }

  nextPage() { if (this.page < this.totalPages) this.goToPage(this.page + 1); }
  prevPage() { if (this.page > 1) this.goToPage(this.page - 1); }
  goBy(delta: number): void { this.goToPage(this.page + delta); }
  goToFirstPage(): void { this.goToPage(1); }
  goToLastPage(): void { this.goToPage(this.totalPages); }

  onJumpToPage(): void {
    if (this.jumpPage == null) return;
    this.goToPage(this.jumpPage);
  }

  setPageSize(n: number) {
    const v = Number(n || 0);
    const allowed = [10, 20, 30, 40, 50];
    if (!allowed.includes(v)) return;
    this.pageSize = v as 10 | 20 | 30 | 40 | 50;
    this.page = 1;
  }

  get vendasPagina(): any[] {
    const start = (this.page - 1) * Number(this.pageSize || 1);
    return this.vendasFiltradas.slice(start, start + Number(this.pageSize || 1));
  }

  onClickPage(p: number | string): void {
    if (typeof p === 'number') this.goToPage(p);
  }
  // pagination for relatorio diario (separate from detailed vendas pagination)
  // pagination for relatorio (aplica tanto ao diário quanto ao mensal)
  relatorioPage = 1;
  relatorioPageSize: 5 | 10 | 20 | 30 | 50 = 5;
  relatorioJumpPage: number | null = null;

  get relatorioTotal(): number {
    if (this.filtroPeriodo === 'dia') return Array.isArray(this.relatorioDiario) ? this.relatorioDiario.length : 0;
    return Array.isArray(this.relatorioMensal) ? this.relatorioMensal.length : 0;
  }

  get relatorioTotalPages(): number {
    const totalItems = Number(this.relatorioTotal || 0);
    const perPage = Number(this.relatorioPageSize || 1);
    const pages = Math.ceil(totalItems / perPage);
    return Math.max(1, pages || 1);
  }

  get relatorioPaginationItems(): Array<number | string> {
    const totalPages = this.relatorioTotalPages;
    const currentPage = this.relatorioPage;
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

  relatorioGoToPage(targetPage: number): void {
    const page = Math.max(1, Math.min(this.relatorioTotalPages, Math.floor(Number(targetPage) || 1)));
    if (page === this.relatorioPage) return;
    this.relatorioPage = page;
  }

  relatorioNextPage() { if (this.relatorioPage < this.relatorioTotalPages) this.relatorioGoToPage(this.relatorioPage + 1); }
  relatorioPrevPage() { if (this.relatorioPage > 1) this.relatorioGoToPage(this.relatorioPage - 1); }
  relatorioGoBy(delta: number): void { this.relatorioGoToPage(this.relatorioPage + delta); }
  relatorioGoToFirstPage(): void { this.relatorioGoToPage(1); }
  relatorioGoToLastPage(): void { this.relatorioGoToPage(this.relatorioTotalPages); }

  relatorioOnJumpToPage(): void {
    if (this.relatorioJumpPage == null) return;
    this.relatorioGoToPage(this.relatorioJumpPage);
  }

  get relatorioVendasPagina(): any[] {
    const list = this.filtroPeriodo === 'dia' ? (this.relatorioDiario || []) : (this.relatorioMensal || []);
    const start = (this.relatorioPage - 1) * Number(this.relatorioPageSize || 1);
    return list.slice(start, start + Number(this.relatorioPageSize || 1));
  }

  relatorioOnClickPage(p: number | string): void {
    if (typeof p === 'number') this.relatorioGoToPage(p);
  }

  relatorioSetPageSize(n: number) {
    const v = Number(n || 0);
    const allowed = [5, 10, 20, 30, 50];
    if (!allowed.includes(v)) return;
    this.relatorioPageSize = v as 5 | 10 | 20 | 30 | 50;
    this.relatorioPage = 1;
  }

  // removed diario-specific pagination (now unified under relatorio*)
  expandedRows = new Set<string>();
  relatorioDiario: RelatorioVendas[] = [];
  relatorioMensal: RelatorioVendas[] = [];
  resumoDia?: RelatorioResumo;
  resumoMes?: RelatorioResumo;
  filtroPeriodo: 'dia' | 'mes' = 'dia';
  filtroData: string = '';
  filtroHoraInicio: string = '';
  filtroHoraFim: string = '';
  filtroNomeProduto: string = '';
  filtroMetodoPagamento: string = '';
  loading = false;
  error = '';
  isAdmin = false;


  // Estatísticas
  totalVendas = 0;
  receitaTotal = 0;
  mediaVendas = 0;
  melhorDia = '';
  melhorDiaReceita = 0;
  // subscription para eventos de alteração de vendas (ajustes/devoluções)
  private salesChangedSub: any;

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly imageService: ImageService,
    private readonly router: Router,
    private readonly sanitizer: DomSanitizer,
    private readonly renderer: Renderer2
  ) { }

  // Using shared modal component
  showEnviarModal = false;
  modalOrderId: number | null = null;
  // Compatibility properties used by legacy modal-related methods
  modalCustomerName = '';
  modalCustomerEmail = '';
  modalCustomerPhone = '';
  previewLoading = false;
  previewBlobUrl: SafeResourceUrl | null = null;
  previewObjectUrl: string | null = null;
  previewHtml: string | null = null;
  objectFailed = false;
  @ViewChild('previewObject') previewObjectRef?: ElementRef<HTMLObjectElement>;
  @ViewChild('pdfViewerContainer', { read: ElementRef }) pdfViewerContainer?: ElementRef<HTMLDivElement>;
  // PDF.js state (compat)
  private pdfArrayBuffer: ArrayBuffer | null = null;
  public pdfScale = 1.4;
  private pdfDoc: any = null;
  private pageObserver: IntersectionObserver | null = null;
  private readonly renderedPages = new Set<number>();

  ngOnInit(): void {
    logger.info('RELATORIO_VENDAS', 'INIT', 'Componente iniciado');
    this.isAdmin = this.authService.isAdmin();
    // por padrão não filtrar por data para mostrar todas as vendas
    this.filtroData = '';
    this.loadVendas();
    this.loadResumos();
    // Auto refresh quando houver ajustes (devolução/troca)
    try {
      this.salesChangedSub = this.apiService.salesChanged$.subscribe(() => {
        logger.info('RELATORIO_VENDAS', 'SALES_CHANGED_EVENT', 'Recebido evento de alteração de vendas -> recarregando');
        this.loadVendas();
        this.loadResumos();
      });
    } catch { /* ignore */ }
  }

  ngOnDestroy(): void { try { if (this.salesChangedSub) this.salesChangedSub.unsubscribe(); } catch { /* ignore */ } }

  // client autocomplete for modal
  clientSearchTerm = '';
  clientResults: any[] = [];
  clientSearching = false;
  showClientDropdown = false;
  private hideDropdownTimer: any = null;
  clientDropdownIndex = -1;

  onClientDropdownKeydown(event: KeyboardEvent): void {
    const len = this.clientResults?.length || 0;
    if (!this.showClientDropdown || len === 0) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); this.clientDropdownIndex = Math.min(len - 1, (this.clientDropdownIndex || 0) + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.clientDropdownIndex = Math.max(0, (this.clientDropdownIndex || 0) - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); if (this.clientDropdownIndex >= 0 && this.clientDropdownIndex < len) this.selectClientForModal(this.clientResults[this.clientDropdownIndex]); }
    else if (event.key === 'Escape') { this.showClientDropdown = false; }
  }

  openClientAutocomplete(): void {
    this.clientResults = [];
    this.showClientDropdown = true;
    this.clientSearching = true;
    this.apiService.getClientes().subscribe({ next: r => { this.clientResults = r; this.clientSearching = false; }, error: () => { this.clientResults = []; this.clientSearching = false; } });
  }

  onClientSearchChange(): void {
    const t = (this.clientSearchTerm || '').trim();
    if (!t) { this.clientResults = []; return; }
    this.apiService.getClientes(t).subscribe({ next: r => this.clientResults = r, error: () => this.clientResults = [] });
  }

  selectClientForModal(c: any): void {
    this.modalCustomerName = c.nome || '';
    this.modalCustomerEmail = c.email || '';
    this.modalCustomerPhone = c.telefone || '';
    this.clientResults = [];
    this.showClientDropdown = false;
  }

  onClientNameChange(): void {
    const t = (this.modalCustomerName || '').trim();
    if (!t) { this.clientResults = []; this.showClientDropdown = true; return; }
    this.apiService.getClientes(t).subscribe({ next: r => { this.clientResults = r; this.showClientDropdown = true; }, error: () => { this.clientResults = []; } });
  }

  hideClientDropdownDelayed(): void {
    // small delay to allow click selection
    this.hideDropdownTimer = setTimeout(() => { this.showClientDropdown = false; }, 150);
  }

  openEnviarModal(orderId: number): void {
    this.modalOrderId = orderId;
    this.modalCustomerName = '';
    this.modalCustomerEmail = '';
    this.modalCustomerPhone = '';
    this.previewLoading = true;
    this.previewBlobUrl = null;
    this.showEnviarModal = true;

    // previewHtml not required for PDF preview; avoid calling /nota/html to reduce payload/log noise
    this.previewHtml = null;
    this.apiService.getNotaPdf(orderId).subscribe({
      next: async (blob: any) => {
        try {
          const pdfBlob = blob as Blob;
          // debug info to help diagnose preview issues
          console.debug('RELATORIO_VENDAS', 'PDF_PREVIEW_RECEIVED', { type: pdfBlob?.type, size: pdfBlob?.size });

          if (!pdfBlob || pdfBlob.size === 0) {
            console.error('Preview PDF vazio (relatorio)');
            this.previewLoading = false;
            return;
          }

          // revoke previous url if present
          if (this.previewObjectUrl) {
            try { URL.revokeObjectURL(this.previewObjectUrl); } catch (e) { /* ignore */ }
            this.previewObjectUrl = null;
            this.previewBlobUrl = null;
          }

          const url = URL.createObjectURL(pdfBlob);
          this.previewObjectUrl = url; // store raw blob url
          this.previewBlobUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url); // sanitized for iframe src if needed

          // Render PDF directly from Blob (avoid fetching blob: URL which may be blocked by CSP)
          // fire-and-forget: render and keep arrayBuffer for zoom operations
          (this.renderPdfJsFromBlob(pdfBlob) as Promise<void>).catch(e => console.debug('RELATORIO_VENDAS: renderPdfJsFromBlob failed scheduling', e));
          // attempt to render preview with PDF.js (after view has had chance to mount)
          setTimeout(() => {
            try {
              // render directly from the received Blob (pdfBlob is in scope)
              // fire-and-forget: rendering already attempted above but allow a quick retry
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              this.renderPdfJsFromBlob(pdfBlob);
            } catch (e) { console.debug('renderPdfJs scheduling failed', e); }
          }, 60);
        } catch (e) {
          console.error('Falha ao criar preview do PDF', e);
        }
        this.previewLoading = false;
      },
      error: (err) => {
        console.error('Erro ao obter PDF para preview', err);
        this.previewLoading = false;
      }
    });
  }

  onObjectLoad(): void {
    // object loaded successfully
    this.objectFailed = false;
  }

  onObjectError(): void {
    console.warn('RELATORIO_VENDAS: object failed to load PDF, falling back to iframe.');
    this.objectFailed = true;
  }

  openPreviewInNewTab(): void {
    if (!this.previewObjectUrl) return;
    window.open(this.previewObjectUrl, '_blank');
  }

  downloadPreviewPdf(): void {
    if (!this.previewObjectUrl || !this.modalOrderId) return;
    const a = document.createElement('a');
    a.href = this.previewObjectUrl;
    a.download = `nota-${this.modalOrderId}.pdf`;
    a.click();
  }

  printPdf(): void {
    if (!this.previewObjectUrl) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.src = this.previewObjectUrl as string;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.error('Failed to print PDF', e);
      } finally {
        setTimeout(() => { document.body.removeChild(iframe); }, 500);
      }
    };
  }

  fitWidth(): void {
    // set scale so that pages fit the container width
    if (!this.pdfViewerContainer) return;
    const containerWidth = this.pdfViewerContainer.nativeElement.clientWidth || 420;
    // approximate: use first canvas width to compute scale
    const firstCanvas = this.pdfViewerContainer.nativeElement.querySelector('.pdf-page-canvas') as HTMLCanvasElement | null;
    if (!firstCanvas) return;
    const intrinsic = firstCanvas.width || (firstCanvas.getBoundingClientRect().width || containerWidth);
    const newScale = Math.max(0.6, Math.min(3, containerWidth / intrinsic * this.pdfScale));
    this.pdfScale = Number(newScale.toFixed(2));
    // re-render
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.reRenderPdf();
  }

  private openExternalUrl(url: string): void {
    try {
      const api = (window as any).electronAPI;
      if (api && typeof api.openExternal === 'function') {
        // open in external browser via main process; fallback to window.open on failure
        api.openExternal(url).catch(() => { window.open(url, '_blank'); });
        return;
      }
    } catch (e) {
      // ignore and fallback
    }
    window.open(url, '_blank');
  }

  // Render PDF with PDF.js into the modal container
  private async renderPdfJsFromBlob(pdfBlob: Blob): Promise<void> {
    try {
      if (!this.pdfViewerContainer) return;
      // Clear previous viewer and observer
      this.cleanupObserverAndSlots();
      this.pdfViewerContainer.nativeElement.innerHTML = '';

      // Convert blob to arrayBuffer without fetch to avoid blob: CSP issues
      const arrayBuffer = await pdfBlob.arrayBuffer();

      // Dynamically import PDF.js
      // Try different import approaches for better compatibility
      let pdfjsLib: any;
      try {
        pdfjsLib = await import('pdfjs-dist/legacy/build/pdf');
      } catch (e) {
        console.warn('Legacy import failed, trying standard:', e);
        pdfjsLib = await import('pdfjs-dist');
      }

      // Configure workerSrc to avoid "No GlobalWorkerOptions.workerSrc specified" error.
      try {
        // Configure worker
        try {
          if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = this.getWorkerPath();
          } else if (pdfjsLib.default?.GlobalWorkerOptions) {
            pdfjsLib.default.GlobalWorkerOptions.workerSrc = this.getWorkerPath();
          }
        } catch (e) {
          console.warn('Worker configuration failed:', e);
        }
      } catch (e) {
        console.warn('Could not set pdfjs workerSrc via GlobalWorkerOptions', e);
      }

      // Get the getDocument function
      const getDocument = pdfjsLib.getDocument || pdfjsLib.default?.getDocument;
      if (!getDocument) {
        throw new Error('getDocument function not found in pdfjs-dist');
      }
      const loadingTask = getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;

      // save arrayBuffer and pdfDoc for zoom/pan operations and render-on-demand
      this.pdfArrayBuffer = arrayBuffer;
      this.pdfDoc = pdf;
      this.renderedPages.clear();
      // If the PDF has a single page (cupom), render it immediately for best UX
      if (pdf.numPages === 1) {
        await this.renderSinglePage(1);
        return;
      }

      // create placeholders and observer to render pages on demand
      this.setupPlaceholders(pdf.numPages);
    } catch (e) {
      console.error('PDF.js render failed', e);
    }
  }

  zoomIn(): void {
    this.pdfScale = Math.min(this.pdfScale + 0.2, 3);
    this.reRenderPdf();
  }

  zoomOut(): void {
    this.pdfScale = Math.max(this.pdfScale - 0.2, 0.6);
    this.reRenderPdf();
  }

  private async reRenderPdf(): Promise<void> {
    try {
      if (!this.pdfViewerContainer) return;
      // If we have arrayBuffer but not pdfDoc, load it; otherwise reuse
      if (!this.pdfDoc) {
        if (!this.pdfArrayBuffer) return;
        // Try different import approaches for better compatibility
        let pdfjsLib: any;
        try {
          pdfjsLib = await import('pdfjs-dist/legacy/build/pdf');
        } catch (e) {
          console.warn('Legacy import failed, trying standard:', e);
          pdfjsLib = await import('pdfjs-dist');
        }
        // Configure worker
        try {
          if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = this.getWorkerPath();
          } else if (pdfjsLib.default?.GlobalWorkerOptions) {
            pdfjsLib.default.GlobalWorkerOptions.workerSrc = this.getWorkerPath();
          }
        } catch (e) {
          console.warn('Worker configuration failed:', e);
        }
        // Get the getDocument function
        const getDocument = pdfjsLib.getDocument || pdfjsLib.default?.getDocument;
        if (!getDocument) {
          throw new Error('getDocument function not found in pdfjs-dist');
        }
        const loadingTask = getDocument({ data: this.pdfArrayBuffer });
        this.pdfDoc = await loadingTask.promise;
      }

      // clear previous slots/observer
      this.cleanupObserverAndSlots();
      this.pdfViewerContainer.nativeElement.innerHTML = '';
      this.renderedPages.clear();
      // If single page, render immediately
      if (this.pdfDoc.numPages === 1) {
        await this.renderSinglePage(1);
        return;
      }
      this.setupPlaceholders(this.pdfDoc.numPages);
    } catch (e) {
      console.error('reRenderPdf failed', e);
    }
  }

  private async renderSinglePage(pageNum: number): Promise<void> {
    if (!this.pdfDoc || !this.pdfViewerContainer) return;
    if (this.renderedPages.has(pageNum)) return;
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.pdfScale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = 'pdf-page-canvas';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport }).promise;
      this.pdfViewerContainer.nativeElement.appendChild(canvas);
      this.renderedPages.add(pageNum);
    } catch (e) {
      console.error('renderSinglePage failed', e);
    }
  }

  private setupPlaceholders(numPages: number): void {
    if (!this.pdfViewerContainer) return;
    const container = this.pdfViewerContainer.nativeElement;
    // create observer
    const options: IntersectionObserverInit = { root: container, rootMargin: '400px', threshold: 0.1 };
    this.pageObserver = new IntersectionObserver((entries) => {
      entries.forEach(ent => {
        if (ent.isIntersecting) {
          const slot = ent.target as HTMLElement;
          const pageAttr = slot.getAttribute('data-page');
          if (!pageAttr) return;
          const pageNum = Number(pageAttr);
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.renderPageIfNeeded(pageNum).catch(e => console.error('renderPageIfNeeded failed', e));
        }
      });
    }, options);

    for (let p = 1; p <= numPages; p++) {
      const slot = document.createElement('div');
      slot.className = 'pdf-page-slot';
      slot.setAttribute('data-page', String(p));
      // visual placeholder size to avoid layout shift; will be replaced by canvas when rendered
      slot.style.minHeight = '360px';
      slot.style.display = 'flex';
      slot.style.alignItems = 'center';
      slot.style.justifyContent = 'center';
      slot.style.marginBottom = '12px';
      slot.innerHTML = `<div class="page-loading">Carregando página ${p}...</div>`;
      container.appendChild(slot);
      if (this.pageObserver) this.pageObserver.observe(slot);
    }
  }

  private async renderPageIfNeeded(pageNum: number): Promise<void> {
    if (!this.pdfDoc || !this.pdfViewerContainer) return;
    if (this.renderedPages.has(pageNum)) return;
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.pdfScale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = 'pdf-page-canvas';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport }).promise;
      // replace placeholder slot content with canvas
      const container = this.pdfViewerContainer.nativeElement;
      const slot = container.querySelector(`.pdf-page-slot[data-page="${pageNum}"]`);
      if (slot && slot.parentElement) {
        slot.parentElement.replaceChild(canvas, slot);
      }
      this.renderedPages.add(pageNum);
    } catch (e) {
      console.error('renderPage failed', e);
    }
  }

  private cleanupObserverAndSlots(): void {
    try {
      if (this.pageObserver) {
        this.pageObserver.disconnect();
        this.pageObserver = null;
      }
    } catch (e) {
      // ignore
    }
    this.renderedPages.clear();
    // don't clear pdfDoc here; keep for re-render
  }

  onOverlayClick(event: MouseEvent): void {
    // fecha o modal se o clique for no overlay (fora da modal)
    if (event.target === event.currentTarget) {
      this.closeEnviarModal();
    }
  }

  closeEnviarModal(): void {
    this.showEnviarModal = false;
    this.modalOrderId = null;
    if (this.previewObjectUrl) {
      try { URL.revokeObjectURL(this.previewObjectUrl); } catch (e) { /* ignore */ }
      this.previewObjectUrl = null;
    }
    this.previewBlobUrl = null;
  }

  sendNotaByEmailFromModal(): void {
    if (!this.modalOrderId) return;
    const orderId = this.modalOrderId;
    const contactPayload: any = {};
    if (this.modalCustomerName) contactPayload.customerName = this.modalCustomerName;
    if (this.modalCustomerEmail) contactPayload.customerEmail = this.modalCustomerEmail;
    if (this.modalCustomerPhone) contactPayload.customerPhone = this.modalCustomerPhone;

    if (Object.keys(contactPayload).length > 0) {
      this.apiService.updateOrderContact(orderId, contactPayload).subscribe({ next: () => { }, error: () => { } });
    }

    const to = this.modalCustomerEmail || '';
    if (!to || to.trim().length === 0) {
      alert('Informe um e-mail válido para enviar a nota.');
      return;
    }

    const subject = `Comprovante - Pedido #${orderId}`;
    const body = `Segue a nota do seu último pedido na nossa loja.`;

    // Call backend endpoint that generates the PDF and sends it via SMTP (uses EmailService)
    this.apiService.sendNotaEmail(orderId, { to, subject, body }).subscribe({
      next: (res) => {
        alert('Email enviado com sucesso.');
        this.closeEnviarModal();
      },
      error: (err) => {
        console.error('SEND_NOTA_EMAIL failed', err);
        const msg = err?.error?.message || err?.error?.error || err?.message || 'Falha ao enviar email';
        alert(msg);
      }
    });
  }

  sendNotaByWhatsappFromModal(): void {
    if (!this.modalOrderId) return;
    const orderId = this.modalOrderId;
    const contactPayload: any = {};
    if (this.modalCustomerName) contactPayload.customerName = this.modalCustomerName;
    if (this.modalCustomerEmail) contactPayload.customerEmail = this.modalCustomerEmail;
    if (this.modalCustomerPhone) contactPayload.customerPhone = this.modalCustomerPhone;

    if (Object.keys(contactPayload).length > 0) {
      this.apiService.updateOrderContact(orderId, contactPayload).subscribe({ next: () => { }, error: () => { } });
    }

    let phone = (this.modalCustomerPhone || '').replace(/\D/g, '');
    if (!phone) { this.closeEnviarModal(); return; }
    if (!phone.startsWith('55')) {
      if (phone.length <= 11) phone = '55' + phone;
    }
    const pdfUrl = this.apiService.getNotaPdfUrl(orderId);
    const msg = `Segue a nota do seu último pedido na nossa loja: ${pdfUrl}`;
    // Try open WhatsApp Desktop/Web via external browser
    const waUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`;
    this.openExternalUrl(waUrl);
    this.closeEnviarModal();
  }
  loadResumos(): void {
    this.apiService.getResumoDia().subscribe({
      next: (res) => {
        this.resumoDia = res;
        // Ajustar para refletir valores líquidos após devoluções/trocas
        this.recomputeResumosFromNet();
      },
      error: () => { }
    });
    this.apiService.getResumoMesAtual().subscribe({
      next: (res) => {
        this.resumoMes = res;
        // Ajustar para refletir valores líquidos após devoluções/trocas
        this.recomputeResumosFromNet();
      },
      error: () => { }
    });
  }


  getDataAtual(): string {
    return getCurrentDateForInput();
  }

  loadVendas(): void {
    this.loading = true;
    this.error = '';

    forkJoin({
      legado: this.apiService.getVendas().pipe(catchError(() => of([]))),
      checkout: this.apiService.getVendasCompletas().pipe(catchError(() => of([])))
    }).subscribe(({ legado, checkout }) => {
      // Legado
      const legacyArr = Array.isArray(legado) ? legado : [];
      // ensure unique row id for legacy entries
      legacyArr.forEach((row: any, idx: number) => {
        row._isCheckout = false;
        row.row_id = `legacy-${row.id ?? idx}`;
      });
      this.vendasLegado = [...legacyArr].sort((a, b) => {
        const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
        if (timeDiff !== 0) return timeDiff;
        return (b.id || 0) - (a.id || 0);
      });

      // Checkout -> uma linha por ordem (agregada)
      const linhas: Venda[] = [];
      const vendasCompletas = Array.isArray(checkout) ? checkout : [];
      logger.info('RELATORIO_VENDAS', 'LOAD_CHECKOUT_RAW', 'Payload de checkout recebido', {
        numOrdens: vendasCompletas.length
      });
      let rowCounter = 0;
      for (const v of vendasCompletas) {
        const data = v.data_venda;
        const pagamentos: Array<{ metodo: MetodoPagamento; valor: number }> = (v.pagamentos || []);
        const itens = v.itens || [];
        // Mapa auxiliar: preco unitário por sale_item_id para estimar devoluções quando necessário
        const unitBySid: Record<string, number> = {};
        try {
          for (const it of (itens || [])) {
            const sid = String((it as any).id || (it as any).sale_item_id || (it as any).saleItemId || '');
            const unit = Number((it as any).preco_unitario || (it as any).precoUnitario || (it as any).preco || 0) || 0;
            if (sid) unitBySid[sid] = unit;
          }
        } catch { /* ignore */ }
        const adjustments: any[] = Array.isArray(v.adjustments) ? v.adjustments : (Array.isArray(v.ajustes) ? v.ajustes : []);
        // Mapear quantidades devolvidas por item e trocas (diferença e método) por item
        const returnedByItem: Record<string, number> = {};
        const exchangeDiffByItem: Record<string, number> = {};
        const exchangePmByItem: Record<string, string> = {};
        const exchangesRaw: Array<{ sid?: string; rpid?: number; diff: number; pm?: string; qty?: number }> = [];
        const exchangeMethodSum: Record<string, number> = {};
        const returnMethodSum: Record<string, number> = {};
        let exchangeDiffTotal = 0;
        for (const a of adjustments) {
          try {
            const t = (a?.type || a?.tipo || '').toLowerCase();
            if (t === 'return') {
              const sid = String(a.sale_item_id || a.saleItem?.id || a.saleItemId || a.item_id || '');
              const q = Number(a.quantity || a.quantidade || 0) || 0;
              if (sid && q > 0) returnedByItem[sid] = (returnedByItem[sid] || 0) + q;
              // Valor devolvido por método, se disponível
              try {
                const pm = (a as any).payment_method || (a as any).metodo_pagamento;
                let valRaw: any = (a as any).amount ?? (a as any).valor ?? (a as any).refund_amount ?? (a as any).valor_reembolso;
                if (valRaw == null) {
                  const unit = Number(unitBySid[sid] || 0) || 0;
                  valRaw = unit * q;
                }
                if (pm && valRaw != null) {
                  let valNum = Number(valRaw);
                  if (typeof valRaw === 'string') {
                    const cleaned = valRaw.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
                    const parsed = Number(cleaned); if (!isNaN(parsed)) valNum = parsed;
                  }
                  const key = String(pm).toLowerCase();
                  returnMethodSum[key] = (returnMethodSum[key] || 0) + (Number(valNum) || 0);
                }
              } catch { /* ignore */ }
            } else if (t === 'exchange' || t === 'troca') {
              let diffRaw: any = a.difference ?? a.diferenca ?? a.price_difference ?? (a as any).priceDifference ?? (a as any).valor_diferenca ?? a.amount ?? a.valor ?? 0;
              if (typeof diffRaw === 'string') {
                const cleaned = diffRaw.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
                const parsed = Number(cleaned);
                if (!isNaN(parsed)) diffRaw = parsed;
              }
              const diffNum = Number(diffRaw) || 0;
              if (diffNum !== 0) exchangeDiffTotal += diffNum;
              const sid2 = String(a.sale_item_id || a.saleItem?.id || a.saleItemId || a.item_id || '');
              if (sid2) {
                exchangeDiffByItem[sid2] = (exchangeDiffByItem[sid2] || 0) + diffNum;
              }
              const pm = (a as any).payment_method || (a as any).metodo_pagamento;
              if (pm) {
                exchangePmByItem[sid2] = String(pm);
                (v as any).exchange_payment_methods = Array.from(new Set([...(v as any).exchange_payment_methods || [], String(pm)]));
                const key = String(pm).toLowerCase();
                exchangeMethodSum[key] = (exchangeMethodSum[key] || 0) + diffNum;
              }
              const rpidRaw = (a as any).replacement_product_id || (a as any).replacementProductId;
              const rpid = rpidRaw != null ? Number(rpidRaw) : undefined;
              const q = Number((a as any).quantity || (a as any).quantidade || 0) || 0;
              exchangesRaw.push({ sid: sid2 || undefined, rpid, diff: diffNum, pm, qty: q });
            }
          } catch (e) { /* ignore unsafe payload shape */ }
        }
        const metodoResumo = this.buildPagamentoResumo(pagamentos);
        const metodosSet = new Set<MetodoPagamento>();
        for (const p of pagamentos) if (p?.metodo) metodosSet.add(p.metodo);
        const pagamentosSum: Record<MetodoPagamento, number> = { dinheiro: 0, cartao_credito: 0, cartao_debito: 0, pix: 0 } as any;
        try { for (const p of pagamentos) { if (p?.metodo != null) pagamentosSum[p.metodo] = (pagamentosSum[p.metodo] || 0) + Number(p.valor || 0); } } catch { /* ignore */ }

        const totalQuantidade = Array.isArray(itens) ? itens.reduce((s: number, it: any) => s + (Number(it.quantidade) || 0), 0) : 0;
        let totalValorBruto = (v.total_final ?? v.totalFinal ?? 0) as number;
        if (!totalValorBruto || totalValorBruto === 0) {
          totalValorBruto = Array.isArray(itens) ? itens.reduce((s: number, it: any) => s + (Number(it.preco_total || it.precoTotal) || 0), 0) : 0;
        }
        const returnedTotalBackend = Number(v.returned_total ?? v.returnedTotal ?? 0) || 0;
        let netTotal = Number(v.net_total ?? v.preco_total_liquido ?? v.netTotal ?? v.precoTotalLiquido ?? NaN);
        if (isNaN(netTotal)) {
          netTotal = Math.max(0, totalValorBruto - returnedTotalBackend);
        }
        let returnedTotal = returnedTotalBackend;
        if (returnedTotal === 0 && totalValorBruto > netTotal) {
          // Inferir devolução se backend não mandou explicitamente
          returnedTotal = Math.max(0, totalValorBruto - netTotal);
        }
        // Log de inconsistência: há ajustes tipo return mas valor devolvido permanece 0
        try {
          const hasReturnAdj = adjustments.some(a => ((a?.type || a?.tipo || '').toLowerCase() === 'return'));
          if (hasReturnAdj && returnedTotal === 0) {
            logger.warn('RELATORIO_VENDAS', 'AJUSTES_SEM_RETURNED_TOTAL', 'Ajustes de devolução presentes mas returned_total == 0', {
              id: v.id,
              bruto: totalValorBruto,
              netRaw: v.net_total ?? v.preco_total_liquido,
              netUsado: netTotal,
              ajustes: adjustments.length
            });
          }
        } catch { /* ignore */ }

        // Decorar itens com quantidade devolvida e diferença de troca antes de montar nome
        if (Array.isArray(itens)) {
          for (const it of itens) {
            try {
              const sid = String(it.id || it.item_id || it.sale_item_id || '');
              const unit = Number(it.preco_unitario || it.precoUnitario || it.preco || 0) || 0;
              const qtyOrig = Number(it.quantidade || it.quantidade_vendida || 0) || 0;
              let ret = sid && returnedByItem[sid] ? returnedByItem[sid] : 0;
              if (ret === 0 && unit > 0) {
                const brutoDecl = Number(it.preco_total || it.precoTotal || (unit * qtyOrig)) || 0;
                const liquidoDeclRaw = (it as any).preco_total_liquido ?? (it as any).precoTotalLiquido;
                const liquidoDecl = Number(liquidoDeclRaw != null ? liquidoDeclRaw : brutoDecl);
                if (liquidoDecl < brutoDecl - 0.0001) {
                  const diff = brutoDecl - liquidoDecl;
                  const inferred = Math.min(qtyOrig, Math.round(diff / unit));
                  if (inferred > 0) ret = inferred;
                }
              }
              if (ret > 0) (it as any).returned_quantity = ret;
              // exchange diff per item + método
              const exch = Number(exchangeDiffByItem[sid] || 0) || 0;
              if (exch !== 0) (it as any).exchange_difference_total = exch;
              const pm = exchangePmByItem[sid];
              if (pm) (it as any).exchange_payment_method = pm;
            } catch (e) { /* ignore mapping error for item */ }
          }
        }
        // Fallback: se não casou por sale_item_id, tentar por replacement_product_id ou 1º item
        try {
          const itemsArr = Array.isArray(itens) ? itens : [];
          const idToIndex: Record<string, number> = {};
          const pidToIndex: Record<string, number> = {};
          for (let i = 0; i < itemsArr.length; i++) {
            const it = itemsArr[i] as any;
            const iid = String(it.id || it.item_id || it.sale_item_id || '');
            if (iid) idToIndex[iid] = i;
            const pid = String(it.produto_id || it.produtoId || (it.produto?.id) || '');
            if (pid) pidToIndex[pid] = i;
          }
          for (const ex of exchangesRaw) {
            try {
              const qty = Math.max(1, Number(ex.qty || 0) || 1);
              const diff = Number(ex.diff || 0) || 0;
              const pm = ex.pm ? String(ex.pm) : undefined;
              const getUnit = (it: any): number => Number(it?.preco_unitario || it?.precoUnitario || it?.preco || 0) || 0;

              let fromIdx = (ex.sid && idToIndex[ex.sid] != null) ? idToIndex[ex.sid] : -1;
              let toIdx = (ex.rpid != null && pidToIndex[String(ex.rpid)] != null) ? pidToIndex[String(ex.rpid)] : -1;

              // Quick 2-item fallbacks when only one side is known
              if (itemsArr.length === 2) {
                if (fromIdx >= 0 && toIdx < 0) toIdx = (fromIdx === 0 ? 1 : 0);
                if (toIdx >= 0 && fromIdx < 0) fromIdx = (toIdx === 0 ? 1 : 0);
              }

              // Heuristics when indices are missing or ambiguous
              if (fromIdx < 0 && toIdx >= 0) {
                // Estimate original unit from the known 'to' item
                const toUnit = getUnit(itemsArr[toIdx]);
                const origEst = toUnit - (diff / qty);
                let bestIdx = -1; let bestDelta = Number.POSITIVE_INFINITY;
                for (let i = 0; i < itemsArr.length; i++) {
                  if (i === toIdx) continue;
                  const d = Math.abs(getUnit(itemsArr[i]) - origEst);
                  if (d < bestDelta) { bestDelta = d; bestIdx = i; }
                }
                if (bestIdx >= 0) fromIdx = bestIdx;
              } else if (toIdx < 0 && fromIdx >= 0) {
                // Estimate replacement unit from the known 'from' item
                const fromUnit = getUnit(itemsArr[fromIdx]);
                const replEst = fromUnit + (diff / qty);
                let bestIdx = -1; let bestDelta = Number.POSITIVE_INFINITY;
                for (let i = 0; i < itemsArr.length; i++) {
                  if (i === fromIdx) continue;
                  const d = Math.abs(getUnit(itemsArr[i]) - replEst);
                  if (d < bestDelta) { bestDelta = d; bestIdx = i; }
                }
                if (bestIdx >= 0) toIdx = bestIdx;
              }

              // If neither side known, pick the pair (i->j) whose unit diff best matches diff/qty
              if (fromIdx < 0 && toIdx < 0 && itemsArr.length >= 2) {
                let bestFrom = -1, bestTo = -1; let bestDelta = Number.POSITIVE_INFINITY;
                for (let i = 0; i < itemsArr.length; i++) {
                  const ui = getUnit(itemsArr[i]);
                  for (let j = 0; j < itemsArr.length; j++) {
                    if (j === i) continue;
                    const uj = getUnit(itemsArr[j]);
                    const d = Math.abs((uj - ui) - (diff / qty));
                    if (d < bestDelta) { bestDelta = d; bestFrom = i; bestTo = j; }
                  }
                }
                if (bestFrom >= 0 && bestTo >= 0) { fromIdx = bestFrom; toIdx = bestTo; }
              }

              // Final safety: if still missing, default to first-other pairing
              if (fromIdx < 0 && itemsArr.length > 0) fromIdx = 0;
              if (toIdx < 0 && itemsArr.length > 1) toIdx = (fromIdx === 0 ? 1 : 0);

              const fromIt = itemsArr[fromIdx] as any;
              const toIt = toIdx >= 0 ? (itemsArr[toIdx] as any) : null;
              if (!fromIt) continue;

              // Roles and annotations — always annotate 'from'
              const partnerName = toIt ? (toIt.produto_nome || toIt.produtoNome || 'Produto') : (ex.rpid != null ? `Produto #${ex.rpid}` : 'Produto');
              fromIt._exchange_partner_name = partnerName;
              fromIt._exchange_partner_role = 'from';
              fromIt._exchange_quantity = qty;
              fromIt._exchange_diff = diff;
              if (pm) fromIt._exchange_payment_method = pm;

              if (toIt) {
                toIt._exchange_partner_name = (fromIt.produto_nome || fromIt.produtoNome || 'Produto');
                toIt._exchange_partner_role = 'to';
                toIt._exchange_quantity = qty;
                toIt._exchange_diff = diff;
                if (pm) toIt._exchange_payment_method = pm;
              }

              // Apply monetary diff only on the 'from' item when not already assigned via sale_item_id mapping
              const alreadyAssigned = Boolean(ex.sid && idToIndex[ex.sid] != null && Number(exchangeDiffByItem[ex.sid] || 0) !== 0);
              if (!alreadyAssigned) {
                fromIt.exchange_difference_total = Number(fromIt.exchange_difference_total || 0) + diff;
              }
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
        // Montar nome agregando cada produto com anotações por item
        let produtoNome = '';
        let exchangeAnnotation = '';
        let composedProdutoNome = '';
        if (Array.isArray(itens) && itens.length > 0) {
          const partes: string[] = [];
          for (const it of itens) {
            const baseNome = it.produto_nome || it.produtoNome || 'Produto';
            const rq = Number((it as any).returned_quantity || 0);
            if (rq > 0) partes.push(`${baseNome} (devolvido, qtd: ${rq})`); else partes.push(baseNome);
          }
          produtoNome = partes.join(', ');
          if (exchangeDiffTotal !== 0) {
            const sign = exchangeDiffTotal > 0 ? '+' : '-';
            exchangeAnnotation = `(troca ${sign}${Math.abs(exchangeDiffTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
          }
          // Nome composto (para exibição) inclui anotações de devolução e, quando houver, de troca
          composedProdutoNome = exchangeAnnotation ? `${produtoNome} ${exchangeAnnotation}` : produtoNome;
        } else {
          produtoNome = `Pedido #${v.id} (${itens.length} itens)`;
          composedProdutoNome = produtoNome;
        }
        // Fallback: se nenhuma anotação adicionada e existe diferença bruto-liquido indicando devolução, tentar distribuir
        if (!/devolvido, qtd:/i.test(produtoNome)) {
          try {
            const brutoVenda = totalValorBruto;
            const liquidoVenda = netTotal;
            const diffValor = Math.max(0, brutoVenda - liquidoVenda);
            if (diffValor > 0.0001 && Array.isArray(itens) && itens.length > 0) {
              let restante = diffValor;
              let anyRet = false;
              for (let idx = 0; idx < itens.length; idx++) {
                const it = itens[idx];
                const unit = Number(it.preco_unitario || it.precoUnitario || it.preco || 0) || 0;
                const qtyOrig = Number(it.quantidade || it.quantidade_vendida || 0) || 0;
                if (unit <= 0 || qtyOrig <= 0) continue;
                if ((it as any).returned_quantity > 0) { anyRet = true; continue; }
                let retQtd = 0;
                if (idx < itens.length - 1) {
                  const brutoItem = unit * qtyOrig;
                  const proporcao = brutoItem / brutoVenda;
                  const valorAlocado = Math.min(restante, diffValor * proporcao);
                  retQtd = Math.min(qtyOrig, Math.round(valorAlocado / unit));
                } else {
                  retQtd = Math.min(qtyOrig, Math.round(restante / unit));
                }
                if (retQtd > 0) {
                  (it as any).returned_quantity = retQtd;
                  restante -= retQtd * unit;
                  anyRet = true;
                }
                if (restante <= 0.0001) break;
              }
              if (anyRet) {
                const partes2: string[] = [];
                for (const it of itens) {
                  const baseNome = it.produto_nome || it.produtoNome || 'Produto';
                  const rq = Number((it as any).returned_quantity || 0);
                  if (rq > 0) partes2.push(`${baseNome} (devolvido, qtd: ${rq})`); else partes2.push(baseNome);
                }
                produtoNome = partes2.join(', ');
                logger.info('RELATORIO_VENDAS', 'FALLBACK_RETURN_ALLOCATION', 'Distribuiu devolução por valor', { id: v.id, diffValor });
              }
            }
          } catch { /* ignore */ }
        }
        const produtoImagem = Array.isArray(itens) && itens.length > 0 ? (itens[0].produto_imagem || itens[0].produtoImagem) : null;
        const linha: Venda = {
          id: v.id,
          produto_id: v.id,
          quantidade_vendida: totalQuantidade,
          preco_total: totalValorBruto,
          data_venda: data,
          metodo_pagamento: 'dinheiro',
          produto_nome: produtoNome,
          produto_imagem: produtoImagem,
          pagamentos_resumo: metodoResumo,
        } as any;
        // Adicionar nome composto e total de diferença de troca para exibição consistente nas tabelas
        (linha as any)._produtos_compostos = composedProdutoNome;
        (linha as any).exchange_difference_total = exchangeDiffTotal;
        // Valor líquido deve refletir devoluções + diferença de troca (adicional/troco)
        (linha as any).preco_total_liquido = Number(netTotal || 0) + Number(exchangeDiffTotal || 0);
        (linha as any).itens = itens;
        (linha as any).metodos_multi = Array.from(metodosSet);
        (linha as any).row_id = `checkout-${v.id}-${rowCounter++}`;
        (linha as any)._isCheckout = true;
        (linha as any).returned_total = returnedTotal;
        (linha as any).pagamentos_sum = pagamentosSum;
        (linha as any).exchange_method_sum = exchangeMethodSum;
        (linha as any).return_method_sum = returnMethodSum;
        // Log de trocas por item para debug
        try {
          const itemsLog = (Array.isArray(itens) ? itens : []).map((it: any) => ({
            produto: it.produto_nome || it.produtoNome,
            diff: Number((it as any).exchange_difference_total || 0) || 0,
            pm: (it as any).exchange_payment_method || null
          }));
          logger.info('RELATORIO_VENDAS', 'EXCHANGE_MAP', 'Trocas mapeadas na venda', {
            id: v.id,
            exchange_total: Number((linha as any).exchange_difference_total || 0) || 0,
            itens: itemsLog
          });
        } catch { /* ignore */ }
        if (netTotal !== undefined) {
          const exchAdj = Number((linha as any).exchange_difference_total || 0) || 0;
          (linha as any).preco_total_liquido = Number(netTotal) + exchAdj;
        }
        // Não anexar mais sufixo agregado no produto_nome; mostramos badge separado e anotações por item dentro da lista
        // Persistir quantidades agregadas para uso consistente em tabelas / relatórios
        try {
          let totalReturnedQtyPersist = 0;
          for (const it of itens) totalReturnedQtyPersist += Number((it as any).returned_quantity || 0);
          (linha as any).returned_quantity_total = totalReturnedQtyPersist; // quantidade devolvida agregada
          (linha as any).quantidade_bruta = totalQuantidade;               // quantidade original vendida
          (linha as any).quantidade_liquida = Math.max(0, totalQuantidade - totalReturnedQtyPersist); // após devoluções
          // Garantir que quantidade_vendida continue representando a quantidade bruta (pedido original)
          linha.quantidade_vendida = totalQuantidade;
        } catch { /* ignore */ }
        linhas.push(linha);

        // Log detalhado desta ordem mapeada
        try {
          let totalReturnedQty = 0;
          try {
            for (const it of itens) totalReturnedQty += Number((it as any).returned_quantity || 0);
          } catch { /* ignore */ }
          logger.info('RELATORIO_VENDAS', 'MAP_PEDIDO', 'Pedido mapeado', {
            id: v.id,
            bruto: totalValorBruto,
            net: netTotal,
            returned_total: returnedTotal,
            returned_qty_total: totalReturnedQty,
            itens: itens.length,
            ajustes_return: adjustments.filter(a => (a?.type || a?.tipo || '').toLowerCase() === 'return').length,
            inferiu_returned_total: returnedTotalBackend === 0 && returnedTotal > 0
          });
        } catch { /* ignore */ }

        logger.info('RELATORIO_VENDAS', 'MAP_CHECKOUT_ORDEM', 'Ordem mapeada', {
          ordemId: v.id,
          itens: itens.length,
          pagamentos: pagamentos.length,
          resumo: metodoResumo
        });
      }
      this.vendasCheckout = [...linhas].sort((a, b) => {
        const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
        if (timeDiff !== 0) return timeDiff;
        return (b.id || 0) - (a.id || 0);
      });

      this.mergeAndRecompute();
      // Log resumo após unificação
      try {
        const brutoAll = this.vendas.reduce((s, r: any) => s + (Number(r.preco_total) || 0), 0);
        const liquidoAll = this.vendas.reduce((s, r: any) => s + this.getNetValor(r), 0);
        const devolvidoAll = this.vendas.reduce((s, r: any) => s + (Number((r as any).returned_total) || 0), 0);
        logger.info('RELATORIO_VENDAS', 'UNIFICADO_SUMMARY', 'Resumo unificado', {
          linhas: this.vendas.length,
          brutoAll,
          liquidoAll,
          devolvidoAll
        });
      } catch { /* ignore */ }
      this.loading = false;
      // set pagination metadata: currently using vendasFiltradas total
      this.total = this.vendasFiltradas.length;
      this.hasMore = this.total > (this.page * this.pageSize);
      logger.info('RELATORIO_VENDAS', 'LOAD_ALL', 'Vendas unificadas carregadas', {
        legado: this.vendasLegado.length,
        checkout: this.vendasCheckout.length,
        total: (this.vendasLegado.length + this.vendasCheckout.length)
      });
      // Estatística de quantas linhas têm múltiplos métodos
      const multiLinhas = this.vendasCheckout.filter(v => Array.isArray((v as any).metodos_multi) && (v as any).metodos_multi.length > 1).length;
      logger.info('RELATORIO_VENDAS', 'CHECK_MULTI', 'Resumo de vendas com múltiplos pagamentos', {
        linhasCheckout: this.vendasCheckout.length,
        linhasMulti: multiLinhas
      });
    });
  }

  private mergeAndRecompute(): void {
    this.vendas = [...(this.vendasCheckout || []), ...(this.vendasLegado || [])].sort((a, b) => {
      const timeDiff = (parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime());
      if (timeDiff !== 0) return timeDiff;
      return (b.id || 0) - (a.id || 0);
    });
    this.vendasFiltradas = this.computeVendasFiltradas();
    // Debug: log sample vendasFiltradas to verify itens presence for expand button
    try {
      logger.debug('RELATORIO_VENDAS', 'POST_MERGE_SAMPLE', 'Sample vendasFiltradas', this.vendasFiltradas.slice(0, 50).map(v => ({ id: v.id, row_id: (v as any).row_id, itensLen: Array.isArray((v as any).itens) ? (v as any).itens.length : 0, metodos_multi: Array.isArray((v as any).metodos_multi) ? (v as any).metodos_multi.length : 0 })));
    } catch (e) { console.debug('RELATORIO_VENDAS: failed to log sample', e); }
    this.calcularEstatisticas(this.vendasFiltradas);
    this.gerarRelatorios(this.vendasFiltradas);
    // Ajustar resumos (dia/mês) para refletir valores líquidos (devoluções + trocas)
    this.recomputeResumosFromNet();
  }

  toggleExpand(rowId: string): void {
    logger.debug('RELATORIO_VENDAS', 'TOGGLE_EXPAND', 'toggleExpand called', { rowId, before: Array.from(this.expandedRows) });
    if (!rowId) return;
    if (this.expandedRows.has(rowId)) {
      this.expandedRows.delete(rowId);
    } else {
      this.expandedRows.add(rowId);
    }
    logger.debug('RELATORIO_VENDAS', 'TOGGLE_EXPAND', 'toggleExpand updated', { rowId, after: Array.from(this.expandedRows) });
  }

  calcularEstatisticas(vendasFiltradas?: Venda[]): void {
    const raw = vendasFiltradas ?? this.computeVendasFiltradas();
    const list = this.metricsBase(raw);
    this.totalVendas = list.length;
    // Usar valor líquido quando disponível
    this.receitaTotal = list.reduce((total, venda: any) => total + this.getNetValor(venda), 0);
    this.mediaVendas = this.totalVendas > 0 ? this.receitaTotal / this.totalVendas : 0;

    // Encontrar melhor dia
    const vendasPorDia = list.reduce((acc, venda) => {
      const data = extractLocalDate(venda.data_venda);
      if (!acc[data]) {
        acc[data] = 0;
      }
      acc[data] += this.getNetValor(venda);
      return acc;
    }, {} as Record<string, number>);

    let melhorDia = '';
    let melhorReceita = 0;
    for (const [data, receita] of Object.entries(vendasPorDia)) {
      if (receita > melhorReceita) {
        melhorReceita = receita;
        melhorDia = data;
      }
    }

    this.melhorDia = melhorDia;
    this.melhorDiaReceita = melhorReceita;
  }

  gerarRelatorios(vendasFiltradas?: Venda[]): void {
    this.gerarRelatorioDiario(vendasFiltradas);
    this.gerarRelatorioMensal(vendasFiltradas);
  }

  gerarRelatorioDiario(vendasFiltradas?: Venda[]): void {
    const list = this.metricsBase(vendasFiltradas ?? this.computeVendasFiltradas());
    const vendasPorDia = list.reduce((acc, venda) => {
      const data = extractLocalDate(venda.data_venda);
      if (!acc[data]) {
        acc[data] = {
          data: data,
          total_vendas: 0,
          quantidade_vendida: 0, // bruta
          receita_total: 0,
          returned_total: 0
        } as any; // cast any para permitir campo adicional dinamicamente
      }
      acc[data].total_vendas++;
      acc[data].quantidade_vendida += venda.quantidade_vendida;
      (acc[data] as any).receita_total += this.getNetValor(venda);
      (acc[data] as any).returned_total = ((acc[data] as any).returned_total || 0) + (venda.returned_total || 0);
      (acc[data] as any).returned_total_qty = ((acc[data] as any).returned_total_qty || 0) + (Number((venda as any).returned_quantity_total) || 0);
      return acc;
    }, {} as Record<string, RelatorioVendas>);

    this.relatorioDiario = Object.values(vendasPorDia).sort((a, b) => b.data.localeCompare(a.data));
  }

  private buildPagamentoResumo(pagamentos: Array<{ metodo: MetodoPagamento; valor: number }>): string {
    if (!Array.isArray(pagamentos) || pagamentos.length === 0) return '';
    const order: MetodoPagamento[] = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'];
    // Somar por método para robustez
    const somaPorMetodo: Record<MetodoPagamento, number> = {
      dinheiro: 0,
      cartao_credito: 0,
      cartao_debito: 0,
      pix: 0
    };
    for (const p of pagamentos) {
      const m = p.metodo;
      const v = Number(p.valor || 0);
      if (m in somaPorMetodo) somaPorMetodo[m] += v;
    }
    const partes: string[] = [];
    for (const m of order) {
      const v = somaPorMetodo[m];
      if (v > 0) {
        const nome = this.getMetodoPagamentoNome(m);
        const valorFmt = v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        partes.push(`${nome} R$ ${valorFmt}`);
      }
    }
    return partes.join(' + ');
  }

  gerarRelatorioMensal(vendasFiltradas?: Venda[]): void {
    const list = this.metricsBase(vendasFiltradas ?? this.computeVendasFiltradas());
    const vendasPorMes = list.reduce((acc, venda) => {
      const mes = extractYearMonth(venda.data_venda);

      if (!acc[mes]) {
        acc[mes] = {
          data: mes,
          total_vendas: 0,
          quantidade_vendida: 0, // bruta
          receita_total: 0,
          returned_total: 0
        } as any;
      }
      acc[mes].total_vendas++;
      acc[mes].quantidade_vendida += venda.quantidade_vendida;
      (acc[mes] as any).receita_total += this.getNetValor(venda);
      (acc[mes] as any).returned_total = ((acc[mes] as any).returned_total || 0) + (venda.returned_total || 0);
      (acc[mes] as any).returned_total_qty = ((acc[mes] as any).returned_total_qty || 0) + (Number((venda as any).returned_quantity_total) || 0);
      return acc;
    }, {} as Record<string, RelatorioVendas>);

    this.relatorioMensal = Object.values(vendasPorMes).sort((a, b) => b.data.localeCompare(a.data));
  }

  aplicarFiltros(): void {
    this.vendasFiltradas = this.computeVendasFiltradas();
    this.calcularEstatisticas(this.vendasFiltradas);
    this.gerarRelatorios(this.vendasFiltradas);
    this.recomputeResumosFromNet();
    this.total = this.vendasFiltradas.length;
    this.page = 1;
    // reset relatorio pagination to first page when filters change
    this.relatorioPage = 1;
    logger.info('RELATORIO_VENDAS', 'APLICAR_FILTROS', 'Filtros aplicados', {
      periodo: this.filtroPeriodo,
      data: this.filtroData,
      nome: this.filtroNomeProduto,
      metodo: this.filtroMetodoPagamento
    });
  }

  limparFiltros(): void {
    this.filtroData = '';
    this.filtroNomeProduto = '';
    this.filtroMetodoPagamento = '';
    this.vendasFiltradas = this.computeVendasFiltradas();
    this.calcularEstatisticas(this.vendasFiltradas);
    this.gerarRelatorios(this.vendasFiltradas);
    this.recomputeResumosFromNet();
    // reset page and pageSize to default (10) when clearing filters
    this.page = 1;
    this.setPageSize(10);
    // reset relatorio pagination to defaults (page 1, pageSize 5)
    this.relatorioPage = 1;
    this.relatorioSetPageSize(5);
  }

  // Recalcula os resumos diário/mensal para a tabela "Receita por forma de pagamento"
  // somando diretamente: pagamentos por método + trocas por método - devoluções por método.
  // Não faz rateio proporcional algum, evitando centavos artificiais.
  private recomputeResumosFromNet(): void {
    try {
      const list = this.metricsBase(Array.isArray(this.vendasFiltradas) ? this.vendasFiltradas : []);
      const todayIso = new Date().toISOString();
      const todayYmd = extractLocalDate(todayIso);
      const thisMonth = extractYearMonth(todayIso);

      const isToday = (v: any) => {
        try { return extractLocalDate(v?.data_venda) === todayYmd; } catch { return false; }
      };
      const isThisMonth = (v: any) => {
        try { return extractYearMonth(v?.data_venda) === thisMonth; } catch { return false; }
      };

      const normalizarMetodo = (m: any): 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix' => {
        const s = String(m || '').toLowerCase();
        if (s.includes('pix')) return 'pix';
        if (s.includes('deb')) return 'cartao_debito';
        if (s.includes('cred')) return 'cartao_credito';
        return 'dinheiro';
      };

      const somarPorMetodoReal = (subset: any[]): Record<string, number> => {
        const acc: Record<string, number> = { dinheiro: 0, cartao_credito: 0, cartao_debito: 0, pix: 0 };
        for (const v of subset) {
          const local: Record<string, number> = { dinheiro: 0, cartao_credito: 0, cartao_debito: 0, pix: 0 };
          const pagSum = (v as any).pagamentos_sum as Record<string, number> | undefined;
          const exSum = (v as any).exchange_method_sum as Record<string, number> | undefined;
          const retSum = (v as any).return_method_sum as Record<string, number> | undefined;
          if (pagSum && Object.keys(pagSum).length) {
            Object.entries(pagSum).forEach(([k, val]) => { const key = normalizarMetodo(k); local[key] += Number(val || 0); });
          } else {
            // Fallback: se não veio breakdown, credita tudo no método único
            const key = normalizarMetodo((v as any).metodo_pagamento);
            local[key] += this.getNetValor(v);
          }
          if (exSum && Object.keys(exSum).length) {
            Object.entries(exSum).forEach(([k, val]) => { const key = normalizarMetodo(k); local[key] += Number(val || 0); });
          }
          if (retSum && Object.keys(retSum).length) {
            Object.entries(retSum).forEach(([k, val]) => { const key = normalizarMetodo(k); local[key] -= Number(val || 0); });
          }
          // Garantir que a soma por método do pedido bata com o valor líquido do pedido (sem rateio, um método só)
          const expected = this.getNetValor(v);
          const localSum = Number(local['dinheiro'] || 0) + Number(local['cartao_credito' as any] || 0) + Number(local['cartao_debito' as any] || 0) + Number(local['pix'] || 0);
          const delta = Math.round((expected - localSum) * 100) / 100; // cents safe
          if (Math.abs(delta) >= 0.01) {
            // escolher método fallback: prefere dinheiro; senão maior pagamento; senão método do pedido
            let fallback: 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix' = 'dinheiro';
            const keys: Array<'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix'> = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix'];
            if (!keys.some(k => (local[k] || 0) > 0)) {
              fallback = normalizarMetodo((v as any).metodo_pagamento);
            } else if ((local['dinheiro'] || 0) > 0) {
              fallback = 'dinheiro';
            } else {
              // maior valor atual
              let maxK: any = 'dinheiro'; let maxV = -Infinity;
              for (const k of keys) { const val = Number(local[k] || 0); if (val > maxV) { maxV = val; maxK = k; } }
              fallback = maxK;
            }
            local[fallback] = Number(local[fallback] || 0) + delta;
          }
          // acumular no total
          acc['dinheiro'] += Number(local['dinheiro'] || 0);
          acc['cartao_credito'] += Number(local['cartao_credito' as any] || 0);
          acc['cartao_debito'] += Number(local['cartao_debito' as any] || 0);
          acc['pix'] += Number(local['pix'] || 0);
        }
        return acc;
      };

      const aplicarResumoDireto = (resumo: any, subset: any[]) => {
        if (!resumo) return;
        try {
          const por = somarPorMetodoReal(subset);
          const total = Number(por['dinheiro'] || 0) + Number(por['cartao_credito'] || 0) + Number(por['cartao_debito'] || 0) + Number(por['pix'] || 0);
          resumo.por_pagamento = por;
          resumo.receita_total = total;
          resumo.vendas_com_multiplo_pagamento = subset.filter((v: any) => Array.isArray((v as any).metodos_multi) && (v as any).metodos_multi.length > 1).length;
          resumo.total_vendas = subset.length;
          resumo.quantidade_vendida = subset.reduce((acc: number, v: any) => acc + (Number((v as any).quantidade_liquida ?? (v as any).quantidade_vendida ?? 0) || 0), 0);
        } catch { /* ignore */ }
      };

      // Log original -> antes
      try {
        logger.info('RELATORIO_VENDAS', 'RESUMO_BEFORE', 'Resumo original (antes do ajuste)', {
          dia: {
            receita_total: this.resumoDia?.receita_total,
            por_pagamento: this.resumoDia?.por_pagamento
          },
          mes: {
            receita_total: this.resumoMes?.receita_total,
            por_pagamento: this.resumoMes?.por_pagamento
          }
        });
      } catch { /* ignore */ }

      const subsetDia = list.filter(isToday);
      const subsetMes = list.filter(isThisMonth);
      aplicarResumoDireto(this.resumoDia, subsetDia);
      aplicarResumoDireto(this.resumoMes, subsetMes);

      // Log ajustado -> depois
      try {
        const sumPor = (p?: any) => (p ? (Number(p['dinheiro'] || 0) + Number(p['cartao_credito'] || 0) + Number(p['cartao_debito'] || 0) + Number(p['pix'] || 0)) : 0);
        logger.info('RELATORIO_VENDAS', 'RESUMO_AFTER', 'Resumo ajustado (método real, sem rateio)', {
          dia: {
            receita_liquida: subsetDia.reduce((s, v: any) => s + this.getNetValor(v), 0),
            por_pagamento: this.resumoDia?.por_pagamento,
            soma_por_pagamento: sumPor(this.resumoDia?.por_pagamento)
          },
          mes: {
            receita_liquida: subsetMes.reduce((s, v: any) => s + this.getNetValor(v), 0),
            por_pagamento: this.resumoMes?.por_pagamento,
            soma_por_pagamento: sumPor(this.resumoMes?.por_pagamento)
          }
        });
      } catch { /* ignore */ }
    } catch { /* ignore */ }
  }

  // Base para métricas: prioriza apenas linhas de checkout (uma por pedido)
  private metricsBase(list: Venda[]): Venda[] {
    try {
      const onlyCheckout = (list || []).filter((v: any) => v && (v as any)._isCheckout === true);
      if (onlyCheckout.length > 0) return onlyCheckout;
      return list || [];
    } catch {
      return list || [];
    }
  }

  exportarRelatorio(): void {
    const dados = this.filtroPeriodo === 'dia' ? this.relatorioDiario : this.relatorioMensal;
    const csv = this.converterParaCSV(dados);
    this.downloadCSV(csv, `relatorio-vendas-${this.filtroPeriodo}-${this.filtroData}.csv`);
  }

  private converterParaCSV(dados: RelatorioVendas[]): string {
    const headers = ['Data', 'Total de Vendas', 'Quantidade Vendida', 'Receita Total'];
    const linhas = dados.map(item => [
      item.data,
      item.total_vendas.toString(),
      item.quantidade_vendida.toString(),
      `R$ ${Number(item.receita_total || 0).toFixed(2)}`
    ]);

    return [headers, ...linhas].map(linha => linha.join(',')).join('\n');
  }

  private downloadCSV(csv: string, filename: string): void {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  voltarAoDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  irParaGraficos(): void {
    this.router.navigate(['/relatorios/graficos']);
  }

  private computeVendasFiltradas(): Venda[] {
    if (!Array.isArray(this.vendas)) return [];
    return [...this.vendas]
      .filter(v => !!v?.data_venda)
      .filter(v => this.passaFiltroData(v))
      .filter(v => this.passaFiltroNome(v))
      .filter(v => this.passaFiltroMetodo(v))
      .sort((a, b) => this.ordenarPorDataEId(a, b));
  }

  private getNetValor(venda: any): number {
    try {
      if (venda == null) return 0;
      const bruto = Number(venda.preco_total ?? 0) || 0;
      const liquidoRaw = venda.preco_total_liquido ?? venda.net_total;
      if (liquidoRaw != null && !isNaN(Number(liquidoRaw))) {
        return Number(liquidoRaw) || 0; // já inclui trocas quando mapeado
      }
      const devolvido = Number(venda.returned_total ?? 0) || 0;
      const exch = Number((venda as any).exchange_difference_total || 0) || 0;
      return Math.max(0, bruto - devolvido) + exch;
    } catch { return 0; }
  }

  private ordenarPorDataEId(a: Venda, b: Venda): number {
    const timeDiff = parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (b.id || 0) - (a.id || 0);
  }

  private passaFiltroData(venda: Venda): boolean {
    if (!this.filtroData) return true;
    try {
      if (this.filtroPeriodo === 'dia') {
        const vendaDate = parseDate(venda.data_venda);
        const vendaDataLocal = extractLocalDate(venda.data_venda); // YYYY-MM-DD
        if (vendaDataLocal !== this.filtroData) return false;
        // if hour filters provided, compare
        if (this.filtroHoraInicio || this.filtroHoraFim) {
          // build start/end using filtroData + times (local)
          const startIso = this.filtroHoraInicio ? this.normalizeDateTimeLocal(this.filtroData, this.filtroHoraInicio) : null;
          const endIso = this.filtroHoraFim ? this.normalizeDateTimeLocal(this.filtroData, this.filtroHoraFim) : null;
          const vendaTs = vendaDate.getTime();
          if (startIso) {
            const sTs = new Date(startIso).getTime();
            if (vendaTs < sTs) return false;
          }
          if (endIso) {
            const eTs = new Date(endIso).getTime();
            if (vendaTs > eTs) return false;
          }
        }
        return true;
      }

      // filtroPeriodo === 'mes' -> filtroData expected YYYY-MM (from input type=month)
      const vendaMes = extractYearMonth(venda.data_venda); // YYYY-MM
      // normalize filtroData which can be 'YYYY-MM' or 'YYYY-MM-DD' if user pasted
      const filtroMes = (this.filtroData || '').slice(0, 7);
      return vendaMes === filtroMes;
    } catch (error) {
      logger.warn('RELATORIO_VENDAS', 'FILTER_INVALID_DATE', 'Data de venda inválida ao aplicar filtro', { venda, error: String(error) });
      return false;
    }
  }

  // Build local ISO datetime string (no Z) from YYYY-MM-DD and HH:mm
  private normalizeDateTimeLocal(dateYmd: string, timeHHmm: string): string {
    try {
      const parts = dateYmd.split('-');
      if (parts.length !== 3) return dateYmd;
      const year = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const day = Number(parts[2]);
      const t = (timeHHmm || '').split(':');
      const hours = Number(t[0]) || 0;
      const minutes = Number(t[1]) || 0;
      const d = new Date(year, month, day, hours, minutes, 0, 0);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      const ms = String(d.getMilliseconds()).padStart(3, '0');
      return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}.${ms}`;
    } catch {
      return `${dateYmd}T00:00:00.000`;
    }
  }

  private passaFiltroNome(venda: Venda): boolean {
    const termo = this.filtroNomeProduto?.trim();
    if (!termo) return true;
    const nomeProduto = venda.produto_nome?.toLowerCase() ?? '';
    return nomeProduto.includes(termo.toLowerCase());
  }

  private passaFiltroMetodo(venda: Venda): boolean {
    const filtro = this.filtroMetodoPagamento?.trim() as MetodoPagamento | undefined;
    if (!filtro) return true;
    const metodosMulti: MetodoPagamento[] | undefined = (venda as any).metodos_multi;
    if (Array.isArray(metodosMulti) && metodosMulti.length > 0) {
      return metodosMulti.includes(filtro);
    }
    return venda.metodo_pagamento === filtro;
  }

  formatarData(data: string): string {
    // Quando o agrupamento gera 'YYYY-MM-DD', usar formatação própria
    if (/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return formatDateYMD(data);
    }

    // Para relatórios mensais o agrupamento produz 'YYYY-MM'
    if (/^\d{4}-\d{2}$/.test(data)) {
      // formatar como Mmm/AA (ex: Jan/24)
      try {
        const parts = data.split('-');
        const year = Number(parts[0]);
        const month = Number(parts[1]);
        const date = new Date(year, month - 1, 1);
        // Remover possível ponto final da abreviação (ex: "ago.") e capitalizar
        const monthName = date.toLocaleString('pt-BR', { month: 'short' }).replace(/\.$/, '');
        const yearShort = String(year).slice(-2);
        const formattedMonth = monthName.charAt(0).toUpperCase() + monthName.slice(1);
        return `${formattedMonth}/${yearShort}`;
      } catch (e) {
        return data;
      }
    }

    return formatDateBR(data);
  }

  formatarHora(data: string): string {
    return formatTimeBR(data);
  }

  formatarMelhorDia(data: string): string {
    return formatDateYMD(data);
  }

  getMetodoPagamentoNome(metodo: MetodoPagamento): string {
    const nomes = {
      'dinheiro': 'Dinheiro',
      'cartao_credito': 'Cartão de Crédito',
      'cartao_debito': 'Cartão de Débito',
      'pix': 'PIX'
    };
    return nomes[metodo] || metodo;
  }

  getMetodoPagamentoIcone(metodo: MetodoPagamento): string {
    const icones = {
      'dinheiro': '💵',
      'cartao_credito': '💳',
      'cartao_debito': '🏧',
      'pix': '📱'
    };
    return icones[metodo] || '💰';
  }

  absValue(n: number): number { return Math.abs(Number(n) || 0); }

  // Helpers para exibir troca por item com fallback (quando venda tem apenas 1 item)
  getItemExchangeDiff(item: any, venda: any): number {
    try {
      const d = Number(item?.exchange_difference_total ?? 0) || 0;
      if (d !== 0) return d;
      const itensLen = Array.isArray(venda?.itens) ? venda.itens.length : 0;
      if (itensLen === 1) return Number(venda?.exchange_difference_total ?? 0) || 0;
      return 0;
    } catch { return 0; }
  }

  getItemExchangeMethod(item: any, venda: any): string | null {
    try {
      const m = item?.exchange_payment_method;
      if (m) return String(m);
      const itensLen = Array.isArray(venda?.itens) ? venda.itens.length : 0;
      const list = venda?.exchange_payment_methods;
      if (itensLen === 1 && Array.isArray(list) && list.length) return list.join(' / ');
      return null;
    } catch { return null; }
  }

  getImageUrl(imageName: string | null | undefined): string {
    return this.imageService.getImageUrl(imageName);
  }

  onImageError(event: any): void {
    // Se a imagem falhar ao carregar, tentar carregar a imagem padrão
    const fallbackUrl = this.imageService.getImageUrl(null);
    if (event.target.src !== fallbackUrl) {
      event.target.src = fallbackUrl;
    }
  }

  // Enviar nota via email (abre mailto:) — pede email via prompt
  sendNotaByEmail(venda: any): void {
    if (!venda || !venda.id) return;
    const orderId = venda.id;
    const defaultEmail = (venda.customer_email || '') as string;
    const email = window.prompt('Email para enviar a nota:', defaultEmail);
    if (!email) return;
    // attempt update contact (best-effort)
    const payload: any = { customerEmail: email };
    this.apiService.updateOrderContact(orderId, payload).subscribe({ next: () => { }, error: () => { } });

    const pdfUrl = this.apiService.getNotaPdfUrl(orderId);
    const subject = `Comprovante - Pedido #${orderId}`;
    const body = `Segue a nota do seu último pedido na nossa loja:\n\n${pdfUrl}`;
    const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, '_blank');
  }

  // Enviar nota via WhatsApp (abre wa.me) — pede telefone via prompt
  sendNotaByWhatsapp(venda: any): void {
    if (!venda || !venda.id) return;
    const orderId = venda.id;
    const defaultPhone = (venda.customer_phone || '') as string;
    let phone = window.prompt('Telefone (com DDI) para enviar por WhatsApp (ex: 5521999998888):', defaultPhone);
    if (!phone) return;
    phone = phone.replace(/\D/g, '');
    if (!phone.startsWith('55')) {
      if (phone.length <= 11) phone = '55' + phone;
    }
    const payload: any = { customerPhone: phone };
    this.apiService.updateOrderContact(orderId, payload).subscribe({ next: () => { }, error: () => { } });

    const pdfUrl = this.apiService.getNotaPdfUrl(orderId);
    const msg = `Segue a nota do seu último pedido na nossa loja: ${pdfUrl}`;
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
  }

  private getWorkerPath(): string {
    // Em desenvolvimento, usar path direto
    if (window.location.hostname === 'localhost' || window.location.port === '4200') {
      return '/assets/pdfjs/pdf.worker.min.js';
    }

    // Em produção, o frontend é servido pelo backend no contexto /app/
    const baseHref = document.querySelector('base')?.getAttribute('href') || '/';
    if (baseHref.includes('/app/')) {
      return '/app/assets/pdfjs/pdf.worker.min.js';
    }

    // Fallback
    return '/assets/pdfjs/pdf.worker.min.js';
  }
}
