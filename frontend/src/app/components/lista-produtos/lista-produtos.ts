import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { Produto } from '../../models';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-lista-produtos',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './lista-produtos.html',
  styleUrl: './lista-produtos.scss'
})
export class ListaProdutosComponent implements OnInit {
  produtos: Produto[] = [];
  loading = false;
  error = '';
  isAdmin = false;

  constructor(
    private apiService: ApiService,
    private authService: AuthService,
    private imageService: ImageService,
    public router: Router
  ) { }

  ngOnInit(): void {
    this.isAdmin = this.authService.isAdmin();
    this.loadProdutos();
    logger.info('LISTA_PRODUTOS', 'INIT', 'Componente iniciado', { isAdmin: this.isAdmin });
  }

  loadProdutos(): void {
    this.loading = true;
    this.error = '';

    this.apiService.getProdutos().subscribe({
      next: (produtos) => {
        this.produtos = produtos;
        this.loading = false;
        logger.info('LISTA_PRODUTOS', 'LOAD_PRODUTOS', 'Produtos carregados', { count: produtos.length });
      },
      error: (error) => {
        this.error = 'Erro ao carregar produtos';
        this.loading = false;
        logger.error('LISTA_PRODUTOS', 'LOAD_PRODUTOS', 'Erro ao carregar produtos', error);
      }
    });
  }

  editProduto(id: number): void {
    this.router.navigate(['/produtos/editar', id]);
  }

  deleteProduto(id: number): void {
    if (confirm('Tem certeza que deseja excluir este produto?')) {
      this.loading = true;
      this.error = '';

      this.apiService.deleteProduto(id).subscribe({
        next: () => {
          this.produtos = this.produtos.filter(p => p.id !== id);
          this.loading = false;
          logger.info('LISTA_PRODUTOS', 'DELETE_PRODUTO', 'Produto deletado', { id });
        },
        error: (error: any) => {
          this.error = 'Erro ao excluir produto';
          this.loading = false;
          logger.error('LISTA_PRODUTOS', 'DELETE_PRODUTO', 'Erro ao excluir produto', error);
        }
      });
    }
  }

  updateEstoque(id: number, novaQuantidade: number): void {
    this.loading = true;
    this.error = '';

    this.apiService.updateEstoque(id, novaQuantidade).subscribe({
      next: () => {
        const produto = this.produtos.find(p => p.id === id);
        if (produto) {
          produto.quantidade_estoque = novaQuantidade;
        }
        this.loading = false;
        logger.info('LISTA_PRODUTOS', 'UPDATE_ESTOQUE', 'Estoque atualizado', { id, quantidade: novaQuantidade });
      },
      error: (error: any) => {
        this.error = 'Erro ao atualizar estoque';
        this.loading = false;
        logger.error('LISTA_PRODUTOS', 'UPDATE_ESTOQUE', 'Erro ao atualizar estoque', error);
      }
    });
  }

  novoProduto(): void {
    this.router.navigate(['/produtos/novo']);
  }

  getProdutosEmEstoque(): number {
    return this.produtos.filter(p => p.quantidade_estoque > 0).length;
  }

  getProdutosEstoqueBaixo(): number {
    return this.produtos.filter(p => p.quantidade_estoque < 10).length;
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
      const placeholder = container.querySelector('.produto-sem-imagem');
      if (placeholder) {
        placeholder.style.display = 'flex';
      } else {
        // Criar placeholder se não existir
        const newPlaceholder = document.createElement('div');
        newPlaceholder.className = 'produto-sem-imagem';
        newPlaceholder.textContent = '📷';
        container.appendChild(newPlaceholder);
      }
    }
  }
}
