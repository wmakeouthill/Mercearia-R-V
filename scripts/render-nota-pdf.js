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

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Ensure invoice element exists
    const el = await page.$('.invoice') || await page.$('body');
    const box = await el.boundingBox();

    // convert px -> mm (assume 96dpi CSS)
    const pxToMm = px => (px * 25.4) / 96.0;
    // add small extra margin to avoid accidental page breaks and rounding issues
    const widthMm = Math.max(40, Math.ceil(pxToMm(box.width) + 4));
    const heightMm = Math.max(40, Math.ceil(pxToMm(box.height) + 4));

    // force single-page output by setting exact width/height measured from content
    await page.pdf({ path: outPath, width: `${widthMm}mm`, height: `${heightMm}mm`, printBackground: true, preferCSSPageSize: false });
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();


