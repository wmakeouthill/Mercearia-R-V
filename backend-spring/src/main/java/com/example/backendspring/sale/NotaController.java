package com.example.backendspring.sale;

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

    private static final String NOTE_PREFIX = "nota-";
    private static final String USER_DIR_PROPERTY = "user.dir";
    // inline HTML fragments used multiple times
    private static final String CLOSE_DIV = "</div>";
    private static final String CLOSE_TD = "</td>";

    private final SaleOrderRepository saleOrderRepository;
    private final com.example.backendspring.client.ClientRepository clientRepository;
    private EmailService emailService; // optional, injected via constructor

    private static final String ERROR_KEY = "error";

    public NotaController(SaleOrderRepository saleOrderRepository,
            com.example.backendspring.client.ClientRepository clientRepository, @Nullable EmailService emailService) {
        this.saleOrderRepository = saleOrderRepository;
        this.clientRepository = clientRepository;
        this.emailService = emailService; // may be null if JavaMailSender not configured
        log.info("EmailService present: {}", this.emailService != null);
    }

    // Extracted helper so the main method is shorter and Sonar S1141/Cognitive
    // Complexity is reduced.
    private boolean runPuppeteerRender(Path script, Path htmlTmp, Path pdfOut)
            throws java.io.IOException, InterruptedException {
        java.io.File scriptsDir = Paths.get(System.getProperty(USER_DIR_PROPERTY)).resolve("..")
                .resolve("scripts").normalize().toFile();
        ProcessBuilder pb = new ProcessBuilder("node", script.toString(), htmlTmp.toString(), pdfOut.toString());
        pb.directory(scriptsDir.exists() ? scriptsDir : new java.io.File(System.getProperty(USER_DIR_PROPERTY)));
        pb.redirectErrorStream(true);
        Process p = pb.start();
        String out = readProcessOutput(p);
        log.debug("puppeteer output: {}", out);
        boolean finished = p.waitFor(45, java.util.concurrent.TimeUnit.SECONDS);
        if (!finished) {
            p.destroyForcibly();
            log.warn("Puppeteer timed out");
            return false;
        }
        int exit = p.exitValue();
        return exit == 0 && Files.exists(pdfOut);
    }

    private String readProcessOutput(Process p) throws java.io.IOException {
        try (java.io.InputStream is = p.getInputStream();
                java.util.Scanner s = new java.util.Scanner(is).useDelimiter("\\A")) {
            return s.hasNext() ? s.next() : "";
        }
    }

    // removed unused PuppeteerRenderException

    // Attempts rendering (may call Puppeteer multiple times) and returns PDF bytes.
    private byte[] attemptPuppeteerRender(Path script, Path htmlTmp, Path pdfOut)
            throws InterruptedException, java.io.IOException {
        int attempts = 1;
        for (int attempt = 1; attempt <= attempts; attempt++) {
            boolean ok = runPuppeteerRender(script, htmlTmp, pdfOut);
            if (ok) {
                return Files.readAllBytes(pdfOut);
            }
            log.warn("Puppeteer attempt {} failed", attempt);
        }
        throw new IllegalStateException("Puppeteer render failed after " + attempts + " attempts");
    }

    // Removed getProductImageDataUri method to reduce PDF size - no longer
    // embedding product images

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

    @GetMapping("/{id}/nota/html")
    @Transactional(readOnly = true)
    public ResponseEntity<String> getNotaHtml(@PathVariable Long id) {
        var vendaOpt = saleOrderRepository.findById(id);
        if (vendaOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        String htmlStr = buildHtmlForVenda(vendaOpt.get());
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.TEXT_HTML);
        // allow embedding in same-origin frames
        headers.set("X-Frame-Options", "SAMEORIGIN");
        return ResponseEntity.ok().headers(headers).body(htmlStr);
    }

    @PostMapping("/{id}/send-email")
    @Transactional
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
            emailService.sendEmailWithAttachment(to, subject, body, pdfBytes, NOTE_PREFIX + id + ".pdf");

            // After successful send, persist or link client based on saleOrder contact
            // fields
            try {
                com.example.backendspring.client.Client cliente = null;
                String email = venda.getCustomerEmail();
                String phone = venda.getCustomerPhone();
                if (email != null && !email.isBlank()) {
                    try {
                        cliente = clientRepository.findByEmailIgnoreCase(email.trim().toLowerCase()).orElse(null);
                    } catch (Exception ex) {
                        cliente = clientRepository.findByEmail(email).orElse(null);
                    }
                }
                if (cliente == null && phone != null && !phone.isBlank()) {
                    cliente = clientRepository.findByTelefone(phone).orElse(null);
                }
                if (cliente != null) {
                    if (venda.getCustomerName() != null && !venda.getCustomerName().isBlank()
                            && (cliente.getNome() == null || cliente.getNome().isBlank()
                                    || cliente.getNome().equalsIgnoreCase("Cliente"))) {
                        cliente.setNome(venda.getCustomerName().trim());
                        clientRepository.save(cliente);
                    }
                } else {
                    // create new client only if we have identifying info
                    String baseName = null;
                    if (venda.getCustomerName() != null && !venda.getCustomerName().isBlank()) {
                        baseName = venda.getCustomerName().trim();
                    } else if (email != null && email.contains("@")) {
                        baseName = email.split("@")[0];
                    } else if (phone != null && !phone.isBlank()) {
                        baseName = phone.trim();
                    }
                    if (baseName != null) {
                        // reuse CheckoutController's helper if possible; otherwise simple unique suffix
                        String uniqueName = baseName;
                        int s = 1;
                        while (clientRepository.existsByNomeIgnoreCase(uniqueName)) {
                            s++;
                            uniqueName = baseName + " (" + s + ")";
                        }
                        cliente = com.example.backendspring.client.Client.builder()
                                .nome(uniqueName)
                                .email(email)
                                .telefone(phone)
                                .createdAt(java.time.OffsetDateTime.now())
                                .build();
                        clientRepository.save(cliente);
                    }
                }
                // associate sale order with client if not already linked
                if (cliente != null && venda.getCliente() == null) {
                    venda.setCliente(cliente);
                    saleOrderRepository.save(venda);
                }
            } catch (Exception e) {
                log.warn("Failed to create/link client after send-email: {}", e.getMessage());
            }

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

    // Optimized logo - smaller resolution for reduced PDF size
    private String getLogoDataUri() {
        try {
            Path logoPath = Paths.get("uploads", "logo.png");
            if (!Files.exists(logoPath)) {
                return "";
            }
            byte[] logoBytes = Files.readAllBytes(logoPath);
            // Keep logo but smaller - only use if file is reasonable size
            if (logoBytes.length > 50000) { // > 50KB
                return ""; // Skip large logos to keep PDF small
            }
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(logoBytes);
        } catch (Exception e) {
            log.warn("Failed to load logo: {}", e.getMessage());
            return "";
        }
    }

    // Optimized product images - smaller resolution for reduced PDF size
    private String getProductImageDataUri(Long productId) {
        if (productId == null)
            return "";
        try {
            Path imagePath = Paths.get("uploads", "produtos", "produto_" + productId + ".png");
            if (!Files.exists(imagePath)) {
                // Try default image
                imagePath = Paths.get("uploads", "produtos", "padrao.png");
                if (!Files.exists(imagePath)) {
                    return "";
                }
            }
            byte[] imageBytes = Files.readAllBytes(imagePath);
            // Keep images but smaller - only use if file is reasonable size
            if (imageBytes.length > 30000) { // > 30KB
                return ""; // Skip large images to keep PDF small
            }
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(imageBytes);
        } catch (Exception e) {
            log.debug("Failed to load product image for {}: {}", productId, e.getMessage());
            return "";
        }
    }

    private String buildHtmlForVenda(SaleOrder venda) {
        StringBuilder html = new StringBuilder();
        html.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
        html.append("<html xmlns=\"http://www.w3.org/1999/xhtml\"><head><meta charset=\"utf-8\" />");
        html.append("<style>");
        // estimate page height based on number of items so PDF is cropped to content
        // increase per-item estimate to avoid accidental pagination; allow large
        // max so renderer will place everything in a single page (we crop a bit
        // of white space rather than split into multiple pages)
        // Let Puppeteer measure the .invoice bounding box and size the PDF to content
        // so we avoid forced pagination via @page CSS.
        // Simplified CSS for smaller PDF size
        html.append("body{font-family:Arial,sans-serif;font-size:10px;color:#111;margin:0;padding:0}");
        html.append(".invoice{width:90mm;margin:0 auto;padding:4px;background:#fff;color:#111}");
        html.append(".store{font-size:12px;font-weight:700;text-align:center;margin:4px 0}");
        html.append(".meta{font-size:9px;color:#444;text-align:center;margin:2px 0}");
        html.append("table{width:100%;border-collapse:collapse;margin-top:4px;font-size:9px}");
        html.append("th,td{padding:3px 4px;border-bottom:1px solid #ddd}");
        html.append("tbody tr:last-child td{border-bottom:none}");
        html.append("td.prod{display:flex;align-items:center}");
        html.append(".prod-name{flex:1;overflow-wrap:break-word}");
        html.append("td.qty,td.price,td.total{text-align:center;white-space:nowrap}");
        html.append("tfoot td{padding-top:6px;font-weight:700;border-top:1px solid #ddd}");
        html.append(".small{font-size:9px;color:#666;text-align:center;margin-top:4px}");
        html.append("</style></head><body>");

        html.append("<div class=\"invoice\">\n");

        // Header with optimized logo (if available and reasonably sized)
        String logoDataUri = getLogoDataUri();
        if (!logoDataUri.isEmpty()) {
            html.append("<div style=\"text-align:center;margin:6px 0\">");
            html.append("<img src=\"").append(logoDataUri)
                    .append("\" style=\"max-width:80px;max-height:40px;\" alt=\"Logo\" />");
            html.append("</div>");
        }
        html.append(
                "<div class=\"store\" style=\"font-size:14px;font-weight:700;text-align:center;margin:6px 0;padding:8px;background:#f8f8f8;border-radius:4px\">MERCEARIA R-V</div>\n");
        html.append("<div class=\"meta\">Comprovante de Pedido</div>\n");

        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        // Mostrar somente o nome do cliente no comprovante (email/telefone removidos)
        if (venda.getCustomerName() != null)
            html.append("<div class=\"small\">Cliente: ").append(escapeHtml(venda.getCustomerName())).append(CLOSE_DIV);
        html.append("<div class=\"small\">Data: ").append(venda.getDataVenda().format(fmt)).append(CLOSE_DIV);

        // let columns size by content; reserve fixed mm widths for numeric columns
        // let CSS control font-size; avoid inline font-size to prevent conflicts
        html.append(
                "<table style=\"width:100%;border-collapse:collapse;margin-top:6px;table-layout:auto;\">\n");
        html.append(
                "<colgroup><col style=\"width:auto\"/><col style=\"width:10mm\"/><col style=\"width:21mm\"/><col style=\"width:21mm\"/></colgroup>\n");
        html.append(
                "<thead><tr><th style=\"text-align:left;padding:6px 4px;border-bottom:1px solid #ddd\">Produto</th><th style=\"text-align:center;padding:6px 4px;border-bottom:1px solid #ddd\">Qtd</th><th style=\"text-align:center;padding:6px 4px;border-bottom:1px solid #ddd\">Preço</th><th style=\"text-align:center;padding:6px 4px;border-bottom:1px solid #ddd\">Total</th></tr></thead>\n");
        html.append("<tbody>\n");
        venda.getItens().forEach(it -> {
            html.append("<tr>");
            // Show product images if available and reasonably sized, otherwise use emoji
            html.append("<td class=\"prod\">");
            String productImageUri = getProductImageDataUri(it.getProduto().getId());
            if (!productImageUri.isEmpty()) {
                html.append("<img src=\"").append(productImageUri).append(
                        "\" style=\"width:20px;height:20px;margin-right:6px;border-radius:3px;\" alt=\"Produto\" />");
            } else {
                html.append("<span style=\"margin-right:6px;font-size:12px;\">📦</span>");
            }
            html.append("<span class=\"prod-name\">" + escapeHtml(it.getProduto().getNome()) + "</span>");
            html.append(CLOSE_TD);
            html.append("<td class=\"qty\">").append(it.getQuantidade()).append(CLOSE_TD);
            // use numeric non-breaking entity (&#160;) to be XML-safe and avoid line breaks
            html.append("<td class=\"price\">R$&#160;").append(String.format("%.2f", it.getPrecoUnitario()))
                    .append(CLOSE_TD);
            html.append("<td class=\"total\">R$&#160;").append(String.format("%.2f", it.getPrecoTotal()))
                    .append(CLOSE_TD);
            html.append("</tr>\n");
        });
        html.append("</tbody>\n");
        // footer: mostrar métodos de pagamento (com emoji) alinhados à esquerda e total
        // à direita
        String paymentsSummary = buildPaymentsSummary(venda);

        // allow left cell to wrap so it doesn't push the total column; keep total
        // non-wrapping and vertically centered
        html.append(
                "<tfoot><tr><td colspan=\"3\" style=\"text-align:left;white-space:normal;word-break:break-word;vertical-align:middle\">Pagamento via: "
                        + paymentsSummary
                        + "</td><td style=\"text-align:right;white-space:nowrap;vertical-align:middle\">Total: R$&#160;"
                        + String.format("%.2f", venda.getTotalFinal())
                        + "</td></tr></tfoot>\n");
        html.append("</table>\n");

        html.append("</div>\n");
        html.append("</body></html>");
        return html.toString();
    }

    // Build a compact, safe summary string for payments (e.g. "Cred R$ 10.00, Pix
    // R$ 5.00").
    private String buildPaymentsSummary(SaleOrder venda) {
        if (venda == null)
            return "";
        try {
            var pagamentos = venda.getPagamentos();
            if (pagamentos == null || pagamentos.isEmpty())
                return "";
            StringBuilder psb = new StringBuilder();
            for (var p : pagamentos) {
                if (!psb.isEmpty())
                    psb.append(", ");
                String metodo = p.getMetodo() == null ? "" : p.getMetodo();
                String label;
                // Use simple text symbols instead of external images to reduce PDF size
                switch (metodo) {
                    case "cartao_credito":
                        label = "💳 Créd";
                        break;
                    case "cartao_debito":
                        label = "💳 Déb";
                        break;
                    case "pix":
                        label = "📱 Pix";
                        break;
                    case "dinheiro":
                        label = "💵 Dinheiro";
                        break;
                    default:
                        label = metodo;
                }
                // normalize spaces in label and remove trailing/leading spaces to avoid
                // extra gap before ':'
                String cleanLabel = label == null ? "" : label.replaceAll("\\s+", " ").trim();
                psb.append(cleanLabel);
                psb.append(": R$&#160;").append(String.format("%.2f", p.getValor()));
            }
            return psb.toString();
        } catch (Exception e) {
            log.debug("buildPaymentsSummary failed: {}", e.getMessage());
            return "";
        }
    }

    private byte[] renderPdfFromHtml(String htmlStr, Long id) {
        // prefer Puppeteer rendering: write HTML to temp and call Node script that
        // measures .invoice bounding box and prints exact-sized PDF
        try {
            Path outDir = Paths.get(System.getProperty("java.io.tmpdir"));
            Files.createDirectories(outDir);
            Path htmlTmp = outDir.resolve(NOTE_PREFIX + id + ".html");
            Files.write(htmlTmp, htmlStr.getBytes(StandardCharsets.UTF_8));
            log.info("Saved nota HTML to {}", htmlTmp.toAbsolutePath());

            // script is located in repo root `scripts/`; backend runs with cwd
            // backend-spring,
            // so resolve parent then scripts
            Path script = Paths.get(System.getProperty(USER_DIR_PROPERTY)).resolve("..").resolve("scripts")
                    .resolve("render-nota-pdf.js").normalize().toAbsolutePath();
            Path pdfOut = outDir.resolve(NOTE_PREFIX + id + ".pdf");

            // delegate to helper that attempts render and either returns bytes or throws
            return attemptPuppeteerRender(script, htmlTmp, pdfOut);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Failed to render PDF with Puppeteer", ie);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to render PDF with Puppeteer", e);
        }
    }

    // cropPdfToContent was unused and produced many Sonar warnings; remove it to
    // keep the controller focused on HTML -> Puppeteer rendering.
}
