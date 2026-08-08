const fs = require('fs');
const path = require('path');

const ROUTER = path.join(__dirname, 'runtime_llm_router.js');
const source = fs.readFileSync(ROUTER, 'utf8');

// V4: put Gemini first, add OpenAI as a real fallback, and skip GitHub Models
// because the current GitHub Models endpoint is in a scheduled retirement brownout.
let patched = source;

patched = patched.replace(
  '  "const ROUTER_GITHUB_TOKEN = (process.env.GITHUB_TOKEN || \'\').trim();",',
  '  "const ROUTER_GITHUB_TOKEN = (process.env.GITHUB_TOKEN || \'\').trim();",\n' +
  '  "const ROUTER_GEMINI_API_KEY = (process.env.GEMINI_API_KEY || \'\').trim();",\n' +
  '  "const ROUTER_OPENAI_API_KEY = (process.env.OPENAI_API_KEY || \'\').trim();",'
);

const providerStart = patched.indexOf("  'const LLM_PROVIDERS = [',");
const providerEndMarker = "  '].filter(p => p.key);',";
const providerEnd = patched.indexOf(providerEndMarker, providerStart);
if (providerStart < 0 || providerEnd < 0) {
  throw new Error('V4: LLM provider block not found');
}

const providerBlock = [
  "  'const LLM_PROVIDERS = [',",
  "  \"  { name: 'gemini', key: ROUTER_GEMINI_API_KEY, url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', model: 'gemini-2.5-flash', maxTokens: 2200 },\",",
  "  \"  { name: 'openai', key: ROUTER_OPENAI_API_KEY, url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', maxTokens: 1800 },\",",
  "  \"  { name: 'openrouter-free', key: ROUTER_OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1/chat/completions', model: 'qwen/qwen3-235b-a22b-2507:free', maxTokens: 1800 },\",",
  "  \"  { name: 'groq-120b', key: ROUTER_GROQ_API_KEY, url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', maxTokens: 1800 },\",",
  "  \"  { name: 'groq-20b', key: ROUTER_GROQ_API_KEY, url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', maxTokens: 2200 }\",",
  "  '].filter(p => p.key);',"
].join('\n');

patched = patched.slice(0, providerStart) + providerBlock + patched.slice(providerEnd + providerEndMarker.length);

const callAnchor = "  'async function callProvider(provider, prompt) {',";
const callReplacement = [
  "  'async function callProvider(provider, prompt) {',",
  "  \"  if (provider.name === 'gemini') {\",",
  "  \"    const res = await fetchWithTimeout(provider.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.key }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.35, maxOutputTokens: provider.maxTokens, thinkingConfig: { thinkingBudget: 0 } } }) }, 30000);\",",
  "  \"    let data = {}; try { data = await res.json(); } catch (_) {}\",",
  "  \"    if (!res.ok) { const msg = (data && data.error && (data.error.message || data.error.status)) || ('HTTP ' + res.status); const err = new Error(msg); err.status = res.status; throw err; }\",",
  "  \"    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;\",",
  "  \"    const content = Array.isArray(parts) ? parts.map(p => p && p.text).filter(Boolean).join('') : '';\",",
  "  \"    if (!content.trim()) throw new Error('empty Gemini response');\",",
  "  \"    return content.replace(/<think>[\\\\s\\\\S]*?<\\\\/think>/gi, '').trim();\",",
  "  '  }',",
  callAnchor
].join('\n');
if (!patched.includes(callAnchor)) {
  throw new Error('V4: callProvider anchor not found');
}
patched = patched.replace(callAnchor, callReplacement);

// Do not repeatedly burn attempts after every configured provider has already failed.
// A new fact attempt is only useful if a provider becomes available again, so keep the
// provider health state for the whole run and surface the real last error.
patched = patched.replace(
  "  '  throw new Error(\'All configured LLM providers failed. Last error: \' + (lastError && lastError.message));',",
  "  \"  throw new Error('All configured LLM providers failed. Last error: ' + (lastError && lastError.message ? lastError.message : 'no provider available'));\","
);

const runtime = path.join(__dirname, '.index.runtime.v4.js');
fs.writeFileSync(runtime, patched, 'utf8');
console.log('LLM_ROUTER_V4: Gemini + OpenAI + OpenRouter fallback added; GitHub Models brownout bypassed.');
require(runtime);
