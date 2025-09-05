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
        '--font-render-hinting=none',
        '--disable-font-subpixel-positioning'
      ] 
    });
    
    const page = await browser.newPage();
    
    // Otimizar viewport para menor resolução
    await page.setViewport({ 
      width: 800, 
      height: 600,
      deviceScaleFactor: 1 // Reduzir de 2 para 1 para menor resolução
    });
    
    await page.setContent(html, { waitUntil: 'domcontentloaded' }); // Mais rápido que networkidle0

    // Aguardar o conteúdo ser totalmente carregado, incluindo imagens
    await page.waitForTimeout(1500);
    
    // Medir o tamanho real do conteúdo
    const contentDimensions = await page.evaluate(() => {
      const invoice = document.querySelector('.invoice');
      if (invoice) {
        const rect = invoice.getBoundingClientRect();
        return {
          width: Math.ceil(rect.width + 32), // padding extra
          height: Math.ceil(rect.height + 32) // padding extra
        };
      }
      return { width: 400, height: 600 };
    });

    // Usar tamanho customizado baseado no conteúdo para eliminar espaço em branco
    await page.pdf({ 
      path: outPath, 
      width: `${contentDimensions.width}px`,
      height: `${contentDimensions.height}px`,
      margin: {
        top: '5mm',
        bottom: '5mm', 
        left: '5mm',
        right: '5mm'
      },
      printBackground: true,
      preferCSSPageSize: false,
      // Configurações para reduzir tamanho do arquivo
      displayHeaderFooter: false,
      scale: 0.85 // Escala otimizada
    });
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();


