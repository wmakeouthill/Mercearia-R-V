const http = require('http');

console.log('🧪 Testando conexão com o backend...');

const options = {
    hostname: '127.0.0.1',
    port: 3000,
    path: '/test',
    method: 'GET',
    timeout: 5000
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('✅ Backend está respondendo!');
        console.log('Status:', res.statusCode);
        console.log('Resposta:', data);
    });
});

req.on('error', (error) => {
    console.error('❌ Erro ao conectar com backend:', error.message);
    console.error('Isso pode indicar que o backend não iniciou corretamente.');
});

req.on('timeout', () => {
    console.error('❌ Timeout ao conectar com backend');
    req.destroy();
});

req.end(); 