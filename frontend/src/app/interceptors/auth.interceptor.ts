import { HttpRequest, HttpHandlerFn, HttpErrorResponse, HttpEvent } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { logger } from '../utils/logger';

export function AuthInterceptor(
    request: HttpRequest<unknown>,
    next: HttpHandlerFn
): Observable<HttpEvent<unknown>> {
    const authService = inject(AuthService);
    const router = inject(Router);

    const token = authService.getToken();

    if (token) {
        request = request.clone({
            setHeaders: {
                Authorization: `Bearer ${token}`
            }
        });
    }

    return next(request).pipe(
        tap((response: any) => {
            // Log de sucesso
            logger.logApiResponse('HTTP_INTERCEPTOR', 'REQUEST', request.url, response, true);
        }),
        catchError((error: HttpErrorResponse) => {
            // Log de erro
            logger.logApiError('HTTP_INTERCEPTOR', 'REQUEST', request.url, error);

            if (error.status === 401) {
                // Token expirado ou inválido
                logger.warn('HTTP_INTERCEPTOR', 'AUTH', 'Token expirado, redirecionando para login');
                authService.logout();
                router.navigate(['/login']);
            }
            return throwError(() => error);
        })
    );
} 