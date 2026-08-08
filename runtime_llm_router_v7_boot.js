const fs = require('fs');
const path = require('path');
const child = require('child_process');

const sourcePath = path.join(__dirname, 'runtime_llm_router_v7.js');
const runtimePath = path.join(__dirname, '.runtime_llm_router_v7.boot.js');
let source = fs.readFileSync(sourcePath, 'utf8');

// V7 has a literal backtick inside a regex that lives inside a template-string
// replacement. Replace the whole topic-cleanup line before Node parses V7.
source = source.replace(/    let topic = .*?\.trim\(\);/, "    let topic = (await callLLM(topicPrompt)).replace(/^[-*#\\s]+|\\s+$/g, '').split(/\\n/)[0].trim();");

fs.writeFileSync(runtimePath, source, 'utf8');
child.execFileSync(process.execPath, ['--check', runtimePath], { stdio: 'inherit' });
console.log('LLM_ROUTER_V7_BOOT: preflight syntax repair applied successfully.');
require(runtimePath);
