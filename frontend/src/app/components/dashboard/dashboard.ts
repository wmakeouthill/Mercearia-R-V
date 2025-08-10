import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../services/auth';
import { CaixaService } from '../../services/caixa.service';
import { Usuario, StatusCaixa } from '../../models';

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
    private authService: AuthService,
    private caixaService: CaixaService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) { }

  async ngOnInit(): Promise<void> {
    this.currentUser = this.authService.getCurrentUser();
    this.isAdmin = this.authService.isAdmin();
    this.podeControlarCaixa = this.authService.podeControlarCaixa();

    // Recarregar informações do usuário para garantir que as permissões estão atualizadas
    await this.authService.reloadCurrentUser();
    this.currentUser = this.authService.getCurrentUser();
    this.isAdmin = this.authService.isAdmin();
    this.podeControlarCaixa = this.authService.podeControlarCaixa();

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
      if (status && status.horario_abertura_obrigatorio) {
        this.horarioAbertura = status.horario_abertura_obrigatorio;
      }
      if (status && status.horario_fechamento_obrigatorio) {
        this.horarioFechamento = status.horario_fechamento_obrigatorio;
      }
      // Forçar detecção de mudanças
      this.cdr.detectChanges();
    });
  }

  abrirCaixa(): void {
    this.loading = true;
    this.error = '';

    this.caixaService.abrirCaixa().subscribe({
      next: (response) => {
        this.success = response.message;
        this.loading = false;
        setTimeout(() => this.success = '', 3000);
      },
      error: (error) => {
        this.error = error.error?.error || 'Erro ao abrir caixa';
        this.loading = false;
      }
    });
  }

  fecharCaixa(): void {
    if (!confirm('Tem certeza que deseja fechar o caixa?')) {
      return;
    }

    this.loading = true;
    this.error = '';

    this.caixaService.fecharCaixa().subscribe({
      next: (response) => {
        this.success = response.message;
        this.loading = false;
        setTimeout(() => this.success = '', 3000);
      },
      error: (error) => {
        this.error = error.error?.error || 'Erro ao fechar caixa';
        this.loading = false;
      }
    });
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
      },
      error: (error) => {
        this.error = error.error?.error || 'Erro ao configurar horários';
        this.loading = false;
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
