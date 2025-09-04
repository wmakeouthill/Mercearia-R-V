import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, ElementRef, ViewChild, Renderer2 } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-enviar-nota-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './enviar-nota-modal.html',
  styleUrls: ['./enviar-nota-modal.scss']
})
export class EnviarNotaModalComponent implements OnChanges {
  @Input() orderId: number | null = null;
  @Output() close = new EventEmitter<void>();
  @Output() notify = new EventEmitter<{ type: 'success' | 'info' | 'error', message: string }>();

  modalCustomerName = '';
  modalCustomerEmail = '';
  modalCustomerPhone = '';
  previewLoading = false;
  previewBlobUrl: SafeResourceUrl | null = null;
  previewObjectUrl: string | null = null;
  previewHtml: string | null = null;
  objectFailed = false;
  @ViewChild('pdfViewerContainer', { read: ElementRef }) pdfViewerContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('clientInput', { read: ElementRef }) clientInput?: ElementRef<HTMLInputElement>;
  @ViewChild('clientDropdown', { read: ElementRef }) clientDropdown?: ElementRef<HTMLUListElement>;

  // client autocomplete
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

  // PDF.js state
  public pdfScale = 1.4;
  private pdfArrayBuffer: ArrayBuffer | null = null;
  private pdfDoc: any = null;
  private pageObserver: IntersectionObserver | null = null;
  private readonly renderedPages = new Set<number>();

  constructor(
    private readonly apiService: ApiService,
    private readonly sanitizer: DomSanitizer,
    private readonly renderer: Renderer2,
    private readonly notificationService: NotificationService
  ) { }

  onOverlayClick(event: MouseEvent): void {
    // fecha quando clica fora do modal
    if (event.target === event.currentTarget) {
      this.closeModal();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['orderId']) {
      const id = changes['orderId'].currentValue as number | null;
      if (id) {
        this.open(id);
      } else {
        this.reset();
      }
    }
  }

  open(orderId: number): void {
    this.modalCustomerName = '';
    this.modalCustomerEmail = '';
    this.modalCustomerPhone = '';
    this.previewLoading = true;
    this.previewBlobUrl = null;
    this.previewObjectUrl = null;
    this.previewHtml = null;
    this.objectFailed = false;

    this.apiService.getNotaPdf(orderId).subscribe({
      next: (blob: any) => {
        try {
          const pdfBlob = blob as Blob;
          if (!pdfBlob || pdfBlob.size === 0) {
            this.previewLoading = false;
            return;
          }
          if (this.previewObjectUrl) {
            try {
              URL.revokeObjectURL(this.previewObjectUrl);
            } catch (e) {
              console.debug('revokeObjectURL failed', e);
            }
            this.previewObjectUrl = null;
            this.previewBlobUrl = null;
          }
          const url = URL.createObjectURL(pdfBlob);
          this.previewObjectUrl = url;
          this.previewBlobUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
          this.renderPdfJsFromBlob(pdfBlob).catch(e => console.debug('ENVIAR_NOTA render failed', e));
          setTimeout(() => {
            try {
              this.renderPdfJsFromBlob(pdfBlob);
            } catch (e) {
              console.debug('renderPdfJsFromBlob timeout call failed', e);
            }
          }, 60);
        } catch (e) {
          console.error('Falha ao criar preview do PDF', e);
        }
        this.previewLoading = false;
      },
      error: (err) => { console.error('Erro ao obter PDF para preview', err); this.previewLoading = false; }
    });
  }

  reset(): void {
    this.modalCustomerName = '';
    this.modalCustomerEmail = '';
    this.modalCustomerPhone = '';
    this.previewLoading = false;
    this.previewBlobUrl = null;
    this.previewObjectUrl = null;
    this.previewHtml = null;
    this.objectFailed = false;
    this.pdfArrayBuffer = null;
    this.pdfDoc = null;
    this.renderedPages.clear();
  }

  // removed explicit "Salvar" action: creation/association happens on send
  // keep method only for backward compatibility if ever needed
  private saveModalAsCliente(): void {
    // no-op; creation occurs when sending nota via updateOrderContact or via backend
  }

