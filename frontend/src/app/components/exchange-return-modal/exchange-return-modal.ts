import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-exchange-return-modal',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './exchange-return-modal.html',
    styleUrls: ['./exchange-return-modal.scss']
})
export class ExchangeReturnModalComponent {
    @Output() close = new EventEmitter<void>();

    // UI state (static for first iteration)
    mode: 'devolucao' | 'troca' = 'devolucao';
    selectedLineIndex: number | null = null;
    returnQuantity = 1;
    replacementProductId: number | null = null;
    additionalPayment = 0;
    notes = '';

    onOverlayClick(e: MouseEvent): void {
        if (e.target === e.currentTarget) this.close.emit();
    }

    confirm(): void {
        // placeholder: will call backend in next steps
        alert('Ação de troca/devolução confirmada (implementação futura)');
        this.close.emit();
    }

    cancel(): void { this.close.emit(); }
}


