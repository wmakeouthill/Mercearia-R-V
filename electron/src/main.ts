import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import type { Input, OnHeadersReceivedListenerDetails, HeadersReceivedResponse, MenuItemConstructorOptions } from 'electron';
import { inspect } from 'util';
import * as path from 'path';
import * as childProcess from 'child_process';
// execSync removido; usando spawnSync para evitar exceptions sem tratamento
import * as net from 'net';
import * as fs from 'fs';

// Adicionar switches cedo para aceitar certificados self-signed e evitar GPU crash em alguns ambientes Windows
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
app.commandLine.appendSwitch('disable-gpu');

let mainWindow: BrowserWindow | null = null;
let backendProcess: childProcess.ChildProcess | null = null;
let backendHealthCheckInterval: NodeJS.Timeout | null = null;
let backendStartupTimeout: NodeJS.Timeout | null = null;
let isBackendReady = false;
let backendRestartAttempts = 0;
const maxBackendRestartAttempts = 5; // Aumentar tentativas
let backendShouldBeRunning = false; // Flag para saber se backend deveria estar rodando
let currentBackendPort = 3000;
const backendCandidatePorts = [3000, 3001, 3002];
let backendStdoutStream: fs.WriteStream | null = null;
let backendStderrStream: fs.WriteStream | null = null;
// Flag para desativar completamente logs em arquivo (frontend.log, backend-stdout.log, backend-stderr.log)
const DISABLE_FILE_LOGS = process.env.DISABLE_FILE_LOGS === 'true' || true; // forçar true por padrão

// ==== Funções auxiliares para reduzir complexidade ====
function attemptNextBackendPort(reason: string): void {
    console.error(reason);
    const nextIndex = backendCandidatePorts.indexOf(currentBackendPort) + 1;
    if (nextIndex < backendCandidatePorts.length) {
        currentBackendPort = backendCandidatePorts[nextIndex];
        stopBackend();
        setTimeout(() => { void startBackend(); }, 1000);
    }
}

function writeBackendStream(streamType: 'stdout' | 'stderr', content: string): void {
    if (DISABLE_FILE_LOGS) return;
    try {
        const isStdout = streamType === 'stdout';
        if (!app.isPackaged) {
            const dir = getLogsDirectory();
            if (isStdout) {
                if (!backendStdoutStream) {
                    backendStdoutStream = fs.createWriteStream(path.join(dir, 'backend-stdout.log'), { flags: 'a' });
                }
                backendStdoutStream.write(content);
                return;
            }
            if (!backendStderrStream) {
                backendStderrStream = fs.createWriteStream(path.join(dir, 'backend-stderr.log'), { flags: 'a' });
            }
            backendStderrStream.write(content);
            return;
        }
        const stream = isStdout ? backendStdoutStream : backendStderrStream;
        if (stream) stream.write(content);
    } catch { /* ignorar erros de escrita */ }
}

function processBackendStdout(output: string): void {
    console.log('Backend STDOUT:', output);
    writeBackendStream('stdout', output);

    const springStarted = /Started|Tomcat started|JVM running/.test(output);
    if (springStarted) {
        console.log('✅ Backend (Spring) parece iniciado. Confirmando com health check...');
    }
    const portInUse = /already in use|Address already in use/i.test(output);
    if (portInUse) {
        attemptNextBackendPort(`❌ Porta ${currentBackendPort} reportada como em uso pelo backend.`);
    }
}

function processBackendStderr(error: string): void {
    console.error('Backend STDERR:', error);
    writeBackendStream('stderr', error);

    if (error.includes('EADDRINUSE')) {
        attemptNextBackendPort(`❌ Porta ${currentBackendPort} já está em uso!`);
        return;
    }
    if (/already in use|Address already in use/i.test(error)) {
        attemptNextBackendPort(`❌ Porta ${currentBackendPort} em uso (detectado no STDERR).`);
        return;
    }
    if (error.includes('ENOENT')) {
        console.error('❌ Arquivo não encontrado!');
    } else if (error.includes('EACCES')) {
        console.error('❌ Permissão negada!');
    }
}

function isPortFree(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '0.0.0.0');
    });
}

async function findFirstFreePort(candidatePorts: number[]): Promise<number> {
    for (const port of candidatePorts) {
        // eslint-disable-next-line no-await-in-loop
        const free = await isPortFree(port);
        if (free) return port;
    }
    return candidatePorts[0];
}

function resolveJavaExecutable(): string | null {
    const embeddedJavaPathWin = process.resourcesPath
        ? path.join(process.resourcesPath, 'jre', 'win', 'bin', 'java.exe')
        : path.join(__dirname, '../resources/jre/win/bin/java.exe');
    const embeddedJavaPathUnix = process.resourcesPath
        ? path.join(process.resourcesPath, 'jre', 'bin', 'java')
        : path.join(__dirname, '../resources/jre/bin/java');
    const embeddedJdkPathWin = process.resourcesPath
        ? path.join(process.resourcesPath, 'jdk', 'win', 'bin', 'java.exe')
        : path.join(__dirname, '../resources/jdk/win/bin/java.exe');
    const embeddedJdkPathUnix = process.resourcesPath
        ? path.join(process.resourcesPath, 'jdk', 'bin', 'java')
        : path.join(__dirname, '../resources/jdk/bin/java');

    if (process.platform === 'win32' && fs.existsSync(embeddedJavaPathWin)) {
        console.log('✅ Usando Java embarcado (Windows)');
        return embeddedJavaPathWin;
    }
    if (fs.existsSync(embeddedJavaPathUnix)) {
        console.log('✅ Usando Java embarcado (Unix-like)');
        return embeddedJavaPathUnix;
    }
    if (process.platform === 'win32' && fs.existsSync(embeddedJdkPathWin)) {
        console.log('✅ Usando JDK embarcado (Windows)');
        return embeddedJdkPathWin;
    }
    if (fs.existsSync(embeddedJdkPathUnix)) {
        console.log('✅ Usando JDK embarcado (Unix-like)');
        return embeddedJdkPathUnix;
    }
    const check = childProcess.spawnSync('java', ['-version'], { stdio: 'pipe' });
    if (check.status === 0) {
        console.log('✅ Java do sistema disponível');
        return 'java';
    }
    console.error('❌ Java não encontrado (nem embarcado, nem no sistema).');
    console.error('💡 Instale o Java Runtime (JRE/JDK) ou inclua um JRE embarcado.');
    return null;
}

