package com.example.backendspring.sale;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import org.springframework.lang.Nullable;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@RestController
@RequestMapping("/api/checkout")
public class NotaController {

    private final SaleOrderRepository saleOrderRepository;
    private EmailService emailService; // optional, injected via constructor

    private static final String TD_CLOSE = "</td>";
    private static final String PRICE_PREFIX = "<td class=\"right\">R$ ";
    private static final String ERROR_KEY = "error";

    public NotaController(SaleOrderRepository saleOrderRepository, @Nullable EmailService emailService) {
        this.saleOrderRepository = saleOrderRepository;
        this.emailService = emailService; // may be null if JavaMailSender not configured
    }

    private static final Logger log = LoggerFactory.getLogger(NotaController.class);

    @GetMapping("/{id}/nota")
    @Transactional(readOnly = true)
    public ResponseEntity<byte[]> getNotaPdf(@PathVariable Long id) {
        var vendaOpt = saleOrderRepository.findById(id);
        if (vendaOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        var venda = vendaOpt.get();

        String htmlStr = buildHtmlForVenda(venda);
        try {
            byte[] pdfBytes = renderPdfFromHtml(htmlStr, id);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_PDF);
            headers.set(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=nota-" + id + ".pdf");
            // allow embedding in same-origin frames/objects so frontend can preview
            headers.set("X-Frame-Options", "SAMEORIGIN");
            return ResponseEntity.ok().headers(headers).body(pdfBytes);
        } catch (Exception e) {
            log.error("Failed to generate PDF for order {}", id, e);
            return ResponseEntity.status(500)
                    .body(("Error generating PDF: " + e.getMessage()).getBytes(StandardCharsets.UTF_8));
        }
    }

    @PostMapping("/{id}/send-email")
    @Transactional(readOnly = true)
    public ResponseEntity<Object> sendNotaEmail(@PathVariable Long id, @RequestBody SendEmailRequest req) {
        var vendaOpt = saleOrderRepository.findById(id);
        if (vendaOpt.isEmpty())
            return ResponseEntity.status(404).body(Map.of(ERROR_KEY, "Venda não encontrada"));
        var venda = vendaOpt.get();

        String htmlStr = buildHtmlForVenda(venda);
        byte[] pdfBytes;
        try {
            pdfBytes = renderPdfFromHtml(htmlStr, id);
        } catch (Exception e) {
            log.error("Failed to generate/send PDF email for order {}", id, e);
            return ResponseEntity.status(500)
                    .body(Map.of(ERROR_KEY, "Error generating PDF", "details", e.getMessage()));
        }

        // send email
        try {
            String to = req.getTo();
            String subject = req.getSubject() != null ? req.getSubject() : "Comprovante Pedido #" + id;
            String body = req.getBody() != null ? req.getBody() : "Segue a nota do seu último pedido na nossa loja.";
            if (emailService == null) {
                return ResponseEntity.status(500).body(Map.of(ERROR_KEY, "Email service not configured"));
            }
            emailService.sendEmailWithAttachment(to, subject, body, pdfBytes, "nota-" + id + ".pdf");
            return ResponseEntity.ok(Map.of("message", "Email enviado"));
        } catch (Exception e) {
            return ResponseEntity.status(500)
                    .body(Map.of(ERROR_KEY, "Falha ao enviar email", "details", e.getMessage()));
        }
    }

    public static class SendEmailRequest {
        private String to;
        private String subject;
        private String body;

        public String getTo() {
            return to;
        }

        public void setTo(String to) {
            this.to = to;
        }

        public String getSubject() {
            return subject;
        }

        public void setSubject(String subject) {
            this.subject = subject;
        }

        public String getBody() {
            return body;
        }

        public void setBody(String body) {
            this.body = body;
        }
    }

    private String escapeHtml(String s) {
        if (s == null)
            return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("\'",
                "&#39;");
    }

    private String getLogoDataUri() {
        try {
            Path p = Paths.get("uploads", "produtos", "logo.png");
            if (!Files.exists(p))
                return null;
            byte[] data = Files.readAllBytes(p);
            String base64 = Base64.getEncoder().encodeToString(data);
            return "data:image/png;base64," + base64;
        } catch (Exception e) {
            return null;
        }
    }

    private String buildHtmlForVenda(SaleOrder venda) {
        StringBuilder html = new StringBuilder();
        html.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
        html.append("<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><meta charset=\"utf-8\" />");
        html.append("<style>");
        // set page size to small receipt width and small margins so PDF matches cupom
        html.append("@page{size:78mm auto;margin:4mm}");
        html.append(
                "body{font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size:12px; color:#111;margin:0;padding:0}");
        html.append(
                ".invoice{width:78mm;margin:0 auto;padding:6px;font-family:monospace;background:#fff;color:#111}");
        html.append(".logo{max-width:140px;height:auto;display:block;margin:0 auto}");
        html.append(".store{font-size:14px;font-weight:700;text-align:center;margin-top:6px}");
        html.append(".meta{font-size:10px;color:#444;text-align:center;margin:6px 0}");
        html.append("table{width:100%;border-collapse:collapse;margin-top:6px;font-size:11px;table-layout:fixed}");
        html.append("td{padding:6px 4px;border-bottom:1px dashed #ddd}");
        html.append("td.prod{width:55%;white-space:normal;}");
        html.append("td.qty{width:12%;text-align:center;white-space:nowrap}");
        html.append("td.price{width:16%;text-align:right;white-space:nowrap}");
        html.append("td.total{width:17%;text-align:right;white-space:nowrap}");
        html.append("tfoot td{padding-top:8px;font-weight:700;border-top:1px solid #ddd}");
        html.append(".small{font-size:10px;color:#666;text-align:center;margin-top:6px}");
        html.append("</style></head><body>");

        html.append("<div class=\"invoice\">\n");

        String logoDataUri = getLogoDataUri();
        // centered logo + store name
        if (logoDataUri != null) {
            html.append("<img class=\"logo\" src=\"").append(logoDataUri)
                    .append("\" style=\"display:block;margin:0 auto;max-width:140px;height:auto;\"/>\n");
        } else {
            html.append(
                    "<div style=\"width:120px;height:60px;margin:0 auto;background:#f2f2f2;display:flex;align-items:center;justify-content:center;border-radius:4px;color:#666\">LOGO</div>\n");
        }
        html.append("<div class=\"store\">Mercearia R-V</div>\n");
        html.append("<div class=\"meta\">Comprovante de Pedido</div>\n");

        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        if (venda.getCustomerName() != null)
            html.append("<div class=\"small\">Cliente: ").append(escapeHtml(venda.getCustomerName())).append("</div>");
        if (venda.getCustomerEmail() != null)
            html.append("<div class=\"small\">Email: ").append(escapeHtml(venda.getCustomerEmail())).append("</div>");
        if (venda.getCustomerPhone() != null)
            html.append("<div class=\"small\">Telefone: ").append(escapeHtml(venda.getCustomerPhone()))
                    .append("</div>");
        html.append("<div class=\"small\">Data: ").append(venda.getDataVenda().format(fmt)).append("</div>");

        html.append(
                "<table style=\"width:100%;font-size:12px;border-collapse:collapse;margin-top:6px;table-layout:fixed\">\n");
        html.append(
                "<colgroup><col style=\"width:40mm\"/><col style=\"width:10mm\"/><col style=\"width:14mm\"/><col style=\"width:14mm\"/></colgroup>\n");
        html.append(
                "<thead><tr><th style=\"text-align:left;padding:6px 4px;border-bottom:1px solid #ddd\">Produto</th><th style=\"text-align:center;padding:6px 4px;border-bottom:1px solid #ddd\">Qtd</th><th style=\"text-align:right;padding:6px 4px;border-bottom:1px solid #ddd\">Preço</th><th style=\"text-align:right;padding:6px 4px;border-bottom:1px solid #ddd\">Total</th></tr></thead>\n");
        html.append("<tbody>\n");
        venda.getItens().forEach(it -> {
            html.append("<tr>");
            html.append("<td class=\"prod\">" + escapeHtml(it.getProduto().getNome()) + "</td>");
            html.append("<td class=\"qty\">" + it.getQuantidade() + "</td>");
            html.append("<td class=\"price\">R$ " + String.format("%.2f", it.getPrecoUnitario()) + "</td>");
            html.append("<td class=\"total\">R$ " + String.format("%.2f", it.getPrecoTotal()) + "</td>");
            html.append("</tr>\n");
        });
        html.append("</tbody>\n");
        html.append(
                "<tfoot><tr><td colspan=\"3\" style=\"text-align:right\">Total:</td><td style=\"text-align:right\">R$ "
                        + String.format("%.2f", venda.getTotalFinal()) + "</td></tr></tfoot>\n");
        html.append("</table>\n");

        html.append("</div>\n");
        html.append("</body></html>");
        return html.toString();
    }

    private byte[] renderPdfFromHtml(String htmlStr, Long id) {
        // attempt to write an HTML copy for debugging, ignore failures
        try {
            Path outDir = Paths.get(System.getProperty("java.io.tmpdir"));
            Files.createDirectories(outDir);
            Path outFile = outDir.resolve("nota-" + id + ".html");
            Files.write(outFile, htmlStr.getBytes(StandardCharsets.UTF_8));
            log.info("Saved nota HTML to {}", outFile.toAbsolutePath());
        } catch (Exception ex) {
            log.warn("Failed to write nota HTML to disk: {}", ex.getMessage());
        }

        htmlStr = htmlStr.replace("\uFEFF", "");
        log.debug("PDF HTML preview (first 800 chars): {}",
                htmlStr.length() > 800 ? htmlStr.substring(0, 800) : htmlStr);
        log.debug("PDF HTML tail (last 400 chars): {}",
                htmlStr.length() > 400 ? htmlStr.substring(htmlStr.length() - 400) : htmlStr);

        try (ByteArrayOutputStream os = new ByteArrayOutputStream()) {
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.withHtmlContent(htmlStr, null);
            builder.toStream(os);
            builder.run();

            byte[] pdfBytes = os.toByteArray();

            // attempt to write a PDF copy for debugging, ignore failures
            try {
                Path outDir = Paths.get(System.getProperty("java.io.tmpdir"));
                Files.createDirectories(outDir);
                Path outFile = outDir.resolve("nota-" + id + ".pdf");
                Files.write(outFile, pdfBytes);
                log.info("Saved nota PDF to {} ({} bytes)", outFile.toAbsolutePath(), pdfBytes.length);
            } catch (Exception ex) {
                log.warn("Failed to write nota PDF to disk: {}", ex.getMessage());
            }

            return pdfBytes;
        } catch (Exception e) {
            throw new IllegalStateException("Failed to render PDF", e);
        }
    }
}
