import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'currencyBR',
    standalone: true
})
export class CurrencyBrPipe implements PipeTransform {
    transform(value: number | string | null | undefined, includeSymbol: boolean = true): string {
        const num = Number(value || 0);
        const formatted = num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return includeSymbol ? `R$ ${formatted}` : formatted;
    }
}


