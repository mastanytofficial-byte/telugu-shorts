const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, 'index.js');
const s = fs.readFileSync(file, 'utf8');

// V8 is now a compatibility no-op. The actual content-quality changes live
// in quality_patch_v9.js, which runs immediately after this file.
try {
  new vm.Script(s, { filename: file });
} catch (err) {
  throw new Error('QUALITY_PATCH_V8: current index.js failed syntax validation: ' + err.message);
}

console.log('QUALITY_PATCH_V8_COMPAT applied successfully.');
