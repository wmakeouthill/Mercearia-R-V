import { logger } from './logger';

// Função para salvar logs em arquivo na raiz do projeto
export function saveLogsToFile(): void {
    try {
        const logs = logger.getLogs();
        const logsJson = JSON.stringify(logs, null, 2);

        // Criar blob com os logs
        const blob = new Blob([logsJson], { type: 'application/json' });

        // Criar link de download
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sistema-logs-${new Date().toISOString().split('T')[0]}.json`;

        // Simular clique para download
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Limpar URL
        window.URL.revokeObjectURL(url);

        console.log('Logs salvos com sucesso!');
    } catch (error) {
        console.error('Erro ao salvar logs:', error);
    }
}

// Função para exportar logs em formato CSV
export function exportLogsToCSV(): void {
    try {
        const logs = logger.getLogs();

        // Cabeçalho CSV
        let csvContent = 'Timestamp,Level,Component,Action,Message,Data,Error\n';

        // Dados CSV
        logs.forEach(log => {
            const timestamp = new Date(log.timestamp).toLocaleString('pt-BR');
            const level = log.level;
            const component = log.component;
            const action = log.action;
            const message = log.message.replace(/"/g, '""'); // Escapar aspas
            const data = log.data ? JSON.stringify(log.data).replace(/"/g, '""') : '';
            const error = log.error ? JSON.stringify(log.error).replace(/"/g, '""') : '';

            csvContent += `"${timestamp}","${level}","${component}","${action}","${message}","${data}","${error}"\n`;
        });

        // Criar blob com CSV
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sistema-logs-${new Date().toISOString().split('T')[0]}.csv`;

        // Simular clique para download
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Limpar URL
        window.URL.revokeObjectURL(url);

        console.log('Logs exportados para CSV com sucesso!');
    } catch (error) {
        console.error('Erro ao exportar logs para CSV:', error);
    }
}

// Função para salvar logs automaticamente a cada intervalo
export function startAutoSaveLogs(intervalMinutes: number = 30): void {
    window.setInterval(() => {
        const logs = logger.getLogs();
        if (logs.length > 0) {
            console.log(`Auto-save: Salvando ${logs.length} logs...`);
            saveLogsToFile();
        }
    }, intervalMinutes * 60 * 1000);
}

// Função para obter estatísticas dos logs
export function getLogStats(): any {
    const logs = logger.getLogs();

    const stats = {
        total: logs.length,
        byLevel: {} as any,
        byComponent: {} as any,
        byHour: {} as any,
        recentActivity: logs.slice(-10) // Últimos 10 logs
    };

    logs.forEach(log => {
        // Por nível
        stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;

        // Por componente
        stats.byComponent[log.component] = (stats.byComponent[log.component] || 0) + 1;

        // Por hora
        const hour = new Date(log.timestamp).getHours();
        stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
    });

    return stats;
} 