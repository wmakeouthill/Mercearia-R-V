package com.example.backendspring.sale;

import com.example.backendspring.caixa.CaixaStatus;
import com.example.backendspring.caixa.CaixaStatusRepository;
import com.example.backendspring.caixa.CaixaMovimentacaoRepository;
import com.example.backendspring.product.Product;
import com.example.backendspring.product.ProductRepository;
import org.junit.jupiter.api.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SaleAdjustmentReturnExchangeTest {

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private SaleOrderRepository saleOrderRepository;

    @Autowired
    private SaleItemRepository saleItemRepository;

    @Autowired
    private SaleAdjustmentRepository saleAdjustmentRepository;

    @Autowired
    private CaixaStatusRepository caixaStatusRepository;

    @Autowired
    private CaixaMovimentacaoRepository caixaMovimentacaoRepository;

    @Autowired
    private SaleAdjustmentController adjustmentController;

    @BeforeAll
    void setup() {
        // ensure DB is reachable via Spring Boot test profile (embedded PG provided by
        // test environment)
    }

    @Test
    @Transactional
    void testReturnAdjustsStockAndCreatesAdjustment() {
        // create product
        Product p = Product.builder().nome("TestProd").precoVenda(10.0).quantidadeEstoque(5).build();
        p = productRepository.save(p);

        // create sale order with one item
        SaleOrder order = SaleOrder.builder().subtotal(10.0).desconto(0.0).acrescimo(0.0).totalFinal(10.0).build();
        SaleItem it = SaleItem.builder().venda(order).produto(p).quantidade(1).precoUnitario(10.0).precoTotal(10.0)
                .build();
        order.getItens().add(it);
        SalePayment sp = SalePayment.builder().venda(order).metodo("dinheiro").valor(10.0).troco(0.0).build();
        order.getPagamentos().add(sp);
        order = saleOrderRepository.save(order);

        // open caixa session so adjustments allowed
        CaixaStatus cs = CaixaStatus.builder().aberto(true).saldoInicial(0.0).build();
        cs = caixaStatusRepository.save(cs);

        // perform return via controller
        SaleAdjustmentController.AdjustmentRequest req = new SaleAdjustmentController.AdjustmentRequest();
        req.setType("return");
        req.setSaleItemId(it.getId());
        req.setQuantity(1);
        req.setPaymentMethod("dinheiro");
        var resp = adjustmentController.createAdjustment(order.getId(), req);
        assertThat(resp.getStatusCode().is2xxSuccessful()).isTrue();

        // verify adjustment recorded
        var adjustments = saleAdjustmentRepository.findBySaleOrderId(order.getId());
        assertThat(adjustments).isNotEmpty();
        var adj = adjustments.get(0);
        assertThat(adj.getType()).isEqualTo("return");

        // product stock increased
        var prodAfter = productRepository.findById(p.getId()).orElseThrow();
        assertThat(prodAfter.getQuantidadeEstoque()).isEqualTo(6);
    }
}
