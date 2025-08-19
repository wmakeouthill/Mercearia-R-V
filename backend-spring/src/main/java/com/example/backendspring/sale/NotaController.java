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
    private EmailService emailService; // optional, injected via constructor

    private static final String ERROR_KEY = "error";

    public NotaController(SaleOrderRepository saleOrderRepository, @Nullable EmailService emailService) {
        this.saleOrderRepository = saleOrderRepository;
        this.emailService = emailService; // may be null if JavaMailSender not configured
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

    private String getProductImageDataUri(String imagePath) {
        try {
            if (imagePath == null || imagePath.isBlank())
                return null;
            Path p = Paths.get("uploads", "produtos", imagePath);
            if (!Files.exists(p))
                return null;
            byte[] data = Files.readAllBytes(p);
            String base64 = Base64.getEncoder().encodeToString(data);
            return "data:image/png;base64," + base64;
        } catch (Exception e) {
            return null;
        }
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
            emailService.sendEmailWithAttachment(to, subject, body, pdfBytes, NOTE_PREFIX + id + ".pdf");
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
        // estimate page height based on number of items so PDF is cropped to content
        // increase per-item estimate to avoid accidental pagination; allow large
        // max so renderer will place everything in a single page (we crop a bit
        // of white space rather than split into multiple pages)
        // Let Puppeteer measure the .invoice bounding box and size the PDF to content
        // so we avoid forced pagination via @page CSS.
        html.append(
                "body{font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size:9px; color:#111;margin:0;padding:0}");
        // make invoice slightly narrower than page to avoid any clipping
        html.append(
                ".invoice{width:94mm;margin:0 auto;padding:6px 6px;font-family:'Segoe UI', Arial, Helvetica, sans-serif;background:#fff;color:#111;display:block;box-sizing:border-box;line-height:1}");
        // keep logo small (receipt style) and centered
        html.append(".logo{max-width:22mm;width:auto;height:auto;display:block;margin:4px auto 2px auto}");
        // thumbnail and product layout
        html.append(
                ".thumb{width:10mm;height:10mm;margin-right:6px;border-radius:2px;object-fit:cover;display:inline-block}");
        html.append(".store{font-size:12px;font-weight:700;text-align:center;margin-top:2px}");
        html.append(".meta{font-size:9px;color:#444;text-align:center;margin:2px 0}");
        // table: let product column size by content; reserve fixed mm widths for
        // numeric columns
        html.append(
                "table{width:100%;border-collapse:collapse;margin-top:6px;font-size:10px;table-layout:auto;box-sizing:border-box}");
        html.append("th,td{padding:4px 6px;border-bottom:1px solid #ddd;box-sizing:border-box}");
        html.append("td.prod{display:flex;align-items:center;gap:6px;white-space:normal;overflow-wrap:break-word}");
        html.append(
                ".prod-name{display:block;flex:1;min-width:0;white-space:normal;overflow-wrap:break-word;word-break:normal}");
        html.append("td.qty{text-align:center;vertical-align:middle;white-space:nowrap}");
        // center numeric columns
        html.append("td.price{text-align:center;vertical-align:middle;white-space:nowrap;padding-right:4px}");
        html.append("td.total{text-align:center;vertical-align:middle;white-space:nowrap;padding-right:4px}");
        html.append("tfoot td{padding-top:8px;font-weight:700;border-top:1px solid #ddd}");
        html.append(".small{font-size:10px;color:#666;text-align:center;margin-top:6px}");
        html.append("</style></head><body>");

        html.append("<div class=\"invoice\">\n");

        String logoDataUri = getLogoDataUri();
        // centered logo + store name
        if (logoDataUri != null) {
            html.append("<img class=\"logo\" src=\"").append(logoDataUri)
                    .append("\" alt=\"logo\"/>\n");
        } else {
            html.append(
                    "<div style=\"width:120px;height:60px;margin:0 auto;background:#f2f2f2;display:flex;align-items:center;justify-content:center;border-radius:4px;color:#666\">LOGO</div>\n");
        }
        html.append("<div class=\"store\">Mercearia R-V</div>\n");
        html.append("<div class=\"meta\">Comprovante de Pedido</div>\n");

        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        if (venda.getCustomerName() != null)
            html.append("<div class=\"small\">Cliente: ").append(escapeHtml(venda.getCustomerName())).append(CLOSE_DIV);
        if (venda.getCustomerEmail() != null)
            html.append("<div class=\"small\">Email: ").append(escapeHtml(venda.getCustomerEmail())).append(CLOSE_DIV);
        if (venda.getCustomerPhone() != null)
            html.append("<div class=\"small\">Telefone: ").append(escapeHtml(venda.getCustomerPhone()))
                    .append(CLOSE_DIV);
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
            // product thumbnail (if present) + name
            String imgUri = getProductImageDataUri(it.getProduto().getImagem());
            html.append("<td class=\"prod\">");
            if (imgUri != null) {
                html.append("<img class=\"thumb\" src=\"" + imgUri + "\" alt=\"\"/>");
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
        // footer total with non-breaking space
        // footer total with numeric non-breaking space
        html.append(
                "<tfoot><tr><td colspan=\"3\" style=\"text-align:right\">Total:</td><td style=\"text-align:right\">R$&#160;"
                        + String.format("%.2f", venda.getTotalFinal()) + "</td></tr></tfoot>\n");
        html.append("</table>\n");

        html.append("</div>\n");
        html.append("</body></html>");
        return html.toString();
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
