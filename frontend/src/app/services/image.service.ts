import { Injectable } from '@angular/core';
import { ApiService } from './api';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ImageService {
  private baseUrl = `${environment.apiUrl.replace('/api', '')}/api/produtos`;

  constructor(private readonly apiService: ApiService) {
    // Em produção, atualizar URL quando o backend for detectado
    if (environment.production) {
      this.setupDynamicUrl();
    }
  }

  private setupDynamicUrl(): void {
    // Observar mudanças na URL do backend
    (this.apiService as any).backendUrlSubject?.subscribe((apiUrl: string) => {
      if (apiUrl) {
        this.baseUrl = `${apiUrl.replace('/api', '')}/api/produtos`;
        console.log('🖼️ URL de imagens atualizada para:', this.baseUrl);
      }
    });
  }

  /**
* Gera URL para exibir imagem do produto
*/
  getImageUrl(imageName: string | null | undefined): string {
    if (!imageName) {
      // Usar imagem padrão como fallback
      return `${this.baseUrl}/imagem/padrao.png`;
    }
    return `${this.baseUrl}/imagem/${imageName}`;
  }

  /**
   * Obtém a URL base atual (útil para debug)
   */
  getCurrentBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Converte arquivo para base64
   */
  async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(new Error('Falha ao ler arquivo: resultado inesperado'));
        }
      };
      reader.onerror = () => {
        const message = reader.error?.message ?? 'Falha ao ler arquivo';
        reject(new Error(message));
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Valida arquivo de imagem - verificação básica apenas
   */
  validateImageFile(file: File): { valid: boolean; error?: string } {
    // Verificar se é muito grande (limite superior para evitar problemas)
    if (file.size > 10 * 1024 * 1024) { // 10MB máximo para processamento
      return { valid: false, error: 'Arquivo muito grande para processar. Máximo 10MB.' };
    }

    // Verificar tipo
    if (!file.type.startsWith('image/')) {
      return { valid: false, error: 'Arquivo deve ser uma imagem.' };
    }

    // Tipos permitidos
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return { valid: false, error: 'Tipo de imagem não suportado. Use JPG, PNG, GIF ou WebP.' };
    }

    return { valid: true };
  }

  /**
   * Verifica se a imagem precisa ser comprimida
   */
  async needsCompression(file: File): Promise<{ needsCompression: boolean; reason?: string; dimensions?: { width: number; height: number } }> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const needsSizeCompression = file.size > 200 * 1024;
        const needsDimensionCompression = img.width > 300 || img.height > 300;

        if (needsSizeCompression || needsDimensionCompression) {
          let reason = '';
          if (needsSizeCompression && needsDimensionCompression) {
            reason = `Arquivo muito grande (${Math.round(file.size / 1024)}KB) e dimensões grandes (${img.width}x${img.height})`;
          } else if (needsSizeCompression) {
            reason = `Arquivo muito grande (${Math.round(file.size / 1024)}KB)`;
          } else {
            reason = `Dimensões muito grandes (${img.width}x${img.height})`;
          }

          resolve({
            needsCompression: true,
            reason,
            dimensions: { width: img.width, height: img.height }
          });
        } else {
          resolve({
            needsCompression: false,
            dimensions: { width: img.width, height: img.height }
          });
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ needsCompression: false, reason: 'Erro ao ler a imagem' });
      };

      img.src = url;
    });
  }  /**
   * Manipula erro de carregamento de imagem
   */
  handleImageError(event: any, fallbackSelector: string = '.produto-sem-imagem'): void {
    // Esconder a imagem que falhou
    event.target.style.display = 'none';

    // Mostrar placeholder no lugar
    const container = event.target.parentElement;
    if (container) {
      const placeholder = container.querySelector(fallbackSelector);
      if (placeholder) {
        (placeholder as HTMLElement).style.display = 'flex';
      } else {
        // Criar placeholder se não existir
        const newPlaceholder = document.createElement('div');
        newPlaceholder.className = fallbackSelector.replace('.', '');
        newPlaceholder.textContent = '📷';
        newPlaceholder.style.display = 'flex';
        newPlaceholder.style.alignItems = 'center';
        newPlaceholder.style.justifyContent = 'center';
        newPlaceholder.style.width = '100%';
        newPlaceholder.style.height = '100%';
        newPlaceholder.style.background = '#e9ecef';
        newPlaceholder.style.color = '#6c757d';
        newPlaceholder.style.borderRadius = '8px';
        container.appendChild(newPlaceholder);
      }
    }
  }

  /**
   * Redimensiona e comprime imagem para 300x300px com máxima compressão
   */
  async resizeAndCompressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        // Definir dimensões finais (sempre 300x300)
        const targetSize = 300;
        canvas.width = targetSize;
        canvas.height = targetSize;

        // Configurar renderização de alta qualidade para o redimensionamento
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
        }

        // Calcular dimensões para manter proporção e centralizar
        let sourceX = 0, sourceY = 0, sourceWidth = img.width, sourceHeight = img.height;

        if (img.width > img.height) {
          // Imagem mais larga - cortar laterais
          sourceWidth = img.height;
          sourceX = (img.width - img.height) / 2;
        } else if (img.height > img.width) {
          // Imagem mais alta - cortar topo/fundo
          sourceHeight = img.width;
          sourceY = (img.height - img.width) / 2;
        }

        // Desenhar imagem redimensionada e centralizada
        ctx?.drawImage(
          img,
          sourceX, sourceY, sourceWidth, sourceHeight,  // área da imagem original
          0, 0, targetSize, targetSize                   // área do canvas
        );

        // Compressão agressiva com JPEG de baixa qualidade
        const tryCompress = (quality: number): string => {
          const compressed = canvas.toDataURL('image/jpeg', quality);
          const base64String = compressed.split(',')[1];
          const sizeInKB = Math.round((base64String.length * 3) / 4 / 1024);

          console.log(`Compressão JPEG: qualidade ${(quality * 100).toFixed(0)}%, tamanho: ${sizeInKB}KB`);
          return compressed;
        };

        // Tentar diferentes níveis de compressão JPEG
        let bestResult = '';
        let bestQuality = 0;

        // Testar qualidades de 70% até 10% para encontrar o melhor balanço
        for (let q = 0.7; q >= 0.1; q -= 0.1) {
          const result = tryCompress(q);
          const sizeInKB = Math.round((result.split(',')[1].length * 3) / 4 / 1024);

          if (sizeInKB <= 200 || q <= 0.1) { // Para quando atingir 200KB ou na última tentativa
            bestResult = result;
            bestQuality = q;
            console.log(`✅ Compressão ótima: ${(q * 100).toFixed(0)}%, ${sizeInKB}KB`);
            break;
          }
        }

        // Se ainda não conseguiu comprimir suficiente, usar qualidade mínima
        if (!bestResult) {
          bestResult = tryCompress(0.05);
          bestQuality = 0.05;
          const finalSizeKB = Math.round((bestResult.split(',')[1].length * 3) / 4 / 1024);
          console.log(`🔧 Compressão máxima: ${(bestQuality * 100).toFixed(1)}%, ${finalSizeKB}KB`);
        }

        resolve(bestResult);
      };

      img.onerror = (error: unknown) => {
        const reason = (error instanceof Error)
          ? error
          : new Error((error as any)?.toString?.() ?? 'Falha ao carregar imagem');
        reject(reason);
      };

      // Carregar arquivo como URL
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  }
}
