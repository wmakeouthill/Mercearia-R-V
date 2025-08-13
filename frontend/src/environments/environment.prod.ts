export const environment = {
    production: true,
    // URL primária fixa em 3000 (fallbacks só em caso de conflito)
    apiUrl: 'http://127.0.0.1:3000/api',
    // URLs de fallback que o backend detector testará
    fallbackUrls: [
        'http://127.0.0.1:3000/api',
        'http://localhost:3000/api',
        'http://0.0.0.0:3000/api',
        'http://127.0.0.1:3001/api',
        'http://localhost:3001/api',
        'http://127.0.0.1:3002/api',
        'http://localhost:3002/api'
    ]
};
