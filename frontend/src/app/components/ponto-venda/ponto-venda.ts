import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { CaixaService } from '../../services/caixa.service';
import { ImageService } from '../../services/image.service';
import { Produto, ItemVenda, MetodoPagamento, StatusCaixa } from '../../models';
import { Subject, debounceTime, distinctUntilChanged, Subscription } from 'rxjs';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-ponto-venda',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
  loading = false;
  error = '';
  sucesso = '';
  showModernNotification = false;
  modernNotificationMessage = '';

  metodosDisponiveis: { valor: MetodoPagamento, nome: string, icone: string }[] = [
    { valor: 'dinheiro', nome: 'Dinheiro', icone: '💵' },
    { valor: 'cartao_credito', nome: 'Cartão de Crédito', icone: '💳' },
    { valor: 'cartao_debito', nome: 'Cartão de Débito', icone: '🏧' },
    { valor: 'pix', nome: 'PIX', icone: '📱' }
  ];

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
    private readonly router: Router
  ) { }

  ngOnInit(): void {
    logger.info('PONTO_VENDA', 'INIT', 'Componente iniciado');
    this.isAdmin = this.authService.isAdmin();
    this.podeControlarCaixa = this.authService.podeControlarCaixa();
    this.checkCaixaStatus();
    this.setupCaixaMonitoring();
    this.setupPeriodicCaixaCheck();
    this.loadProdutos();
    this.setupSearch();
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

    this.loading = true;
    this.error = '';

    // Processar cada item do carrinho como uma venda separada
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
