import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { logger, LogEntry } from '../../utils/logger';
import { saveLogsToFile, exportLogsToCSV, getLogStats } from '../../utils/file-logger';

@Component({
  selector: 'app-logs-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="logs-container">
      <div class="logs-header">
        <div class="header-left">
          <button (click)="voltarAoDashboard()" class="btn-voltar">← Voltar ao Dashboard</button>
          <h2>📊 Logs do Sistema</h2>
        </div>
        <div class="logs-controls">
          <select [(ngModel)]="selectedLevel" (change)="filterLogs()">
            <option value="">Todos os níveis</option>
            <option value="INFO">Info</option>
            <option value="WARN">Warning</option>
            <option value="ERROR">Error</option>
            <option value="API_REQUEST">API Request</option>
            <option value="API_RESPONSE">API Response</option>
          </select>

          <select [(ngModel)]="selectedComponent" (change)="filterLogs()">
            <option value="">Todos os componentes</option>
            @for (comp of components; track comp) {<option [value]="comp">{{ comp }}</option>}
          </select>

          <button (click)="clearLogs()" class="btn-clear">Limpar Logs</button>
          <button (click)="clearOldLogs()" class="btn-clear-old">Limpar Antigos</button>
          <button (click)="showLogStats()" class="btn-stats">Estatísticas</button>
          <button (click)="exportLogs()" class="btn-export">Exportar JSON</button>
          <button (click)="exportLogsCSV()" class="btn-export">Exportar CSV</button>
          <button (click)="saveLogsFile()" class="btn-save">Salvar Arquivo</button>
        </div>
      </div>

      <div class="logs-stats">
        <div class="stat">
          <span class="stat-label">Total:</span>
          <span class="stat-value">{{ filteredLogs.length }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Info:</span>
          <span class="stat-value info">{{ getLogsByLevel('INFO').length }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Warnings:</span>
          <span class="stat-value warn">{{ getLogsByLevel('WARN').length }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Errors:</span>
          <span class="stat-value error">{{ getLogsByLevel('ERROR').length }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">API Requests:</span>
          <span class="stat-value api">{{ getLogsByLevel('API_REQUEST').length }}</span>
        </div>
      </div>

      <div class="logs-content">
        @if (filteredLogs.length === 0) {<div class="no-logs">
          Nenhum log encontrado
        </div>}

        @for (log of filteredLogs; track log.timestamp) {<div class="log-entry" [class]="'log-' + log.level.toLowerCase()">
          <div class="log-header">
            <span class="log-timestamp">{{ formatTimestamp(log.timestamp) }}</span>
            <span class="log-level" [class]="'level-' + log.level.toLowerCase()">{{ log.level }}</span>
            <span class="log-component">{{ log.component }}</span>
            <span class="log-action">{{ log.action }}</span>
          </div>
          <div class="log-message">{{ log.message }}</div>
          @if (log.data) {<div class="log-data">
            <pre>{{ formatData(log.data) }}</pre>
          </div>}
          @if (log.error) {<div class="log-error">
            <pre>{{ formatData(log.error) }}</pre>
          </div>}
        </div>}
      </div>
    </div>
  `,
  styles: [`
    .logs-container {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .logs-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 10px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .btn-voltar {
      padding: 8px 16px;
      background: #6c757d;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      text-decoration: none;
    }

    .btn-voltar:hover {
      background: #5a6268;
    }

    .logs-header h2 {
      margin: 0;
      color: #333;
    }

    .logs-controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .logs-controls select {
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: white;
    }

    .btn-clear, .btn-export {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }

    .btn-clear {
      background: #dc3545;
      color: white;
    }

    .btn-export {
      background: #28a745;
      color: white;
    }

    .btn-save {
      background: #007bff;
      color: white;
    }

    .btn-clear-old {
      background: #ffc107;
      color: black;
    }

    .btn-stats {
      background: #17a2b8;
      color: white;
    }

    .logs-stats {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 10px;
      background: #f8f9fa;
      border-radius: 8px;
      min-width: 80px;
    }

    .stat-label {
      font-size: 12px;
      color: #666;
      margin-bottom: 4px;
    }

    .stat-value {
      font-size: 18px;
      font-weight: bold;
    }

    .stat-value.info { color: #17a2b8; }
    .stat-value.warn { color: #ffc107; }
    .stat-value.error { color: #dc3545; }
    .stat-value.api { color: #28a745; }

    .logs-content {
      max-height: 600px;
      overflow-y: auto;
      border: 1px solid #ddd;
      border-radius: 8px;
      background: white;
    }

    .no-logs {
      padding: 40px;
      text-align: center;
      color: #666;
      font-style: italic;
    }

    .log-entry {
      padding: 15px;
      border-bottom: 1px solid #eee;
      font-family: 'Courier New', monospace;
      font-size: 13px;
    }

    .log-entry:last-child {
      border-bottom: none;
    }

    .log-entry.log-error {
      background: #fff5f5;
      border-left: 4px solid #dc3545;
    }

    .log-entry.log-warn {
      background: #fffbf0;
      border-left: 4px solid #ffc107;
    }

    .log-entry.log-info {
      background: #f0f8ff;
      border-left: 4px solid #17a2b8;
    }

    .log-entry.log-api_request {
      background: #f0fff0;
      border-left: 4px solid #28a745;
    }

    .log-entry.log-api_response {
      background: #f0f8ff;
      border-left: 4px solid #007bff;
    }

    .log-header {
      display: flex;
      gap: 15px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .log-timestamp {
      color: #666;
      font-size: 11px;
    }

    .log-level {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: bold;
      text-transform: uppercase;
    }

    .level-info { background: #17a2b8; color: white; }
    .level-warn { background: #ffc107; color: black; }
    .level-error { background: #dc3545; color: white; }
    .level-api_request { background: #28a745; color: white; }
    .level-api_response { background: #007bff; color: white; }

    .log-component {
      font-weight: bold;
      color: #333;
    }

    .log-action {
      color: #666;
      font-style: italic;
    }

    .log-message {
      margin-bottom: 8px;
      color: #333;
    }

    .log-data, .log-error {
      background: #f8f9fa;
      padding: 8px;
      border-radius: 4px;
      margin-top: 8px;
      font-size: 11px;
      max-height: 200px;
      overflow-y: auto;
    }

    .log-error {
      background: #fff5f5;
      color: #dc3545;
    }

    pre {
      margin: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    @media (max-width: 768px) {
      .logs-header {
        flex-direction: column;
        align-items: stretch;
      }

      .logs-controls {
        justify-content: center;
      }

      .logs-stats {
        justify-content: center;
      }

      .log-header {
        flex-direction: column;
        gap: 5px;
      }
    }
  `]
})
export class LogsViewerComponent implements OnInit {
  logs: LogEntry[] = [];
  filteredLogs: LogEntry[] = [];
  selectedLevel = '';
  selectedComponent = '';
  components: string[] = [];

  constructor(private router: Router) { }

  ngOnInit(): void {
    this.loadLogs();
    this.extractComponents();
  }

  loadLogs(): void {
    this.logs = logger.getLogs();
    this.filteredLogs = [...this.logs];
  }

  extractComponents(): void {
    const componentSet = new Set<string>();
    this.logs.forEach(log => componentSet.add(log.component));
    this.components = Array.from(componentSet).sort();
  }

  filterLogs(): void {
    this.filteredLogs = this.logs.filter(log => {
      const levelMatch = !this.selectedLevel || log.level === this.selectedLevel;
      const componentMatch = !this.selectedComponent || log.component === this.selectedComponent;
      return levelMatch && componentMatch;
    });
  }

  getLogsByLevel(level: string): LogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  clearLogs(): void {
    if (confirm('Tem certeza que deseja limpar todos os logs?')) {
      logger.clearLogs();
      this.loadLogs();
      this.extractComponents();
    }
  }

  clearOldLogs(): void {
    if (confirm('Deseja limpar logs mais antigos que 7 dias?')) {
      logger.clearOldLogs(7);
      this.loadLogs();
      this.extractComponents();
    }
  }

  showLogStats(): void {
    const stats = logger.getLogStats();
    const message = `📊 ESTATÍSTICAS DOS LOGS

Total: ${stats.count} logs
Uso de memória: ${stats.memoryUsage}

Log mais antigo: ${stats.oldestLog ? new Date(stats.oldestLog).toLocaleString('pt-BR') : 'N/A'}
Log mais recente: ${stats.newestLog ? new Date(stats.newestLog).toLocaleString('pt-BR') : 'N/A'}

💡 Os logs são automaticamente limpos:
- Após 7 dias (verificação a cada 2 horas)
- Quando excedem 500 entradas
- Quando ultrapassam 2MB de memória
- Máximo de 400 logs mesmo se recentes`;

    alert(message);
  }

  exportLogs(): void {
    const logsJson = logger.exportLogs();
    const blob = new Blob([logsJson], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sistema-logs-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  exportLogsCSV(): void {
    exportLogsToCSV();
  }

  saveLogsFile(): void {
    saveLogsToFile();
  }

  formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo'
    });
  }

  formatData(data: any): string {
    return JSON.stringify(data, null, 2);
  }

  voltarAoDashboard(): void {
    this.router.navigate(['/dashboard']);
  }
}
