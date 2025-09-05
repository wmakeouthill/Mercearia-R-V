package com.example.backendspring.product;

import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.file.*;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/produtos")
@RequiredArgsConstructor
public class ProductController {

    private final ProductRepository productRepository;

    private static final String KEY_ERROR = "error";
    private static final String KEY_MESSAGE = "message";
    private static final String KEY_QTD_ESTOQUE = "quantidade_estoque";
    private static final String KEY_ID = "id";
    private static final String KEY_NOME = "nome";
    private static final String KEY_CODIGO_BARRAS = "codigo_barras";
    private static final String KEY_PRECO_VENDA = "preco_venda";
    private static final String KEY_IMAGEM = "imagem";
    private static final String MSG_PRODUTO_NAO_ENCONTRADO = "Produto não encontrado";
    private static final String DEFAULT_IMAGE = "padrao.png";
    private static final String UPLOADS_DIR = "uploads";
    private static final String PRODUTOS_DIR = "produtos";
    private static final String DATA_IMAGE_PREFIX = "data:image/";

    @GetMapping
    public List<Product> getAll() {
        return productRepository.findAll().stream().sorted((a, b) -> a.getNome().compareToIgnoreCase(b.getNome()))
                .toList();
    }

    @GetMapping("/{id}")
    public ResponseEntity<Map<String, Object>> getById(@PathVariable Long id) {
        return productRepository.findById(id)
                .<ResponseEntity<Map<String, Object>>>map(p -> {
                    java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
                    body.put(KEY_ID, p.getId());
                    body.put(KEY_NOME, p.getNome());
                    body.put(KEY_CODIGO_BARRAS, p.getCodigoBarras());
                    body.put(KEY_PRECO_VENDA, p.getPrecoVenda());
                    body.put(KEY_QTD_ESTOQUE, p.getQuantidadeEstoque());
                    body.put(KEY_IMAGEM, p.getImagem()); // pode ser null
                    return ResponseEntity.ok(body);
                })
                .orElse(ResponseEntity.status(404).body(java.util.Map.of(KEY_ERROR, MSG_PRODUTO_NAO_ENCONTRADO)));
    }

