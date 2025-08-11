export interface Usuario {
    id?: number;
    username: string;
    password?: string;
    role: 'admin' | 'user';
    pode_controlar_caixa?: boolean;
}

export interface Produto {
    id?: number;
    nome: string;
    codigo_barras?: string;
    preco_venda: number;
    quantidade_estoque: number;
    imagem?: string | null;
    novaQuantidade?: number;
    atualizando?: boolean;
}

export type MetodoPagamento = 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix';

export interface Pagamento {
    metodo: MetodoPagamento;
    valor: number;
    troco?: number;
}

export interface ItemVenda {
    produto: Produto;
    quantidade: number;
    preco_unitario: number;
    preco_total: number;
}

export interface Venda {
    id?: number;
    produto_id: number;
    quantidade_vendida: number;
    preco_total: number;
    data_venda: string;
    metodo_pagamento: MetodoPagamento;
    produto_nome?: string;
    produto_imagem?: string | null;
    pagamentos_resumo?: string; // campo auxiliar para exibição
}

export interface VendaSimples {
    id?: number;
    produto_id: number;
    quantidade_vendida: number;
    preco_total: number;
    data_venda: string;
    metodo_pagamento: MetodoPagamento;
}

export interface CheckoutItem {
    produtoId: number;
    quantidade: number;
    precoUnitario: number;
}

export interface CheckoutRequest {
    itens: CheckoutItem[];
    pagamentos: Pagamento[];
    desconto?: number;
    acrescimo?: number;
}

export interface VendaCompletaResponse {
    id: number;
    data_venda: string;
    subtotal: number;
    desconto: number;
    acrescimo: number;
    total_final: number;
    itens: Array<{ produto_id: number; produto_nome: string; produto_imagem?: string | null; quantidade: number; preco_unitario: number; preco_total: number }>
    pagamentos: Array<{ metodo: MetodoPagamento; valor: number; troco?: number }>
}

export interface LoginRequest {
    username: string;
    password: string;
}

export interface LoginResponse {
    token: string;
    user: {
        id: number;
        username: string;
        role: string;
        pode_controlar_caixa?: boolean;
    };
}

export interface JwtPayload {
    id: number;
    username: string;
    role: string;
    iat?: number;
    exp?: number;
}

export interface RelatorioVendas {
    data: string;
    total_vendas: number;
    quantidade_vendida: number;
    receita_total: number;
}

export interface RelatorioResumo {
    data?: string;
    periodo?: string;
    total_vendas: number;
    quantidade_vendida: number;
    receita_total: number;
    por_pagamento?: Record<string, number>;
    vendas_com_multiplo_pagamento?: number;
}

export interface StatusCaixa {
    id?: number;
    aberto: boolean;
    horario_abertura_obrigatorio?: string;
    horario_fechamento_obrigatorio?: string;
    aberto_por?: number;
    fechado_por?: number;
    data_abertura?: string;
    data_fechamento?: string;
    criado_em?: string;
    atualizado_em?: string;
    aberto_por_username?: string;
    fechado_por_username?: string;
}
