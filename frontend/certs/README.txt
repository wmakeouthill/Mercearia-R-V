Coloque aqui os certificados autoassinados ou gerados via mkcert.
Arquivos esperados pelos scripts:
- merceariarv.app.pem (certificado)
- merceariarv.app-key.pem (chave privada)

Gerar automaticamente (preferível):
  npm run cert:generate
  (usa mkcert se disponível; senão fallback para OpenSSL)

Gerar manualmente com mkcert (exemplos - Windows PowerShell):
1. Instale mkcert (opcional se usar script): choco install mkcert
2. Instale o CA local: mkcert -install
3. Gere certificados:
   cd frontend/certs
   mkcert merceariarv.app "*.merceariarv.app" localhost 127.0.0.1 ::1
   Renomeie/duplique para:
     merceariarv.app.pem
     merceariarv.app-key.pem

Depois execute na raiz do monorepo (modo normal):
  npm run dev
Ou para HTTPS direto:
  cd frontend && npm run start:https
  (ou npm run start:https:lan para expor na rede)

Hosts (C:\Windows\System32\drivers\etc\hosts):
  127.0.0.1 merceariarv.app www.merceariarv.app
Ou usando IP local para outros devices:
  192.168.1.14 merceariarv.app www.merceariarv.app

Dispositivos móveis: precisam confiar no CA (mkcert - instalar CA no device) ou usar proxy reverso com certificado público.

Se quiser evitar HTTPS em dev, use domínio .lan ou acesse via IP/localhost.
