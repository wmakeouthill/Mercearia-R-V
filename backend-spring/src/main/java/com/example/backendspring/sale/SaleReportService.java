package com.example.backendspring.sale;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Service
@RequiredArgsConstructor
public class SaleReportService {

        private final JdbcTemplate jdbcTemplate;
        private static final String ALIAS_VALOR = "valor";
        private static final Logger log = LoggerFactory.getLogger(SaleReportService.class);

        public Map<String, Object> getResumoDia(LocalDate dia) {
                Map<String, Object> result = new HashMap<>();

                // Totais usando o modelo unificado (venda_cabecalho + venda_itens +
                // venda_pagamentos)
                // Normalize data_venda to America/Sao_Paulo when extracting date
                Long totalVendas = jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM venda_cabecalho vc WHERE (vc.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = ?",
                                Long.class,
                                dia);
                Long qtdItens = jdbcTemplate.queryForObject(
                                "SELECT COALESCE(SUM(vi.quantidade),0) FROM venda_itens vi JOIN venda_cabecalho vc ON vc.id = vi.venda_id WHERE (vc.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = ?",
                                Long.class, dia);
                Double receitaTotal = jdbcTemplate.queryForObject(
                                "SELECT COALESCE(SUM(vc.total_final),0) FROM venda_cabecalho vc WHERE (vc.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = ?",
                                Double.class, dia);

                totalVendas = totalVendas != null ? totalVendas : 0L;
                long quantidadeVendida = qtdItens != null ? qtdItens : 0L;
                receitaTotal = receitaTotal != null ? receitaTotal : 0.0;

                Map<String, Double> porPagamento = new HashMap<>();
                porPagamento.put("dinheiro", 0.0);
                porPagamento.put("cartao_credito", 0.0);
                porPagamento.put("cartao_debito", 0.0);
                porPagamento.put("pix", 0.0);

                // breakdown por método usando venda_pagamentos
                jdbcTemplate.query(
                                ("SELECT vp.metodo, COALESCE(SUM(vp.valor),0) as " + ALIAS_VALOR
                                                + " FROM venda_pagamentos vp JOIN venda_cabecalho vc ON vc.id = vp.venda_id WHERE (vc.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = ? GROUP BY vp.metodo"),
                                rs -> {
                                        String metodo = rs.getString("metodo");
                                        double valor = rs.getDouble(ALIAS_VALOR);
                                        porPagamento.merge(metodo, valor, Double::sum);
                                }, dia);

                Long vendasComMultiploPagamentoObj = jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM (SELECT vp.venda_id FROM venda_pagamentos vp JOIN venda_cabecalho vc ON vc.id = vp.venda_id WHERE (vc.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = ? GROUP BY vp.venda_id HAVING COUNT(*) > 1) t",
                                Long.class, dia);
                long vendasComMultiploPagamento = vendasComMultiploPagamentoObj != null ? vendasComMultiploPagamentoObj
                                : 0L;

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

                Long totalVendasLegado = 0L;
                Long qtdLegado = 0L;
                Double receitaLegado = 0.0;
                try {
                        totalVendasLegado = jdbcTemplate.queryForObject(
                                        "SELECT COUNT(*) FROM vendas v WHERE (v.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ? AND ?",
                                        Long.class,
                                        inicio, fim);
                        qtdLegado = jdbcTemplate.queryForObject(
                                        "SELECT COALESCE(SUM(v.quantidade_vendida),0) FROM vendas v WHERE (v.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ? AND ?",
                                        Long.class, inicio, fim);
                        receitaLegado = jdbcTemplate.queryForObject(
                                        "SELECT COALESCE(SUM(v.preco_total),0) FROM vendas v WHERE (v.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ? AND ?",
                                        Double.class, inicio, fim);
                } catch (Exception e) {
                        // legacy table may have been removed; treat as zero
                        log.warn("Legacy vendas queries failed (table may not exist): {}", e.getMessage());
                        totalVendasLegado = 0L;
                        qtdLegado = 0L;
                        receitaLegado = 0.0;
                }

                Long totalVendasNovo = jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM venda_cabecalho vc WHERE (vc.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ? AND ?",
                                Long.class, inicio,
                                fim);
                Double receitaNovo = jdbcTemplate.queryForObject(
                                "SELECT COALESCE(SUM(vc.total_final),0) FROM venda_cabecalho vc WHERE (vc.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ? AND ?",
                                Double.class, inicio, fim);
                Long qtdNovo = jdbcTemplate.queryForObject(
                                "SELECT COALESCE(SUM(vi.quantidade),0) FROM venda_itens vi JOIN venda_cabecalho vc ON vc.id = vi.venda_id WHERE (vc.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ? AND ?",
                                Long.class, inicio, fim);

                long totalVendas = (totalVendasLegado != null ? totalVendasLegado : 0L)
                                + (totalVendasNovo != null ? totalVendasNovo : 0L);
                long quantidadeVendida = (qtdLegado != null ? qtdLegado : 0L) + (qtdNovo != null ? qtdNovo : 0L);
                double receitaTotal = (receitaLegado != null ? receitaLegado : 0.0)
                                + (receitaNovo != null ? receitaNovo : 0.0);

                Map<String, Double> porPagamento = new HashMap<>();
                porPagamento.put("dinheiro", 0.0);
                porPagamento.put("cartao_credito", 0.0);
                porPagamento.put("cartao_debito", 0.0);
                porPagamento.put("pix", 0.0);

                try {
                        jdbcTemplate.query(
                                        ("SELECT metodo_pagamento, COALESCE(SUM(preco_total),0) as " + ALIAS_VALOR
                                                        + " FROM vendas WHERE (data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ? AND ? GROUP BY metodo_pagamento"),
                                        rs -> {
                                                String metodo = rs.getString("metodo_pagamento");
                                                double valor = rs.getDouble(ALIAS_VALOR);
                                                porPagamento.merge(metodo, valor, Double::sum);
                                        }, inicio, fim);
                } catch (Exception e) {
                        log.debug("Legacy vendas por-pagamento query skipped: {}", e.getMessage());
                }

                jdbcTemplate.query(
                                ("SELECT vp.metodo, COALESCE(SUM(vp.valor),0) as " + ALIAS_VALOR
                                                + " FROM venda_pagamentos vp JOIN venda_cabecalho vc ON vc.id = vp.venda_id WHERE (vc.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ? AND ? GROUP BY vp.metodo"),
                                rs -> {
                                        String metodo = rs.getString("metodo");
                                        double valor = rs.getDouble(ALIAS_VALOR);
                                        porPagamento.merge(metodo, valor, Double::sum);
                                }, inicio, fim);

                Long vendasComMultiploPagamentoObj2 = jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM (SELECT vp.venda_id FROM venda_pagamentos vp JOIN venda_cabecalho vc ON vc.id = vp.venda_id WHERE (vc.data_venda AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ? AND ? GROUP BY vp.venda_id HAVING COUNT(*) > 1) t",
                                Long.class, inicio, fim);
                long vendasComMultiploPagamento = vendasComMultiploPagamentoObj2 != null
                                ? vendasComMultiploPagamentoObj2
                                : 0L;

                result.put("periodo", inicio + " a " + fim);
                result.put("total_vendas", totalVendas);
                result.put("quantidade_vendida", quantidadeVendida);
                result.put("receita_total", receitaTotal);
                result.put("por_pagamento", porPagamento);
                result.put("vendas_com_multiplo_pagamento", vendasComMultiploPagamento);
                return result;
        }

