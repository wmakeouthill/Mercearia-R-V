import { contextBridge, ipcRenderer } from 'electron';

// Debugging localStorage
const originalSetItem = localStorage.setItem;
const originalGetItem = localStorage.getItem;
const originalRemoveItem = localStorage.removeItem;

localStorage.setItem = function (key: string, value: string) {
    console.log(`📦 localStorage.setItem: ${key}`, value.substring(0, 100) + (value.length > 100 ? '...' : ''));
    try {
        const result = originalSetItem.call(this, key, value);
        console.log(`✅ localStorage.setItem success: ${key}`);
        return result;
    } catch (error) {
        console.error(`❌ localStorage.setItem error: ${key}`, error);
        throw error;
    }
};

localStorage.getItem = function (key: string) {
    try {
        const result = originalGetItem.call(this, key);
        console.log(`📦 localStorage.getItem: ${key}`, result ? 'found' : 'null');
        return result;
    } catch (error) {
        console.error(`❌ localStorage.getItem error: ${key}`, error);
        return null;
    }
};

localStorage.removeItem = function (key: string) {
    console.log(`🗑️ localStorage.removeItem: ${key}`);
    try {
        const result = originalRemoveItem.call(this, key);
        console.log(`✅ localStorage.removeItem success: ${key}`);
        return result;
    } catch (error) {
        console.error(`❌ localStorage.removeItem error: ${key}`, error);
        throw error;
    }
};

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
    writeLog: (line: string) => ipcRenderer.invoke('write-log', line),
    // Abrir link no navegador externo padrão (Chrome etc.)
    openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

    // Debug localStorage
    testLocalStorage: () => {
        try {
            const testKey = '__storage_test__';
            localStorage.setItem(testKey, 'test');
            const result = localStorage.getItem(testKey);
            localStorage.removeItem(testKey);
            return { success: true, result: result === 'test' };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }
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
            openExternal: (url: string) => Promise<boolean>;
        };
    }
} 