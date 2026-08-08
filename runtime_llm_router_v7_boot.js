const fs = require('fs');
const path = require('path');
const child = require('child_process');

const sourcePath = path.join(__dirname, 'runtime_llm_router_v7.js');
const runtimePath = path.join(__dirname, '.runtime_llm_router_v7.boot.js');
let source = fs.readFileSync(sourcePath, 'utf8');

// V7's content-replacement template contains escaped backticks inside a
// regex. Those backticks can terminate the outer template literal while
// parsing. Remove the optional markdown-fence cleanup entirely; the model
// output is already validated as plain narration below.
const lines = source.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('script = script.replace(/^\\\\`\\\\`\\\\`')) {
    lines[i] = "  script = script.replace(/^SCRIPT:\\s*/i, '').replace(/<think>[\\s\\S]*?<\\/think>/gi, '').trim();";
  }
}
source = lines.join('\n');

// Also remove any literal backtick characters from that specific generated
// content-replacement block if one remains in a regex expression.
const marker = 'const contentReplacement = `';
const start = source.indexOf(marker);
if (start >= 0) {
  const end = source.indexOf('`;\n\nlet source =', start);
  if (end >= 0) {
    const block = source.slice(start, end);
    const cleaned = block.replace(/\\`/g, '');
    source = source.slice(0, start) + cleaned + source.slice(end);
  }
}

fs.writeFileSync(runtimePath, source, 'utf8');
child.execFileSync(process.execPath, ['--check', runtimePath], { stdio: 'inherit' });
console.log('LLM_ROUTER_V7_BOOT: syntax-safe runtime generated successfully.');
require(runtimePath);
