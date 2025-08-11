package com.example.backendspring.sale;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class SaleReportService {

    private final JdbcTemplate jdbcTemplate;

    public Map<String, Object> getResumoDia(LocalDate dia) {
        Map<String, Object> result = new HashMap<>();
        // Totais do legado (tabela vendas)
        Long totalVendasLegado = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM vendas v WHERE DATE(v.data_venda) = ?", Long.class, dia);
        Long qtdLegado = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(v.quantidade_vendida),0) FROM vendas v WHERE DATE(v.data_venda) = ?",
                Long.class, dia);
        Double receitaLegado = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(v.preco_total),0) FROM vendas v WHERE DATE(v.data_venda) = ?",
                Double.class, dia);

        // Totais do novo (venda_cabecalho)
        Long totalVendasNovo = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM venda_cabecalho vc WHERE DATE(vc.data_venda) = ?", Long.class, dia);
        Double receitaNovo = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(vc.total_final),0) FROM venda_cabecalho vc WHERE DATE(vc.data_venda) = ?",
                Double.class, dia);
        Long qtdNovo = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(vi.quantidade),0) FROM venda_itens vi JOIN venda_cabecalho vc ON vc.id = vi.venda_id WHERE DATE(vc.data_venda) = ?",
                Long.class, dia);

        long totalVendas = (totalVendasLegado != null ? totalVendasLegado : 0)
                + (totalVendasNovo != null ? totalVendasNovo : 0);
        long quantidadeVendida = (qtdLegado != null ? qtdLegado : 0) + (qtdNovo != null ? qtdNovo : 0);
        double receitaTotal = (receitaLegado != null ? receitaLegado : 0.0) + (receitaNovo != null ? receitaNovo : 0.0);

        // Breakdown por método (legado + novo)
        Map<String, Double> porPagamento = new HashMap<>();
        porPagamento.put("dinheiro", 0.0);
        porPagamento.put("cartao_credito", 0.0);
        porPagamento.put("cartao_debito", 0.0);
        porPagamento.put("pix", 0.0);

        jdbcTemplate.query(
                "SELECT metodo_pagamento, COALESCE(SUM(preco_total),0) as valor FROM vendas WHERE DATE(data_venda) = ? GROUP BY metodo_pagamento",
                rs -> {
                    String metodo = rs.getString("metodo_pagamento");
                    double valor = rs.getDouble("valor");
                    porPagamento.merge(metodo, valor, Double::sum);
                }, dia);

        jdbcTemplate.query(
                "SELECT vp.metodo, COALESCE(SUM(vp.valor),0) as valor FROM venda_pagamentos vp JOIN venda_cabecalho vc ON vc.id = vp.venda_id WHERE DATE(vc.data_venda) = ? GROUP BY vp.metodo",
                rs -> {
                    String metodo = rs.getString("metodo");
                    double valor = rs.getDouble("valor");
                    porPagamento.merge(metodo, valor, Double::sum);
                }, dia);

        long vendasComMultiploPagamento = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM (SELECT vp.venda_id FROM venda_pagamentos vp JOIN venda_cabecalho vc ON vc.id = vp.venda_id WHERE DATE(vc.data_venda) = ? GROUP BY vp.venda_id HAVING COUNT(*) > 1) t",
                Long.class, dia);

        result.put("data", dia.toString());
        result.put("total_vendas", totalVendas);
        result.put("quantidade_vendida", quantidadeVendida);
        result.put("receita_total", receitaTotal);
        result.put("por_pagamento", porPagamento);
        result.put("vendas_com_multiplo_pagamento", vendasComMultiploPagamento);
        return result;
    }

    public Map<String, Object> getResumoMes(int ano, int mes) {
        YearMonth ym = YearMonth.of(ano, mes);
        LocalDate inicio = ym.atDay(1);
        LocalDate fim = ym.atEndOfMonth();

        Map<String, Object> result = new HashMap<>();

        Long totalVendasLegado = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM vendas v WHERE DATE(v.data_venda) BETWEEN ? AND ?", Long.class, inicio, fim);
        Long qtdLegado = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(v.quantidade_vendida),0) FROM vendas v WHERE DATE(v.data_venda) BETWEEN ? AND ?",
                Long.class, inicio, fim);
        Double receitaLegado = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(v.preco_total),0) FROM vendas v WHERE DATE(v.data_venda) BETWEEN ? AND ?",
                Double.class, inicio, fim);

        Long totalVendasNovo = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM venda_cabecalho vc WHERE DATE(vc.data_venda) BETWEEN ? AND ?", Long.class, inicio,
                fim);
        Double receitaNovo = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(vc.total_final),0) FROM venda_cabecalho vc WHERE DATE(vc.data_venda) BETWEEN ? AND ?",
                Double.class, inicio, fim);
        Long qtdNovo = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(vi.quantidade),0) FROM venda_itens vi JOIN venda_cabecalho vc ON vc.id = vi.venda_id WHERE DATE(vc.data_venda) BETWEEN ? AND ?",
                Long.class, inicio, fim);

        long totalVendas = (totalVendasLegado != null ? totalVendasLegado : 0)
                + (totalVendasNovo != null ? totalVendasNovo : 0);
        long quantidadeVendida = (qtdLegado != null ? qtdLegado : 0) + (qtdNovo != null ? qtdNovo : 0);
        double receitaTotal = (receitaLegado != null ? receitaLegado : 0.0) + (receitaNovo != null ? receitaNovo : 0.0);

        Map<String, Double> porPagamento = new HashMap<>();
        porPagamento.put("dinheiro", 0.0);
        porPagamento.put("cartao_credito", 0.0);
        porPagamento.put("cartao_debito", 0.0);
        porPagamento.put("pix", 0.0);

        jdbcTemplate.query(
                "SELECT metodo_pagamento, COALESCE(SUM(preco_total),0) as valor FROM vendas WHERE DATE(data_venda) BETWEEN ? AND ? GROUP BY metodo_pagamento",
                rs -> {
                    String metodo = rs.getString("metodo_pagamento");
                    double valor = rs.getDouble("valor");
                    porPagamento.merge(metodo, valor, Double::sum);
                }, inicio, fim);

        jdbcTemplate.query(
                "SELECT vp.metodo, COALESCE(SUM(vp.valor),0) as valor FROM venda_pagamentos vp JOIN venda_cabecalho vc ON vc.id = vp.venda_id WHERE DATE(vc.data_venda) BETWEEN ? AND ? GROUP BY vp.metodo",
                rs -> {
                    String metodo = rs.getString("metodo");
                    double valor = rs.getDouble("valor");
                    porPagamento.merge(metodo, valor, Double::sum);
                }, inicio, fim);

        long vendasComMultiploPagamento = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM (SELECT vp.venda_id FROM venda_pagamentos vp JOIN venda_cabecalho vc ON vc.id = vp.venda_id WHERE DATE(vc.data_venda) BETWEEN ? AND ? GROUP BY vp.venda_id HAVING COUNT(*) > 1) t",
                Long.class, inicio, fim);

        result.put("periodo", inicio + " a " + fim);
        result.put("total_vendas", totalVendas);
        result.put("quantidade_vendida", quantidadeVendida);
        result.put("receita_total", receitaTotal);
        result.put("por_pagamento", porPagamento);
        result.put("vendas_com_multiplo_pagamento", vendasComMultiploPagamento);
        return result;
    }
}
