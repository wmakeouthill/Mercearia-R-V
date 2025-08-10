import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError, filter, take, switchMap } from 'rxjs/operators';
import { CaixaService } from '../services/caixa.service';
import { AuthService } from '../services/auth';
import { logger } from '../utils/logger';

@Injectable({
    providedIn: 'root'
})
export class CaixaGuard implements CanActivate {
    constructor(
        private caixaService: CaixaService,
        private authService: AuthService,
        private router: Router
    ) { }

    canActivate(): Observable<boolean> {
        // Administradores sempre podem acessar o ponto de venda
        if (this.authService.isAdmin()) {
            return of(true);
        }

        // Para operadores, verificar se o caixa está aberto
        return this.caixaService.statusCaixa$.pipe(
            switchMap(status => {
                if (status !== null) {
                    return of(status);
                } else {
                    return this.caixaService.getStatusCaixa();
                }
            }),
            take(1),
            map(status => {
                if (status.aberto) {
                    logger.info('CAIXA_GUARD', 'ACCESS_ALLOWED', 'Acesso ao ponto de venda permitido - caixa aberto');
                    return true;
                } else {
                    logger.warn('CAIXA_GUARD', 'ACCESS_DENIED', 'Acesso ao ponto de venda negado - caixa fechado');
                    // Redirecionar para dashboard com mensagem
                    this.router.navigate(['/dashboard'], {
                        queryParams: { error: 'caixa_fechado' }
                    });
                    return false;
                }
            }),
            catchError(error => {
                logger.error('CAIXA_GUARD', 'ERROR', 'Erro ao verificar status do caixa', error);
                // Em caso de erro, negar acesso por segurança
                this.router.navigate(['/dashboard'], {
                    queryParams: { error: 'erro_verificacao_caixa' }
                });
                return of(false);
            })
        );
    }
}