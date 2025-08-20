import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, AppNotification } from '../../services/notification.service';

@Component({
    selector: 'app-notification',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="modern-notification" [class.show]="visible" [class.info]="type==='info'" [class.error]="type==='error'">
      <div class="notification-content">
        <div class="notification-icon">{{ type==='info' ? 'ℹ️' : (type==='error' ? '❌' : '✅') }}</div>
        <div class="notification-text">{{ message }}</div>
        <button class="notification-close" (click)="hide()">×</button>
      </div>
    </div>
  `,
    styles: [
        `.modern-notification{position:fixed;bottom:18px;right:-420px;z-index:1200;max-width:380px;min-width:280px;transition:all .35s cubic-bezier(.175,.885,.32,1.275);opacity:0;transform:translateX(100px)}
     .modern-notification.show{right:18px;opacity:1;transform:none}
     .modern-notification .notification-content{background:rgba(255,255,255,.98);backdrop-filter:blur(6px);border:1px solid rgba(0,0,0,.06);border-radius:12px;padding:14px 16px;display:flex;gap:12px;align-items:center}
     .notification-icon{font-size:20px}
     .notification-text{flex:1}
     .notification-close{background:transparent;border:none;font-size:18px;cursor:pointer}
     .modern-notification.error .notification-content{border-color:rgba(220,53,69,.2)}
     .modern-notification.info .notification-content{border-color:rgba(13,110,253,.18)}`
    ]
})
export class NotificationComponent implements OnInit {
    visible = false;
    type: 'success' | 'info' | 'error' = 'info';
    message = '';
    private timeoutRef: any = null;

    constructor(private readonly notificationService: NotificationService) { }

    ngOnInit(): void {
        this.notificationService.onNotify().subscribe((n: AppNotification) => {
            this.show(n);
        });
    }

    show(n: AppNotification): void {
        this.type = n.type;
        this.message = n.message;
        this.visible = true;
        if (this.timeoutRef) clearTimeout(this.timeoutRef);
        this.timeoutRef = setTimeout(() => this.hide(), 4500);
    }

    hide(): void {
        this.visible = false;
        if (this.timeoutRef) { clearTimeout(this.timeoutRef); this.timeoutRef = null; }
    }
}


