/**
 * Wrapper seguro para localStorage que garante persistência em aplicações Electron
 */
export class SafeStorage {
    private static isAvailable(): boolean {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch {
            return false;
        }
    }

    static setItem(key: string, value: string): boolean {
        try {
            if (!this.isAvailable()) {
                console.warn('localStorage não disponível, usando sessão temporária');
                return false;
            }
            localStorage.setItem(key, value);
            // Verificar se foi realmente salvo
            const saved = localStorage.getItem(key);
            if (saved !== value) {
                console.warn(`Falha ao salvar ${key} no localStorage`);
                return false;
            }
            return true;
        } catch (error) {
            console.error(`Erro ao salvar no localStorage (${key}):`, error);
            return false;
        }
    }

    static getItem(key: string): string | null {
        try {
            if (!this.isAvailable()) {
                return null;
            }
            return localStorage.getItem(key);
        } catch (error) {
            console.error(`Erro ao ler do localStorage (${key}):`, error);
            return null;
        }
    }

    static removeItem(key: string): boolean {
        try {
            if (!this.isAvailable()) {
                return false;
            }
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error(`Erro ao remover do localStorage (${key}):`, error);
            return false;
        }
    }

    static clear(): boolean {
        try {
            if (!this.isAvailable()) {
                return false;
            }
            localStorage.clear();
            return true;
        } catch (error) {
            console.error('Erro ao limpar localStorage:', error);
            return false;
        }
    }
}
