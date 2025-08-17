import { contextBridge, ipcRenderer } from 'electron';

// Expor APIs seguras para o frontend
contextBridge.exposeInMainWorld('electronAPI', {
    // Informações da aplicação
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getAppName: () => ipcRenderer.invoke('get-app-name'),

    // Teste de conexão com backend
    testBackendConnection: () => ipcRenderer.invoke('test-backend-connection'),

    // Eventos da aplicação
    onAppReady: (callback: () => void) => {
        ipcRenderer.on('app-ready', callback);
    },
    // Eventos do splash (status/progresso)
    onSplashStatus: (callback: (data: { message?: string; percent?: number }) => void) => {
        ipcRenderer.on('splash-status', (_event, data) => callback(data));
    },

    // Utilitários
    platform: process.platform,
    isDev: process.env.NODE_ENV === 'development',
    // Backend URL exposto para o frontend (preenchido pelo processo principal)
    getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),

    // Log: enviar linha de log para o processo principal gravar em arquivo
    writeLog: (line: string) => ipcRenderer.invoke('write-log', line)
});

// Tipos para TypeScript
declare global {
    interface Window {
        electronAPI: {
            getAppVersion: () => Promise<string>;
            getAppName: () => Promise<string>;
            testBackendConnection: () => Promise<any>;
            onAppReady: (callback: () => void) => void;
            platform: string;
            isDev: boolean;
            writeLog: (line: string) => Promise<void>;
        };
    }
} 