import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { Produto } from '../../models';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-form-produto',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './form-produto.html',
  styleUrl: './form-produto.scss'
})
export class FormProdutoComponent implements OnInit {
  produto: Produto = {
    nome: '',
    codigo_barras: '',
    preco_venda: 0,
    quantidade_estoque: 0,
    imagem: null
  };

  isEditing = false;
  produtoId: number | null = null;
  loading = false;
  error = '';
  sucesso = '';
  imagemPreview: string | null = null;
  imagemFile: File | null = null;
  imagemBase64: string | null = null;

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly imageService: ImageService,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) { }

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      if (params['id']) {
        this.produtoId = +params['id'];
        this.isEditing = true;
        logger.info('FORM_PRODUTO', 'INIT_EDIT', 'Modo edição', { id: this.produtoId });
        this.loadProduto();
      } else {
        logger.info('FORM_PRODUTO', 'INIT_CREATE', 'Modo criação');
      }
    });
  }

  loadProduto(): void {
    if (!this.produtoId) return;

    this.loading = true;
    this.error = '';

    this.apiService.getProduto(this.produtoId).subscribe({
      next: (produto: Produto) => {
        this.produto = produto;
        this.loading = false;
        logger.info('FORM_PRODUTO', 'LOAD_PRODUTO', 'Produto carregado', { id: this.produtoId });
      },
      error: (error: any) => {
        this.error = 'Erro ao carregar produto';
        this.loading = false;
        logger.error('FORM_PRODUTO', 'LOAD_PRODUTO', 'Erro ao carregar produto', error);
      }
    });
  }

  onSubmit(): void {
    if (!this.validarFormulario()) {
      return;
    }

    this.loading = true;
    this.error = '';
    this.sucesso = '';

    if (this.isEditing) {
      this.atualizarProduto();
    } else {
      this.criarProduto();
    }
    logger.info('FORM_PRODUTO', 'SUBMIT', this.isEditing ? 'Atualizando produto' : 'Criando produto');
  }

  private validarFormulario(): boolean {
    if (!this.produto.nome.trim()) {
      this.error = 'Nome do produto é obrigatório';
      return false;
    }

    if (this.produto.preco_venda <= 0) {
      this.error = 'Preço de venda deve ser maior que zero';
      return false;
    }

    if (this.produto.quantidade_estoque < 0) {
      this.error = 'Quantidade em estoque não pode ser negativa';
      return false;
    }

    return true;
  }

  private criarProduto(): void {
    // Incluir imagem se houver
    const produtoData: any = { ...this.produto };

    // Normalizar código de barras: enviar null/omitido se vazio
    if (typeof produtoData.codigo_barras === 'string') {
      const trimmed = produtoData.codigo_barras.trim();
      if (!trimmed) {
        delete produtoData.codigo_barras;
      } else {
        produtoData.codigo_barras = trimmed;
      }
    }
    if (this.imagemBase64) {
      produtoData.imagem = this.imagemBase64;
    }

    this.apiService.criarProduto(produtoData).subscribe({
      next: () => {
        this.sucesso = 'Produto criado com sucesso!';
        this.loading = false;
        logger.info('FORM_PRODUTO', 'CREATE', 'Produto criado com sucesso');

        setTimeout(() => {
          this.router.navigate(['/produtos']);
        }, 2000);
      },
      error: (error: any) => {
        this.error = 'Erro ao criar produto';
        this.loading = false;
        logger.error('FORM_PRODUTO', 'CREATE', 'Erro ao criar produto', error);
      }
    });
  }

  private atualizarProduto(): void {
    if (!this.produtoId) return;

    // Incluir imagem se houver nova ou se foi removida
    const produtoData = { ...this.produto };
    if (this.imagemBase64) {
      produtoData.imagem = this.imagemBase64;
    } else if (this.produto.imagem === null) {
      produtoData.imagem = null; // Sinalizar remoção
    }

    this.apiService.atualizarProduto(this.produtoId, produtoData).subscribe({
      next: () => {
        this.sucesso = 'Produto atualizado com sucesso!';
        this.loading = false;
        logger.info('FORM_PRODUTO', 'UPDATE', 'Produto atualizado com sucesso', { id: this.produtoId });

        setTimeout(() => {
          this.router.navigate(['/produtos']);
        }, 2000);
      },
      error: (error: any) => {
        this.error = 'Erro ao atualizar produto';
        this.loading = false;
        logger.error('FORM_PRODUTO', 'UPDATE', 'Erro ao atualizar produto', error);
      }
    });
  }

  cancelar(): void {
    this.router.navigate(['/dashboard']);
  }

  gerarCodigoBarras(): void {
    // Gerar código de barras aleatório para demonstração
    const codigo = Math.floor(Math.random() * 900000000) + 100000000;
    this.produto.codigo_barras = codigo.toString();
  }

  limparFormulario(): void {
    this.produto = {
      nome: '',
      codigo_barras: '',
      preco_venda: 0,
      quantidade_estoque: 0,
      imagem: null
    };
    this.error = '';
    this.sucesso = '';
    this.imagemPreview = null;
    this.imagemFile = null;
    this.imagemBase64 = null;
  }

  async onImageSelected(event: any): Promise<void> {
    const file = event.target.files[0];
    if (!file) return;

    // Validar tipo básico
    const basicValidation = this.imageService.validateImageFile(file);
    if (!basicValidation.valid) {
      this.error = basicValidation.error || 'Imagem inválida';
      return;
    }

    // Verificar se precisa de compressão
    const compressionCheck = await this.imageService.needsCompression(file);

    if (compressionCheck.needsCompression) {
      // Oferecer compressão automática
      const shouldCompress = confirm(
        `${compressionCheck.reason}. \n\nSua imagem será redimensionada para 300x300px e comprimida para ficar menor e mais otimizada.\n\nDeseja continuar?`
      );

      if (!shouldCompress) {
        this.error = 'Imagem cancelada pelo usuário';
        return;
      }

      try {
        // Comprimir automaticamente
        this.imagemBase64 = await this.imageService.resizeAndCompressImage(file);
        this.imagemPreview = this.imagemBase64;
        this.imagemFile = file;
        this.error = '';

        // Calcular tamanho aproximado da imagem comprimida
        const compressedSize = Math.round((this.imagemBase64.split(',')[1].length * 3) / 4 / 1024);
        console.log(`Imagem comprimida para ~${compressedSize}KB e 300x300px`);
        return;
      } catch (err: any) {
        this.error = 'Erro ao comprimir a imagem: ' + (err?.message || err);
        logger.error('FORM_PRODUTO', 'IMAGE_COMPRESSION', 'Erro ao comprimir imagem', err);
        return;
      }
    } else {
      // Imagem já está dentro dos limites, processar normalmente
      try {
        this.imagemFile = file;
        this.imagemBase64 = await this.imageService.fileToBase64(file);
        this.imagemPreview = this.imagemBase64;
        this.error = '';

        const sizeKB = Math.round(file.size / 1024);
        const dims = compressionCheck.dimensions;
        console.log(`Imagem aceita sem compressão: ${sizeKB}KB, ${dims?.width}x${dims?.height}px`);
      } catch (err: any) {
        this.error = 'Erro ao processar a imagem: ' + (err?.message || err);
        logger.error('FORM_PRODUTO', 'IMAGE_PROCESSING', 'Erro ao processar imagem', err);
      }
    }
  } removerImagem(): void {
    this.imagemPreview = null;
    this.imagemFile = null;
    this.imagemBase64 = null;
    this.produto.imagem = null;

    // Limpar input file
    const fileInput = document.getElementById('imagem') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  alterarImagem(): void {
    const fileInput = document.getElementById('imagem') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
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
}
