import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api';
import { CaixaService } from '../../services/caixa.service';
import { logger } from '../../utils/logger';
import { forkJoin } from 'rxjs';
import { RelatorioResumo } from '../../models';

type TipoMovManual = 'entrada' | 'retirada';
type TipoMovLista = 'entrada' | 'retirada' | 'venda';

@Component({
  selector: 'app-caixa',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './caixa.html',
  styleUrl: './caixa.scss'
})
export class CaixaComponent implements OnInit {
  dataSelecionada = new Date().toISOString().substring(0, 10);
  resumo: { data: string; saldo_movimentacoes: number } | null = null;
  resumoVendasDia: RelatorioResumo | null = null;
  movimentacoes: Array<{ id: number; tipo: TipoMovLista; valor: number; descricao?: string; usuario?: string; data_movimento: string; produto_nome?: string; metodo_pagamento?: string }> = [];
  filtroTipo = '';
  filtroMetodo = '';
  filtroHoraInicio = '';
  filtroHoraFim = '';

  tipo: TipoMovManual = 'entrada';
  valor: number | null = null;
  descricao = '';
  loading = false;
  error = '';
  success = '';

  constructor(
    private readonly api: ApiService,
    private readonly caixaService: CaixaService,
  ) { }

  ngOnInit(): void {
    this.loadResumoEMovimentacoes();
  }

  onChangeData(): void {
    this.loadResumoEMovimentacoes();
  }

  private loadResumoEMovimentacoes(): void {
    this.error = '';
    this.loading = true;
    const data = this.dataSelecionada;
    forkJoin({
      resumoVendas: this.api.getResumoDia(this.dataSelecionada),
      resumoMovs: this.caixaService.getResumoMovimentacoesDia(data),
      movimentacoes: this.caixaService.listarMovimentacoes(
        data,
        this.filtroTipo || undefined,
        this.filtroMetodo || undefined,
        this.filtroHoraInicio || undefined,
        this.filtroHoraFim || undefined)
    }).subscribe({
      next: ({ resumoVendas, resumoMovs, movimentacoes }) => {
        this.resumoVendasDia = resumoVendas;
        this.resumo = resumoMovs as any;
        this.movimentacoes = movimentacoes as any;
        this.loading = false;
      },
      error: (err) => {
        this.error = 'Erro ao carregar dados do caixa';
        this.loading = false;
        logger.error('CAIXA_COMPONENT', 'LOAD_DADOS', 'Erro ao carregar', err);
      }
    });
  }

  aplicarFiltrosMovs(): void {
    this.loadResumoEMovimentacoes();
  }

  limparFiltrosMovs(): void {
    this.filtroTipo = '';
    this.filtroMetodo = '';
    this.filtroHoraInicio = '';
    this.filtroHoraFim = '';
    this.loadResumoEMovimentacoes();
  }

  get totalVendasHoje(): number {
    return Number(this.resumoVendasDia?.receita_total || 0);
  }

  get saldoMovimentacoesHoje(): number {
    return Number(this.resumo?.saldo_movimentacoes || 0);
  }

  get totalNoCaixaHoje(): number {
    return this.totalVendasHoje + this.saldoMovimentacoesHoje;
  }

  registrar(): void {
    if (this.valor == null || this.valor <= 0) {
      this.error = 'Informe um valor válido';
      return;
    }
    this.loading = true;
    this.error = '';
    this.success = '';
    this.caixaService.adicionarMovimentacao({ tipo: this.tipo, valor: Number(this.valor), descricao: this.descricao || undefined })
      .subscribe({
        next: (resp) => {
          this.success = resp.message;
          this.valor = null;
          this.descricao = '';
          this.loading = false;
          this.loadResumoEMovimentacoes();
        },
        error: (error) => {
          this.error = error.error?.error || 'Erro ao registrar movimentação';
          this.loading = false;
        }
      });
  }
}


