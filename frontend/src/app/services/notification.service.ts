import { Injectable } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface AppNotification { type: 'success' | 'info' | 'error'; message: string }

@Injectable({ providedIn: 'root' })
export class NotificationService {
    private readonly subject = new Subject<AppNotification>();

    notify(n: AppNotification): void {
        this.subject.next(n);
    }

    onNotify(): Observable<AppNotification> {
        return this.subject.asObservable();
    }
}


