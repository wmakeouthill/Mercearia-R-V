import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { AuthService } from '../../services/auth';
import { Usuario } from '../../models';
import { logger } from '../../utils/logger';

interface UserWithEdit extends Usuario {
  isEditing?: boolean;
  updatingPerm?: boolean;
}

@Component({
  selector: 'app-administracao',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './administracao.html',
  styleUrl: './administracao.scss'
})
export class AdministracaoComponent implements OnInit {
  currentUser: Usuario | null = null;
  users: UserWithEdit[] = [];
  loading = false;
  error = '';
  success = '';

  // Formulário para novo usuário
  showNewUserForm = false;
  newUser = {
    username: '',
    password: '',
    role: 'user',
    pode_controlar_caixa: false
  };

  // Formulário para alterar senha
  showChangePasswordForm = false;
  passwordChange = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  };

  constructor(
    private readonly apiService: ApiService,
    private readonly authService: AuthService,
    private readonly router: Router
  ) { }

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    if (!this.authService.isAdmin()) {
      this.router.navigate(['/dashboard']);
      return;
    }
    this.loadUsers();
  }

  loadUsers(): void {
    this.loading = true;
    this.error = '';

    this.apiService.getUsers().subscribe({
      next: (users) => {
        this.users = users.map(user => ({ ...user, isEditing: false }));
        this.loading = false;
        logger.info('ADMINISTRACAO', 'LOAD_USERS', 'Usuários carregados com sucesso', { count: users.length });
      },
      error: (error) => {
        this.error = 'Erro ao carregar usuários';
        this.loading = false;
        logger.error('ADMINISTRACAO', 'LOAD_USERS', 'Erro ao carregar usuários', error);
      }
    });
  }

  // Gerenciamento de usuários
  toggleNewUserForm(): void {
    this.showNewUserForm = !this.showNewUserForm;
    if (this.showNewUserForm) {
      this.resetNewUserForm();
    }
  }

  resetNewUserForm(): void {
    this.newUser = {
      username: '',
      password: '',
      role: 'user',
      pode_controlar_caixa: false
    };
    this.error = '';
    this.success = '';
  }

  createUser(): void {
    if (!this.newUser.username || !this.newUser.password) {
      this.error = 'Nome de usuário e senha são obrigatórios';
      return;
    }

    this.loading = true;
    this.error = '';

    // Garantir que admins sempre tenham permissão de controlar caixa
    const userData = {
      ...this.newUser,
      pode_controlar_caixa: this.newUser.role === 'admin' ? true : this.newUser.pode_controlar_caixa
    };

    this.apiService.createUser(userData).subscribe({
      next: (response) => {
        this.success = 'Usuário criado com sucesso!';
        this.showNewUserForm = false;
        this.loadUsers();
        this.loading = false;
        logger.info('ADMINISTRACAO', 'CREATE_USER', 'Usuário criado com sucesso', { username: this.newUser.username });
      },
      error: (error) => {
        this.error = error.error?.error || 'Erro ao criar usuário';
        this.loading = false;
        logger.error('ADMINISTRACAO', 'CREATE_USER', 'Erro ao criar usuário', error);
      }
    });
  }

  editUser(user: UserWithEdit): void {
    // Cancelar edição de outros usuários
    this.users.forEach(u => u.isEditing = false);
    user.isEditing = true;
    this.error = '';
    this.success = '';
  }

  cancelEdit(user: UserWithEdit): void {
    user.isEditing = false;
    this.loadUsers(); // Recarregar para desfazer alterações
  }

  updateUser(user: UserWithEdit): void {
    if (!user.username) {
      this.error = 'Nome de usuário é obrigatório';
      return;
    }

    this.loading = true;
    this.error = '';

    const updateData: { username: string; password?: string; role: string; pode_controlar_caixa?: boolean } = {
      username: user.username,
      role: user.role,
      pode_controlar_caixa: user.pode_controlar_caixa
    };

    // Incluir senha apenas se foi fornecida
    if (user.password) {
      updateData.password = user.password;
    }

    this.apiService.updateUser(user.id!, updateData).subscribe({
      next: (response) => {
        this.success = 'Usuário atualizado com sucesso!';
        user.isEditing = false;

        // Se o usuário editado é o próprio usuário logado, recarregar suas informações
        if (user.id === this.currentUser?.id) {
          this.authService.reloadCurrentUser().finally(() => { });
        }

        this.loadUsers();
        this.loading = false;
        logger.info('ADMINISTRACAO', 'UPDATE_USER', 'Usuário atualizado com sucesso', { id: user.id, username: user.username });
      },
      error: (error) => {
        this.error = error.error?.error || 'Erro ao atualizar usuário';
        this.loading = false;
        logger.error('ADMINISTRACAO', 'UPDATE_USER', 'Erro ao atualizar usuário', error);
      }
    });
  }

  // Toggle rápido da permissão de controle de caixa diretamente na listagem
  toggleCaixaPermission(user: UserWithEdit, allow: boolean): void {
    if (user.role !== 'user') {
      return;
    }
    const previous = !!user.pode_controlar_caixa;
    user.updatingPerm = true;
    user.pode_controlar_caixa = allow;
    const payload = {
      username: user.username,
      role: user.role,
      pode_controlar_caixa: allow
    } as const;
    this.apiService.updateUser(user.id!, payload as any).subscribe({
      next: () => {
        this.success = allow ? 'Permissão de caixa habilitada' : 'Permissão de caixa desabilitada';
        user.updatingPerm = false;
        // Caso o admin altere a própria permissão (raro), recarrega
        if (user.id === this.currentUser?.id) {
          this.authService.reloadCurrentUser().finally(() => { });
        }
      },
      error: (error) => {
        user.pode_controlar_caixa = previous; // reverte
        user.updatingPerm = false;
        this.error = error.error?.error || 'Erro ao atualizar permissão de caixa';
        logger.error('ADMINISTRACAO', 'TOGGLE_PERM', 'Erro ao alternar permissão', error);
      }
    });
  }

  deleteUser(user: Usuario): void {
    if (user.id === this.currentUser?.id) {
      this.error = 'Não é possível deletar sua própria conta';
      return;
    }

    if (!confirm(`Tem certeza que deseja deletar o usuário "${user.username}"?`)) {
      return;
    }

    this.loading = true;
    this.error = '';

    this.apiService.deleteUser(user.id!).subscribe({
      next: (response) => {
        this.success = 'Usuário deletado com sucesso!';
        this.loadUsers();
        this.loading = false;
        logger.info('ADMINISTRACAO', 'DELETE_USER', 'Usuário deletado com sucesso', { id: user.id, username: user.username });
      },
      error: (error) => {
        this.error = error.error?.error || 'Erro ao deletar usuário';
        this.loading = false;
        logger.error('ADMINISTRACAO', 'DELETE_USER', 'Erro ao deletar usuário', error);
      }
    });
  }

  // Alteração de senha
  toggleChangePasswordForm(): void {
    this.showChangePasswordForm = !this.showChangePasswordForm;
    if (this.showChangePasswordForm) {
      this.resetPasswordForm();
    }
  }

  resetPasswordForm(): void {
    this.passwordChange = {
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    };
    this.error = '';
    this.success = '';
  }

  changePassword(): void {
    if (!this.passwordChange.currentPassword || !this.passwordChange.newPassword) {
      this.error = 'Senha atual e nova senha são obrigatórias';
      return;
    }

    if (this.passwordChange.newPassword !== this.passwordChange.confirmPassword) {
      this.error = 'Nova senha e confirmação não coincidem';
      return;
    }

    if (this.passwordChange.newPassword.length < 6) {
      this.error = 'Nova senha deve ter pelo menos 6 caracteres';
      return;
    }

    this.loading = true;
    this.error = '';

    const passwordData = {
      currentPassword: this.passwordChange.currentPassword,
      newPassword: this.passwordChange.newPassword
    };

    this.apiService.changePassword(passwordData).subscribe({
      next: (response) => {
        this.success = 'Senha alterada com sucesso!';
        this.showChangePasswordForm = false;
        this.loading = false;
        logger.info('ADMINISTRACAO', 'CHANGE_PASSWORD', 'Senha alterada com sucesso');
      },
      error: (error) => {
        this.error = error.error?.error || 'Erro ao alterar senha';
        this.loading = false;
        logger.error('ADMINISTRACAO', 'CHANGE_PASSWORD', 'Erro ao alterar senha', error);
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  goToClientes(): void {
    this.router.navigate(['/administracao/clientes']);
  }

  getRoleDisplayName(role: string): string {
    return role === 'admin' ? 'Administrador' : 'Operador';
  }

  clearMessages(): void {
    this.error = '';
    this.success = '';
  }

  // --- Ferramentas críticas (backup / reset) ---
  showCriticalTools = false;
  // Confirmação exata (case sensitive)
  readonly resetConfirmationPhrase = "Desejo com certeza, apagar todos os dados do banco de dados e fazer um reset geral dos dados do aplicativo.";
  criticalConfirmationInput = '';
  backupLoading = false;
  backups: { name: string; createdAt: string }[] = [];
  resetMode: 'ALL' | 'EXCEPT_PRODUCTS' = 'ALL';

  openCriticalTools(): void {
    if (!this.currentUser || this.currentUser.role !== 'admin') {
      this.error = 'Acesso negado: somente administradores podem acessar ferramentas críticas.';
      return;
    }
    // navegar para a tela de ferramentas
    this.router.navigate(['/administracao/ferramentas']);
  }

  closeCriticalTools(): void {
    this.showCriticalTools = false;
  }

  createBackup(format: 'custom' | 'plain' = 'custom'): void {
    this.backupLoading = true;
    this.apiService.createBackup({ format }).subscribe({
      next: (res) => {
        this.backupLoading = false;
        this.success = `Backup criado: ${res.filename}`;
        this.loadBackups();
      },
      error: (err) => {
        this.backupLoading = false;
        this.error = err.error?.error || 'Erro ao criar backup';
      }
    });
  }

  loadBackups(): void {
    this.apiService.listBackups().subscribe({
      next: (list) => {
        this.backups = list;
      },
      error: (err) => {
        // não interrompe o uso do modal
      }
    });
  }

  downloadBackup(name: string): void {
    this.apiService.downloadBackup(name).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: (err) => {
        this.error = err.error?.error || 'Erro ao baixar backup';
      }
    });
  }

  restoreBackup(name: string): void {
    if (!confirm(`Restaurar backup '${name}' irá sobrescrever o banco de dados atual. Deseja prosseguir?`)) {
      return;
    }
    this.backupLoading = true;
    this.apiService.restoreBackup(name).subscribe({
      next: () => {
        this.backupLoading = false;
        this.success = `Backup '${name}' restaurado com sucesso. Reinicie a aplicação se necessário.`;
      },
      error: (err) => {
        this.backupLoading = false;
        this.error = err.error?.error || 'Erro ao restaurar backup';
      }
    });
  }

  confirmAndReset(): void {
    if (this.criticalConfirmationInput !== this.resetConfirmationPhrase) {
      this.error = 'A frase de confirmação não corresponde exatamente.';
      return;
    }
    if (!confirm('Confirma executar o reset selecionado? Esta ação é irreversível.')) {
      return;
    }
    this.loading = true;
    this.apiService.resetDatabase({ mode: this.resetMode, confirmationPhrase: this.criticalConfirmationInput }).subscribe({
      next: () => {
        this.loading = false;
        this.success = 'Reset executado com sucesso.';
        this.showCriticalTools = false;
        // Opcional: forçar recarregamento da aplicação
        setTimeout(() => window.location.reload(), 1500);
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.error || 'Erro ao executar reset';
      }
    });
  }
}
