export const environment = {
    production: true,
    // URL primária - tentar IP primeiro para melhor compatibilidade com Electron
    apiUrl: 'http://127.0.0.1:3000/api',
    // URLs de fallback que o backend detector testará
    fallbackUrls: [
        'http://127.0.0.1:3000/api',
        'http://localhost:3000/api',
        'http://0.0.0.0:3000/api',
        'http://127.0.0.1:3001/api',
        'http://localhost:3001/api'
    ]
}; 