    @GetMapping("/codigo/{codigo}")
    public ResponseEntity<Map<String, Object>> getByCodigo(@PathVariable("codigo") String codigo) {
        return productRepository.findByCodigoBarras(codigo)
                .<ResponseEntity<Map<String, Object>>>map(p -> {
                    java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
                    body.put(KEY_ID, p.getId());
                    body.put(KEY_NOME, p.getNome());
                    body.put(KEY_CODIGO_BARRAS, p.getCodigoBarras());
                    body.put(KEY_PRECO_VENDA, p.getPrecoVenda());
                    body.put(KEY_QTD_ESTOQUE, p.getQuantidadeEstoque());
                    body.put(KEY_IMAGEM, p.getImagem()); // pode ser null
                    return ResponseEntity.ok(body);
                })
                .orElse(ResponseEntity.status(404).body(java.util.Map.of(KEY_ERROR, MSG_PRODUTO_NAO_ENCONTRADO)));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Product req) {
        if (!StringUtils.hasText(req.getNome()) || req.getPrecoVenda() == null) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Nome e preço de venda são obrigatórios"));
        }
        if (StringUtils.hasText(req.getCodigoBarras())
                && productRepository.findByCodigoBarras(req.getCodigoBarras()).isPresent()) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Código de barras já existe"));
        }
        Product p = productRepository.save(Product.builder()
                .nome(req.getNome())
                .codigoBarras(req.getCodigoBarras())
                .precoVenda(req.getPrecoVenda())
                .quantidadeEstoque(req.getQuantidadeEstoque() == null ? 0 : req.getQuantidadeEstoque())
                .build());

        String nomeImagem = null;
        if (req.getImagem() != null && req.getImagem().startsWith(DATA_IMAGE_PREFIX)) {
            nomeImagem = processImage(req.getImagem(), p.getId());
            p.setImagem(nomeImagem);
            productRepository.save(p);
        }
        java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put(KEY_ID, p.getId());
        body.put(KEY_NOME, p.getNome());
        body.put(KEY_CODIGO_BARRAS, p.getCodigoBarras());
        body.put(KEY_PRECO_VENDA, p.getPrecoVenda());
        body.put(KEY_QTD_ESTOQUE, p.getQuantidadeEstoque());
        body.put(KEY_IMAGEM, p.getImagem()); // pode ser null
        return ResponseEntity.status(201).body(body);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Map<String, Object>> update(@PathVariable Long id, @RequestBody Product req) {
        return productRepository.findById(id).map(existing -> {
            ResponseEntity<Map<String, Object>> validationError = validateUpdateRequest(id, req);
            if (validationError != null) {
                return validationError;
            }

            String novaImagem = computeUpdatedImage(existing.getImagem(), req.getImagem(), id);

            existing.setNome(req.getNome());
            existing.setCodigoBarras(req.getCodigoBarras());
            existing.setPrecoVenda(req.getPrecoVenda());
            existing.setQuantidadeEstoque(req.getQuantidadeEstoque() == null ? 0 : req.getQuantidadeEstoque());
            existing.setImagem(novaImagem);
            productRepository.save(existing);
            return ResponseEntity.ok(Map.<String, Object>of(KEY_MESSAGE, "Produto atualizado com sucesso"));
        }).orElse(ResponseEntity.status(404).body(Map.<String, Object>of(KEY_ERROR, MSG_PRODUTO_NAO_ENCONTRADO)));
    }

    @PutMapping("/{id}/estoque")
    public ResponseEntity<Map<String, Object>> updateEstoque(@PathVariable Long id,
            @RequestBody Map<String, Object> body) {
        Number qtd = (Number) body.get(KEY_QTD_ESTOQUE);
        if (qtd == null || qtd.intValue() < 0) {
            return ResponseEntity.badRequest()
                    .body(Map.of(KEY_ERROR, "Quantidade de estoque deve ser um número não negativo"));
        }
        return productRepository.findById(id).map(p -> {
            p.setQuantidadeEstoque(qtd.intValue());
            productRepository.save(p);
            return ResponseEntity.ok(Map.<String, Object>of(KEY_MESSAGE, "Estoque atualizado com sucesso"));
        }).orElse(ResponseEntity.status(404).body(Map.<String, Object>of(KEY_ERROR, MSG_PRODUTO_NAO_ENCONTRADO)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable Long id) {
        return productRepository.findById(id).map(p -> {
            if (p.getImagem() != null)
                deleteImage(p.getImagem());
            productRepository.deleteById(id);
            return ResponseEntity.ok(Map.<String, Object>of(KEY_MESSAGE, "Produto deletado com sucesso"));
        }).orElse(ResponseEntity.status(404).body(Map.<String, Object>of(KEY_ERROR, MSG_PRODUTO_NAO_ENCONTRADO)));
    }

    // Servir imagens
    @GetMapping(value = "/imagem/{fileName}")
    public ResponseEntity<byte[]> getImage(@PathVariable("fileName") String fileName) throws IOException {
        if (DEFAULT_IMAGE.equals(fileName)) {
            Path defaultPath = Paths.get(UPLOADS_DIR, PRODUTOS_DIR, DEFAULT_IMAGE);
            if (!Files.exists(defaultPath)) {
                return ResponseEntity.status(404).build();
            }
            return ResponseEntity.ok()
                    .contentType(MediaType.IMAGE_PNG)
                    .body(Files.readAllBytes(defaultPath));
        }
        if (!fileName.matches("produto_\\d+\\.(png|jpeg|jpg|gif|webp)")) {
            return ResponseEntity.badRequest().build();
        }
        Path path = Paths.get(UPLOADS_DIR, PRODUTOS_DIR, fileName);
        if (!Files.exists(path)) {
            Path defaultPath = Paths.get(UPLOADS_DIR, PRODUTOS_DIR, DEFAULT_IMAGE);
            if (Files.exists(defaultPath)) {
                return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).body(Files.readAllBytes(defaultPath));
            }
            return ResponseEntity.status(404).build();
        }
        return ResponseEntity.ok().contentType(resolveMediaType(fileName)).body(Files.readAllBytes(path));
    }

    private String processImage(String base64, Long produtoId) {
        try {
            String[] parts = base64.split(",", 2);
            String meta = parts[0];
            String data = parts[1];
            String imageType = meta.substring(DATA_IMAGE_PREFIX.length(), meta.indexOf(";"));
            if (!(imageType.equalsIgnoreCase("jpeg") || imageType.equalsIgnoreCase("jpg")
                    || imageType.equalsIgnoreCase("png") || imageType.equalsIgnoreCase("gif")
                    || imageType.equalsIgnoreCase("webp"))) {
                return null;
            }

            // Decodificar base64
            byte[] bytes = java.util.Base64.getDecoder().decode(data);

            // Redimensionar para 300x300px
            byte[] resizedBytes = resizeImageTo300x300(bytes);

            String fileName = "produto_" + produtoId + ".png"; // Sempre salvar como PNG para qualidade
            Path dir = Paths.get(UPLOADS_DIR, PRODUTOS_DIR);
            Files.createDirectories(dir);
            Path file = dir.resolve(fileName);
            Files.write(file, resizedBytes, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            return fileName;
        } catch (Exception e) {
            return null;
        }
    }

    private byte[] resizeImageTo300x300(byte[] originalImageBytes) throws IOException {
        // Ler imagem original
        java.io.ByteArrayInputStream bais = new java.io.ByteArrayInputStream(originalImageBytes);
        java.awt.image.BufferedImage originalImage = javax.imageio.ImageIO.read(bais);

        if (originalImage == null) {
            throw new IOException("Não foi possível ler a imagem");
        }

        // Criar nova imagem 300x300
        java.awt.image.BufferedImage resizedImage = new java.awt.image.BufferedImage(
                300, 300, java.awt.image.BufferedImage.TYPE_INT_RGB);

        // Configurar renderização de alta qualidade
        java.awt.Graphics2D g2d = resizedImage.createGraphics();
        g2d.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION,
                java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g2d.setRenderingHint(java.awt.RenderingHints.KEY_RENDERING,
                java.awt.RenderingHints.VALUE_RENDER_QUALITY);
        g2d.setRenderingHint(java.awt.RenderingHints.KEY_ANTIALIASING,
                java.awt.RenderingHints.VALUE_ANTIALIAS_ON);

        // Preencher fundo branco
        g2d.setColor(java.awt.Color.WHITE);
        g2d.fillRect(0, 0, 300, 300);

        // Calcular dimensões para manter proporção e centralizar
        int sourceWidth = originalImage.getWidth();
        int sourceHeight = originalImage.getHeight();
        int sourceX = 0;
        int sourceY = 0;

        if (sourceWidth > sourceHeight) {
            // Imagem mais larga - cortar laterais para ficar quadrada
            sourceWidth = sourceHeight;
            sourceX = (originalImage.getWidth() - sourceHeight) / 2;
        } else if (sourceHeight > sourceWidth) {
            // Imagem mais alta - cortar topo/fundo para ficar quadrada
            sourceHeight = sourceWidth;
            sourceY = (originalImage.getHeight() - sourceWidth) / 2;
        }

        // Desenhar imagem redimensionada
        g2d.drawImage(originalImage,
                0, 0, 300, 300, // destino (canvas)
                sourceX, sourceY, sourceX + sourceWidth, sourceY + sourceHeight, // origem (imagem)
                null);
        g2d.dispose();

        // Converter para bytes com compressão agressiva para ficar abaixo de 200KB
        return compressImageTo200KB(resizedImage);
    }

    private byte[] compressImageTo200KB(java.awt.image.BufferedImage image) throws IOException {
        // Compressão agressiva - priorizar tamanho pequeno sobre qualidade
        // Tentar JPEG com várias qualidades, priorizando a menor possível

        for (float quality = 0.5f; quality >= 0.05f; quality -= 0.05f) {
            byte[] jpegBytes = compressAsJPEG(image, quality);

            // Se ficou menor que 200KB ou é a última tentativa, usar este
            if (jpegBytes.length <= 200 * 1024 || quality <= 0.05f) {
                return jpegBytes;
            }
        }

        // Fallback: JPEG com qualidade mínima
        return compressAsJPEG(image, 0.05f);
    }

    private byte[] compressAsJPEG(java.awt.image.BufferedImage image, float quality) throws IOException {
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageWriter writer = javax.imageio.ImageIO.getImageWritersByFormatName("jpg").next();
        javax.imageio.stream.ImageOutputStream ios = javax.imageio.ImageIO.createImageOutputStream(baos);
        writer.setOutput(ios);

        javax.imageio.ImageWriteParam param = writer.getDefaultWriteParam();
        param.setCompressionMode(javax.imageio.ImageWriteParam.MODE_EXPLICIT);
        param.setCompressionQuality(quality);

        writer.write(null, new javax.imageio.IIOImage(image, null, null), param);
        writer.dispose();
        ios.close();

        return baos.toByteArray();
    }

    private void deleteImage(String fileName) {
        try {
            Files.deleteIfExists(Paths.get(UPLOADS_DIR, PRODUTOS_DIR, fileName));
        } catch (Exception e) {
            // silencioso: exclusão falhando não é crítica
        }
    }

    private MediaType resolveMediaType(String fileName) {
        MediaType contentType = MediaType.IMAGE_JPEG;
        String ext = StringUtils.getFilenameExtension(fileName);
        if ("png".equalsIgnoreCase(ext)) {
            return MediaType.IMAGE_PNG;
        }
        if ("gif".equalsIgnoreCase(ext)) {
            return MediaType.IMAGE_GIF;
        }
        if ("webp".equalsIgnoreCase(ext)) {
            return MediaType.valueOf("image/webp");
        }
        return contentType;
    }

    public static class DuplicateBarcodeException extends RuntimeException {
        public DuplicateBarcodeException(String message) {
            super(message);
        }
    }

    private ResponseEntity<Map<String, Object>> validateUpdateRequest(Long id, Product req) {
        if (!StringUtils.hasText(req.getNome()) || req.getPrecoVenda() == null) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Nome e preço de venda são obrigatórios"));
        }
        if (req.getCodigoBarras() != null) {
            productRepository.findByCodigoBarras(req.getCodigoBarras())
                    .filter(p -> !p.getId().equals(id))
                    .ifPresent(p -> {
                        throw new DuplicateBarcodeException("Código de barras já existe");
                    });
        }
        return null;
    }

    private String computeUpdatedImage(String imagemAtual, String imagemRequest, Long id) {
        String novaImagem = imagemAtual;
        if (imagemRequest == null) {
            return novaImagem;
        }
        if (imagemRequest.startsWith(DATA_IMAGE_PREFIX)) {
            if (imagemAtual != null) {
                deleteImage(imagemAtual);
            }
            return processImage(imagemRequest, id);
        }
        if (imagemRequest.isEmpty()) {
            if (imagemAtual != null) {
                deleteImage(imagemAtual);
            }
            return null;
        }
        return novaImagem;
    }
}
