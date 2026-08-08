const fs = require('fs');
const path = require('path');
const child = require('child_process');

const sourcePath = path.join(__dirname, 'runtime_llm_router_v7.js');
const runtimePath = path.join(__dirname, '.runtime_llm_router_v7.boot.js');
let source = fs.readFileSync(sourcePath, 'utf8');

// Remove the optional markdown-fence cleanup line from V7 before parsing.
// That line contains literal backticks inside V7's outer template literal,
// which is what caused the SyntaxError at generated line 206.
const lines = source.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trimStart().startsWith('script = script.replace(/^')) {
    lines[i] = "  script = script.replace(/^SCRIPT:\\s*/i, '').replace(/<think>[\\s\\S]*?<\\/think>/gi, '').trim();";
  }
}
source = lines.join('\n');

// Defensive cleanup: inside the contentReplacement template only, remove
// escaped backticks that could otherwise terminate that template literal.
const marker = 'const contentReplacement = `';
const start = source.indexOf(marker);
const endMarker = '`;\n\nlet source =';
const end = start >= 0 ? source.indexOf(endMarker, start) : -1;
if (start >= 0 && end > start) {
  const block = source.slice(start, end);
  source = source.slice(0, start) + block.replaceAll('\\`', '') + source.slice(end);
}

fs.writeFileSync(runtimePath, source, 'utf8');
child.execFileSync(process.execPath, ['--check', runtimePath], { stdio: 'inherit' });
console.log('LLM_ROUTER_V7_BOOT: syntax-safe runtime generated successfully.');
require(runtimePath);