// Retorna o primeiro IPv4 não-interno encontrado nas interfaces de rede
function getLocalIPv4(): string | null {
    try {
        const os = require('os');
        const ifaces = os.networkInterfaces();
        for (const name of Object.keys(ifaces)) {
            const addrs = ifaces[name] || [];
            for (const addr of addrs) {
                if (addr.family === 'IPv4' && !addr.internal) {
                    return addr.address;
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Falha ao obter IP local:', e?.message || e);
    }
    return null;
}

// Em Windows, adiciona entrada no hosts apontando hostname -> ip, se ainda não existir
function ensureHostsEntryWin(hostname: string, ip: string): void {
    try {
        const hostsPath = process.platform === 'win32'
            ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
            : '/etc/hosts';

        if (!fs.existsSync(hostsPath)) {
            console.warn('⚠️ arquivo hosts não encontrado em', hostsPath);
            return;
        }

        const content = fs.readFileSync(hostsPath, { encoding: 'utf8' });
        const regex = new RegExp('^\\s*' + ip.replace(/\./g, '\\.') + '\\s+' + hostname + '\\s*$', 'm');
        const regexHostAnyIp = new RegExp('^\\s*.*\\s+' + hostname + '\\s*$', 'm');

        if (regex.test(content) || regexHostAnyIp.test(content)) {
            console.log(`✅ hosts já contém entrada para ${hostname}`);
            return;
        }

        // Fazer backup antes de alterar
        try {
            const backupPath = hostsPath + '.backup-' + Date.now();
            fs.copyFileSync(hostsPath, backupPath);
            console.log('✅ Backup do hosts criado em', backupPath);
        } catch (e) {
            console.warn('⚠️ Falha ao criar backup do hosts:', (e as Error)?.message || e);
        }

        const line = `\n${ip} ${hostname} # added by Sistema de Gestão de Estoque`;
        fs.appendFileSync(hostsPath, line, { encoding: 'utf8' });
        console.log(`✅ hosts atualizado: ${hostname} -> ${ip}`);
    } catch (e) {
        console.warn('⚠️ Falha ao atualizar hosts:', (e as Error)?.message || e);
    }
}

// Remove entradas do hosts que contenham o hostname
function removeHostsEntryWin(hostname: string): void {
    try {
        const hostsPath = process.platform === 'win32'
            ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
            : '/etc/hosts';

        if (!fs.existsSync(hostsPath)) {
            return;
        }

        const content = fs.readFileSync(hostsPath, { encoding: 'utf8' });
        const lines = content.split(/\r?\n/);
        const filtered = lines.filter(l => !new RegExp('\\b' + hostname + '\\b').test(l));
        if (filtered.length === lines.length) return; // nada a remover

        // Criar backup
        try {
            const backupPath = hostsPath + '.backup-' + Date.now();
            fs.copyFileSync(hostsPath, backupPath);
            console.log('✅ Backup do hosts criado em', backupPath);
        } catch (e) {
            console.warn('⚠️ Falha ao criar backup do hosts:', (e as Error)?.message || e);
        }

        fs.writeFileSync(hostsPath, filtered.join('\n'), { encoding: 'utf8' });
        console.log(`✅ Entrada(s) para ${hostname} removida(s) do hosts`);
    } catch (e) {
        console.warn('⚠️ Falha ao remover entrada do hosts:', (e as Error)?.message || e);
    }
}

// Copia recursivamente diretório src -> dest (sincrono)
function copyDirRecursiveSync(src: string, dest: string): void {
    if (!fs.existsSync(src)) throw new Error('Source not found: ' + src);
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursiveSync(srcPath, destPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function isDirNonEmpty(p: string): boolean {
    try {
        return fs.existsSync(p) && fs.readdirSync(p).length > 0;
    } catch { return false; }
}

function buildBackendArgs(jarPath: string, port: number): string[] {
    return ['-jar', jarPath, `--server.port=${port}`, '--server.address=0.0.0.0'];
}

function computeJarPath(): string {
    if (process.resourcesPath) {
        return path.join(process.resourcesPath, 'backend-spring/backend-spring-0.0.1-SNAPSHOT.jar');
    }
    return path.join(__dirname, '../resources/backend-spring/backend-spring-0.0.1-SNAPSHOT.jar');
}

function determineWorkingDir(): string {
    return process.resourcesPath
        ? path.join(process.resourcesPath, 'backend-spring')
        : path.join(__dirname, '../resources/backend-spring');
}

function attachBackendListeners(proc: childProcess.ChildProcess): void {
    if (proc.stdout) {
        proc.stdout.on('data', (data: Buffer) => {
            processBackendStdout(data.toString());
        });
    }

    if (proc.stderr) {
        proc.stderr.on('data', (data: Buffer) => {
            processBackendStderr(data.toString());
        });
    }

    proc.on('close', (code: number, signal: string) => {
        console.log(`❌ Backend process exited with code ${code}, signal: ${signal || 'none'}`);
        isBackendReady = false;
        if (backendHealthCheckInterval) {
            clearInterval(backendHealthCheckInterval);
            backendHealthCheckInterval = null;
        }
        const shouldRestart = backendRestartAttempts < maxBackendRestartAttempts;
        if (shouldRestart) {
            backendRestartAttempts++;
            console.log(`🔄 Reiniciando backend automaticamente (tentativa ${backendRestartAttempts}/${maxBackendRestartAttempts})...`);
            const reason = signal ? 'sinal ' + signal : 'código ' + code;
            console.log('   - Motivo: ' + reason);
            setTimeout(() => { void startBackend(); }, 3000);
        } else {
            console.error('🚫 Máximo de tentativas de restart atingido. Backend não será reiniciado automaticamente.');
            console.log('💡 Use Ctrl+Shift+B ou o menu para reiniciar manualmente');
        }
    });

    proc.on('error', (error: Error) => {
        console.error('❌ Erro ao iniciar backend:', error);
        isBackendReady = false;
    });
}

// ==== LOG EM ARQUIVO (FRONTEND VIA IPC) ====
function getLogsDirectory(): string {
    if (DISABLE_FILE_LOGS) {
        // Retornar diretório dummy; não será usado pois não iremos escrever
        return app.getPath('temp');
    }
    // Em desenvolvimento, gravar na raiz do workspace (do projeto mono-repo)
    if (!app.isPackaged) {
        // __dirname aponta para electron/dist em dev; subir 2 níveis até electron/, depois voltar 1 para raiz
        // Melhor: usar process.cwd() que em dev será electron/; subir um diretório
        try {
            const cwd = process.cwd();
            const root = path.resolve(cwd, '..');
            return root;
        } catch {
            return path.resolve(__dirname, '..');
        }
    }
    // Em produção, usar diretório de dados do app do usuário
    return app.getPath('userData');
}

function getFrontendLogFilePath(): string {
    const dir = getLogsDirectory();
    return path.join(dir, 'frontend.log');
}

function appendLogLine(line: string): void {
    if (DISABLE_FILE_LOGS) return; // não escrever em arquivo
    const filePath = getFrontendLogFilePath();
    try { fs.appendFileSync(filePath, line + '\n'); } catch { /* ignorar */ }
}

// CONFIGURAÇÃO: Aguardar tudo estar pronto antes de mostrar? (APENAS EM PRODUÇÃO)
// Em desenvolvimento sempre mostra imediatamente independente desta configuração
const WAIT_FOR_EVERYTHING_READY = true; // true = aguarda / false = mostra imediatamente
// ⚠️ Se WAIT_FOR_EVERYTHING_READY = true e a janela não aparecer, mude para false

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: false, // Desabilitar em produção para permitir conexões com localhost
            allowRunningInsecureContent: false,
            spellcheck: false, // Desabilitar spellcheck para performance
            enableWebSQL: false,
            // Adicionar permissões específicas para conexões locais
            additionalArguments: [
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                '--no-sandbox'
            ]
        },
        icon: path.join(__dirname, '../icon/icon.ico'),
        title: 'Sistema de Gestão de Estoque',
        show: false, // Sempre começar oculto, gerenciar manualmente
        center: true,
        resizable: true,
        minimizable: true,
        maximizable: true,
        autoHideMenuBar: false,
        backgroundColor: '#ffffff', // Fundo branco enquanto carrega
        // Melhorar suavidade de abertura
        titleBarStyle: 'default',
        opacity: 0.0 // Começar invisível para fade-in suave
    });

    // Configurar CSP para permitir conexões com o backend local
    mainWindow.webContents.session.webRequest.onHeadersReceived((details: OnHeadersReceivedListenerDetails, callback: (response: HeadersReceivedResponse) => void) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: " +
                    "http://localhost:* http://127.0.0.1:* https://localhost:* https://127.0.0.1:*; " +
                    "connect-src 'self' http://localhost:* http://127.0.0.1:* https://localhost:* https://127.0.0.1:* ws://localhost:*; " +
                    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data: blob: http://localhost:* http://127.0.0.1:*; " +
                    "font-src 'self' data:;"
                ]
            }
        });
    });

    // Garantir que NODE_ENV esteja definido para verificação
    if (!process.env.NODE_ENV) {
        process.env.NODE_ENV = app.isPackaged ? 'production' : 'development';
    }
    const isDev = process.env.NODE_ENV === 'development';

    let hasShown = false; // Evitar múltiplas exibições

    // Função para mostrar janela apenas uma vez com fade-in suave
    const showWindowOnce = (reason: string) => {
        if (!hasShown && mainWindow && !mainWindow.isDestroyed()) {
            hasShown = true;
            console.log(`✅ Exibindo janela: ${reason}`);

            // Fade-in suave para evitar piscadas
            mainWindow.setOpacity(1.0);
            mainWindow.show();
            mainWindow.focus();

            // Garantir que a janela está completamente visível
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.moveTop();
                }
            }, 50);
        }
    };

    // Carregar splash imediatamente para mostrar UI enquanto backend inicializa
    function loadSplash(): void {
        try {
            const splashPaths = [
                // when packaged, resources are under process.resourcesPath
                process.resourcesPath ? path.join(process.resourcesPath, 'assets', 'splash.html') : '',
                // in dev, use electron/assets
                path.join(__dirname, '../assets/splash.html')
            ];
            const splashPath = splashPaths.find(p => p && fs.existsSync(p));
            if (splashPath) {
                mainWindow?.loadFile(splashPath).catch(() => { /* ignore */ });
                // ensure window visible
                try { mainWindow?.show(); mainWindow?.focus(); } catch { }
            } else {
                console.warn('⚠️ splash.html not found, skipping splash load');
            }
        } catch (e) {
            console.warn('⚠️ Failed to load splash:', (e as Error)?.message || e);
        }
    }

    // Evento quando a janela está pronta para ser mostrada
    mainWindow.once('ready-to-show', () => {
        console.log('🎬 Janela pronta para exibição');

        // Em desenvolvimento, mostrar apenas após o conteúdo carregar para evitar piscadas
        if (!isDev && !WAIT_FOR_EVERYTHING_READY) {
            showWindowOnce('ready-to-show (produção)');
        }
    });

    // Evento quando a página termina de carregar
    mainWindow.webContents.once('did-finish-load', () => {
        console.log('✅ Conteúdo da página carregado');

        // Aguardar mais tempo em desenvolvimento para Angular se estabilizar
        const waitTime = isDev ? 800 : 100; // 800ms para desenvolvimento, 100ms para produção

        setTimeout(() => {
            if (isDev) {
                showWindowOnce('did-finish-load (desenvolvimento)');
            } else if (!WAIT_FOR_EVERYTHING_READY) {
                showWindowOnce('did-finish-load (produção)');
            }
        }, waitTime);
    });

    // Evento adicional para garantir que o Angular está renderizado
    if (isDev) {
        mainWindow.webContents.once('did-stop-loading', () => {
            console.log('✅ Página parou de carregar (desenvolvimento)');
            // Backup para mostrar a janela se outros eventos falharem
            setTimeout(() => {
                showWindowOnce('did-stop-loading (backup)');
            }, 1200);
        });
    }

    // Melhorar performance de renderização
    mainWindow.webContents.once('dom-ready', () => {
        console.log('✅ DOM pronto');
    });

    // Adicionar atalhos de teclado globais
    mainWindow.webContents.on('before-input-event', (event: Electron.Event, input: Input) => {
        // F5 - Recarregar
        if (input.key === 'F5' && !input.control && !input.alt && !input.shift) {
            console.log('🔄 Recarregando via F5...');
            mainWindow?.reload();
        }
        // Ctrl+R - Recarregar
        else if (input.key === 'r' && input.control && !input.alt && !input.shift) {
            console.log('🔄 Recarregando via Ctrl+R...');
            mainWindow?.reload();
        }
        // Ctrl+Shift+R - Recarregar ignorando cache
        else if (input.key === 'R' && input.control && !input.alt && input.shift) {
            console.log('🔄 Recarregando (forçado) via Ctrl+Shift+R...');
            mainWindow?.webContents.reloadIgnoringCache();
        }
        // F12 - Toggle DevTools
        else if (input.key === 'F12' && !input.control && !input.alt && !input.shift) {
            console.log('🔧 Alternando DevTools via F12...');
            mainWindow?.webContents.toggleDevTools();
        }
        // Ctrl+Shift+I - Toggle DevTools (alternativo)
        else if (input.key === 'I' && input.control && !input.alt && input.shift) {
            console.log('🔧 Alternando DevTools via Ctrl+Shift+I...');
            mainWindow?.webContents.toggleDevTools();
        }
        // Ctrl+Shift+Delete - Limpar Cache
        else if (input.key === 'Delete' && input.control && !input.alt && input.shift) {
            console.log('🧹 Limpando cache via Ctrl+Shift+Delete...');
            clearCache();
        }
        // Ctrl+Shift+F5 - Limpar Cache e Recarregar
        else if (input.key === 'F5' && input.control && !input.alt && input.shift) {
            console.log('🧹 Limpando cache e recarregando via Ctrl+Shift+F5...');
            clearCacheAndReload();
        }
    });

    if (isDev) {
        // Em desenvolvimento, SEMPRE mostrar imediatamente
        console.log('⏳ Aguardando Angular compilar...');
        console.log('🔧 Desenvolvimento: Janela será exibida automaticamente');
        waitForAngularDev();
        // Desabilitar GPU em dev para evitar erros de GPU process
        app.commandLine.appendSwitch('disable-gpu');
    } else {
        // Em produção: mostrar splash imediatamente, depois aguardar backend e carregar frontend
        loadSplash();
        if (WAIT_FOR_EVERYTHING_READY) {
            console.log('⏳ Aguardando backend estar pronto antes de carregar frontend...');
            waitForBackendThenLoadFrontend();
        } else {
            console.log('🌐 Carregando frontend imediatamente...');
            loadProductionFrontend();
        }

        // Fallback de segurança somente quando não exigimos aguardar tudo
        if (!WAIT_FOR_EVERYTHING_READY) {
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                    console.log('🚨 Fallback de segurança: Forçando exibição da janela após 15s');
                    mainWindow.setOpacity(1.0);
                    mainWindow.show();
                    mainWindow.focus();
                }
            }, 15000);
        }
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    createMenu();
}

