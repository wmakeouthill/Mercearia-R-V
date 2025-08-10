import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { ImageService } from '../../services/image.service';
import { extractLocalDate, extractYearMonth, formatDateBR, formatTimeBR, getCurrentDateForInput, formatDateYMD } from '../../utils/date-utils';
import { RelatorioVendas, Venda, MetodoPagamento } from '../../models';

@Component({
  selector: 'app-relatorio-vendas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './relatorio-vendas.html',
  styleUrl: './relatorio-vendas.scss'
})
export class RelatorioVendasComponent implements OnInit {
  vendas: Venda[] = [];
  relatorioDiario: RelatorioVendas[] = [];
  relatorioMensal: RelatorioVendas[] = [];
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
    private apiService: ApiService,
    private authService: AuthService,
    private imageService: ImageService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.isAdmin = this.authService.isAdmin();
    this.filtroData = this.getDataAtual();
    this.loadVendas();
  }

  getDataAtual(): string {
    return getCurrentDateForInput();
  }

  loadVendas(): void {
    this.loading = true;
    this.error = '';

    this.apiService.getVendas().subscribe({
      next: (vendas) => {
        this.vendas = vendas;
        this.calcularEstatisticas();
        this.gerarRelatorios();
        this.loading = false;
      },
      error: (error: any) => {
        this.error = 'Erro ao carregar vendas';
        this.loading = false;
        console.error('Erro na API:', error);
      }
    });
  }

  calcularEstatisticas(): void {
    const vendasFiltradas = this.getVendasFiltradas();
    this.totalVendas = vendasFiltradas.length;
    this.receitaTotal = vendasFiltradas.reduce((total, venda) => total + venda.preco_total, 0);
    this.mediaVendas = this.totalVendas > 0 ? this.receitaTotal / this.totalVendas : 0;

    // Encontrar melhor dia
    const vendasPorDia = vendasFiltradas.reduce((acc, venda) => {
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

  gerarRelatorios(): void {
    this.gerarRelatorioDiario();
    this.gerarRelatorioMensal();
  }

  gerarRelatorioDiario(): void {
    const vendasFiltradas = this.getVendasFiltradas();
    const vendasPorDia = vendasFiltradas.reduce((acc, venda) => {
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

  gerarRelatorioMensal(): void {
    const vendasFiltradas = this.getVendasFiltradas();
    const vendasPorMes = vendasFiltradas.reduce((acc, venda) => {
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
    // Recalcular estatísticas e relatórios com todos os filtros
    this.calcularEstatisticas();
    this.gerarRelatorios();
  }

  limparFiltros(): void {
    this.filtroData = '';
    this.filtroNomeProduto = '';
    this.filtroMetodoPagamento = '';
    this.calcularEstatisticas();
    this.gerarRelatorios();
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

  getVendasFiltradas(): Venda[] {
    // Garantir que vendas sempre seja um array válido
    if (!Array.isArray(this.vendas)) {
      return [];
    }

    return this.vendas.filter(venda => {
      if (!venda || !venda.data_venda) return false;

      // Filtro por data
      if (this.filtroData) {
        try {
          const vendaDataLocal = extractLocalDate(venda.data_venda);
          if (vendaDataLocal !== this.filtroData) {
            return false;
          }
        } catch (e) {
          return false;
        }
      }

      // Filtro por nome do produto
      if (this.filtroNomeProduto && this.filtroNomeProduto.trim()) {
        const nomeProduto = (venda.produto_nome || '').toLowerCase();
        const termoBusca = this.filtroNomeProduto.toLowerCase().trim();
        if (!nomeProduto.includes(termoBusca)) {
          return false;
        }
      }

      // Filtro por método de pagamento
      if (this.filtroMetodoPagamento && this.filtroMetodoPagamento.trim()) {
        if (venda.metodo_pagamento !== this.filtroMetodoPagamento) {
          return false;
        }
      }

      return true;
    });
  }

  formatarData(data: string): string {
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
}
