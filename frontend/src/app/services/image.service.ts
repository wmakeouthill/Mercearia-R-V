import { Injectable } from '@angular/core';
import { ApiService } from './api';
import { environment } from '../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class ImageService {
    private baseUrl = `${environment.apiUrl.replace('/api', '')}/api/produtos`;

    constructor(private apiService: ApiService) {
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
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
        });
    }

    /**
     * Valida arquivo de imagem
     */
    validateImageFile(file: File): { valid: boolean; error?: string } {
        // Verificar tamanho (5MB)
        if (file.size > 5 * 1024 * 1024) {
            return { valid: false, error: 'Imagem muito grande. Máximo 5MB.' };
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
     * Redimensiona imagem antes do upload (opcional - implementação futura)
     */
    async resizeImage(file: File, maxWidth: number = 800, maxHeight: number = 600): Promise<string> {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();

            img.onload = () => {
                // Calcular dimensões mantendo proporção
                let { width, height } = img;

                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width *= ratio;
                    height *= ratio;
                }

                canvas.width = width;
                canvas.height = height;

                // Desenhar imagem redimensionada
                ctx?.drawImage(img, 0, 0, width, height);

                // Converter para base64
                const resizedBase64 = canvas.toDataURL(file.type, 0.8);
                resolve(resizedBase64);
            };

            img.onerror = reject;

            // Carregar arquivo como URL
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target?.result as string;
            };
            reader.readAsDataURL(file);
        });
    }
}