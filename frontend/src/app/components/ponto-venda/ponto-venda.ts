import { Component, OnInit, OnDestroy, HostListener, ElementRef, Renderer2, ViewChild } from '@angular/core';
import { EnviarNotaModalComponent } from '../enviar-nota-modal/enviar-nota-modal';
import { ConfirmModalComponent } from '../confirm-modal/confirm-modal';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { CaixaService } from '../../services/caixa.service';
import { ImageService } from '../../services/image.service';
import { Produto, ItemVenda, MetodoPagamento, StatusCaixa, Pagamento, CheckoutItem } from '../../models';
import { Subject, debounceTime, distinctUntilChanged, Subscription } from 'rxjs';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-ponto-venda',
  standalone: true,
  imports: [CommonModule, FormsModule, EnviarNotaModalComponent, ConfirmModalComponent],
  templateUrl: './ponto-venda.html',
  styleUrl: './ponto-venda.scss'
})
export class PontoVendaComponent implements OnInit, OnDestroy {
  produtos: Produto[] = [];
  produtosFiltrados: Produto[] = [];
  carrinho: ItemVenda[] = [];
  produtoSelecionado: Produto | null = null;
  quantidade: number = 1;
  termoPesquisa: string = '';
  metodoPagamentoSelecionado: MetodoPagamento = 'dinheiro';
  pagamentos: Pagamento[] = [];
  loading = false;
  error = '';
  sucesso = '';
  showModernNotification = false;
  modernNotificationMessage = '';
  // Modal para envio de nota (usaremos componente compartilhado)
  showEnviarModal = false;
  modalOrderId: number | null = null;
  modalCustomerName = '';
  modalCustomerEmail = '';
  modalCustomerPhone = '';
  // confirmation modal state
  showConfirmModal = false;
  pendingOrderId: number | null = null;
  confirmMessage = '';
  // Cliente autocomplete
  clientSearchTerm = '';
  clientResults: any[] = [];
  clientSearching = false;
  private clientSearchSubject = new Subject<string>();
  showClientDropdown = false;
  private hideDropdownTimer: any = null;
  clientDropdownIndex = -1;

