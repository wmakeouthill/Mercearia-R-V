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
    
    // Otimizar viewport para menor resolução
    await page.setViewport({ 
      width: 800, 
      height: 600,
      deviceScaleFactor: 1 // Reduzir de 2 para 1 para menor resolução
    });
    
    await page.setContent(html, { waitUntil: 'domcontentloaded' }); // Mais rápido que networkidle0

    // Usar formato A4 padrão em vez de tamanho customizado para melhor compressão
    await page.pdf({ 
      path: outPath, 
      format: 'A4',
      margin: {
        top: '10mm',
        bottom: '10mm', 
        left: '10mm',
        right: '10mm'
      },
      printBackground: true,
      preferCSSPageSize: false,
      // Configurações para reduzir tamanho do arquivo
      displayHeaderFooter: false,
      scale: 0.8 // Reduzir escala para 80% - menor tamanho
    });
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();