// Em produção: aguardar backend ficar saudável e então carregar o frontend
function waitForBackendThenLoadFrontend(): void {
    const maxAttempts = 60; // 60 segundos
    let attempts = 0;

    const check = () => {
        attempts++;
        console.log(`🔍 Verificando backend (esperando) tentativa ${attempts}/${maxAttempts}...`);
        testBackendConnection()
            .then((status) => {
                if (status === 'healthy') {
                    console.log('✅ Backend saudável. Carregando frontend empacotado...');
                    loadProductionFrontend();
                    // quando a página terminar de carregar, mostrar a janela (se ainda não visível)
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.once('did-finish-load', () => {
                            try {
                                mainWindow?.setOpacity(1.0);
                                mainWindow?.show();
                                mainWindow?.focus();
                            } catch { }
                        });
                    }
                } else if (attempts < maxAttempts) {
                    setTimeout(check, 1000);
                } else {
                    console.error('❌ Backend não ficou pronto após tempo limite. Mostrando splash com opção de retry.');
                    // deixar splash visível e permitir ações via menu
                }
            })
            .catch(() => {
                if (attempts < maxAttempts) setTimeout(check, 1000);
                else console.error('❌ Erro ao verificar backend (timeout)');
            });
    };

    // iniciar verificação após 1s
    setTimeout(check, 1000);
}

