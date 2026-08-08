const fs = require('fs');
const path = require('path');
const child = require('child_process');

// Stable wrapper around the clean V5 router. It fixes the OpenAI Responses-model
// token parameter and adds per-run provider cooldown without introducing another
// anchor-based patch chain.
const sourcePath = path.join(__dirname, 'runtime_llm_router_v5.js');
const source = fs.readFileSync(sourcePath, 'utf8');

// V5 uses max_tokens for every OpenAI-compatible provider. GPT-5.x rejects it.
let patched = source.replace(
  "max_tokens: p.name === 'groq-20b' ? 1500 : 2200",
  "max_completion_tokens: p.name === 'openai' ? 2200 : undefined,\n          max_tokens: p.name === 'openai' ? undefined : (p.name === 'groq-20b' ? 1500 : 2200)"
);

// Disable a provider for the remainder of the process after the first failure.
// This prevents repeated Gemini 429 / Cerebras 402 / Groq quota calls on later
// fact-verification and script-generation requests in the same run.
patched = patched.replace(
  "const providers = [",
  "const disabledProviders = global.__TELUGU_DISABLED_LLM_PROVIDERS || (global.__TELUGU_DISABLED_LLM_PROVIDERS = new Set());\n  const providers = ["
);
patched = patched.replace(
  "].filter(p => p.key);",
  "].filter(p => p.key && !disabledProviders.has(p.name));"
);
patched = patched.replace(
  "log('WARNING: ' + p.name + ' failed — trying next provider. ' + e.message);",
  "disabledProviders.add(p.name);\n      log('WARNING: ' + p.name + ' failed — disabling it for the rest of this run. ' + e.message);"
);

// V5's generated runtime is deterministic and syntax-checked before execution.
// Write a dedicated final runtime so package.json has exactly one entry point.
const runtimePath = path.join(__dirname, '.index.runtime.final.js');
const marker = "console.log('LLM_ROUTER_V5: clean provider router + fact-locked Telugu script + preflight syntax check applied successfully.');";
patched = patched.replace(marker, "console.log('LLM_ROUTER_FINAL: stable provider fallback + OpenAI GPT-5 compatibility + per-run provider cooldown + fact-locked narration applied successfully.');");
fs.writeFileSync(runtimePath, patched, 'utf8');
child.execFileSync(process.execPath, ['--check', runtimePath], { stdio: 'inherit' });
require(runtimePath);
