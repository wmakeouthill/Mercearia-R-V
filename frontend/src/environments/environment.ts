// Desenvolvimento: usar automaticamente o hostname atual (ex: merceariarv.lan) se não for localhost.
function resolveDevApiBase(): string {
  const isBrowser = typeof window !== 'undefined';
  if (isBrowser && window.location?.hostname) {
    const host = window.location.hostname;
    const isLocal = /^(localhost|127\.|0\.0\.0\.0)/.test(host);
    if (!isLocal) {
      return `http://${host}:3000/api`;
    }
  }
  return 'http://localhost:3000/api';
}

export const environment = {
  production: false,
  apiUrl: resolveDevApiBase(),
  fallbackUrls: [
    resolveDevApiBase(),
    'http://localhost:3000/api',
    'http://127.0.0.1:3000/api'
  ]
};
