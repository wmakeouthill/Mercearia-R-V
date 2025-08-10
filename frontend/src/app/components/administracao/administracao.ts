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
    private apiService: ApiService,
    private authService: AuthService,
    private router: Router
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
      next: async (response) => {
        this.success = 'Usuário atualizado com sucesso!';
        user.isEditing = false;
        
        // Se o usuário editado é o próprio usuário logado, recarregar suas informações
        if (user.id === this.currentUser?.id) {
          await this.authService.reloadCurrentUser();
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

  getRoleDisplayName(role: string): string {
    return role === 'admin' ? 'Administrador' : 'Operador';
  }

  clearMessages(): void {
    this.error = '';
    this.success = '';
  }
} 