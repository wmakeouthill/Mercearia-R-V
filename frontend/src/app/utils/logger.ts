export interface LogEntry {
    timestamp: string;
    level: 'INFO' | 'WARN' | 'ERROR' | 'API_REQUEST' | 'API_RESPONSE';
    component: string;
    action: string;
    message: string;
    data?: any;
    error?: any;
}

class Logger {
    private logs: LogEntry[] = [];
    private maxLogs = 500; // Reduzir limite para melhor performance
    private maxStorageSize = 2 * 1024 * 1024; // 2MB máximo no localStorage
    private autoCleanupInterval: number | null = null;
    private ipcWriteAvailable: boolean = false;

    constructor() {
        this.loadFromStorage();
        this.startAutoCleanup();
        // Detectar API do Electron para escrita em arquivo
        try {
            this.ipcWriteAvailable = Boolean((window as any)?.electronAPI?.writeLog);
        } catch {
            this.ipcWriteAvailable = false;
        }
    }

    private addLog(entry: LogEntry): void {
        this.logs.push(entry);

        // Manter apenas os últimos logs
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }

        // Salvar no localStorage para persistência (com verificação de tamanho)
        this.saveToStorage();

        // Log no console para desenvolvimento
        console.log(`[${entry.level}] ${entry.component}: ${entry.message}`, entry.data || '');

