import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-confirm-modal',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './confirm-modal.html',
    styleUrls: ['./confirm-modal.scss']
})
export class ConfirmModalComponent {
    @Input() title: string = 'Confirmação';
    @Input() message: string = '';
    @Output() confirm = new EventEmitter<void>();
    @Output() cancel = new EventEmitter<void>();

    onConfirm(): void { this.confirm.emit(); }
    onCancel(): void { this.cancel.emit(); }

    onOverlayClick(event: MouseEvent): void {
        // Fecha o modal apenas quando clica no overlay (fora da caixa do modal)
        if (event.target === event.currentTarget) {
            this.cancel.emit();
        }
    }

    onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape' || event.key === 'Esc') {
            this.cancel.emit();
        }
    }
}


