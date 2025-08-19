import { Component, OnInit, ElementRef, Renderer2, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
// pdfjs will be dynamically imported to avoid breaking lazy-loaded route initialization

@Component({
  selector: 'app-relatorio-vendas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './relatorio-vendas.html',
  styleUrl: './relatorio-vendas.scss'
})
export class RelatorioVendasComponent implements OnInit {
  vendas: Venda[] = [];
  private vendasLegado: Venda[] = [];
  private vendasCheckout: Venda[] = [];
  vendasFiltradas: any[] = [];
  expandedRows = new Set<string>();
  relatorioDiario: RelatorioVendas[] = [];
  relatorioMensal: RelatorioVendas[] = [];
  resumoDia?: RelatorioResumo;
  resumoMes?: RelatorioResumo;
  filtroPeriodo: 'dia' | 'mes' = 'dia';
  filtroData: string = '';
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

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly imageService: ImageService,
    private readonly router: Router,
    private readonly sanitizer: DomSanitizer,
    private readonly renderer: Renderer2
  ) { }

  // Modal reuse from PontoVendaComponent logic: show preview modal
  showEnviarModal = false;
  modalOrderId: number | null = null;
  modalCustomerName = '';
  modalCustomerEmail = '';
  modalCustomerPhone = '';
  previewLoading = false;
  previewBlobUrl: SafeResourceUrl | null = null;
  previewObjectUrl: string | null = null;
  @ViewChild('previewObject') previewObjectRef?: ElementRef<HTMLObjectElement>;
  @ViewChild('pdfViewerContainer', { read: ElementRef }) pdfViewerContainer?: ElementRef<HTMLDivElement>;
  previewHtml: string | null = null;
  objectFailed = false;
  // PDF.js state
  private pdfArrayBuffer: ArrayBuffer | null = null;
  public pdfScale = 1.4;
  private pdfDoc: any = null;
  private pageObserver: IntersectionObserver | null = null;
  private renderedPages = new Set<number>();

  ngOnInit(): void {
    logger.info('RELATORIO_VENDAS', 'INIT', 'Componente iniciado');
    this.isAdmin = this.authService.isAdmin();
    // por padrão não filtrar por data para mostrar todas as vendas
    this.filtroData = '';
    this.loadVendas();
    this.loadResumos();
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
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf');

      // Configure workerSrc to avoid "No GlobalWorkerOptions.workerSrc specified" error.
      try {
        (pdfjsLib as any).GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.js';
      } catch (e) {
        console.warn('Could not set pdfjs workerSrc via GlobalWorkerOptions', e);
      }

      const loadingTask = (pdfjsLib as any).getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;

      // save arrayBuffer and pdfDoc for zoom/pan operations and render-on-demand
      this.pdfArrayBuffer = arrayBuffer;
      this.pdfDoc = pdf;
      this.renderedPages.clear();

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
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf');
        (pdfjsLib as any).GlobalWorkerOptions.workerSrc = '/assets/pdfjs/pdf.worker.min.js';
        const loadingTask = (pdfjsLib as any).getDocument({ data: this.pdfArrayBuffer });
        this.pdfDoc = await loadingTask.promise;
      }

      // clear previous slots/observer and recreate placeholders so observer will render visible pages
      this.cleanupObserverAndSlots();
      this.pdfViewerContainer.nativeElement.innerHTML = '';
      this.renderedPages.clear();
      this.setupPlaceholders(this.pdfDoc.numPages);
    } catch (e) {
      console.error('reRenderPdf failed', e);
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

    const pdfUrl = this.apiService.getNotaPdfUrl(orderId);
    const subject = `Comprovante - Pedido #${orderId}`;
    const body = `Segue a nota do seu último pedido na nossa loja:\n\n${pdfUrl}`;
    const mailto = `mailto:${encodeURIComponent(this.modalCustomerEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, '_blank');
    this.closeEnviarModal();
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
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
    this.closeEnviarModal();
  }
  loadResumos(): void {
    this.apiService.getResumoDia().subscribe({
      next: (res) => {
        this.resumoDia = res;
      },
      error: () => { }
    });
    this.apiService.getResumoMesAtual().subscribe({
      next: (res) => {
        this.resumoMes = res;
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
        const metodoResumo = this.buildPagamentoResumo(pagamentos);
        const metodosSet = new Set<MetodoPagamento>();
        for (const p of pagamentos) if (p?.metodo) metodosSet.add(p.metodo);

        const totalQuantidade = Array.isArray(itens) ? itens.reduce((s: number, it: any) => s + (Number(it.quantidade) || 0), 0) : 0;
        let totalValor = (v.total_final ?? v.totalFinal ?? 0) as number;
        if (!totalValor || totalValor === 0) {
          totalValor = Array.isArray(itens) ? itens.reduce((s: number, it: any) => s + (Number(it.preco_total || it.precoTotal) || 0), 0) : 0;
        }

        const produtoNome = Array.isArray(itens) && itens.length > 0
          ? itens.map((it: any) => it.produto_nome || it.produtoNome || '').join(', ')
          : (`Pedido #${v.id} (${itens.length} itens)`);

        const produtoImagem = Array.isArray(itens) && itens.length > 0 ? itens[0].produto_imagem : null;

        const linha: Venda = {
          id: v.id,
          produto_id: v.id,
          quantidade_vendida: totalQuantidade,
          preco_total: totalValor,
          data_venda: data,
          metodo_pagamento: 'dinheiro',
          produto_nome: produtoNome,
          produto_imagem: produtoImagem,
          pagamentos_resumo: metodoResumo,
        } as any;
        (linha as any).itens = itens;
        (linha as any).metodos_multi = Array.from(metodosSet);
        (linha as any).row_id = `checkout-${v.id}-${rowCounter++}`;
        (linha as any)._isCheckout = true;
        linhas.push(linha);

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
      this.loading = false;
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
    const list = vendasFiltradas ?? this.computeVendasFiltradas();
    this.totalVendas = list.length;
    this.receitaTotal = list.reduce((total, venda) => total + venda.preco_total, 0);
    this.mediaVendas = this.totalVendas > 0 ? this.receitaTotal / this.totalVendas : 0;

    // Encontrar melhor dia
    const vendasPorDia = list.reduce((acc, venda) => {
      const data = extractLocalDate(venda.data_venda);
      if (!acc[data]) {
        acc[data] = 0;
      }
      acc[data] += venda.preco_total;
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
    const list = vendasFiltradas ?? this.computeVendasFiltradas();
    const vendasPorDia = list.reduce((acc, venda) => {
      const data = extractLocalDate(venda.data_venda);
      if (!acc[data]) {
        acc[data] = {
          data: data,
          total_vendas: 0,
          quantidade_vendida: 0,
          receita_total: 0
        };
      }
      acc[data].total_vendas++;
      acc[data].quantidade_vendida += venda.quantidade_vendida;
      acc[data].receita_total += venda.preco_total;
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
    const list = vendasFiltradas ?? this.computeVendasFiltradas();
    const vendasPorMes = list.reduce((acc, venda) => {
      const mes = extractYearMonth(venda.data_venda);

      if (!acc[mes]) {
        acc[mes] = {
          data: mes,
          total_vendas: 0,
          quantidade_vendida: 0,
          receita_total: 0
        };
      }
      acc[mes].total_vendas++;
      acc[mes].quantidade_vendida += venda.quantidade_vendida;
      acc[mes].receita_total += venda.preco_total;
      return acc;
    }, {} as Record<string, RelatorioVendas>);

    this.relatorioMensal = Object.values(vendasPorMes).sort((a, b) => b.data.localeCompare(a.data));
  }

  aplicarFiltros(): void {
    this.vendasFiltradas = this.computeVendasFiltradas();
    this.calcularEstatisticas(this.vendasFiltradas);
    this.gerarRelatorios(this.vendasFiltradas);
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
      `R$ ${item.receita_total.toFixed(2)}`
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

  private ordenarPorDataEId(a: Venda, b: Venda): number {
    const timeDiff = parseDate(b.data_venda).getTime() - parseDate(a.data_venda).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (b.id || 0) - (a.id || 0);
  }

  private passaFiltroData(venda: Venda): boolean {
    if (!this.filtroData) return true;
    try {
      const vendaDataLocal = extractLocalDate(venda.data_venda);
      return vendaDataLocal === this.filtroData;
    } catch (error) {
      logger.warn('RELATORIO_VENDAS', 'FILTER_INVALID_DATE', 'Data de venda inválida ao aplicar filtro', { venda, error: String(error) });
      return false;
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
    let phone = window.prompt('Telefone (com DDI) para enviar por WhatsApp (ex: 5511999998888):', defaultPhone);
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
}
