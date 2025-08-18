const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'frontend', 'src', 'app', 'services', 'auth.ts');
const s = fs.readFileSync(file, 'utf8');
const lines = s.split(/\r?\n/);
let p = 0, b = 0, c = 0;
console.log('Line | p  b  c | Non-ASCII chars (code:char@col) | Line');
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  let nonAscii = [];
  for (let j = 0; j < ln.length; j++) {
    const ch = ln[j];
    const code = ch.charCodeAt(0);
    if (ch === '(') p++;
    if (ch === ')') p--;
    if (ch === '{') b++;
    if (ch === '}') b--;
    if (ch === '[') c++;
    if (ch === ']') c--;
    if (code > 127) nonAscii.push(code + ':' + ch + '@' + (j+1));
  }
  console.log(String(i+1).padStart(4) + ' | ' + String(p).padStart(2) + ' ' + String(b).padStart(2) + ' ' + String(c).padStart(2) + ' | ' + (nonAscii.length? nonAscii.join(', '): '-') + ' | ' + ln);
}
console.log('\nFinal balances -> parentheses:', p, 'braces:', b, 'brackets:', c);


