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
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
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

    // File path constants
    private static final String UPLOADS_DIR = "uploads";
    private static final String BACKEND_SPRING_DIR = "backend-spring";
    private static final String PRODUTOS_DIR = "produtos";
    private static final String LOGO_FILENAME = "logo.png";
    private static final String PADRAO_FILENAME = "padrao.png";
    private static final String RESOURCES_DIR = "resources";

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

        return sendEmailWithPdf(req, id, pdfBytes, venda);
    }

    private ResponseEntity<Object> sendEmailWithPdf(SendEmailRequest req, Long id, byte[] pdfBytes, SaleOrder venda) {
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
            linkOrCreateClientFromSaleOrder(venda);

            return ResponseEntity.ok(Map.of("message", "Email enviado"));
        } catch (Exception e) {
            return ResponseEntity.status(500)
                    .body(Map.of(ERROR_KEY, "Falha ao enviar email", "details", e.getMessage()));
        }
    }

    private void linkOrCreateClientFromSaleOrder(SaleOrder venda) {
        try {
            com.example.backendspring.client.Client cliente = findExistingClient(venda);

            if (cliente != null) {
                updateClientNameIfNeeded(cliente, venda);
            } else {
                cliente = createNewClientIfPossible(venda);
            }

            // associate sale order with client if not already linked
            if (cliente != null && venda.getCliente() == null) {
                venda.setCliente(cliente);
                saleOrderRepository.save(venda);
            }
        } catch (Exception e) {
            log.warn("Failed to create/link client after send-email: {}", e.getMessage());
        }
    }

    private com.example.backendspring.client.Client findExistingClient(SaleOrder venda) {
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

        return cliente;
    }

    private void updateClientNameIfNeeded(com.example.backendspring.client.Client cliente, SaleOrder venda) {
        if (venda.getCustomerName() != null && !venda.getCustomerName().isBlank()
                && (cliente.getNome() == null || cliente.getNome().isBlank()
                        || cliente.getNome().equalsIgnoreCase("Cliente"))) {
            cliente.setNome(venda.getCustomerName().trim());
            clientRepository.save(cliente);
        }
    }

    private com.example.backendspring.client.Client createNewClientIfPossible(SaleOrder venda) {
        String baseName = determineBaseName(venda);
        if (baseName == null) {
            return null;
        }

        String uniqueName = generateUniqueName(baseName);
        com.example.backendspring.client.Client cliente = com.example.backendspring.client.Client.builder()
                .nome(uniqueName)
                .email(venda.getCustomerEmail())
                .telefone(venda.getCustomerPhone())
                .createdAt(java.time.OffsetDateTime.now())
                .build();

        return clientRepository.save(cliente);
    }

    private String determineBaseName(SaleOrder venda) {
        String email = venda.getCustomerEmail();
        String phone = venda.getCustomerPhone();

        if (venda.getCustomerName() != null && !venda.getCustomerName().isBlank()) {
            return venda.getCustomerName().trim();
        } else if (email != null && email.contains("@")) {
            return email.split("@")[0];
        } else if (phone != null && !phone.isBlank()) {
            return phone.trim();
        }
        return null;
    }

    private String generateUniqueName(String baseName) {
        String uniqueName = baseName;
        int s = 1;
        while (clientRepository.existsByNomeIgnoreCase(uniqueName)) {
            s++;
            uniqueName = baseName + " (" + s + ")";
        }
        return uniqueName;
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
            // Try multiple possible locations for the logo - incluindo produção
            Path[] logoPaths = {
                    Paths.get(UPLOADS_DIR, LOGO_FILENAME), // Desenvolvimento - cwd é backend-spring
                    Paths.get(BACKEND_SPRING_DIR, UPLOADS_DIR, LOGO_FILENAME), // Build local
                    Paths.get("..", UPLOADS_DIR, LOGO_FILENAME), // Relativo ao parent
                    Paths.get(System.getProperty(USER_DIR_PROPERTY), UPLOADS_DIR, LOGO_FILENAME), // Absoluto dev
                    // Caminhos para produção (executável standalone)
                    Paths.get(RESOURCES_DIR, BACKEND_SPRING_DIR, UPLOADS_DIR, LOGO_FILENAME), // Produção
                    Paths.get("..", RESOURCES_DIR, BACKEND_SPRING_DIR, UPLOADS_DIR, LOGO_FILENAME), // Produção relativo
                    Paths.get(".", BACKEND_SPRING_DIR, UPLOADS_DIR, LOGO_FILENAME), // Dentro do app
                    // Caminho do electron em produção
                    Paths.get("app.asar.unpacked", BACKEND_SPRING_DIR, UPLOADS_DIR, LOGO_FILENAME),
                    // Caminho padrão para imagem
                    Paths.get(UPLOADS_DIR, PADRAO_FILENAME),
                    Paths.get(BACKEND_SPRING_DIR, UPLOADS_DIR, PRODUTOS_DIR, PADRAO_FILENAME)
            };

            Path logoPath = null;
            for (Path testPath : logoPaths) {
                if (Files.exists(testPath)) {
                    logoPath = testPath;
                    log.debug("Logo found at: {}", testPath.toAbsolutePath());
                    break;
                }
            }

            if (logoPath == null) {
                log.debug("Logo not found in any of the expected paths");
                // Lista os caminhos testados para debug
                for (Path testPath : logoPaths) {
                    log.debug("Tested path: {}", testPath.toAbsolutePath());
                }
                return "";
            }

            byte[] logoBytes = Files.readAllBytes(logoPath);
            // Limite muito menor para PDF leve
            if (logoBytes.length > 50000) { // > 50KB apenas
                log.debug("Logo file too large: {} bytes (limit: 50KB)", logoBytes.length);
                return ""; // Skip large logos
            }

            // Logo da empresa não precisa ser comprimido - manter qualidade original
            log.debug("Logo loaded successfully from: {} (size: {}KB)",
                    logoPath.toAbsolutePath(), logoBytes.length / 1024);
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

        Path imagePath = findProductImage(productId);
        if (imagePath == null) {
            return "";
        }

        return processImageToDataUri(imagePath);
    }

    private Path findProductImage(Long productId) {
        String[] extensions = { "png", "jpg", "jpeg", "webp", "gif" };
        Path[] basePaths = createImageBasePaths();

        // First, try to find the product-specific image
        Path imagePath = findSpecificProductImage(productId, extensions, basePaths);

        // If no product-specific image found, try default image
        if (imagePath == null) {
            imagePath = findDefaultProductImage(extensions, basePaths, productId);
        }

        return imagePath;
    }

    private Path[] createImageBasePaths() {
        return new Path[] {
                Paths.get(UPLOADS_DIR), // Desenvolvimento - cwd é backend-spring
                Paths.get(BACKEND_SPRING_DIR, UPLOADS_DIR), // Build local
                Paths.get("..", UPLOADS_DIR), // Relativo parent
                Paths.get(System.getProperty(USER_DIR_PROPERTY), UPLOADS_DIR), // Absoluto dev
                // Caminhos para produção (executável standalone)
                Paths.get(RESOURCES_DIR, BACKEND_SPRING_DIR, UPLOADS_DIR), // Produção
                Paths.get("..", RESOURCES_DIR, BACKEND_SPRING_DIR, UPLOADS_DIR), // Produção relativo
                Paths.get(".", BACKEND_SPRING_DIR, UPLOADS_DIR), // Dentro do app
                // Caminho do electron em produção
                Paths.get("app.asar.unpacked", BACKEND_SPRING_DIR, UPLOADS_DIR)
        };
    }

    private Path findSpecificProductImage(Long productId, String[] extensions, Path[] basePaths) {
        for (Path basePath : basePaths) {
            for (String ext : extensions) {
                Path testPath = basePath.resolve(PRODUTOS_DIR).resolve("produto_" + productId + "." + ext);
                if (Files.exists(testPath)) {
                    return testPath;
                }
            }
        }
        return null;
    }

    private Path findDefaultProductImage(String[] extensions, Path[] basePaths, Long productId) {
        log.debug("Produto {} sem imagem específica, tentando imagem padrão...", productId);
        for (Path basePath : basePaths) {
            for (String ext : extensions) {
                Path testPath = basePath.resolve(PRODUTOS_DIR).resolve(PADRAO_FILENAME.replace(".png", "." + ext));
                if (Files.exists(testPath)) {
                    log.debug("Usando imagem padrão: {}", testPath.toAbsolutePath());
                    return testPath;
                }
            }
        }

        log.debug("No product image found for product {} in any of the expected paths", productId);
        return null;
    }

    private String processImageToDataUri(Path imagePath) {
        try {
            byte[] imageBytes = Files.readAllBytes(imagePath);
            String extension = getFileExtension(imagePath);

            // Estratégia inteligente para imagens:
            // 1. <= 20KB: usar diretamente (mais rápido)
            // 2. 20KB-100KB: compressão leve e rápida
            // 3. > 100KB: pular (muito grandes)

            if (imageBytes.length > 100000) { // > 100KB
                log.debug("Product image too large: {} bytes (limit: 100KB) - skipping", imageBytes.length);
                return ""; // Skip very large images
            }

            if (imageBytes.length <= 20000) { // <= 20KB
                // Usar diretamente sem processamento (mais rápido)
                String mimeType = extension.equals("jpg") ? "jpeg" : extension;
                log.debug("Product image loaded directly: {} (size: {}KB)", imagePath.toAbsolutePath(),
                        imageBytes.length / 1024);
                return "data:image/" + mimeType + ";base64," + Base64.getEncoder().encodeToString(imageBytes);
            }

            // Imagens médias (20-100KB): compressão leve e rápida
            byte[] compressedBytes = quickImageCompress(imageBytes);
            log.debug("Product image compressed: {} (original: {}KB, compressed: {}KB)",
                    imagePath.toAbsolutePath(), imageBytes.length / 1024, compressedBytes.length / 1024);
            return "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(compressedBytes);
        } catch (Exception e) {
            log.debug("Failed to load product image: {}", e.getMessage());
            return "";
        }
    }

    private String getFileExtension(Path imagePath) {
        String fileName = imagePath.getFileName().toString();
        int lastDot = fileName.lastIndexOf('.');
        return lastDot > 0 ? fileName.substring(lastDot + 1).toLowerCase() : "png";
    }

    // Compressão ULTRA leve - só processa se realmente necessário
    private byte[] quickImageCompress(byte[] imageBytes) {
        try {
            // Se o arquivo já é pequeno (menos de 15KB), nem comprime
            if (imageBytes.length < 15000) {
                return imageBytes; // Pula tudo - mais rápido
            }

            ByteArrayInputStream bais = new ByteArrayInputStream(imageBytes);
            java.awt.image.BufferedImage originalImage = javax.imageio.ImageIO.read(bais);

            if (originalImage == null) {
                return imageBytes; // Se não conseguir ler, retorna original
            }

            // Tamanho ainda menor para acelerar muito mais
            int maxSize = 28; // menor ainda (era 32)
            int width = originalImage.getWidth();
            int height = originalImage.getHeight();

            // Se já é pequena dimensão, só comprime qualidade levemente
            if (width <= maxSize && height <= maxSize) {
                return compressQuality(originalImage, 0.95f); // Compressão mínima
            }

            // Redimensionar com algoritmo mais rápido
            double ratio = Math.min((double) maxSize / width, (double) maxSize / height);
            int newWidth = Math.max(1, (int) (width * ratio));
            int newHeight = Math.max(1, (int) (height * ratio));

            java.awt.image.BufferedImage resizedImage = new java.awt.image.BufferedImage(
                    newWidth, newHeight, java.awt.image.BufferedImage.TYPE_INT_RGB);
            java.awt.Graphics2D g2d = resizedImage.createGraphics();

            // Configuração ULTRA rápida
            g2d.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION,
                    java.awt.RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR); // Mais rápido
            g2d.setRenderingHint(java.awt.RenderingHints.KEY_RENDERING,
                    java.awt.RenderingHints.VALUE_RENDER_SPEED); // Prioriza velocidade
            g2d.setRenderingHint(java.awt.RenderingHints.KEY_ALPHA_INTERPOLATION,
                    java.awt.RenderingHints.VALUE_ALPHA_INTERPOLATION_SPEED); // Alpha rápido
            g2d.drawImage(originalImage, 0, 0, newWidth, newHeight, null);
            g2d.dispose();

            return compressQuality(resizedImage, 0.95f); // 95% qualidade (quase sem compressão)

        } catch (java.io.IOException e) {
            log.debug("Quick compression failed: {}", e.getMessage());
            return imageBytes; // Se falhar, retorna original
        }
    }

    // Método auxiliar para compressão de qualidade
    private byte[] compressQuality(java.awt.image.BufferedImage image, float quality) throws java.io.IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        javax.imageio.ImageWriter writer = javax.imageio.ImageIO.getImageWritersByFormatName("jpg").next();
        javax.imageio.stream.ImageOutputStream ios = javax.imageio.ImageIO.createImageOutputStream(baos);
        writer.setOutput(ios);

        javax.imageio.ImageWriteParam writeParam = writer.getDefaultWriteParam();
        writeParam.setCompressionMode(javax.imageio.ImageWriteParam.MODE_EXPLICIT);
        writeParam.setCompressionQuality(quality);

        writer.write(null, new javax.imageio.IIOImage(image, null, null), writeParam);
        writer.dispose();
        ios.close();

        return baos.toByteArray();
    }

    private String buildHtmlForVenda(SaleOrder venda) {
        StringBuilder html = new StringBuilder();
        html.append("<!DOCTYPE html>");
        html.append("<html><head><meta charset=\"UTF-8\" />");
        html.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />");
        html.append("<style>");
        // estimate page height based on number of items so PDF is cropped to content
        // increase per-item estimate to avoid accidental pagination; allow large
        // max so renderer will place everything in a single page (we crop a bit
        // of white space rather than split into multiple pages)
        // Let Puppeteer measure the .invoice bounding box and size the PDF to content
        // so we avoid forced pagination via @page CSS.
        // Improved CSS for better appearance and wider layout
        html.append(
                "body{font-family:'Roboto Mono','Consolas','Courier New',monospace,Arial,sans-serif;font-size:11px;color:#222;margin:0;padding:0;background:#fff}");
        html.append(
                ".invoice{width:120mm;margin:0;padding:8px;background:#fff;color:#222;border:1px solid #ddd;box-sizing:border-box}");
        html.append(
                ".store{font-size:16px;font-weight:700;text-align:center;margin:2px 0 0px 0;padding:8px;background:#f8f9fa;border-radius:6px;border:1px solid #e9ecef;display:flex;align-items:center;justify-content:center;min-height:40px}");
        html.append(".meta{font-size:10px;color:#555;text-align:center;margin:0px 0}");
        html.append(".small{font-size:10px;color:#666;text-align:center;margin:0;padding:0}");
        html.append(
                "table{width:100%;border-collapse:collapse;margin-top:8px;font-size:10px;border:1px solid #dee2e6}");
        html.append(
                "th{padding:8px 6px;background:#f8f9fa;font-weight:700;border-bottom:1px solid #dee2e6;color:#495057}");
        html.append("td{padding:6px;border-bottom:1px solid #e9ecef}");
        html.append("tbody tr:last-child td{border-bottom:none}");
        html.append("td.prod{display:flex;align-items:center;min-height:32px}");
        html.append(".prod-name{flex:1;overflow-wrap:break-word;font-weight:500}");
        html.append("td.qty,td.price,td.total{text-align:center;white-space:nowrap;font-weight:500}");
        html.append("tfoot td{padding:10px 6px;font-weight:700;border-top:1px solid #dee2e6;background:#f8f9fa}");
        html.append(".small{font-size:10px;color:#666;text-align:center;margin:6px 0;padding:4px}");
        html.append("</style></head><body>");
        html.append("<style>");
        html.append(
                "body, * { font-family: 'Roboto Mono','Consolas','Courier New',monospace,Arial,sans-serif !important; }");
        html.append("</style></head><body>");

        html.append("<div class=\"invoice\">\n");

        // Header with optimized logo (if available and reasonably sized)
        String logoDataUri = getLogoDataUri();
        log.info("Logo DataURI loaded: {}",
                logoDataUri.isEmpty() ? "EMPTY" : "SUCCESS (" + logoDataUri.length() + " chars)");
        html.append("<div class=\"store\">");
        if (!logoDataUri.isEmpty()) {
            html.append("<img src=\"").append(logoDataUri)
                    .append("\" style=\"max-width:150px;max-height:80px;\" alt=\"Logo da Mercearia\" />");
        } else {
            html.append("🏪 MERCEARIA R-V"); // Voltar ao emoji direto
        }
        html.append(CLOSE_DIV);
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        html.append(
                "<div class=\"bloco-comprovante\" style='margin:0 auto;padding:0;line-height:1.35;text-align:center;max-width:320px;'>");
        html.append("<div style='margin:4px 0;'>Comprovante de Pedido</div>");
        if (venda.getCustomerName() != null)
            html.append("<div style='margin:4px 0;'>Cliente: ").append(escapeHtml(venda.getCustomerName()))
                    .append(CLOSE_DIV);
        html.append("<div style='margin:4px 0;'>Data: ").append(venda.getDataVenda().format(fmt)).append(CLOSE_DIV);
        html.append("</div>\n");

        // let columns size by content; reserve fixed mm widths for numeric columns
        // let CSS control font-size; avoid inline font-size to prevent conflicts
        html.append(
                "<table style=\"width:100%;border-collapse:collapse;margin-top:6px;table-layout:auto;\">\n");
        html.append(
                "<colgroup><col style=\"width:auto\"/><col style=\"width:10mm\"/><col style=\"width:21mm\"/><col style=\"width:21mm\"/></colgroup>\n");
        html.append(
                "<thead><tr><th style=\"text-align:left;padding:6px 4px;border-bottom:1px solid #dee2e6\">Produto</th><th style=\"text-align:center;padding:6px 4px;border-bottom:1px solid #dee2e6\">Qtd</th><th style=\"text-align:center;padding:6px 4px;border-bottom:1px solid #dee2e6\">Preço</th><th style=\"text-align:center;padding:6px 4px;border-bottom:1px solid #dee2e6\">Total</th></tr></thead>\n");
        html.append("<tbody>\n");
        venda.getItens().forEach(it -> {
            html.append("<tr>");
            // Show product images if available and reasonably sized, otherwise use emoji
            html.append("<td class=\"prod\">");
            String productImageUri = getProductImageDataUri(it.getProduto().getId());
            log.info("Product {} image URI: {}", it.getProduto().getId(),
                    productImageUri.isEmpty() ? "EMPTY" : "SUCCESS (" + productImageUri.length() + " chars)");
            if (!productImageUri.isEmpty()) {
                html.append("<img src=\"").append(productImageUri).append(
                        "\" style=\"width:28px;height:28px;margin-right:8px;border-radius:4px;border:1px solid #e9ecef;object-fit:cover;\" alt=\"Produto\" />");
            } else {
                html.append(
                        "<span style=\"margin-right:8px;font-size:16px;width:28px;text-align:center;display:inline-block;\">📦</span>"); // Voltar
                                                                                                                                         // ao
                                                                                                                                         // emoji
                                                                                                                                         // direto
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
                String svg = getPaymentSvg(metodo);
                String label = getPaymentLabel(metodo);
                String cleanLabel = label == null ? "" : label.replaceAll("\\s+", " ").trim();
                psb.append(svg).append(cleanLabel);
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

    private String getPaymentSvg(String metodo) {
        switch (metodo) {
            case "cartao_credito", "cartao_debito":
                return "<svg width='16' height='16' viewBox='0 0 24 24' style='vertical-align:middle;margin-right:2px'><rect x='2' y='6' width='20' height='12' rx='2' fill='#4A90E2'/><rect x='2' y='10' width='20' height='2' fill='#fff'/></svg>";
            case "pix":
                return "<svg width='16' height='16' viewBox='0 0 24 24' style='vertical-align:middle;margin-right:2px'><circle cx='12' cy='12' r='10' fill='#43C6AC'/><text x='12' y='16' text-anchor='middle' font-size='10' fill='#fff' font-family='Arial'>PIX</text></svg>";
            case "dinheiro":
                return "<svg width='16' height='16' viewBox='0 0 24 24' style='vertical-align:middle;margin-right:2px'><rect x='2' y='6' width='20' height='12' rx='2' fill='#7ED957'/><text x='12' y='16' text-anchor='middle' font-size='10' fill='#fff' font-family='Arial'>$</text></svg>";
            default:
                return "";
        }
    }

    private String getPaymentLabel(String metodo) {
        switch (metodo) {
            case "cartao_credito":
                return "Créd";
            case "cartao_debito":
                return "Déb";
            case "pix":
                return "Pix";
            case "dinheiro":
                return "Dinheiro";
            default:
                return metodo;
        }
    }

    // cropPdfToContent was unused and produced many Sonar warnings; remove it to
    // keep the controller focused on HTML -> Puppeteer rendering.
}
