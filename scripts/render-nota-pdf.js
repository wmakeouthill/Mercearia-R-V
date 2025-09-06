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
        '--force-color-emoji',
        '--enable-font-antialiasing',
        '--disable-font-subpixel-positioning',
        '--enable-oop-rasterization'
      ] 
    });
    
    const page = await browser.newPage();
    
    // Viewport otimizado 
    await page.setViewport({ 
      width: 800, 
      height: 600,
      deviceScaleFactor: 1
    });

    // Injetar CSS adicional para garantir renderização de emojis
    await page.addStyleTag({
      content: `
        /* Forçar fonte local de emoji do Windows */
        * {
          font-family: "Segoe UI Emoji", "Segoe UI", "Apple Color Emoji", Arial, sans-serif !important;
        }
        /* Comprovante e dados: menos espaçamento entre linhas */
        .meta, .small, .dados-cliente, .dados-data, .bloco-comprovante {
          font-size: 10px;
          color: #555;
          text-align: center;
          margin: 2px 0 2px 0;
          line-height: 1.25;
          padding: 0;
          width: 100%;
          display: block;
        }
        tfoot td, .payment-info {
          font-family: "Segoe UI Emoji", "Segoe UI", "Apple Color Emoji", Arial, sans-serif !important;
          font-size: 12px !important;
          line-height: 1.1;
          text-rendering: optimizeLegibility;
          font-variant-emoji: emoji;
        }
      `
    });
    
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Debug melhorado: verificar emojis e entidades
    const emojiCheck = await page.evaluate(() => {
      const paymentCell = document.querySelector('tfoot td');
      if (!paymentCell) return { error: 'Payment cell not found' };
      
      const paymentText = paymentCell.textContent || '';
      const paymentHTML = paymentCell.innerHTML || '';
      
      // Verificar vários tipos de emoji/símbolos
      return {
        paymentText: paymentText.substring(0, 100),
        paymentHTML: paymentHTML.substring(0, 100),
        hasGeometricEmoji: paymentText.includes('🟦') || paymentText.includes('�') || paymentText.includes('💰'),
        hasClassicEmoji: paymentText.includes('�') || paymentText.includes('📱') || paymentText.includes('💵'),
        hasAnySymbol: /[\u{1F000}-\u{1F9FF}]/u.test(paymentText),
        length: paymentText.length,
        cellExists: !!paymentCell
      };
    });
    console.log('=== EMOJI DEBUG COMPLETO ===');
    console.log(JSON.stringify(emojiCheck, null, 2));

    // Aguardar um pouco mais para fonts e emojis carregarem
    await page.waitForTimeout(1000);
    
    // Medir as dimensões do conteúdo da nota
    const contentDimensions = await page.evaluate(() => {
      const invoice = document.querySelector('.invoice');
      if (invoice) {
        const rect = invoice.getBoundingClientRect();
        return {
          width: Math.ceil(rect.width + 4),
          height: Math.ceil(rect.height + 4)
        };
      }
      return { width: 400, height: 600 };
    });

    // PDF com tamanho do conteúdo
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
      tagged: false,
      outline: false,
      timeout: 15000
    });
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();