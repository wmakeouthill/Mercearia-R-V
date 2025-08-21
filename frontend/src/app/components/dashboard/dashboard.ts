import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth';
import { CaixaService } from '../../services/caixa.service';
import { Usuario, StatusCaixa } from '../../models';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class DashboardComponent implements OnInit, OnDestroy {
  currentUser: Usuario | null = null;
  isAdmin = false;
  podeControlarCaixa = false;
  statusCaixa: StatusCaixa | null = null;
  loading = false;
  error = '';
  success = '';
  showHorariosConfig = false;

  // Configuração de horários
  horarioAbertura = '';
  horarioFechamento = '';

  private statusSubscription?: Subscription;

  constructor(
    private readonly authService: AuthService,
    private readonly caixaService: CaixaService,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    logger.info('DASHBOARD', 'INIT', 'Componente iniciado');
    this.currentUser = this.authService.getCurrentUser();
    this.isAdmin = this.authService.isAdmin();
    this.podeControlarCaixa = this.authService.podeControlarCaixa();

    // Recarregar informações do usuário para garantir que as permissões estão atualizadas
    this.authService.reloadCurrentUser()
      .finally(() => {
        this.currentUser = this.authService.getCurrentUser();
        this.isAdmin = this.authService.isAdmin();
        this.podeControlarCaixa = this.authService.podeControlarCaixa();
      });

    // Verificar mensagens de erro na URL
    this.route.queryParams.subscribe(params => {
      if (params['error'] === 'caixa_fechado') {
        if (params['message']) {
          this.error = params['message'];
        } else {
          this.error = 'Não é possível acessar o ponto de venda com o caixa fechado';
        }
      } else if (params['error'] === 'erro_verificacao_caixa') {
        this.error = 'Erro ao verificar status do caixa. Tente novamente';
      }
    });

    // Carregar status do caixa (o serviço já carrega automaticamente no constructor)
    this.loadStatusCaixa();

    // Configurar verificação automática de horários (a cada minuto)
    setInterval(() => {
      this.caixaService.verificarHorariosAutomaticos();
    }, 60000); // 1 minuto

    // Verificação periódica do status do caixa (a cada 2 minutos em vez de 30s)
    setInterval(() => {
      this.caixaService.loadStatusCaixa();
    }, 120000); // 2 minutos para reduzir tráfego
  }

  ngOnDestroy(): void {
    if (this.statusSubscription) {
      this.statusSubscription.unsubscribe();
    }
  }

  loadStatusCaixa(): void {
    this.statusSubscription = this.caixaService.statusCaixa$.subscribe(status => {
      this.statusCaixa = status;
      if (status?.horario_abertura_obrigatorio) {
        this.horarioAbertura = status.horario_abertura_obrigatorio;
      }
      if (status?.horario_fechamento_obrigatorio) {
        this.horarioFechamento = status.horario_fechamento_obrigatorio;
      }
      // Forçar detecção de mudanças
      this.cdr.detectChanges();
    });
  }

  // modal state for abrir/fechar
  abrirModal = false;
  fecharModal = false;
  abrirSaldoInput: number | null = null;
  fecharSaldoInput: number | null = null;
  fecharObservacoes = '';

  abrirCaixa(): void {
    this.error = '';
    this.abrirSaldoInput = null;
    this.loading = false;
    this.abrirModal = true;
  }

  confirmarAbrir(): void {
    if (this.abrirSaldoInput == null) { this.error = 'Informe saldo inicial'; return; }
    this.loading = true;
    this.error = '';
    this.caixaService.abrirCaixa({ saldo_inicial: Number(this.abrirSaldoInput) }).subscribe({
      next: (response) => {
        this.success = response.message;
        this.loading = false;
        this.abrirModal = false;
        setTimeout(() => this.success = '', 3000);
        logger.info('DASHBOARD', 'ABRIR_CAIXA', 'Caixa aberto');
      },
      error: (error) => {
        this.error = error.error?.error || 'Erro ao abrir caixa';
        this.loading = false;
        logger.error('DASHBOARD', 'ABRIR_CAIXA', 'Erro ao abrir caixa', error);
      }
    });
  }

  cancelarAbrir(): void {
    this.abrirModal = false;
    this.abrirSaldoInput = null;
    this.loading = false;
  }

  fecharCaixa(): void {
    if (!confirm('Tem certeza que deseja fechar o caixa?')) {
      return;
    }
    // abrir modal de fechamento; não marcar como loading até a requisição
    this.loading = false;
    this.error = '';
    this.fecharSaldoInput = null;
    this.fecharObservacoes = '';
    this.fecharModal = true;
  }

  confirmarFecharModal(): void {
    if (this.fecharSaldoInput == null) { this.error = 'Informe saldo contado'; return; }
    const saldo = Number(this.fecharSaldoInput);
    if (Number.isNaN(saldo)) { this.error = 'Saldo contado inválido'; return; }
    this.loading = true;
    this.error = '';
    this.caixaService.fecharCaixa({ saldo_contado: saldo, observacoes: this.fecharObservacoes }).subscribe({
      next: (response) => {
        this.success = response.message;
        this.loading = false;
        this.fecharModal = false;
        setTimeout(() => this.success = '', 3000);
        logger.info('DASHBOARD', 'FECHAR_CAIXA', 'Caixa fechado');
      },
      error: (error) => {
        this.error = error.error?.error || 'Erro ao fechar caixa';
        this.loading = false;
        logger.error('DASHBOARD', 'FECHAR_CAIXA', 'Erro ao fechar caixa', error);
      }
    });
  }

  cancelarFechar(): void {
    this.fecharModal = false;
    this.fecharSaldoInput = null;
    this.fecharObservacoes = '';
    this.loading = false;
    this.error = '';
  }

  toggleHorariosConfig(): void {
    this.showHorariosConfig = !this.showHorariosConfig;
    this.error = '';
    this.success = '';
  }

  salvarHorarios(): void {
    if (!this.horarioAbertura || !this.horarioFechamento) {
      this.error = 'Informe ambos os horários';
      return;
    }

    this.loading = true;
    this.error = '';

    this.caixaService.configurarHorarios({
      horario_abertura_obrigatorio: this.horarioAbertura,
      horario_fechamento_obrigatorio: this.horarioFechamento
    }).subscribe({
      next: (response) => {
        this.success = response.message;
        this.showHorariosConfig = false;
        this.loading = false;
        setTimeout(() => this.success = '', 3000);
        logger.info('DASHBOARD', 'CONFIG_HORARIOS', 'Horários configurados', {
          abertura: this.horarioAbertura,
          fechamento: this.horarioFechamento
        });
      },
      error: (error) => {
        this.error = error.error?.error || 'Erro ao configurar horários';
        this.loading = false;
        logger.error('DASHBOARD', 'CONFIG_HORARIOS', 'Erro ao configurar horários', error);
      }
    });
  }

  clearMessages(): void {
    this.error = '';
    this.success = '';
  }

  logout(): void {
    this.authService.logout();
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  handlePontoVendaClick(): void {
    // Se é admin, sempre pode acessar
    if (this.isAdmin) {
      this.navigateTo('/vendas');
      return;
    }

    // Se não é admin e caixa fechado, mostrar mensagem
    if (this.statusCaixa && !this.statusCaixa.aberto) {
      this.error = 'Não é possível acessar o ponto de venda. O caixa está fechado!';
      setTimeout(() => this.error = '', 4000);
      return;
    }

    // Se não é admin mas caixa está aberto, pode acessar
    this.navigateTo('/vendas');
  }
}
