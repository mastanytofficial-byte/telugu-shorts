const fs = require('fs');
const path = require('path');
const child = require('child_process');

const sourcePath = path.join(__dirname, 'runtime_llm_router_v7.js');
const runtimePath = path.join(__dirname, '.runtime_llm_router_v7.boot.js');
let source = fs.readFileSync(sourcePath, 'utf8');

// V7 contains one literal backtick inside a regex that lives inside a
// template-string replacement. Remove that unnecessary backtick matcher
// before Node parses the generated router.
const bt = String.fromCharCode(96);
const bad = "replace(/^[-*#" + bt + "\\\\s]+|[" + bt + "\\\\s]+$/g, '').split(/\\\\n/)[0].trim();";
const good = "replace(/^[-*#\\\\s]+|\\\\s+$/g, '').split(/\\\\n/)[0].trim();";
if (source.includes(bad)) source = source.replace(bad, good);

fs.writeFileSync(runtimePath, source, 'utf8');
child.execFileSync(process.execPath, ['--check', runtimePath], { stdio: 'inherit' });
console.log('LLM_ROUTER_V7_BOOT: preflight syntax repair applied successfully.');
require(runtimePath);