        public Map<String, Object> getResumoTotal() {
                Map<String, Object> result = new HashMap<>();

                // Totais usando o modelo unificado (venda_cabecalho + venda_itens +
                // venda_pagamentos)
                // Sem filtro de data - TODAS as vendas
                Long totalVendas = jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM venda_cabecalho vc",
                                Long.class);
                Long qtdItens = jdbcTemplate.queryForObject(
                                "SELECT COALESCE(SUM(vi.quantidade),0) FROM venda_itens vi JOIN venda_cabecalho vc ON vc.id = vi.venda_id",
                                Long.class);
                Double receitaTotal = jdbcTemplate.queryForObject(
                                "SELECT COALESCE(SUM(vc.total_final),0) FROM venda_cabecalho vc",
                                Double.class);

                totalVendas = totalVendas != null ? totalVendas : 0L;
                long quantidadeVendida = qtdItens != null ? qtdItens : 0L;
                receitaTotal = receitaTotal != null ? receitaTotal : 0.0;

                Map<String, Double> porPagamento = new HashMap<>();
                porPagamento.put("dinheiro", 0.0);
                porPagamento.put("cartao_credito", 0.0);
                porPagamento.put("cartao_debito", 0.0);
                porPagamento.put("pix", 0.0);

                // breakdown por método usando venda_pagamentos (todas as vendas)
                jdbcTemplate.query(
                                ("SELECT vp.metodo, COALESCE(SUM(vp.valor),0) as " + ALIAS_VALOR
                                                + " FROM venda_pagamentos vp JOIN venda_cabecalho vc ON vc.id = vp.venda_id GROUP BY vp.metodo"),
                                rs -> {
                                        String metodo = rs.getString("metodo");
                                        double valor = rs.getDouble(ALIAS_VALOR);
                                        porPagamento.merge(metodo, valor, Double::sum);
                                });

                Long vendasComMultiploPagamentoObj = jdbcTemplate.queryForObject(
                                "SELECT COUNT(*) FROM (SELECT vp.venda_id FROM venda_pagamentos vp JOIN venda_cabecalho vc ON vc.id = vp.venda_id GROUP BY vp.venda_id HAVING COUNT(*) > 1) t",
                                Long.class);
                long vendasComMultiploPagamento = vendasComMultiploPagamentoObj != null ? vendasComMultiploPagamentoObj
                                : 0L;

                result.put("periodo", "Total acumulado");
                result.put("total_vendas", totalVendas);
                result.put("quantidade_vendida", quantidadeVendida);
                result.put("receita_total", receitaTotal);
                result.put("por_pagamento", porPagamento);
                result.put("vendas_com_multiplo_pagamento", vendasComMultiploPagamento);
                return result;
        }
}