function waitForAngularDev(): void {
    const baseHosts: string[] = ['localhost', '127.0.0.1', 'merceariarv.lan', 'merceariarv.app'];
    // Adicionar IPs da máquina se disponível via env (poderíamos injetar depois)
    const networkEnv = process.env.ANGULAR_DEV_HOSTS;
    if (networkEnv) {
        networkEnv.split(',').map(h => h.trim()).filter(Boolean).forEach(h => baseHosts.push(h));
    }
    let hostIndex = 0;
    let currentHost = baseHosts[0];
    let attempts = 0;
    const maxAttempts = 60; // 60 segundos máximo
    // Priorizar HTTPS primeiro (dev server geralmente está em HTTPS quando certificados existem)
    const protocols: ('http' | 'https')[] = ['https', 'http'];
    let protoIndex = 0;

    const nextHost = () => {
        hostIndex = (hostIndex + 1) % baseHosts.length;
        currentHost = baseHosts[hostIndex];
    };

    const showDevWindowFallback = (): void => {
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
            }
        }, 500);
    };

    const probeHost = (host: string, port: number, protocol: 'http' | 'https', timeoutMs: number): Promise<boolean> => {
        return new Promise((resolve) => {
            const mod: any = protocol === 'https' ? require('https') : require('http');
            const options: any = { hostname: host, port, path: '/', timeout: timeoutMs };
            if (protocol === 'https') options.rejectUnauthorized = false; // aceitar self-signed
            const req = mod.get(options, (res: any) => {
                const ok = typeof res?.statusCode === 'number' && res.statusCode < 400;
                resolve(Boolean(ok));
                try { req.destroy(); } catch { }
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { try { req.destroy(); } catch { } resolve(false); });
        });
    };

    const checkAngular = async (): Promise<void> => {
        attempts++;
        const protocol = protocols[protoIndex];
        const angularUrl = `${protocol}://${currentHost}:4200`;
        console.log(`🔍 Verificando Angular (tentativa ${attempts}/${maxAttempts}) em ${angularUrl}...`);

        const timeoutMs = protocol === 'https' ? 2000 : 1500;
        const available = await probeHost(currentHost, 4200, protocol, timeoutMs).catch(() => false);
        if (!available) {
            retryAngularCheck();
            return;
        }

        try {
            await mainWindow?.loadURL(angularUrl);
            console.log('🎯 URL carregada com sucesso em desenvolvimento');
        } catch (err) {
            console.error(`❌ Erro ao carregar URL de desenvolvimento (${protocol}):`, err);
            if (protocol === 'https') {
                const fallbackUrl = `http://${currentHost}:4200`;
                try {
                    await mainWindow?.loadURL(fallbackUrl);
                } catch (e) {
                    console.error('❌ Fallback http também falhou:', e);
                    showDevWindowFallback();
                }
            } else {
                showDevWindowFallback();
            }
        }
    };

    const retryAngularCheck = () => {
        if (attempts < maxAttempts) {
            // Alternar protocolo primeiro, depois host
            protoIndex = (protoIndex + 1) % protocols.length;
            if (protoIndex === 0) {
                nextHost();
            }
            setTimeout(() => { checkAngular().catch(() => { }); }, 1000); // Tentar novamente em 1 segundo
        } else {
            console.error('❌ Angular não inicializou após 60 segundos');
            console.log('💡 Tente executar: cd frontend && npm start');
            // Mostrar janela mesmo assim para não travar completamente
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    };

    // Iniciar verificação após 2 segundos para dar tempo do Angular começar
    setTimeout(() => { checkAngular().catch(() => { }); }, 2000);
}

function waitForProductionReady(): void {
    let frontendReady = false;
    let backendReady = false;

    console.log('🔄 Iniciando verificação de prontidão...');

    // Carregar frontend mas não mostrar ainda
    loadProductionFrontendHidden();

    // Verificar se frontend carregou
    const checkFrontendReady = () => {
        if (!mainWindow?.webContents) {
            return;
        }
        const markFrontendReady = () => {
            console.log('✅ Frontend carregado e pronto!');
            frontendReady = true;
            checkIfAllReady();
        };
        const scheduleRecheck = () => setTimeout(runCheckReady, 500);
        const runCheckReady = () => {
            const webContents = mainWindow.webContents;
            const script = "document.readyState === 'complete' && !!document.querySelector('app-root')";
            webContents
                .executeJavaScript(script)
                .then(() => {
                    markFrontendReady();
                })
                .catch(() => {
                    scheduleRecheck();
                });
        };
        // Aguardar um pouco antes de verificar
        setTimeout(runCheckReady, 2000);
    };

    // Verificar se backend está pronto
    const onBackendHealthy = () => {
        console.log('✅ Backend detectado como pronto!');
        backendReady = true;
        isBackendReady = true;
        checkIfAllReady();
    };

    const onBackendNotReady = () => {
        console.log('⏳ Backend ainda não está pronto, aguardando...');
        setTimeout(checkBackendReady, 2000);
    };

    const checkBackendReady = () => {
        if (isBackendReady) {
            console.log('✅ Backend já está pronto!');
            backendReady = true;
            checkIfAllReady();
        } else {
            testBackendConnection()
                .then((status) => {
                    return status === 'healthy' ? onBackendHealthy() : onBackendNotReady();
                })
                .catch(() => {
                    setTimeout(checkBackendReady, 2000);
                });
        }
    };

    // Verificar se tudo está pronto
    const checkIfAllReady = () => {
        if (frontendReady && backendReady) {
            console.log('🎉 Backend e Frontend prontos! Mostrando aplicação...');
            showWhenReady();
        }
    };

    // Iniciar verificações
    checkFrontendReady();
    checkBackendReady();

    // Sem fallback: só mostrar quando backend e frontend estiverem prontos
}

function loadProductionFrontendHidden(): void {
    loadProductionFrontend();
}

function showWhenReady(): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('✨ Aplicação exibida - tudo pronto!');
        // Usar fade-in suave igual ao desenvolvimento
        mainWindow.setOpacity(1.0);
        mainWindow.show();
        mainWindow.focus();

        // Garantir que está visível
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.moveTop();
            }
        }, 50);
    }
}