  onClientDropdownKeydown(event: KeyboardEvent): void {
    const len = this.clientResults?.length || 0;
    if (!this.showClientDropdown || len === 0) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); this.clientDropdownIndex = Math.min(len - 1, (this.clientDropdownIndex || 0) + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.clientDropdownIndex = Math.max(0, (this.clientDropdownIndex || 0) - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); if (this.clientDropdownIndex >= 0 && this.clientDropdownIndex < len) this.selectClient(this.clientResults[this.clientDropdownIndex]); }
    else if (event.key === 'Escape') { this.showClientDropdown = false; }
  }
  // Preview do PDF
  previewLoading = false;
  previewBlobUrl: string | null = null;
  previewObjectUrl: string | null = null;
  previewHtml: string | null = null;
  @ViewChild('previewObject') previewObjectRef?: ElementRef<HTMLObjectElement>;

  metodosDisponiveis: { valor: MetodoPagamento, nome: string, icone: string }[] = [
    { valor: 'dinheiro', nome: 'Dinheiro', icone: '💵' },
    { valor: 'cartao_credito', nome: 'Cartão de Crédito', icone: '💳' },
    { valor: 'cartao_debito', nome: 'Cartão de Débito', icone: '🏧' },
    { valor: 'pix', nome: 'PIX', icone: '📱' }
  ];

  getMetodoPagamentoNome(metodo: MetodoPagamento): string {
    const nomes: Record<MetodoPagamento, string> = {
      'dinheiro': 'Dinheiro',
      'cartao_credito': 'Cartão de Crédito',
      'cartao_debito': 'Cartão de Débito',
      'pix': 'PIX'
    };
    return nomes[metodo] || metodo;
  }

  getMetodoLabelCurto(metodo: MetodoPagamento): string {
    const curtos: Record<MetodoPagamento, string> = {
      'dinheiro': 'Dinheiro',
      'cartao_credito': 'Crédito',
      'cartao_debito': 'Débito',
      'pix': 'PIX'
    };
    return curtos[metodo] || this.getMetodoPagamentoNome(metodo);
  }

  adicionarPagamento(metodo?: MetodoPagamento): void {
    const total = this.getTotalCarrinho();
    const somaAtual = this.pagamentos.reduce((sum, p) => sum + (p.valor || 0), 0);
    const restante = Math.max(total - somaAtual, 0);
    this.pagamentos.push({ metodo: metodo || 'dinheiro', valor: Number(restante.toFixed(2)) });
  }

  removerPagamento(index: number): void {
    this.pagamentos.splice(index, 1);
  }

  getTotalPagamentos(): number {
    return this.pagamentos.reduce((sum, p) => sum + (p.valor || 0), 0);
  }

  isPagamentoValido(): boolean {
    const total = this.getTotalCarrinho();
    // Comparação em centavos (tolerância zero) para exigir igualdade exata em centavos
    const diferencaCentavos = Math.round((this.getTotalPagamentos() - total) * 100);
    return diferencaCentavos === 0 && this.pagamentos.length > 0;
  }

  /** Retorna quanto falta para cobrir o total (em reais), arredondado a centavos */
  getFaltaTotal(): number {
    const total = this.getTotalCarrinho();
    const faltaCentavos = Math.round((total - this.getTotalPagamentos()) * 100);
    return faltaCentavos > 0 ? faltaCentavos / 100 : 0;
  }

  /**
   * Indica se o usuário pode finalizar a venda.
   * Regras:
   * - Deve haver itens no carrinho
   * - Total do carrinho deve ser maior que zero
   * - Se houver pagamentos detalhados, a soma deve ser igual ao total
   * - Se não houver pagamentos detalhados, deve existir um método de pagamento selecionado
   */
  get podeFinalizar(): boolean {
    const total = this.getTotalCarrinho();
    if (this.carrinho.length === 0) return false;
    if (total <= 0) return false;

    // Exige que haja ao menos um pagamento (pode ser único) e que a soma bata com o total
    if (this.pagamentos.length > 0) {
      return this.isPagamentoValido();
    }

    // Sem pagamentos explícitos, não permite finalizar — exige que o operador adicione um pagamento
    return false;
  }

  private readonly searchSubject = new Subject<string>();
  private statusCaixaSubscription?: Subscription;
  private periodicCheckInterval?: any;
  statusCaixa: StatusCaixa | null = null;
  isAdmin = false;
  podeControlarCaixa = false;

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly caixaService: CaixaService,
    private readonly imageService: ImageService,
    private readonly router: Router,
    private readonly renderer: Renderer2
  ) { }

  onConfirmSend(): void {
    this.showConfirmModal = false;
    if (this.pendingOrderId) {
      this.openEnviarModal(this.pendingOrderId);
      this.pendingOrderId = null;
    }
  }

  onCancelSend(): void {
    this.showConfirmModal = false;
    this.pendingOrderId = null;
  }

  ngOnInit(): void {
    logger.info('PONTO_VENDA', 'INIT', 'Componente iniciado');
    this.isAdmin = this.authService.isAdmin();
    this.podeControlarCaixa = this.authService.podeControlarCaixa();
    this.checkCaixaStatus();
    this.setupCaixaMonitoring();
    this.setupPeriodicCaixaCheck();
    this.loadProdutos();
    this.setupSearch();
    this.setupClientSearch();
  }

  private setupClientSearch(): void {
    this.clientSearchSubject.pipe(debounceTime(300), distinctUntilChanged()).subscribe(term => {
      const t = (term || '').trim();
      if (!t) {
        this.clientResults = [];
        this.clientSearching = false;
        return;
      }
      this.clientSearching = true;
      this.apiService.getClientes(t).subscribe({ next: r => { this.clientResults = r; this.clientSearching = false; this.showClientDropdown = true; }, error: () => { this.clientResults = []; this.clientSearching = false; } });
    });
  }

  onClientSearchChange(): void {
    this.clientSearchSubject.next(this.clientSearchTerm);
  }

  selectClient(c: any): void {
    this.modalCustomerName = c.nome || '';
    this.modalCustomerEmail = c.email || '';
    this.modalCustomerPhone = c.telefone || '';
    this.clientResults = [];
    this.clientSearchTerm = '';
    this.showClientDropdown = false;
  }

  onClientNameChange(): void {
    const t = (this.modalCustomerName || '').trim();
    if (!t) { this.clientResults = []; this.showClientDropdown = true; return; }
    this.apiService.getClientes(t).subscribe({ next: r => { this.clientResults = r; this.showClientDropdown = true; }, error: () => { this.clientResults = []; } });
  }

  hideClientDropdownDelayed(): void {
    this.hideDropdownTimer = setTimeout(() => { this.showClientDropdown = false; }, 150);
  }

  saveModalAsCliente(): void {
    const payload: any = { nome: this.modalCustomerName, email: this.modalCustomerEmail, telefone: this.modalCustomerPhone };
    if (!payload.nome) { alert('Nome é obrigatório para salvar cliente'); return; }
    this.apiService.createCliente(payload).subscribe({ next: () => { this.showModernNotification = true; this.modernNotificationMessage = 'Cliente criado com sucesso'; setTimeout(() => this.hideModernNotification(), 3000); }, error: (e) => { this.error = 'Erro ao criar cliente'; console.error(e); } });
  }

  ngOnDestroy(): void {
    this.searchSubject.complete();
    if (this.statusCaixaSubscription) {
      this.statusCaixaSubscription.unsubscribe();
    }
    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval);
    }
  }

  /**
   * Verifica o status inicial do caixa
   */
  private checkCaixaStatus(): void {
    // Se é admin, sempre pode usar o ponto de venda
    if (this.isAdmin) {
      return;
    }

    this.caixaService.getStatusCaixa().subscribe({
      next: (status) => {
        this.statusCaixa = status;
        if (!status.aberto) {
          this.redirectToDashboard('O caixa está fechado. Você foi redirecionado para o dashboard.');
        }
      },
      error: (error) => {
        logger.error('PONTO_VENDA', 'CHECK_CAIXA', 'Erro ao verificar status do caixa', error);
        this.redirectToDashboard('Erro ao verificar status do caixa. Você foi redirecionado para o dashboard.');
      }
    });
  }

  /**
   * Monitora mudanças no status do caixa em tempo real
   */
  private setupCaixaMonitoring(): void {
    // Se é admin, não precisa monitorar
    if (this.isAdmin) {
      return;
    }

    this.statusCaixaSubscription = this.caixaService.statusCaixa$.subscribe(status => {
      if (status) {
        this.statusCaixa = status;
        // Se o caixa foi fechado enquanto o usuário estava usando o ponto de venda
        if (!status.aberto) {
          this.redirectToDashboard('O caixa foi fechado. Você foi redirecionado para o dashboard.');
        }
      }
    });
  }

  /**
   * Configura verificação periódica do status do caixa (a cada 30 segundos)
   */
  private setupPeriodicCaixaCheck(): void {
    // Se é admin, não precisa verificar periodicamente
    if (this.isAdmin) {
      return;
    }

    this.periodicCheckInterval = setInterval(() => {
      this.caixaService.getStatusCaixa().subscribe({
        next: (status) => {
          this.statusCaixa = status;
          if (!status.aberto) {
            this.redirectToDashboard('O caixa foi fechado automaticamente. Você foi redirecionado para o dashboard.');
          }
        },
        error: (error) => {
          logger.warn('PONTO_VENDA', 'CHECK_CAIXA_PERIODICO', 'Erro na verificação periódica do caixa', error);
        }
      });
    }, 30000); // Verificar a cada 30 segundos
  }

  /**
   * Redireciona para o dashboard com mensagem
   */
  private redirectToDashboard(message: string): void {
    this.router.navigate(['/dashboard'], {
      queryParams: { error: 'caixa_fechado', message: message }
    });
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // Adicionar ao carrinho com Enter quando há produto selecionado
    if (event.key === 'Enter' && this.produtoSelecionado) {
      event.preventDefault();
      this.adicionarAoCarrinho(true); // Manter seleção ao usar Enter
    }
  }

  @HostListener('document:click', ['$event'])
  handleClickOutside(event: MouseEvent) {
    // Desselecionar produto ao clicar fora da área de produtos
    const target = event.target as HTMLElement;
    const produtoCard = target.closest('.produto-card');
    const selecaoProdutos = target.closest('.selecao-produtos');

    // Se clicou fora da seção de produtos ou fora de qualquer card de produto
    if (!selecaoProdutos || (!produtoCard && selecaoProdutos)) {
      this.produtoSelecionado = null;
      this.quantidade = 1;
    }
  }

  setupSearch(): void {
    this.searchSubject
      .pipe(
        debounceTime(500), // 0.5 segundos de debounce
        distinctUntilChanged()
      )
      .subscribe(termo => {
        this.filtrarProdutos(termo);
      });
  }

  loadProdutos(): void {
    this.loading = true;
    this.error = '';

    this.apiService.getProdutos().subscribe({
      next: (produtos) => {
        this.produtos = produtos;
        this.produtosFiltrados = produtos; // Inicializa com todos os produtos
        this.loading = false;
        logger.info('PONTO_VENDA', 'LOAD_PRODUTOS', 'Produtos carregados', { count: produtos.length });
      },
      error: (error) => {
        this.error = 'Erro ao carregar produtos';
        this.loading = false;
        logger.error('PONTO_VENDA', 'LOAD_PRODUTOS', 'Erro ao carregar produtos', error);
      }
    });
  }

  onSearchChange(): void {
    this.searchSubject.next(this.termoPesquisa);
  }

  filtrarProdutos(termo: string): void {
    if (!termo.trim()) {
      this.produtosFiltrados = this.produtos;
      return;
    }

    const termoLower = termo.toLowerCase();
    this.produtosFiltrados = this.produtos.filter(produto =>
      produto.nome.toLowerCase().includes(termoLower) ||
      produto.codigo_barras?.toLowerCase().includes(termoLower)
    );
  }

  selecionarProduto(produto: Produto): void {
    this.produtoSelecionado = produto;
    this.quantidade = 1;
    this.error = '';
  }

  increaseQuantidadeSelecionada(maximo: number): void {
    const atual = Number(this.quantidade || 1);
    this.quantidade = Math.min(maximo, atual + 1);
  }

  decreaseQuantidadeSelecionada(): void {
    const atual = Number(this.quantidade || 1);
    this.quantidade = Math.max(1, atual - 1);
  }

  adicionarAoCarrinho(manterSelecao: boolean = false): void {
    // Verificar se o caixa está aberto (proteção adicional)
    if (!this.isAdmin && this.statusCaixa && !this.statusCaixa.aberto) {
      this.redirectToDashboard('O caixa foi fechado. Não é possível adicionar produtos ao carrinho.');
      return;
    }

    if (!this.produtoSelecionado) {
      this.error = 'Selecione um produto';
      return;
    }

    if (this.quantidade <= 0) {
      this.error = 'Quantidade deve ser maior que zero';
      return;
    }

    if (this.quantidade > this.produtoSelecionado.quantidade_estoque) {
      this.error = 'Quantidade insuficiente em estoque';
      return;
    }

    // Verificar se o produto já está no carrinho
    const itemExistente = this.carrinho.find(item => item.produto.id === this.produtoSelecionado!.id);

    if (itemExistente) {
      const novaQuantidade = itemExistente.quantidade + this.quantidade;
      if (novaQuantidade > this.produtoSelecionado.quantidade_estoque) {
        this.error = 'Quantidade total excede o estoque disponível';
        return;
      }
      itemExistente.quantidade = novaQuantidade;
      itemExistente.preco_total = itemExistente.quantidade * itemExistente.produto.preco_venda;
    } else {
      const novoItem: ItemVenda = {
        produto: this.produtoSelecionado,
        quantidade: this.quantidade,
        preco_unitario: this.produtoSelecionado.preco_venda,
        preco_total: this.quantidade * this.produtoSelecionado.preco_venda
      };
      this.carrinho.push(novoItem);
    }

    // Só desseleciona se não for para manter a seleção (quando clica no botão)
    if (!manterSelecao) {
      this.produtoSelecionado = null;
    }
    this.quantidade = 1;
    this.error = '';
    this.sucesso = 'Produto adicionado ao carrinho';
    setTimeout(() => this.sucesso = '', 2000);
    logger.info('PONTO_VENDA', 'ADD_CARRINHO', 'Produto adicionado ao carrinho', {
      produto_id: this.produtoSelecionado?.id,
      quantidade: this.quantidade
    });
  }

  removerDoCarrinho(index: number): void {
    this.carrinho.splice(index, 1);
  }

  atualizarQuantidade(item: ItemVenda, novaQuantidade: number): void {
    if (novaQuantidade <= 0) {
      this.removerDoCarrinho(this.carrinho.indexOf(item));
      return;
    }

    if (novaQuantidade > item.produto.quantidade_estoque) {
      this.error = 'Quantidade excede o estoque disponível';
      return;
    }

    item.quantidade = novaQuantidade;
    item.preco_total = novaQuantidade * item.preco_unitario;
  }

  getTotalCarrinho(): number {
    return this.carrinho.reduce((total, item) => total + item.preco_total, 0);
  }

  finalizarVenda(): void {
    // Verificar se o caixa está aberto (proteção adicional)
    if (!this.isAdmin && this.statusCaixa && !this.statusCaixa.aberto) {
      this.redirectToDashboard('O caixa foi fechado. Não é possível finalizar vendas.');
      return;
    }

    if (this.carrinho.length === 0) {
      this.error = 'Carrinho vazio';
      return;
    }

    if (!this.podeFinalizar) {
      this.error = 'Defina o(s) pagamento(s) com valor igual ao total antes de finalizar a venda';
      return;
    }

    this.loading = true;
    this.error = '';

    // Se houver pagamentos preenchidos, usar checkout único
    if (this.pagamentos.length > 0) {
      if (!this.isPagamentoValido()) {
        this.error = 'Soma dos pagamentos deve ser igual ao total';
        this.loading = false;
        return;
      }

      const itens: CheckoutItem[] = this.carrinho.map(item => ({
        produtoId: item.produto.id!,
        quantidade: item.quantidade,
        precoUnitario: item.preco_unitario,
      }));

      const checkout = {
        itens,
        pagamentos: this.pagamentos.map(p => ({ metodo: p.metodo, valor: Number(p.valor) })),
      };

      const totalVenda = this.getTotalCarrinho();
      this.apiService.createVendaWithItens(checkout).subscribe({
        next: (res: any) => {
          const orderId = res?.id;
          this.carrinho = [];
          this.pagamentos = [];
          this.loading = false;
          setTimeout(() => this.loadProdutos(), 500);
          // Mostrar notificação de venda finalizada e perguntar ao usuário se deseja enviar a nota
          this.showModernNotification = true;
          this.modernNotificationMessage = `Venda finalizada com sucesso! Total: R$ ${totalVenda.toFixed(2)}`;
          setTimeout(() => this.hideModernNotification(), 5000);

          if (orderId) {
            // Perguntar ao usuário se deseja enviar a nota; se confirmar, abrir o modal de envio
            // Usamos um confirm simples aqui para manter o fluxo leve; o modal de envio permite
            // escolher envio por WhatsApp ou email, conforme já implementado em openEnviarModal
            // abrir modal de confirmação customizado
            setTimeout(() => {
              this.pendingOrderId = orderId;
              this.confirmMessage = `Venda finalizada com sucesso! Total: R$ ${totalVenda.toFixed(2)}. Deseja enviar a nota por WhatsApp ou Email para o cliente?`;
              this.showConfirmModal = true;
            }, 200);
          }
        },
        error: (error: any) => {
          this.error = 'Erro ao finalizar venda';
          this.loading = false;
          logger.error('PONTO_VENDA', 'CHECKOUT_FAIL', 'Erro no checkout', error);
        }
      });
      return;
    }

    // Caso contrário, processar cada item como venda separada (legado)
    const vendas = this.carrinho.map(item => ({
      produto_id: item.produto.id!,
      quantidade_vendida: item.quantidade,
      preco_total: item.produto.preco_venda * item.quantidade,
      data_venda: new Date().toISOString(),
      metodo_pagamento: this.metodoPagamentoSelecionado
    }));

    // Processar vendas sequencialmente com delay para evitar ERR_CONNECTION_RESET
    let processadas = 0;
    let erros = 0;
    const total = vendas.length;
    const totalVenda = this.getTotalCarrinho();

    const processarVenda = (index: number) => {
      if (index >= vendas.length) {
        if (processadas > 0) {
          this.showModernNotification = true;
          this.modernNotificationMessage = `Venda finalizada com sucesso! ${processadas}/${total} itens processados. Total: R$ ${totalVenda.toFixed(2)}`;
          this.carrinho = [];
          this.loading = false;

          // Recarregar produtos para atualizar estoque
          setTimeout(() => {
            this.loadProdutos();
          }, 500);

          // Remover notificação após 5 segundos
          setTimeout(() => {
            this.hideModernNotification();
          }, 5000);
        } else {
          this.error = 'Erro ao finalizar venda - nenhum item foi processado';
          this.loading = false;
        }
        return;
      }

      const venda = vendas[index];

      // Delay entre requisições para evitar sobrecarga
      setTimeout(() => {
        this.apiService.createVenda(venda).subscribe({
          next: () => {
            processadas++;
            logger.info('PONTO_VENDA', 'VENDA_ITEM_OK', `Item ${index + 1}/${total} processado com sucesso`);
            processarVenda(index + 1);
          },
          error: (error: any) => {
            erros++;
            logger.error('PONTO_VENDA', 'VENDA_ITEM_FAIL', `Erro no item ${index + 1}/${total}`, error);

            // Tentar próxima venda mesmo com erro
            if (error.status === 0 || error.message?.includes('ERR_CONNECTION')) {
              logger.warn('PONTO_VENDA', 'VENDA_ITEM_RETRY', 'Erro de conexão, tentando próxima...');
            }

            processarVenda(index + 1);
          }
        });
      }, index * 200); // 200ms de delay entre cada requisição
    };

    // Iniciar processamento
    processarVenda(0);
  }

  limparCarrinho(): void {
    this.carrinho = [];
    this.error = '';
  }

  // ----- Envio de nota (modal) -----
  openEnviarModal(orderId: number): void {
    this.modalOrderId = orderId;
    this.modalCustomerName = '';
    this.modalCustomerEmail = '';
    this.modalCustomerPhone = '';
    this.previewLoading = true;
    this.previewBlobUrl = null;
    this.showEnviarModal = true;

    // buscar PDF para preview
    this.apiService.getNotaPdf(orderId).subscribe({
      next: (resp: any) => {
        const blob = resp as Blob;
        try {
          // Verificar tipo/size para diagnóstico
          logger.debug('PONTO_VENDA', 'PDF_PREVIEW_RECEIVED', 'blob info', { type: blob?.type, size: blob?.size });

          if (!blob || blob.size === 0) {
            console.error('Preview PDF vazio');
            this.previewLoading = false;
            return;
          }

          if (!blob.type || !blob.type.includes('pdf')) {
            // Tentar ler como texto para debugar (provavelmente um HTML de erro)
            const reader = new FileReader();
            reader.onload = () => {
              console.error('Preview recebido não é PDF. Conteúdo:', reader.result);
              this.previewLoading = false;
            };
            reader.onerror = (e) => {
              console.error('Erro ao ler Blob não-PDF', e);
              this.previewLoading = false;
            };
            reader.readAsText(blob);
            return;
          }

          // Revogar URL anterior se existir
          if (this.previewBlobUrl) {
            try { URL.revokeObjectURL(this.previewBlobUrl); } catch (e) { /* ignore */ }
            this.previewBlobUrl = null;
          }

          const url = URL.createObjectURL(blob as Blob);
          this.previewObjectUrl = url;
          this.previewBlobUrl = url;
          // set attribute data safely on object if present
          setTimeout(() => {
            try {
              if (this.previewObjectRef && this.previewObjectRef.nativeElement) {
                this.renderer.setAttribute(this.previewObjectRef.nativeElement, 'data', url);
              }
            } catch (e) { /* ignore */ }
          }, 0);
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

  /**
   * Abre o autocomplete de cliente no modal carregando clientes existentes
   */
  openClientAutocomplete(): void {
    this.clientSearchTerm = '';
    this.clientResults = [];
    this.clientSearching = true;
    this.apiService.getClientes().subscribe({ next: r => { this.clientResults = r; this.clientSearching = false; }, error: () => { this.clientResults = []; this.clientSearching = false; } });
  }

  closeEnviarModal(): void {
    this.showEnviarModal = false;
    this.modalOrderId = null;
    if (this.previewBlobUrl) {
      try { URL.revokeObjectURL(this.previewBlobUrl); } catch (e) { /* ignore */ }
      this.previewBlobUrl = null;
    }
  }

  sendNotaByEmail(): void {
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

  // Envia email via servidor com anexo PDF
  sendNotaByEmailServer(): void {
    if (!this.modalOrderId) return;
    const orderId = this.modalOrderId;
    const to = this.modalCustomerEmail;
    if (!to) { alert('Informe um email para envio por servidor'); return; }
    const subject = `Comprovante - Pedido #${orderId}`;
    const body = 'Segue anexo o comprovante do seu pedido.';
    this.apiService.sendNotaEmail(orderId, { to, subject, body }).subscribe({
      next: () => {
        this.showModernNotification = true;
        this.modernNotificationMessage = 'Email enviado com sucesso!';
        setTimeout(() => this.hideModernNotification(), 4000);
      },
      error: (err) => {
        this.error = 'Erro ao enviar email pelo servidor';
        console.error(err);
      }
    });
    this.closeEnviarModal();
  }

  sendNotaByWhatsapp(): void {
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
    if (!phone) {
      this.closeEnviarModal();
      return;
    }
    if (!phone.startsWith('55')) {
      if (phone.length <= 11) phone = '55' + phone;
    }
    const pdfUrl = this.apiService.getNotaPdfUrl(orderId);
    const msg = `Segue a nota do seu último pedido na nossa loja: ${pdfUrl}`;
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');
    this.closeEnviarModal();
  }

  downloadPreviewPdf(): void {
    if (!this.previewBlobUrl || !this.modalOrderId) return;
    const a = document.createElement('a');
    a.href = this.previewBlobUrl;
    a.download = `nota-${this.modalOrderId}.pdf`;
    a.click();
  }

  voltarAoDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  hideModernNotification(): void {
    this.showModernNotification = false;
    this.modernNotificationMessage = '';
  }

  getImageUrl(imageName: string | null | undefined): string {
    return this.imageService.getImageUrl(imageName);
  }

  onImageError(event: any): void {
    // Se a imagem falhar ao carregar, esconder o elemento
    event.target.style.display = 'none';

    // Mostrar placeholder no lugar
    const container = event.target.parentElement;
    if (container) {
      const placeholder = container.querySelector('.carrinho-produto-sem-imagem, .produto-sem-imagem');
      if (placeholder) {
        (placeholder as HTMLElement).style.display = 'flex';
      }
    }
  }
}
