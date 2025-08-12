import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import type { Input, OnHeadersReceivedListenerDetails, HeadersReceivedResponse, MenuItemConstructorOptions } from 'electron';
import { inspect } from 'util';
import * as path from 'path';
import * as childProcess from 'child_process';
import { execSync } from 'child_process';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let backendProcess: childProcess.ChildProcess | null = null;
let backendHealthCheckInterval: NodeJS.Timeout | null = null;
let backendStartupTimeout: NodeJS.Timeout | null = null;
let isBackendReady = false;
let backendRestartAttempts = 0;
const maxBackendRestartAttempts = 5; // Aumentar tentativas
let backendShouldBeRunning = false; // Flag para saber se backend deveria estar rodando

// ==== LOG EM ARQUIVO (FRONTEND VIA IPC) ====
function getLogsDirectory(): string {
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
    const filePath = getFrontendLogFilePath();
    try {
        fs.appendFileSync(filePath, line + '\n');
    } catch (err) {
        console.error('Erro ao escrever log de frontend:', err);
    }
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
        if (WAIT_FOR_EVERYTHING_READY) {
            // Em produção, aguardar backend E frontend estarem prontos
            console.log('⏳ Aguardando backend e frontend estarem completamente prontos...');
            waitForProductionReady();
        } else {
            // Em produção, carregar frontend imediatamente e deixar ele detectar o backend
            console.log('🌐 Carregando frontend imediatamente...');
            loadProductionFrontend();
        }

        // Fallback de segurança para produção - mostrar após 15 segundos independente do estado
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
                console.log('🚨 Fallback de segurança: Forçando exibição da janela após 15s');
                mainWindow.setOpacity(1.0);
                mainWindow.show();
                mainWindow.focus();
            }
        }, 15000);
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    createMenu();
}