function loadProductionFrontend(): void {
    console.log('🌐 Carregando frontend em produção (arquivo local empacotado)...');
    console.log('🔧 Debug: NODE_ENV =', process.env.NODE_ENV);
    console.log('🔧 Debug: app.isPackaged =', app.isPackaged);
    // Carregar diretamente o arquivo local empacotado
    loadFallbackFile();
}

// Removido: fluxo antigo que carregava o frontend via HTTP do backend

function loadFallbackFile(): void {
    const productionPath = path.join(__dirname, '../resources/frontend/index.html');
    console.log('📁 Fallback: Carregando frontend via arquivo...');
    console.log('  - Caminho do frontend:', productionPath);
    console.log('  - Arquivo existe:', fs.existsSync(productionPath));

    if (fs.existsSync(productionPath)) {
        mainWindow?.loadFile(productionPath).catch((err: Error) => {
            console.error('❌ Erro ao carregar arquivo de produção:', err);
            loadErrorPage(productionPath, '');
        });
    } else {
        // Tentar caminho alternativo - relativo ao executável
        const altPath = path.join(process.resourcesPath, 'frontend/index.html');
        console.log('📁 Tentando caminho alternativo:', altPath);
        console.log('  - Arquivo existe:', fs.existsSync(altPath));

        if (fs.existsSync(altPath)) {
            mainWindow?.loadFile(altPath).catch((err: Error) => {
                console.error('❌ Erro ao carregar arquivo de produção (caminho alternativo):', err);
                loadErrorPage(productionPath, altPath);
            });
        } else {
            console.error('❌ Arquivo de produção não encontrado em nenhum caminho');
            loadErrorPage(productionPath, altPath);
        }
    }
}

function loadErrorPage(path1: string, path2: string): void {
    // Carregar uma página de erro com mais informações
    console.log('💡 Use F12 para abrir DevTools se necessário para debug');
    const errorHtml = `
        <html>
            <head>
                <title>Erro - Sistema de Estoque</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
                    .error { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                    .error h1 { color: #d32f2f; }
                    .error p { color: #666; }
                    .paths { background: #f0f0f0; padding: 10px; border-radius: 4px; margin: 10px 0; }
                </style>
            </head>
            <body>
                <div class="error">
                    <h1>Erro: Frontend não encontrado</h1>
                    <p>O sistema não conseguiu encontrar os arquivos do frontend.</p>
                    <div class="paths">
                        <strong>Caminhos verificados:</strong><br>
                        ${path1}<br>
                        ${path2}
                    </div>
                    <p>Para debug avançado:</p>
                    <ul>
                        <li>Pressione <strong>F12</strong> para abrir DevTools</li>
                        <li>Ou use o menu: <em>Ferramentas → Ferramentas de Desenvolvedor</em></li>
                        <li>Verifique os logs do console para mais detalhes</li>
                    </ul>
                </div>
            </body>
        </html>
    `;
    mainWindow?.loadURL(`data:text/html,${encodeURIComponent(errorHtml)}`);
}

