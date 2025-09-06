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
        '--enable-font-antialiasing'
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
        /* Configuração simples e direta para emojis */
        * {
          font-family: "Segoe UI", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif !important;
        }
        
        /* Força renderização específica para área de pagamento */
        tfoot td {
          font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Segoe UI", Arial !important;
          font-size: 11px !important;
        }
      `
    });
    
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Debug simples: verificar se emojis estão presentes
    const emojiCheck = await page.evaluate(() => {
      const paymentCell = document.querySelector('tfoot td');
      if (!paymentCell) return { error: 'Payment cell not found' };
      
      const paymentText = paymentCell.textContent || '';
      return {
        paymentText: paymentText.substring(0, 100),
        hasCardEmoji: paymentText.includes('💳'),
        hasPhoneEmoji: paymentText.includes('📱'),
        hasMoneyEmoji: paymentText.includes('💵'),
        length: paymentText.length
      };
    });
    console.log('Emoji check:', JSON.stringify(emojiCheck, null, 2));

    // Aguardar um pouco para fonts carregarem
    await page.waitForTimeout(500);
    
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