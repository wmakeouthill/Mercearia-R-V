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

    // Utilitários
    platform: process.platform,
    isDev: process.env.NODE_ENV === 'development'
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
        };
    }
} 