  closeModal(): void {
    this.close.emit();
    if (this.previewObjectUrl) {
      try {
        URL.revokeObjectURL(this.previewObjectUrl);
      } catch (e) {
        console.debug('revokeObjectURL failed', e);
      }
      this.previewObjectUrl = null;
    }
    this.previewBlobUrl = null;
  }

  // client autocomplete
  openClientAutocomplete(): void {
    // cancel any pending hide timers
    if (this.hideDropdownTimer) { clearTimeout(this.hideDropdownTimer); this.hideDropdownTimer = null; }
    this.clientResults = [];
    this.showClientDropdown = true;
    this.clientSearching = true;
    this.apiService.getClientes().subscribe({ next: r => { this.clientResults = r; this.clientSearching = false; setTimeout(() => this.alignDropdownWidth(), 0); }, error: () => { this.clientResults = []; this.clientSearching = false; } });
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
    this.apiService.getClientes(t).subscribe({ next: r => { this.clientResults = r; this.showClientDropdown = true; setTimeout(() => this.alignDropdownWidth(), 0); }, error: () => { this.clientResults = []; } });
  }

  hideClientDropdownDelayed(): void {
    this.hideDropdownTimer = setTimeout(() => { this.showClientDropdown = false; }, 150);
  }

  toggleClientDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showClientDropdown = !this.showClientDropdown;
    if (this.showClientDropdown) {
      this.openClientAutocomplete();
      setTimeout(() => this.alignDropdownWidth(), 0);
    }
  }

  private alignDropdownWidth(): void {
    try {
      if (!this.clientInput || !this.clientDropdown) {
        return;
      }
      const inputEl = this.clientInput.nativeElement as HTMLElement;
      const dropdownEl = this.clientDropdown.nativeElement as HTMLElement;
      // compute left relative to positioned ancestor (offsetParent)
      const inputRect = inputEl.getBoundingClientRect();
      const parent = dropdownEl.offsetParent as HTMLElement | null;
      let offsetLeft = inputEl.offsetLeft;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        offsetLeft = Math.max(0, inputRect.left - parentRect.left + parent.scrollLeft);
      }
      // set exact width to match input (account for box-sizing)
      const inputWidth = inputEl.offsetWidth;
      dropdownEl.style.width = `${inputWidth}px`;
      dropdownEl.style.left = `${offsetLeft}px`;
    } catch (e) { console.debug('alignDropdownWidth failed', e); }
  }

  downloadPreviewPdf(): void {
    if (!this.previewObjectUrl || !this.orderId) return;
    const a = document.createElement('a');
    a.href = this.previewObjectUrl;
    a.download = `nota-${this.orderId}.pdf`;
    a.click();
  }

  printPdf(): void {
    if (!this.previewObjectUrl) {
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.src = String(this.previewObjectUrl);
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

  sendNotaByEmailFromModal(): void {
    if (!this.orderId) return;
    const orderId = this.orderId;
    const contactPayload: any = {};
    if (this.modalCustomerName) contactPayload.customerName = this.modalCustomerName;
    if (this.modalCustomerEmail) contactPayload.customerEmail = this.modalCustomerEmail;
    if (this.modalCustomerPhone) contactPayload.customerPhone = this.modalCustomerPhone;
    if (Object.keys(contactPayload).length > 0) {
      this.apiService.updateOrderContact(orderId, contactPayload).subscribe({ next: () => { }, error: () => { } });
    }
    const to = this.modalCustomerEmail || '';
    if (!to || to.trim().length === 0) { this.notify.emit({ type: 'error', message: 'Informe um e-mail válido para enviar a nota.' }); return; }
    // fecha imediatamente e mostra notificação global informando que o comprovante
    // está sendo preparado/enviado para o e-mail do cliente, para o usuário não ficar preso no modal
    try {
      this.notificationService.notify({ type: 'info', message: 'Comprovante sendo preparado e enviado para o email do cliente.' });
    } catch (e) {
      console.debug('notificationService.notify failed', e);
    }
    this.closeModal();

    // realiza envio em background e notifica sucesso/erro quando terminar
    this.apiService.sendNotaEmail(orderId, { to, subject: `Comprovante - Pedido #${orderId}`, body: 'Segue a nota do seu pedido.' }).subscribe({
      next: () => {
        const msg = `Email enviado com sucesso para ${to}`;
        try {
          this.notify.emit({ type: 'info', message: msg });
        } catch (e) {
          console.debug('emit notify failed', e);
        }
        try {
          this.notificationService.notify({ type: 'success', message: msg });
        } catch (e) {
          console.debug('notificationService.notify failed', e);
        }
      },
      error: (err) => {
        console.error('SEND_NOTA_EMAIL failed', err);
        const msg = err?.error?.message || 'Falha ao enviar email';
        try {
          this.notify.emit({ type: 'error', message: msg });
        } catch (e) {
          console.debug('emit notify failed', e);
        }
        try {
          this.notificationService.notify({ type: 'error', message: msg });
        } catch (e) {
          console.debug('notificationService.notify failed', e);
        }
      }
    });
  }

  sendNotaByWhatsappFromModal(): void {
    if (!this.orderId) {
      return;
    }
    const orderId = this.orderId;
    const contactPayload: any = {};
    if (this.modalCustomerName) contactPayload.customerName = this.modalCustomerName;
    if (this.modalCustomerEmail) contactPayload.customerEmail = this.modalCustomerEmail;
    if (this.modalCustomerPhone) contactPayload.customerPhone = this.modalCustomerPhone;
    if (Object.keys(contactPayload).length > 0) { this.apiService.updateOrderContact(orderId, contactPayload).subscribe({ next: () => { }, error: () => { } }); }
    let phone = (this.modalCustomerPhone || '').replace(/\D/g, '');
    if (!phone) {
      this.notify.emit({ type: 'error', message: 'Informe um telefone válido para enviar via WhatsApp.' });
      return;
    }
    if (!phone.startsWith('55')) {
      if (phone.length <= 11) {
        phone = '55' + phone;
      }
    }

    // Aviso imediato ao usuário
    try {
      this.notificationService.notify({ type: 'info', message: 'Baixando o PDF do comprovante e abrindo o WhatsApp...' });
    } catch (e) {
      console.debug('notificationService.notify failed', e);
    }

    // 1) Baixar o PDF para a pasta de downloads com um nome amigável
    const filename = `nota-${orderId}.pdf`;
    let startedDownload = false;
    try {
      if (this.previewObjectUrl) {
        const a = document.createElement('a');
        a.href = String(this.previewObjectUrl);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        startedDownload = true;
      }
    } catch (e) {
      console.debug('WA download via previewObjectUrl failed', e);
    }
    if (!startedDownload) {
      this.apiService.getNotaPdf(orderId).subscribe({
        next: (blob: any) => {
          try {
            const url = window.URL.createObjectURL(blob as Blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => { try { window.URL.revokeObjectURL(url); } catch { } }, 4000);
          } catch (err) {
            console.error('WA fallback download failed', err);
          }
        },
        error: (err) => {
          console.error('GET_NOTA_PDF for WA failed', err);
        }
      });
    }

    // 2) Abrir WhatsApp Web já com a mensagem padrão
    const msg = 'Segue a nota do seu pedido na nossa loja.';
    const waUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`;
    try {
      const api = (window as any).electronAPI;
      if (api && typeof api.openExternal === 'function') {
        api.openExternal(waUrl).catch(() => { window.open(waUrl, '_blank'); });
      } else {
        window.open(waUrl, '_blank');
      }
    } catch (e) {
      try { window.open(waUrl, '_blank'); } catch { }
    }

    // 3) Fechar o modal após breve atraso para garantir início do download
    setTimeout(() => {
      try { this.closeModal(); } catch { }
      try {
        this.notificationService.notify({ type: 'info', message: `WhatsApp aberto e PDF salvo como ${filename}` });
      } catch (e) {
        console.debug('notificationService.notify failed', e);
      }
    }, 500);
  }

  zoomIn(): void {
    this.pdfScale = Math.min(this.pdfScale + 0.2, 3);
    this.reRenderPdf();
  }

  zoomOut(): void {
    this.pdfScale = Math.max(this.pdfScale - 0.2, 0.6);
    this.reRenderPdf();
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

  async fitWidth(): Promise<void> {
    if (!this.pdfViewerContainer) {
      return;
    }
    const containerWidth = this.pdfViewerContainer.nativeElement.clientWidth || 420;
    const firstCanvas = this.pdfViewerContainer.nativeElement.querySelector('.pdf-page-canvas') as HTMLCanvasElement | null;
    if (!firstCanvas) {
      return;
    }
    const intrinsic = firstCanvas.width || (firstCanvas.getBoundingClientRect().width || containerWidth);
    const newScale = Math.max(0.6, Math.min(3, containerWidth / intrinsic * this.pdfScale));
    this.pdfScale = Number(newScale.toFixed(2));
    await this.reRenderPdf();
  }

  private async reRenderPdf(): Promise<void> {
    try {
      if (!this.pdfViewerContainer) {
        return;
      }
      if (!this.pdfDoc) {
        if (!this.pdfArrayBuffer) {
          return;
        }

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
      this.cleanupObserverAndSlots();
      this.pdfViewerContainer.nativeElement.innerHTML = '';
      this.renderedPages.clear();
      if (this.pdfDoc.numPages === 1) {
        await this.renderSinglePage(1);
        return;
      }
      this.setupPlaceholders(this.pdfDoc.numPages);
    } catch (e) {
      console.error('reRenderPdf failed', e);
    }
  }

  private async renderPdfJsFromBlob(pdfBlob: Blob): Promise<void> {
    try {
      if (!this.pdfViewerContainer) return;
      this.cleanupObserverAndSlots();
      this.pdfViewerContainer.nativeElement.innerHTML = '';
      const arrayBuffer = await pdfBlob.arrayBuffer();

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

      const loadingTask = getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      this.pdfArrayBuffer = arrayBuffer; this.pdfDoc = pdf; this.renderedPages.clear();
      if (pdf.numPages === 1) { await this.renderSinglePage(1); return; }
      this.setupPlaceholders(pdf.numPages);
    } catch (e) { console.error('PDF.js render failed', e); }
  }

  private async renderSinglePage(pageNum: number): Promise<void> {
    if (!this.pdfDoc || !this.pdfViewerContainer) {
      return;
    }
    if (this.renderedPages.has(pageNum)) {
      return;
    }
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.pdfScale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = 'pdf-page-canvas';
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      await page.render({ canvasContext: ctx, viewport }).promise;
      this.pdfViewerContainer.nativeElement.appendChild(canvas);
      this.renderedPages.add(pageNum);
    } catch (e) {
      console.error('renderSinglePage failed', e);
    }
  }

  private setupPlaceholders(numPages: number): void {
    if (!this.pdfViewerContainer) {
      return;
    }
    const container = this.pdfViewerContainer.nativeElement;
    const options: IntersectionObserverInit = { root: container, rootMargin: '400px', threshold: 0.1 };
    this.pageObserver = new IntersectionObserver((entries) => {
      entries.forEach(ent => {
        if (ent.isIntersecting) {
          const slot = ent.target as HTMLElement;
          const pageAttr = slot.getAttribute('data-page');
          if (!pageAttr) {
            return;
          }
          const pageNum = Number(pageAttr);
          this.renderPageIfNeeded(pageNum).catch(e => console.error('renderPageIfNeeded failed', e));
        }
      });
    }, options);
    for (let p = 1; p <= numPages; p++) {
      const slot = document.createElement('div');
      slot.className = 'pdf-page-slot';
      slot.setAttribute('data-page', String(p));
      slot.style.minHeight = '360px';
      slot.style.display = 'flex';
      slot.style.alignItems = 'center';
      slot.style.justifyContent = 'center';
      slot.style.marginBottom = '12px';
      slot.innerHTML = `<div class="page-loading">Carregando página ${p}...</div>`;
      container.appendChild(slot);
      if (this.pageObserver) {
        this.pageObserver.observe(slot);
      }
    }
  }

  private async renderPageIfNeeded(pageNum: number): Promise<void> {
    if (!this.pdfDoc || !this.pdfViewerContainer) {
      return;
    }
    if (this.renderedPages.has(pageNum)) {
      return;
    }
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: this.pdfScale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = 'pdf-page-canvas';
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      await page.render({ canvasContext: ctx, viewport }).promise;
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
      console.debug('cleanupObserverAndSlots failed', e);
    }
    this.renderedPages.clear();
  }
}