        // Encaminhar para arquivo via Electron (se disponível)
        if (this.ipcWriteAvailable) {
            try {
                const line = JSON.stringify(entry);
                (window as any).electronAPI.writeLog(line);
            } catch (err) {
                // Se falhar uma vez, evitar tentar em excesso
                this.ipcWriteAvailable = false;
            }
        }
    }

    private startAutoCleanup(): void {
        // Verificação automática a cada 2 horas (não precisa ser tão frequente)
        const scheduleCleanup = () => {
            this.autoCleanupInterval = window.setTimeout(() => {
                this.performAutoCleanup();
                scheduleCleanup(); // Reagendar para próxima verificação
            }, 2 * 60 * 60 * 1000); // 2 horas
        };

        scheduleCleanup();
    }

    private performAutoCleanup(): void {
        const oldCount = this.logs.length;

        // Remover logs mais antigos que 7 dias (tempo mais sensato)
        const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 dias
        this.logs = this.logs.filter(log => new Date(log.timestamp).getTime() > cutoffTime);

        // Se ainda tiver muitos logs, manter apenas os 400 mais recentes (limite de segurança)
        if (this.logs.length > 400) {
            console.log(`⚠️ Muitos logs (${this.logs.length}), mantendo apenas os 400 mais recentes`);
            this.logs = this.logs.slice(-400);
        }

        const newCount = this.logs.length;
        if (oldCount !== newCount) {
            console.log(`🧹 Auto-limpeza de logs: ${oldCount} → ${newCount} logs (removidos logs > 7 dias)`);
            this.saveToStorage();
        }
    }

    private saveToStorage(): void {
        try {
            const logsData = JSON.stringify(this.logs);

            // Verificar tamanho antes de salvar
            if (logsData.length > this.maxStorageSize) {
                console.warn('⚠️ Logs muito grandes para localStorage, reduzindo...');
                // Manter apenas os 200 logs mais recentes se o tamanho for muito grande
                this.logs = this.logs.slice(-200);
                localStorage.setItem('app_logs', JSON.stringify(this.logs));
            } else {
                localStorage.setItem('app_logs', logsData);
            }
        } catch (error) {
            console.error('Erro ao salvar logs:', error);
            // Se der erro de quota, limpar e tentar novamente com menos logs
            if ((error as any)?.name === 'QuotaExceededError') {
                console.warn('🧹 Quota excedida, limpando logs antigos...');
                this.logs = this.logs.slice(-100);
                try {
                    localStorage.setItem('app_logs', JSON.stringify(this.logs));
                } catch (e) {
                    console.error('Erro crítico no localStorage, limpando completamente');
                    this.clearLogs();
                }
            }
        }
    }

    private loadFromStorage(): void {
        try {
            const stored = localStorage.getItem('app_logs');
            if (stored) {
                this.logs = JSON.parse(stored);
                console.log(`📂 Carregados ${this.logs.length} logs do localStorage`);

                // Verificar se há logs muito antigos na inicialização (7 dias)
                const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 dias
                const oldCount = this.logs.length;
                this.logs = this.logs.filter(log => new Date(log.timestamp).getTime() > cutoffTime);

                if (oldCount !== this.logs.length) {
                    console.log(`🧹 Limpeza inicial: ${oldCount} → ${this.logs.length} logs (removidos logs > 7 dias)`);
                    this.saveToStorage();
                }
            }
        } catch (error) {
            console.error('Erro ao carregar logs:', error);
            this.logs = [];
        }
    }

    // Logs de API
    logApiRequest(component: string, action: string, url: string, data?: any): void {
        this.addLog({
            timestamp: new Date().toISOString(),
            level: 'API_REQUEST',
            component,
            action,
            message: `API Request: ${url}`,
            data: { url, requestData: data }
        });
    }

    logApiResponse(component: string, action: string, url: string, response: any, success: boolean): void {
        this.addLog({
            timestamp: new Date().toISOString(),
            level: 'API_RESPONSE',
            component,
            action,
            message: `API Response: ${url} - ${success ? 'SUCCESS' : 'ERROR'}`,
            data: { url, response, success }
        });
    }

    logApiError(component: string, action: string, url: string, error: any): void {
        this.addLog({
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            component,
            action,
            message: `API Error: ${url}`,
            error: { url, error: error.message || error }
        });
    }

    // Logs gerais
    info(component: string, action: string, message: string, data?: any): void {
        this.addLog({
            timestamp: new Date().toISOString(),
            level: 'INFO',
            component,
            action,
            message,
            data
        });
    }

    warn(component: string, action: string, message: string, data?: any): void {
        this.addLog({
            timestamp: new Date().toISOString(),
            level: 'WARN',
            component,
            action,
            message,
            data
        });
    }

    error(component: string, action: string, message: string, error?: any): void {
        this.addLog({
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            component,
            action,
            message,
            error
        });
    }

    // Exportar logs
    exportLogs(): string {
        return JSON.stringify(this.logs, null, 2);
    }

    // Limpar logs
    clearLogs(): void {
        this.logs = [];
        localStorage.removeItem('app_logs');
        console.log('🧹 Todos os logs foram limpos');
    }

    // Parar limpeza automática (útil para testes)
    stopAutoCleanup(): void {
        if (this.autoCleanupInterval !== null) {
            window.clearTimeout(this.autoCleanupInterval);
            this.autoCleanupInterval = null;
            console.log('⏹️ Limpeza automática de logs parada');
        }
    }

    // Limpar logs antigos (mais de X dias)
    clearOldLogs(daysAgo: number = 7): void {
        const cutoffTime = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
        const oldCount = this.logs.length;
        this.logs = this.logs.filter(log => new Date(log.timestamp).getTime() > cutoffTime);

        if (oldCount !== this.logs.length) {
            console.log(`🧹 Logs antigos removidos: ${oldCount} → ${this.logs.length} logs (removidos logs > ${daysAgo} dias)`);
            this.saveToStorage();
        } else {
            console.log(`ℹ️ Nenhum log mais antigo que ${daysAgo} dias encontrado`);
        }
    }

    // Obter estatísticas de memória dos logs
    getLogStats(): { count: number, memoryUsage: string, oldestLog?: string, newestLog?: string } {
        const logsData = JSON.stringify(this.logs);
        const sizeInBytes = new Blob([logsData]).size;
        const sizeInKB = (sizeInBytes / 1024).toFixed(2);

        return {
            count: this.logs.length,
            memoryUsage: `${sizeInKB} KB`,
            oldestLog: this.logs.length > 0 ? this.logs[0].timestamp : undefined,
            newestLog: this.logs.length > 0 ? this.logs[this.logs.length - 1].timestamp : undefined
        };
    }

    // Obter logs
    getLogs(): LogEntry[] {
        return [...this.logs];
    }

    // Obter logs por nível
    getLogsByLevel(level: LogEntry['level']): LogEntry[] {
        return this.logs.filter(log => log.level === level);
    }

    // Obter logs por componente
    getLogsByComponent(component: string): LogEntry[] {
        return this.logs.filter(log => log.component === component);
    }
}

export const logger = new Logger();
