const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'romantic_simple.js');
let s = fs.readFileSync(file, 'utf8');

// Keep the quote safely inside the 1080x1920 frame. 31 characters at 46px
// can exceed the safe width, so use shorter lines and a slightly smaller font.
s = s.replace(/function quoteLines\(text,max=31\)/, 'function quoteLines(text,max=22)');
s = s.replace(/fontsize=46/g, 'fontsize=40');
s = s.replace(/drawbox=x=55:y=650:w=970:h=620/, 'drawbox=x=70:y=620:w=940:h=680');
s = s.replace(/y=\(h-text_h\)\/2/, 'y=(h-text_h)/2');

fs.writeFileSync(file, s);
console.log('Romantic quote layout prepared: safe wrapping + smaller centered text.');
