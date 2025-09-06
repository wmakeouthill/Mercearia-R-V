#!/bin/bash

echo "🔄 Testando correções para redirecionamentos e persistência de login..."

# Limpar processos anteriores
echo "🧹 Limpando processos anteriores..."
cd "$(dirname "$0")"
npm run cleanup:all

# Aguardar um pouco para garantir que tudo foi limpo
sleep 3

# Compilar e executar em modo de distribuição
echo "🔨 Compilando aplicação..."
npm run build:all

if [ $? -eq 0 ]; then
    echo "✅ Compilação bem-sucedida!"
    echo ""
    echo "🚀 Iniciando aplicação em modo de produção..."
    echo "   - Configurado para aguardar backend+frontend estarem prontos"
    echo "   - Redirecionamentos reduzidos (máximo 10 tentativas)"
    echo "   - Timeout aumentado para 3 segundos entre tentativas"
    echo "   - localStorage substituído por SafeStorage"
    echo "   - WebSecurity habilitado para preservar dados"
    echo ""
    
    # Executar a aplicação
    npm run dist:win
else
    echo "❌ Erro na compilação!"
    exit 1
fi
