import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { Produto } from '../../models';

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
    private apiService: ApiService,
    private authService: AuthService,
    private imageService: ImageService,
    private router: Router,
    private route: ActivatedRoute
  ) { }

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      if (params['id']) {
        this.produtoId = +params['id'];
        this.isEditing = true;
        this.loadProduto();
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
      },
      error: (error: any) => {
        this.error = 'Erro ao carregar produto';
        this.loading = false;
        console.error('Erro na API:', error);
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
    const produtoData = { ...this.produto };
    if (this.imagemBase64) {
      produtoData.imagem = this.imagemBase64;
    }

    this.apiService.criarProduto(produtoData).subscribe({
      next: () => {
        this.sucesso = 'Produto criado com sucesso!';
        this.loading = false;

        setTimeout(() => {
          this.router.navigate(['/produtos']);
        }, 2000);
      },
      error: (error: any) => {
        this.error = 'Erro ao criar produto';
        this.loading = false;
        console.error('Erro na API:', error);
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

        setTimeout(() => {
          this.router.navigate(['/produtos']);
        }, 2000);
      },
      error: (error: any) => {
        this.error = 'Erro ao atualizar produto';
        this.loading = false;
        console.error('Erro na API:', error);
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

  onImageSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      // Validar tamanho (5MB)
      if (file.size > 5 * 1024 * 1024) {
        this.error = 'Imagem muito grande. Máximo 5MB.';
        return;
      }

      // Validar tipo
      if (!file.type.startsWith('image/')) {
        this.error = 'Arquivo deve ser uma imagem.';
        return;
      }

      this.imagemFile = file;

      // Criar preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.imagemPreview = e.target?.result as string;
        this.imagemBase64 = this.imagemPreview;
      };
      reader.readAsDataURL(file);

      this.error = '';
    }
  }

  removerImagem(): void {
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
