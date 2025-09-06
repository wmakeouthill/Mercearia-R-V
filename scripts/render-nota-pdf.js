#!/usr/bin/env node
// Usage: node render-nota-pdf.js input.html output.pdf
const fs = require('fs');
const path = require('path');
(async () => {
  try {
    const inPath = process.argv[2];
    const outPath = process.argv[3];
    if (!inPath || !outPath) {
      console.error('Usage: node render-nota-pdf.js input.html output.pdf');
      process.exit(2);
    }

    const html = fs.readFileSync(inPath, 'utf8');
    const puppeteer = require('puppeteer');

    const browser = await puppeteer.launch({ 
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-font-subpixel-positioning',
        '--enable-font-antialiasing',
        '--font-render-hinting=slight',
        '--lang=pt-BR',
        '--enable-logging',
        '--force-color-emoji'
      ] 
    });
    
    const page = await browser.newPage();
    
    // Viewport otimizado para renderização de emojis
    await page.setViewport({ 
      width: 1000, 
      height: 700,
      deviceScaleFactor: 1
    });

    // Configurar codificação para suportar emojis
    await page.setExtraHTTPHeaders({
      'Accept-Charset': 'utf-8'
    });

    // Injetar CSS adicional para garantir renderização de emojis
    await page.addStyleTag({
      content: `
        @import url('https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap');
        
        /* Força o uso de fonts que suportam emojis */
        * {
          font-family: 'Segoe UI', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', system-ui, -apple-system, sans-serif !important;
        }
        
        /* Força renderização de emojis especificamente na célula de pagamento */
        tfoot td {
          font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'Segoe UI', Arial, sans-serif !important;
          -webkit-font-feature-settings: "liga", "kern";
          font-feature-settings: "liga", "kern";
          font-variant-emoji: emoji;
        }
        
        /* Força suporte completo a emojis */
        body {
          -webkit-font-feature-settings: "liga", "kern";
          font-feature-settings: "liga", "kern";
          font-variant-emoji: emoji;
          text-rendering: optimizeLegibility;
        }
      `
    });
    
    await page.setContent(html, { waitUntil: 'networkidle0' }); // Aguardar tudo carregar

    // Debug: verificar se emojis estão presentes no DOM
    const emojiCheck = await page.evaluate(() => {
      const paymentCell = document.querySelector('tfoot td');
      const paymentText = paymentCell?.textContent || '';
      const paymentHTML = paymentCell?.innerHTML || '';
      
      // Verificar cada emoji individualmente
      const hasCardEmoji = paymentText.includes('💳');
      const hasPhoneEmoji = paymentText.includes('📱');
      const hasMoneyEmoji = paymentText.includes('💵');
      
      return {
        paymentText: paymentText.substring(0, 200),
        paymentHTML: paymentHTML.substring(0, 200),
        hasCardEmoji,
        hasPhoneEmoji, 
        hasMoneyEmoji,
        textLength: paymentText.length,
        // Verificar se há caracteres Unicode de emojis
        unicodePresent: /[\u{1F300}-\u{1F9FF}]/u.test(paymentText)
      };
    });
    console.log('Emoji debug completo:', JSON.stringify(emojiCheck, null, 2));

    // Aguardar fonts e emojis carregarem completamente
    await page.waitForTimeout(2000); // 2 segundos para garantir que tudo carregou
    
    // Forçar re-render para garantir que emojis apareçam
    await page.evaluate(() => {
      // Forçar repaint da página
      document.body.style.display = 'none';
      const height = document.body.offsetHeight; // trigger reflow
      document.body.style.display = '';
      return height;
    });

    // Aguardar o conteúdo ser totalmente carregado, incluindo imagens
    console.log('Emoji debug completo:', JSON.stringify(emojiCheck, null, 2));

    // Aguardar o conteúdo ser totalmente carregado, incluindo imagens
    await page.waitForTimeout(1500);
    
        // Medir as dimensões EXATAS do conteúdo da nota (.invoice) 
    const contentDimensions = await page.evaluate(() => {
      const invoice = document.querySelector('.invoice');
      if (invoice) {
        const rect = invoice.getBoundingClientRect();
        // Usar dimensões exatas do elemento + margem mínima
        return {
          width: Math.ceil(rect.width + 4), // margem mínima de 2px cada lado
          height: Math.ceil(rect.height + 4) // margem mínima de 2px cada lado
        };
      }
      return { width: 400, height: 600 };
    });

    // PDF com tamanho EXATO do conteúdo e máxima compressão
    await page.pdf({ 
      path: outPath, 
      width: `${contentDimensions.width}px`,
      height: `${contentDimensions.height}px`,
      margin: {
        top: '1px',
        bottom: '1px', 
        left: '1px',
        right: '1px'
      },
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: false,
      scale: 1.0,
      format: null,
      tagged: false, // Remove acessibilidade para PDF menor
      outline: false, // Remove outline para PDF menor 
      timeout: 30000
    });
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();


