import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError, take, switchMap } from 'rxjs/operators';
import { CaixaService } from '../services/caixa.service';
import { AuthService } from '../services/auth';
import { logger } from '../utils/logger';

@Injectable({
    providedIn: 'root'
})
export class CaixaGuard implements CanActivate {
    constructor(
        private readonly caixaService: CaixaService,
        private readonly authService: AuthService,
        private readonly router: Router
    ) { }

    canActivate(): Observable<boolean> {
        // Esperar pelo status do caixa (buscar se necessário) antes de permitir
        // a navegação, para que o componente POS receba o status imediatamente
        // e possa mostrar o overlay quando aplicável. Ainda assim, sempre
        // permitimos a navegação retornando `true`.
        return this.caixaService.statusCaixa$.pipe(
            switchMap(status => status !== null ? of(status) : this.caixaService.getStatusCaixa()),
            take(1),
            map(status => {
                if (status && !status.aberto) {
                    logger.warn('CAIXA_GUARD', 'STATUS_CLOSED', 'Caixa fechado - navegacao permitida para exibir overlay no POS');
                } else {
                    logger.info('CAIXA_GUARD', 'STATUS_OPEN', 'Caixa aberto - navegacao permitida');
                }
                return true;
            }),
            catchError(e => {
                logger.error('CAIXA_GUARD', 'CHECK_ERROR', 'Erro ao verificar status do caixa', e);
                return of(true);
            })
        );
    }
}
