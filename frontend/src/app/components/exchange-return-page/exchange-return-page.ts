import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExchangeReturnListComponent } from '../exchange-return-list/exchange-return-list';
import { Router } from '@angular/router';

@Component({
    selector: 'app-exchange-return-page',
    standalone: true,
    imports: [CommonModule, ExchangeReturnListComponent],
    templateUrl: './exchange-return-page.html',
    styleUrls: ['./exchange-return-page.scss']
})
export class ExchangeReturnPageComponent {
    constructor(private readonly router: Router) { }

    goBack(): void { try { this.router.navigate(['/vendas']); } catch (e) { window.history.back(); } }
}


