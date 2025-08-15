# Produção — Instruções para TLS e expor `merceariarv.app` via HTTPS

Resumo rápido

- O aplicativo Electron empacota o frontend localmente e inicia o backend embutido em `0.0.0.0:3000`.
- Para acessar `https://merceariarv.app/` sem informar a porta, é necessário um proxy reverso (nginx/IIS) escutando na porta 443 que encaminhe as requisições ao backend (3000) e sirva o frontend se desejado.

Opções:

1) Usar nginx local na máquina onde o app roda

- Configurar nginx com um bloco server para `merceariarv.app` na porta 443 com o certificado TLS.
- proxy_pass para `http://127.0.0.1:3000` para as rotas /api e /health; servir arquivos estáticos do frontend via `root /path/to/frontend` ou deixar o Electron servir o index.

Exemplo de config (nginx):

```nginx
server {
    listen 443 ssl;
    server_name merceariarv.app;

    ssl_certificate /etc/ssl/certs/merceariarv.app.pem;
    ssl_certificate_key /etc/ssl/private/merceariarv.app-key.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        # servir index estático caso queira; ou redirecionar para app local
        proxy_pass http://127.0.0.1:3000/;
    }
}
```

1) Certificados e hosts

- Em ambientes controlados (intranet), você pode usar certificados self-signed ou CA interna. Instale o certificado na máquina cliente para evitar alertas.
- Adicione `merceariarv.app` no `hosts` apontando para o IP local. O instalador do app já tenta criar essa entrada no Windows quando executado como admin.

1) Observações de segurança

- Não exponha diretamente o backend na internet sem proteção (firewall, proxy, TLS).
- Mantenha backups do banco e um plano de rollback antes de distribuir atualizações.
