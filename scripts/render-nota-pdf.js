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
        '--disable-features=VizDisplayCompositor'
      ] 
    });
    
    const page = await browser.newPage();
    
    // Viewport maior para melhor renderização de emojis
    await page.setViewport({ 
      width: 1200, 
      height: 800,
      deviceScaleFactor: 1
    });
    
    await page.setContent(html, { waitUntil: 'networkidle0' }); // Aguardar tudo carregar

    // Debug: verificar se emojis estão presentes no DOM
    const emojiCheck = await page.evaluate(() => {
      const paymentText = document.querySelector('tfoot td')?.textContent || '';
      return {
        hasEmojis: /💳|📱|💵/.test(paymentText),
        paymentText: paymentText.substring(0, 100)
      };
    });
    console.log('Emoji check:', emojiCheck);

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

    // PDF com tamanho EXATO do conteúdo
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
      scale: 1.0 // Escala 1:1 para precisão máxima
    });
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();


