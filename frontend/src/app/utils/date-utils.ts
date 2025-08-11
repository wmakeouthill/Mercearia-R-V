/**
 * Utilitários para tratamento correto de datas, evitando problemas de fuso horário (UTC)
 */

/**
 * Converte uma string de data para Date, tratando corretamente o timezone
 * @param dateString String da data (pode ou não ter timezone)
 * @returns Date object parseado corretamente
 */
export function parseDate(dateString: string): Date {
    if (!dateString) {
        throw new Error('Data inválida: string vazia');
    }

    // Se a data não tem timezone (como '2024-01-15T10:30:00'),
    // adicionar 'Z' para forçar interpretação como UTC
    let dataParseada = dateString;
    if (!dateString.includes('Z') && !dateString.includes('+') && !dateString.includes('-', 10)) {
        dataParseada = dateString + 'Z';
    }

    const date = new Date(dataParseada);

    if (isNaN(date.getTime())) {
        throw new Error(`Data inválida: ${dateString}`);
    }

    return date;
}

/**
 * Extrai data local de uma string ISO, considerando fuso horário local
 * @param dateString String da data em formato ISO
 * @returns String no formato YYYY-MM-DD
 */
export function extractLocalDate(dateString: string): string {
    try {
        const date = parseDate(dateString);

        // Usar métodos de data local do browser que já consideram o fuso horário
        const localDate = new Date(date.getTime());

        return localDate.getFullYear() + '-' +
            String(localDate.getMonth() + 1).padStart(2, '0') + '-' +
            String(localDate.getDate()).padStart(2, '0');
    } catch (error) {
        console.error('Erro ao extrair data local:', error);
        return '';
    }
}

/**
 * Extrai mês/ano de uma string ISO para agrupamentos, considerando fuso horário local
 * @param dateString String da data em formato ISO
 * @returns String no formato YYYY-MM
 */
export function extractYearMonth(dateString: string): string {
    try {
        const date = parseDate(dateString);

        // Usar métodos de data local do browser
        const localDate = new Date(date.getTime());

        return `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}`;
    } catch (error) {
        console.error('Erro ao extrair ano/mês:', error);
        return '';
    }
}

/**
 * Formata uma data para exibição em formato brasileiro
 * @param dateString String da data em formato ISO
 * @param includeTime Se deve incluir hora e minutos
 * @returns String formatada (DD/MM/YYYY ou DD/MM/YYYY HH:mm)
 */
export function formatDateBR(dateString: string, includeTime: boolean = false): string {
    try {
        if (!dateString) return 'Data não disponível';

        const date = parseDate(dateString);

        // Usar toLocaleDateString para considerar o fuso horário local automaticamente
        if (includeTime) {
            return date.toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'America/Sao_Paulo'
            });
        } else {
            return date.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                timeZone: 'America/Sao_Paulo'
            });
        }
    } catch (error) {
        console.error('Erro ao formatar data:', error);
        return 'Data inválida';
    }
}

/**
 * Formata apenas a hora de uma data
 * @param dateString String da data em formato ISO
 * @returns String no formato HH:mm
 */
export function formatTimeBR(dateString: string): string {
    try {
        if (!dateString) return '--:--';

        const date = parseDate(dateString);

        // Usar toLocaleTimeString para considerar o fuso horário brasileiro automaticamente
        return date.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo'
        });
    } catch (error) {
        console.error('Erro ao formatar hora:', error);
        return '--:--';
    }
}

/**
 * Obtém a data atual no formato YYYY-MM-DD para inputs
 * @returns String da data atual
 */
export function getCurrentDateForInput(): string {
    // Retornar data LOCAL (YYYY-MM-DD) evitando deslocamento por UTC
    const hoje = new Date();
    const yyyy = hoje.getFullYear();
    const mm = String(hoje.getMonth() + 1).padStart(2, '0');
    const dd = String(hoje.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Formata uma data no formato YYYY-MM-DD para exibição brasileira
 * @param dateString String no formato YYYY-MM-DD (ex: "2024-01-15")
 * @returns String formatada DD/MM/YYYY
 */
export function formatDateYMD(dateString: string): string {
    try {
        if (!dateString) return 'Data não disponível';

        // Para formato YYYY-MM-DD, criar data local sem problemas de fuso
        const parts = dateString.split('-');
        if (parts.length !== 3) return 'Data inválida';

        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; // JavaScript usa mês 0-11
        const day = parseInt(parts[2]);

        if (isNaN(year) || isNaN(month) || isNaN(day)) return 'Data inválida';

        // Criar data local sem conversão de fuso horário
        const date = new Date(year, month, day);

        return date.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch (error) {
        console.error('Erro ao formatar data YMD:', error);
        return 'Data inválida';
    }
}

/**
 * Função de teste para verificar o comportamento das datas
 * Execute no console para debug: import { testDateHandling } from './utils/date-utils'
 */
export function testDateHandling(): void {
    console.log('🧪 TESTE DE MANIPULAÇÃO DE DATAS');
    console.log('='.repeat(50));

    // Dados de teste (exemplos do seu banco)
    const testDates = [
        '2024-01-15T10:30:00',    // Sem timezone (do seed)
        '2024-01-15T10:30:00Z',   // Com UTC
        new Date().toISOString()   // Data atual
    ];

    testDates.forEach((dateStr, index) => {
        console.log(`\n📅 Teste ${index + 1}: ${dateStr}`);
        console.log(`  extractLocalDate: ${extractLocalDate(dateStr)}`);
        console.log(`  extractYearMonth: ${extractYearMonth(dateStr)}`);
        console.log(`  formatDateBR: ${formatDateBR(dateStr)}`);
        console.log(`  formatDateBR+time: ${formatDateBR(dateStr, true)}`);
        console.log(`  formatTimeBR: ${formatTimeBR(dateStr)}`);
    });

    console.log('\n💡 Se as datas estão 1 dia incorretas, o problema foi identificado!');
}