function createMenu(): void {
    const template: MenuItemConstructorOptions[] = [
        {
            label: 'Arquivo',
            submenu: [
                {
                    label: 'Sair',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Ferramentas',
            submenu: [
                {
                    label: 'Ferramentas de Desenvolvedor',
                    accelerator: 'F12',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.toggleDevTools();
                        }
                    }
                },
                {
                    label: 'Recarregar',
                    accelerator: 'F5',
                    click: () => {
                        if (mainWindow) {
                            console.log('🔄 Recarregando aplicação...');
                            mainWindow.reload();
                        }
                    }
                },
                {
                    label: 'Recarregar (Ctrl+R)',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        if (mainWindow) {
                            console.log('🔄 Recarregando aplicação (Ctrl+R)...');
                            mainWindow.reload();
                        }
                    }
                },
                {
                    label: 'Recarregar Forçado',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: () => {
                        if (mainWindow) {
                            console.log('🔄 Recarregando aplicação (forçado)...');
                            mainWindow.webContents.reloadIgnoringCache();
                        }
                    }
                },
                {
                    type: 'separator'
                },
                {
                    label: 'Limpar Cache',
                    accelerator: 'CmdOrCtrl+Shift+Delete',
                    click: () => {
                        console.log('🧹 Limpando cache via menu...');
                        clearCache();
                    }
                },
                {
                    label: 'Limpar Cache e Recarregar',
                    accelerator: 'CmdOrCtrl+Shift+F5',
                    click: () => {
                        console.log('🧹 Limpando cache e recarregando...');
                        clearCacheAndReload();
                    }
                },
                {
                    label: 'Limpeza Completa (Reset)',
                    click: () => {
                        console.log('🧹 Executando limpeza completa...');
                        fullReset();
                    }
                },
                {
                    type: 'separator'
                },
                {
                    label: 'Reiniciar Backend',
                    accelerator: 'CmdOrCtrl+Shift+B',
                    click: () => {
                        console.log('🔄 Reiniciando backend via menu (manual)...');
                        // Reset contador para restart manual
                        backendRestartAttempts = 0;
                        restartBackend();
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

async function preparePgData(): Promise<{ userDataDir: string; userPgDir: string; embeddedPgDir: string }> {
    const userDataDir = app.getPath('userData');
    const userPgDir = path.join(userDataDir, 'data', 'pg');
    const resourceBase = process.resourcesPath ? process.resourcesPath : path.join(__dirname, '../resources');
    const embeddedPgDir = path.join(resourceBase, 'backend-spring', 'data', 'pg');

    if (!fs.existsSync(embeddedPgDir)) {
        throw new Error(`Dados embutidos do Postgres não encontrados em: ${embeddedPgDir}`);
    }

    // Se não existir em userData, copiar (primeira execução)
    if (!isDirNonEmpty(userPgDir)) {
        console.log('📦 Copiando dados do Postgres empacotados para userData (primeira execução)...');
        fs.mkdirSync(userPgDir, { recursive: true });
        copyDirRecursiveSync(embeddedPgDir, userPgDir);
        console.log('✅ Cópia concluída para', userPgDir);
    } else {
        console.log('ℹ️ Diretório de dados do Postgres em userData já existe, usando-o:', userPgDir);
    }

    // Verificação mínima de compatibilidade: checar arquivo PG_VERSION
    const pgVersionFile = path.join(userPgDir, 'PG_VERSION');
    if (!fs.existsSync(pgVersionFile)) {
        throw new Error(`Arquivo PG_VERSION não encontrado no diretório de dados do Postgres (incompatível): ${userPgDir}`);
    }
    try {
        const actualVersion = fs.readFileSync(pgVersionFile, 'utf8').trim();
        const expected = process.env.EMBEDDED_PG_EXPECTED_VERSION;
        if (expected && actualVersion !== expected) {
            console.warn('⚠️ Versão do Postgres diferente do esperado:', actualVersion, '!=', expected);
        } else {
            console.log('✅ PG_VERSION detectado:', actualVersion);
        }
    } catch (e) {
        console.warn('⚠️ Falha ao checar PG_VERSION:', (e as Error)?.message || e);
    }

    return { userDataDir, userPgDir, embeddedPgDir };
}

function buildEnvForBackend(userDataDir: string, userPgDir: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        NODE_ENV: 'production',
        // Forçar apontar para o banco de dados copiado em userData (única fonte de verdade)
        PG_DATA_DIR: userPgDir,
        PERSIST_EMBEDDED_PG: 'true',
        LOG_FILE: path.join(userDataDir, 'backend.log')
    } as NodeJS.ProcessEnv;
}

async function launchBackendProcess(jarPath: string, userDataDir: string, env: NodeJS.ProcessEnv): Promise<void> {
    console.log('🚀 Iniciando processo do backend (Java)...');

    const workingDir = determineWorkingDir();

    // Resolver Java preferindo embarcado
    const javaExecutable = resolveJavaExecutable();
    if (!javaExecutable) throw new Error('Java não encontrado');

    // Tentar fixar a 3000, com fallback somente se ocupada
    const primaryPort = 3000;
    const free3000 = await isPortFree(primaryPort);
    currentBackendPort = free3000 ? primaryPort : await findFirstFreePort(backendCandidatePorts);

    const args = buildBackendArgs(jarPath, currentBackendPort);

    // Abrir streams de log (produção e desenvolvimento) antes do spawn
    if (!DISABLE_FILE_LOGS) {
        try {
            const logsDir = getLogsDirectory();
            backendStdoutStream = fs.createWriteStream(path.join(logsDir, 'backend-stdout.log'), { flags: 'a' });
            backendStderrStream = fs.createWriteStream(path.join(logsDir, 'backend-stderr.log'), { flags: 'a' });
            const banner = `\n===== Backend start @ ${new Date().toISOString()} =====\n`;
            backendStdoutStream.write(banner);
            backendStderrStream.write(banner);
            const context = { javaExecutable, jarPath, workingDir, currentBackendPort, userDataDir, envKeys: Object.keys(env) } as Record<string, unknown>;
            backendStdoutStream.write(`[electron] startBackend context: ${JSON.stringify(context)}\n`);
        } catch (e) {
            console.error('⚠️ Falha ao preparar arquivos de log do backend:', (e as Error)?.message || e);
        }
    }

    backendProcess = childProcess.spawn(javaExecutable, args, {
        stdio: 'pipe',
        detached: false,
        env: env,
        cwd: workingDir,
        windowsHide: true,
        shell: false
    });
    attachBackendListeners(backendProcess);
    startBackendHealthCheck();

    // Timeout para startup do backend
    backendStartupTimeout = setTimeout(() => {
        if (!isBackendReady) {
            console.error('⚠️ Backend não respondeu após 30 segundos, pode haver um problema');
            // Tentar reiniciar
            restartBackend();
        }
    }, 30000);

    console.log('🔄 Backend startup iniciado, aguardando confirmação...');
}

async function startBackend(): Promise<void> {
    // Garantir que NODE_ENV esteja definido corretamente
    if (!process.env.NODE_ENV) {
        process.env.NODE_ENV = app.isPackaged ? 'production' : 'development';
    }
    const isDev = process.env.NODE_ENV === 'development';

    console.log('🔍 Verificando ambiente para iniciar backend...');
    console.log('  - NODE_ENV:', process.env.NODE_ENV);
    console.log('  - isDev:', isDev);

    // EM DESENVOLVIMENTO: NÃO iniciar backend via Electron
    // O backend já está rodando via npm run dev
    if (isDev) {
        console.log('⚡ Modo desenvolvimento: Backend gerenciado pelo npm run dev');
        console.log('✅ Pulando inicialização do backend via Electron');
        isBackendReady = true; // Assumir que está pronto via npm
        return;
    }

    console.log('🚀 Iniciando backend Spring Boot embutido para produção...');
    console.log('📁 Diretório atual:', __dirname);
    console.log('📁 Process resourcesPath:', (process as any).resourcesPath);

    // Marcar que backend deveria estar rodando
    backendShouldBeRunning = true;

    // Em produção, iniciar o backend Spring Boot embutido (JAR)
    const jarPath = computeJarPath();

    // Verificar se os arquivos existem nos recursos extraídos
    console.log('📋 Verificando recursos extraídos:');
    console.log('  - JAR path:', jarPath);
    console.log('  - JAR exists:', fs.existsSync(jarPath));

    if (!fs.existsSync(jarPath)) {
        console.error('❌ Arquivo JAR do backend não encontrado:', jarPath);
        return;
    }

    try {
        const { userDataDir, userPgDir } = await preparePgData();
        const env = buildEnvForBackend(userDataDir, userPgDir);
        await launchBackendProcess(jarPath, userDataDir, env);
    } catch (error) {
        console.error('❌ Erro ao iniciar backend:', error);
        isBackendReady = false;
    }
}

function startBackendHealthCheck(): void {
    if (backendHealthCheckInterval) {
        clearInterval(backendHealthCheckInterval);
    }

    // Verificar saúde do backend a cada 15 segundos (mais frequente)
    backendHealthCheckInterval = setInterval(() => {
        // Só verificar se deveria estar rodando
        if (backendShouldBeRunning) {
            testBackendConnection().then((status) => {
                const isHealthy = status === 'healthy';
                if (!isHealthy && isBackendReady) {
                    console.log('❌ Backend não está respondendo no health check, reiniciando...');
                    isBackendReady = false;
                    restartBackend();
                } else if (!isHealthy && !isBackendReady && !backendProcess) {
                    console.log('🔄 Backend deveria estar rodando mas não está, reiniciando...');
                    restartBackend();
                } else if (isHealthy && !isBackendReady) {
                    console.log('✅ Backend detectado como saudável novamente');
                    isBackendReady = true;
                    backendRestartAttempts = 0; // Reset contador em caso de sucesso
                }
            }).catch((error) => {
                console.error('❌ Erro no health check:', error.message);
                if (backendShouldBeRunning && (!backendProcess || isBackendReady)) {
                    isBackendReady = false;
                    restartBackend();
                }
            });
        }
    }, 15000); // Verificar a cada 15 segundos
}

type BackendStatus = 'healthy' | 'unhealthy';

function testBackendConnection(): Promise<BackendStatus> {
    return new Promise((resolve) => {
        console.log('🧪 Testando conexão com o backend...');

        const http: typeof import('http') = require('http');
        const options = {
            hostname: '127.0.0.1',
            port: currentBackendPort,
            path: '/health',
            method: 'GET',
            timeout: 5000
        };

        const req = http.request(options, (res: import('http').IncomingMessage) => {
            let data = '';
            res.on('data', (chunk: Buffer) => {
                data += chunk.toString();
            });
            res.on('end', () => {
                const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 400;
                if (ok) {
                    console.log('✅ Backend está respondendo!');
                    resolve('healthy');
                } else {
                    resolve('unhealthy');
                }
            });
        });

        req.on('error', (error: unknown) => {
            let message: string;
            if (error instanceof Error) {
                message = `${error.name}: ${error.message}`;
            } else if (typeof error === 'object' && error !== null) {
                message = inspect(error, { depth: 2, breakLength: Infinity });
            } else {
                message = inspect(error, { depth: 2, breakLength: Infinity });
            }
            console.error('❌ Erro ao conectar com backend:', message);
            resolve('unhealthy');
        });

        req.on('timeout', () => {
            console.error('❌ Timeout ao conectar com backend');
            req.destroy();
            resolve('unhealthy');
        });

        req.end();
    });
}

function stopBackend(): void {
    console.log('🛑 Parando backend...');

    // Marcar que backend não deveria estar mais rodando
    backendShouldBeRunning = false;

    // Limpar intervals
    if (backendHealthCheckInterval) {
        clearInterval(backendHealthCheckInterval);
        backendHealthCheckInterval = null;
    }

    if (backendStartupTimeout) {
        clearTimeout(backendStartupTimeout);
        backendStartupTimeout = null;
    }

    isBackendReady = false;

    if (backendProcess) {
        try {
            // Tentar graceful shutdown primeiro
            backendProcess.kill('SIGTERM');

            // Force kill após 5 segundos se não parar
            setTimeout(() => {
                if (backendProcess && !backendProcess.killed) {
                    console.log('🔨 Forçando parada do backend...');
                    backendProcess.kill('SIGKILL');
                }
            }, 5000);

            backendProcess = null;
            console.log('✅ Backend parado');
        } catch (error) {
            console.error('❌ Erro ao parar backend:', error);
        }
    }
    // Fechar streams de log
    try {
        if (backendStdoutStream) {
            backendStdoutStream.end();
            backendStdoutStream = null;
        }
        if (backendStderrStream) {
            backendStderrStream.end();
            backendStderrStream = null;
        }
    } catch { }
}

async function clearCache(): Promise<void> {
    if (!mainWindow) {
        console.error('❌ Janela principal não encontrada');
        return;
    }

    try {
        console.log('🧹 Iniciando limpeza de cache...');

        const session = mainWindow.webContents.session;

        // Limpar cache de armazenamento
        await session.clearStorageData({
            storages: [
                'cookies',
                'filesystem',
                'indexdb',
                'localstorage',
                'shadercache',
                'websql',
                'serviceworkers',
                'cachestorage'
            ]
        });

        // Limpar cache de HTTP
        await session.clearCache();

        // Limpar dados de host
        await session.clearHostResolverCache();

        console.log('✅ Cache limpo com sucesso!');
        console.log('💡 Recarregue a aplicação para ver as mudanças');

    } catch (error) {
        console.error('❌ Erro ao limpar cache:', error);
    }
}

async function clearCacheAndReload(): Promise<void> {
    if (!mainWindow) {
        console.error('❌ Janela principal não encontrada');
        return;
    }

    try {
        console.log('🧹 Limpando cache e recarregando...');

        // Limpar cache primeiro
        await clearCache();

        // Aguardar um pouco antes de recarregar
        setTimeout(() => {
            if (mainWindow) {
                console.log('🔄 Recarregando aplicação após limpeza de cache...');
                mainWindow.webContents.reloadIgnoringCache();
            }
        }, 1000);

    } catch (error) {
        console.error('❌ Erro ao limpar cache e recarregar:', error);
    }
}

async function fullReset(): Promise<void> {
    if (!mainWindow) {
        console.error('❌ Janela principal não encontrada');
        return;
    }

    try {
        console.log('🔄 Iniciando reset completo da aplicação...');

        // 1. Limpar cache completo
        console.log('📋 1/4 - Limpando cache...');
        await clearCache();

        // 2. Reiniciar backend (se em produção)
        if (!process.env.NODE_ENV || process.env.NODE_ENV === 'production') {
            console.log('📋 2/4 - Reiniciando backend...');
            backendRestartAttempts = 0; // Reset contador
            restartBackend();
        } else {
            console.log('📋 2/4 - Backend (desenvolvimento - pulando)');
        }

        // 3. Aguardar um pouco para o backend
        console.log('📋 3/4 - Aguardando estabilização...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 4. Recarregar aplicação forçadamente
        console.log('📋 4/4 - Recarregando aplicação...');
        setTimeout(() => {
            if (mainWindow) {
                console.log('✅ Reset completo! Recarregando aplicação...');
                mainWindow.webContents.reloadIgnoringCache();
            }
        }, 1000);

    } catch (error) {
        console.error('❌ Erro durante reset completo:', error);
    }
}

// Ao executar reset completo, remover também a entrada do hosts criada
// (apenas em produção pois em desenvolvimento não alteramos hosts)
const ORIGINAL_fullReset = fullReset;
async function fullResetWithHostsCleanup(): Promise<void> {
    await ORIGINAL_fullReset();
    try {
        if (app.isPackaged) {
            removeHostsEntryWin('merceariarv.app');
        }
    } catch (e) {
        console.warn('⚠️ Falha ao limpar hosts durante reset:', (e as Error)?.message || e);
    }
}

// Substituir referência usada por menu para apontar para versão com cleanup
// (o menu chama fullReset() diretamente; alterar para a nova implementação)
// Encontramos createMenu() que usa fullReset; portanto apenas sobrescrever a função global
// com a nova versão para manter compatibilidade
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
fullReset = fullResetWithHostsCleanup;

function restartBackend(): void {
    if (backendRestartAttempts >= maxBackendRestartAttempts) {
        console.error('🚫 Máximo de tentativas de restart já atingido');
        return;
    }

    backendRestartAttempts++;
    console.log(`🔄 Reiniciando backend (tentativa ${backendRestartAttempts}/${maxBackendRestartAttempts})...`);

    // Parar backend atual
    stopBackend();

    // Aguardar um pouco antes de reiniciar
    setTimeout(() => {
        startBackend();
    }, 3000); // Aumentar delay para dar tempo de limpar processos
}

app.whenReady().then(() => {
    // Garantir que NODE_ENV esteja definido corretamente
    if (!process.env.NODE_ENV) {
        process.env.NODE_ENV = app.isPackaged ? 'production' : 'development';
    }

    const isDev = process.env.NODE_ENV === 'development';
    console.log(`🚀 Inicializando aplicação em modo: ${isDev ? 'Desenvolvimento' : 'Produção'}`);

    // OTIMIZAÇÃO: Criar janela imediatamente para melhor UX
    createWindow();

    // Em produção, tentar mapear `merceariarv.app` para o IP local no arquivo hosts (Windows)
    if (!isDev) {
        try {
            const localIp = getLocalIPv4();
            if (localIp) {
                ensureHostsEntryWin('merceariarv.app', localIp);
            } else {
                console.warn('⚠️ Não foi possível detectar IP local para mapear merceariarv.app');
            }
        } catch (e) {
            console.warn('⚠️ Erro ao tentar mapear hosts:', (e as Error)?.message || e);
        }
    }

    if (!isDev) {
        // Em produção, iniciar backend em paralelo (não bloquear UI)
        console.log('🔄 Iniciando backend em paralelo...');
        setTimeout(() => {
            startBackend();
        }, 500); // Delay mínimo para não competir com criação da janela
    } else {
        // Em desenvolvimento, não iniciar backend via Electron
        // O backend já está sendo executado pelo npm run dev
        console.log('⚡ Modo desenvolvimento: Usando backend do npm run dev');
        startBackend(); // Apenas marca como pronto
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        stopBackend();
        app.quit();
    }
});

app.on('before-quit', () => {
    stopBackend();
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('get-app-name', () => {
    return app.getName();
});

ipcMain.handle('test-backend-connection', async () => {
    try {
        const status = await testBackendConnection();
        return {
            status: status === 'healthy' ? 200 : 500,
            data: {
                status: status === 'healthy' ? 'ok' : 'error',
                ready: isBackendReady,
                attempts: backendRestartAttempts
            }
        };
    } catch (error) {
        console.error('Erro geral ao testar backend:', error);
        throw error;
    }
});

ipcMain.handle('restart-backend', async () => {
    try {
        console.log('🔄 Reiniciando backend via IPC (manual)...');
        // Reset contador para restart manual
        backendRestartAttempts = 0;
        restartBackend();
        return { success: true, message: 'Backend reiniciado manualmente' };
    } catch (error) {
        console.error('Erro ao reiniciar backend:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-cache', async () => {
    try {
        console.log('🧹 Limpando cache via IPC...');
        await clearCache();
        return { success: true, message: 'Cache limpo com sucesso' };
    } catch (error) {
        console.error('Erro ao limpar cache:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-cache-and-reload', async () => {
    try {
        console.log('🧹 Limpando cache e recarregando via IPC...');
        await clearCacheAndReload();
        return { success: true, message: 'Cache limpo e aplicação recarregada' };
    } catch (error) {
        console.error('Erro ao limpar cache e recarregar:', error);
        return { success: false, error: error.message };
    }
});

// IPC para receber logs do frontend e salvar em arquivo
ipcMain.handle('write-log', async (_event, line: string) => {
    try {
        const timestamp = new Date().toISOString();
        const normalized = typeof line === 'string' ? line : JSON.stringify(line);
        appendLogLine(`[${timestamp}] ${normalized}`);
    } catch (error: any) {
        console.error('Erro ao gravar log via IPC:', error?.message || error);
    }
});

process.on('uncaughtException', (error: Error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    console.error('❌ Promise rejeitada não tratada:', reason);
}); 