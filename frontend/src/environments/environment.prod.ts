// Produção: detectar dinamicamente se abriu via hostname/IP da LAN para usar mesma origem.
function resolveApiBase(): string {
    const isBrowser = typeof window !== 'undefined' && !!window.location;
    if (isBrowser) {
        // In Electron (file:// origin), force localhost backend
        if (window.location.protocol === 'file:') {
            return 'http://127.0.0.1:3000/api';
        }
        const host = window.location.hostname;
        const isLocal = /^(localhost|127\.|0\.0\.0\.0)/.test(host);
        if (!isLocal) {
            return window.location.origin + '/api';
        }
    }
    return 'http://127.0.0.1:3000/api';
}

export const environment = {
    production: true,
    apiUrl: resolveApiBase(),
    fallbackUrls: [
        resolveApiBase(),
        'http://127.0.0.1:3000/api',
        'http://localhost:3000/api',
        'http://0.0.0.0:3000/api',
        'http://127.0.0.1:3001/api',
        'http://localhost:3001/api',
        'http://127.0.0.1:3002/api',
        'http://localhost:3002/api'
    ]
};
