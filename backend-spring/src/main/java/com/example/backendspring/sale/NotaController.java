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

    private static final String ERROR_KEY = "error";

    public NotaController(SaleOrderRepository saleOrderRepository, @Nullable EmailService emailService) {
        this.saleOrderRepository = saleOrderRepository;
        this.emailService = emailService; // may be null if JavaMailSender not configured
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
        // estimate page height based on number of items so PDF is cropped to content
        // increase per-item estimate to avoid accidental pagination; allow large
        // max so renderer will place everything in a single page (we crop a bit
        // of white space rather than split into multiple pages)
        int items = venda.getItens() == null ? 0 : venda.getItens().size();
        int estimatedHeightMm = 30 + items * 12; // base + per-item
        if (estimatedHeightMm < 60)
            estimatedHeightMm = 60;
        if (estimatedHeightMm > 1000)
            estimatedHeightMm = 1000;
        // Let Puppeteer measure the .invoice bounding box and size the PDF to content
        // so we avoid forced pagination via @page CSS.
        html.append(
                "body{font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size:9px; color:#111;margin:0;padding:0}");
        // make invoice slightly narrower than page to avoid any clipping
        html.append(
                ".invoice{width:90mm;margin:0 auto;padding:6px 6px;font-family:'Segoe UI', Arial, Helvetica, sans-serif;background:#fff;color:#111;display:block;box-sizing:border-box;line-height:1}");
        // keep logo small (receipt style) and centered
        html.append(".logo{max-width:22mm;width:auto;height:auto;display:block;margin:4px auto 2px auto}");
        html.append(
                ".thumb{width:10mm;height:10mm;margin-right:6px;border-radius:2px;object-fit:cover;display:inline-block}");
        html.append("td.prod{display:flex;align-items:center}");
        html.append(".store{font-size:12px;font-weight:700;text-align:center;margin-top:2px}");
        html.append(".meta{font-size:9px;color:#444;text-align:center;margin:2px 0}");
        // fixed layout: widths by mm to match receipt, ensure product wraps and numbers
        // never break
        html.append(
                "table{width:100%;border-collapse:collapse;margin-top:6px;font-size:10px;table-layout:fixed;box-sizing:border-box}");
        html.append("th,td{padding:4px 6px;border-bottom:1px solid #ddd;box-sizing:border-box}");
        // column widths match the table colgroup; give more room to price/total
        // (50/10/20/20)
        html.append(
                "td.prod{width:50%;max-width:50%;white-space:normal;overflow-wrap:break-word;word-break:break-word}");
        html.append("td.qty{width:10%;text-align:center;white-space:nowrap}");
        // center numeric columns to avoid overlap and improve legibility on narrow
        // receipts
        html.append("td.price{width:25%;text-align:center;white-space:nowrap;padding-right:8px}");
        html.append("td.total{width:25%;text-align:center;white-space:nowrap;padding-right:8px}");
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
            html.append("<div class=\"small\">Cliente: ").append(escapeHtml(venda.getCustomerName())).append("</div>");
        if (venda.getCustomerEmail() != null)
            html.append("<div class=\"small\">Email: ").append(escapeHtml(venda.getCustomerEmail())).append("</div>");
        if (venda.getCustomerPhone() != null)
            html.append("<div class=\"small\">Telefone: ").append(escapeHtml(venda.getCustomerPhone()))
                    .append("</div>");
        html.append("<div class=\"small\">Data: ").append(venda.getDataVenda().format(fmt)).append("</div>");

        // use fixed table layout with percentage columns so widths match CSS and wrap
        // works
        // let CSS control font-size; avoid inline font-size to prevent conflicts
        html.append(
                "<table style=\"width:100%;border-collapse:collapse;margin-top:6px;table-layout:fixed;\">\n");
        html.append(
                "<colgroup><col style=\"width:40%\"/><col style=\"width:10%\"/><col style=\"width:25%\"/><col style=\"width:25%\"/></colgroup>\n");
        html.append(
                "<thead><tr><th style=\"text-align:left;padding:6px 4px;border-bottom:1px solid #ddd\">Produto</th><th style=\"text-align:center;padding:6px 4px;border-bottom:1px solid #ddd\">Qtd</th><th style=\"text-align:right;padding:6px 4px;border-bottom:1px solid #ddd\">Preço</th><th style=\"text-align:right;padding:6px 4px;border-bottom:1px solid #ddd\">Total</th></tr></thead>\n");
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
            html.append("</td>");
            html.append("<td class=\"qty\">" + it.getQuantidade() + "</td>");
            // use numeric non-breaking entity (&#160;) to be XML-safe and avoid line breaks
            html.append("<td class=\"price\">R$&#160;" + String.format("%.2f", it.getPrecoUnitario()) + "</td>");
            html.append("<td class=\"total\">R$&#160;" + String.format("%.2f", it.getPrecoTotal()) + "</td>");
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
            Path htmlTmp = outDir.resolve("nota-" + id + ".html");
            Files.write(htmlTmp, htmlStr.getBytes(StandardCharsets.UTF_8));
            log.info("Saved nota HTML to {}", htmlTmp.toAbsolutePath());

            // script is located in repo root `scripts/`; backend runs with cwd
            // backend-spring,
            // so resolve parent then scripts
            Path script = Paths.get(System.getProperty("user.dir")).resolve("..").resolve("scripts")
                    .resolve("render-nota-pdf.js").normalize().toAbsolutePath();
            Path pdfOut = outDir.resolve("nota-" + id + ".pdf");

            int attempts = 1; // single attempt as requested
            for (int attempt = 1; attempt <= attempts; attempt++) {
                try {
                    ProcessBuilder pb = new ProcessBuilder("node", script.toString(), htmlTmp.toString(),
                            pdfOut.toString());
                    // set working directory to scripts folder (repo root/scripts) so local
                    // node_modules (puppeteer) is resolved
                    java.io.File scriptsDir = Paths.get(System.getProperty("user.dir")).resolve("..").resolve("scripts")
                            .normalize().toFile();
                    pb.directory(scriptsDir.exists() ? scriptsDir : new java.io.File(System.getProperty("user.dir")));
                    pb.redirectErrorStream(true);
                    Process p = pb.start();
                    try (java.io.InputStream is = p.getInputStream()) {
                        java.util.Scanner s = new java.util.Scanner(is).useDelimiter("\\A");
                        String out = s.hasNext() ? s.next() : "";
                        log.debug("puppeteer output (attempt {}): {}", attempt, out);
                    }
                    boolean finished = p.waitFor(45, java.util.concurrent.TimeUnit.SECONDS);
                    if (!finished) {
                        p.destroyForcibly();
                        log.warn("Puppeteer attempt {} timed out", attempt);
                        continue;
                    }
                    int exit = p.exitValue();
                    if (exit == 0 && Files.exists(pdfOut)) {
                        byte[] pdf = Files.readAllBytes(pdfOut);
                        log.info("Puppeteer produced PDF {} ({} bytes)", pdfOut.toAbsolutePath(), pdf.length);
                        return pdf;
                    } else {
                        log.warn("Puppeteer attempt {} failed exit {}", attempt, exit);
                    }
                } catch (Exception ex) {
                    log.warn("Puppeteer attempt {} error: {}", attempt, ex.getMessage());
                }
            }
            throw new IllegalStateException("Puppeteer render failed after " + attempts + " attempts");
        } catch (Exception e) {
            throw new IllegalStateException("Failed to render PDF with Puppeteer", e);
        }
    }

    // Crops the first page of the given PDF file to the minimal bounding box that
    // contains non-white content. Returns new PDF bytes or null on failure.
    private byte[] cropPdfToContent(Path pdfPath) {
        try (org.apache.pdfbox.pdmodel.PDDocument doc = org.apache.pdfbox.pdmodel.PDDocument.load(pdfPath.toFile())) {
            if (doc.getNumberOfPages() == 0)
                return null;
            org.apache.pdfbox.rendering.PDFRenderer renderer = new org.apache.pdfbox.rendering.PDFRenderer(doc);
            // render at higher DPI to improve content detection (anti-aliased text)
            final int dpi = 150;
            java.awt.image.BufferedImage image = renderer.renderImageWithDPI(0, dpi);
            int w = image.getWidth();
            int h = image.getHeight();

            int top = 0, bottom = h - 1;
            // find top
            // treat near-white pixels as white; improves robustness to anti-aliasing
            outer: for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int rgb = image.getRGB(x, y);
                    int r = (rgb >> 16) & 0xFF;
                    int g = (rgb >> 8) & 0xFF;
                    int b = (rgb) & 0xFF;
                    int lum = (r + g + b) / 3;
                    if (lum < 250) {
                        top = y;
                        break outer;
                    }
                }
            }
            // find bottom
            outer2: for (int y = h - 1; y >= 0; y--) {
                for (int x = 0; x < w; x++) {
                    int rgb = image.getRGB(x, y);
                    int r = (rgb >> 16) & 0xFF;
                    int g = (rgb >> 8) & 0xFF;
                    int b = (rgb) & 0xFF;
                    int lum = (r + g + b) / 3;
                    if (lum < 250) {
                        bottom = y;
                        break outer2;
                    }
                }
            }

            // convert pixel heights to points: 1 pt = 1/72 in; pixel->pt = 72 / dpi
            float ptPerPixel = 72.0f / dpi;
            // add small margin in pixels to avoid cutting glyphs
            int marginPx = Math.min(12, h / 40); // adaptive margin
            int topWithMargin = Math.max(0, top - marginPx);
            int bottomWithMargin = Math.min(h - 1, bottom + marginPx);
            float cropHeightPt = (bottomWithMargin - topWithMargin + 1) * ptPerPixel;
            float pageWidthPt = doc.getPage(0).getMediaBox().getWidth();

            // create new document with cropped height
            try (org.apache.pdfbox.pdmodel.PDDocument out = new org.apache.pdfbox.pdmodel.PDDocument()) {
                org.apache.pdfbox.pdmodel.common.PDRectangle rect = new org.apache.pdfbox.pdmodel.common.PDRectangle(
                        pageWidthPt, cropHeightPt);
                org.apache.pdfbox.pdmodel.PDPage newPage = new org.apache.pdfbox.pdmodel.PDPage(rect);
                out.addPage(newPage);

                // import content from original first page onto new page but translated
                org.apache.pdfbox.multipdf.Overlay overlay = new org.apache.pdfbox.multipdf.Overlay();
                // As a simpler approach, draw original page as Form XObject and place with
                // translation
                org.apache.pdfbox.pdmodel.PDPage original = doc.getPage(0);
                org.apache.pdfbox.pdmodel.PDResources resources = original.getResources();

                // Use PDFRenderer to render the cropped area into image and then place it into
                // new PDF
                java.awt.image.BufferedImage croppedImage = image.getSubimage(0, topWithMargin, w,
                        bottomWithMargin - topWithMargin + 1);
                try (java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream()) {
                    javax.imageio.ImageIO.write(croppedImage, "PNG", baos);
                    baos.flush();
                    byte[] imgBytes = baos.toByteArray();

                    org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject pdImage = org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory
                            .createFromImage(out, croppedImage);
                    try (org.apache.pdfbox.pdmodel.PDPageContentStream cs = new org.apache.pdfbox.pdmodel.PDPageContentStream(
                            out, newPage)) {
                        cs.drawImage(pdImage, 0, 0, pageWidthPt, cropHeightPt);
                    }
                }

                java.io.ByteArrayOutputStream bout = new java.io.ByteArrayOutputStream();
                out.save(bout);
                return bout.toByteArray();
            }
        } catch (Exception e) {
            log.warn("cropPdfToContent failed: {}", e.getMessage());
            return null;
        }
    }
}