function waitForAngularDev(): void {
    const angularUrl = 'http://localhost:4200';
    let attempts = 0;
    const maxAttempts = 60; // 60 segundos máximo

    const showDevWindowFallback = (): void => {
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
            }
        }, 500);
    };

    const checkAngular = (): void => {
        attempts++;
        console.log(`🔍 Verificando Angular (tentativa ${attempts}/${maxAttempts})...`);

        const http: typeof import('http') = require('http');
        const req = http.get(angularUrl, (res: { statusCode?: number }) => {
            if (res.statusCode !== 200) {
                retryAngularCheck();
                return;
            }

            console.log('✅ Angular pronto! Carregando aplicação...');
            // Carregar URL e aguardar que esteja completamente pronta
            mainWindow?.loadURL(angularUrl)
                .then(() => {
                    console.log('🎯 URL carregada com sucesso em desenvolvimento');
                })
                .catch((err: Error) => {
                    console.error('❌ Erro ao carregar URL de desenvolvimento:', err);
                    // Mostrar janela mesmo com erro para não travar
                    showDevWindowFallback();
                });
        });

        req.on('error', (_err: unknown) => {
            retryAngularCheck();
        });

        req.setTimeout(2000, () => {
            req.destroy();
            retryAngularCheck();
        });
    };

    const retryAngularCheck = () => {
        if (attempts < maxAttempts) {
            setTimeout(checkAngular, 1000); // Tentar novamente em 1 segundo
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
    setTimeout(checkAngular, 2000);
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
            const script = "(document.readyState === 'complete' && window.angular && document.querySelector('app-root')) ? true : (() => { throw new Error('not ready') })()";
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

    // Timeout de segurança - mostrar após 5 segundos mesmo se não estiver 100% pronto
    setTimeout(() => {
        if (!mainWindow?.isVisible()) {
            console.log('⚠️ Timeout atingido, mostrando aplicação mesmo sem tudo pronto');
            console.log(`   - Frontend: ${frontendReady ? '✅' : '❌'}`);
            console.log(`   - Backend: ${backendReady ? '✅' : '❌'}`);
            console.log('💡 A aplicação será exibida e tentará conectar automaticamente');
            showWhenReady();
        }
    }, 5000); // Reduzir para 5 segundos para ser mais responsivo
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

function startBackend(): void {
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
    let jarPath = path.join(__dirname, '../resources/backend-spring/backend-spring-0.0.1-SNAPSHOT.jar');

    // Verificar se estamos no executável empacotado
    if (process.resourcesPath) {
        jarPath = path.join(process.resourcesPath, 'backend-spring/backend-spring-0.0.1-SNAPSHOT.jar');
    }

    // Verificar se os arquivos existem nos recursos extraídos
    console.log('📋 Verificando recursos extraídos:');
    console.log('  - JAR path:', jarPath);
    console.log('  - JAR exists:', fs.existsSync(jarPath));

    if (!fs.existsSync(jarPath)) {
        console.error('❌ Arquivo JAR do backend não encontrado:', jarPath);
        return;
    }

    // Configurar variáveis de ambiente para o backend Spring (mínimas)
    // Em produção, persistir dados do Postgres embutido na pasta do usuário (userData)
    const userDataDir = app.getPath('userData');
    const pgDataDir = path.join(userDataDir, 'data', 'pg');
    try { fs.mkdirSync(pgDataDir, { recursive: true }); } catch { }
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        PG_DATA_DIR: pgDataDir,
        PERSIST_EMBEDDED_PG: 'true'
    } as NodeJS.ProcessEnv;

    try {
        console.log('🚀 Iniciando processo do backend (Java)...');

        const workingDir = process.resourcesPath
            ? path.join(process.resourcesPath, 'backend-spring')
            : path.join(__dirname, '../resources/backend-spring');

        // Usar Java do sistema
        let javaExecutable = 'java';
        try {
            execSync('java -version', { stdio: 'pipe' });
            console.log('✅ Java encontrado no sistema');
        } catch (error) {
            console.error('❌ Java não encontrado no sistema:', error);
            console.error('💡 Instale o Java Runtime (JRE/JDK) para executar o backend.');
            return;
        }

        const args = ['-jar', jarPath, '--server.port=3000'];

        backendProcess = childProcess.spawn(javaExecutable, args, {
            stdio: 'pipe',
            detached: false,
            env: env,
            cwd: workingDir,
            windowsHide: true,
            shell: false
        });

        if (backendProcess.stdout) {
            backendProcess.stdout.on('data', (data: Buffer) => {
                const output = data.toString();
                console.log('Backend STDOUT:', output);
                // Heurísticas de startup do Spring - sem template literals aninhados
                const springStarted = output.indexOf('Started') !== -1 ||
                    output.indexOf('Tomcat started') !== -1 ||
                    output.indexOf('JVM running') !== -1;
                if (springStarted) {
                    console.log('✅ Backend (Spring) parece iniciado. Confirmando com health check...');
                }
            });
        }

        if (backendProcess.stderr) {
            backendProcess.stderr.on('data', (data: Buffer) => {
                const error = data.toString();
                console.error('Backend STDERR:', error);

                // Verificar erros específicos
                if (error.includes('EADDRINUSE')) {
                    console.error('❌ Porta 3000 já está em uso!');
                } else if (error.includes('ENOENT')) {
                    console.error('❌ Arquivo não encontrado!');
                } else if (error.includes('EACCES')) {
                    console.error('❌ Permissão negada!');
                }
            });
        }

        backendProcess.on('close', (code: number, signal: string) => {
            console.log(`❌ Backend process exited with code ${code}, signal: ${signal || 'none'}`);
            isBackendReady = false;

            // Limpar health check
            if (backendHealthCheckInterval) {
                clearInterval(backendHealthCheckInterval);
                backendHealthCheckInterval = null;
            }

            // SEMPRE tentar reiniciar o backend se o Electron ainda estiver rodando
            // A menos que seja um shutdown intencional controlado
            const shouldRestart = backendRestartAttempts < maxBackendRestartAttempts;

            if (shouldRestart) {
                backendRestartAttempts++;
                console.log(`🔄 Reiniciando backend automaticamente (tentativa ${backendRestartAttempts}/${maxBackendRestartAttempts})...`);
                const reason = signal ? 'sinal ' + signal : 'código ' + code;
                console.log('   - Motivo: ' + reason);
                setTimeout(() => {
                    startBackend(); // Usar startBackend ao invés de restartBackend para evitar loop
                }, 3000); // Aumentar delay para 3 segundos
            } else {
                console.error('🚫 Máximo de tentativas de restart atingido. Backend não será reiniciado automaticamente.');
                console.log('💡 Use Ctrl+Shift+B ou o menu para reiniciar manualmente');
            }
        });

        backendProcess.on('error', (error: Error) => {
            console.error('❌ Erro ao iniciar backend:', error);
            isBackendReady = false;
        });

        // Timeout para startup do backend
        backendStartupTimeout = setTimeout(() => {
            if (!isBackendReady) {
                console.error('⚠️ Backend não respondeu após 15 segundos, pode haver um problema');
                // Tentar reiniciar
                restartBackend();
            }
        }, 15000);

        console.log('🔄 Backend startup iniciado, aguardando confirmação...');

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
            port: 3000,
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