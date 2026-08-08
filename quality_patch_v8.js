const fs = require('fs');
const path = require('path');
const vm = require('vm');
const file = path.join(__dirname, 'index.js');
let s = fs.readFileSync(file, 'utf8');

function replaceFunction(source, marker, newFn, label) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('QUALITY_PATCH_V8: ' + label + ' not found');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let end = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && next === '/') { const nl = source.indexOf('\n', i + 2); i = nl < 0 ? source.length : nl; continue; }
    if (ch === '/' && next === '*') { const cl = source.indexOf('*/', i + 2); i = cl < 0 ? source.length : cl + 1; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error('QUALITY_PATCH_V8: ' + label + ' end not found');
  return source.slice(0, start) + newFn + source.slice(end);
}

// GPT-OSS is a reasoning model. Its reasoning tokens count against the
// completion budget, so the old 2400-token call could still consume the
// entire budget before producing visible narration. Groq supports low
// reasoning effort and hidden reasoning for GPT-OSS; use both here because
// our tasks are short-form fact writing, verification and metadata, not
// complex agentic reasoning.
const callLLMFn = String.raw`// QUALITY_PATCH_V8_TPM_SAFE
async function callLLM(prompt, attempt = 1, model = (primaryModelExhaustedThisRun ? GROQ_FALLBACK_MODEL : GROQ_MODEL), maxTokens = 1400) {
  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROQ_API_KEY
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: maxTokens,
      reasoning_effort: 'low',
      include_reasoning: false
    })
  });
  const data = await res.json();

  if (!data.choices || !data.choices[0]) {
    const errorMessage = (data.error && data.error.message) || '';
    const isRateLimit = data.error && data.error.code === 'rate_limit_exceeded';
    const isDailyLimit = /tokens per day|TPD/i.test(errorMessage);

    if (isRateLimit && isDailyLimit) {
      if (model === GROQ_MODEL) {
        primaryModelExhaustedThisRun = true;
        log('WARNING: "' + GROQ_MODEL + '" daily limit reached — switching to fallback model "' + GROQ_FALLBACK_MODEL + '" for the rest of this run.');
        return callLLM(prompt, 1, GROQ_FALLBACK_MODEL, maxTokens);
      }
      throw new Error('Groq DAILY token limit reached on both models — this run cannot continue today. ' + errorMessage);
    }

    if (isRateLimit && attempt <= 3) {
      const waitMs = 15000 * attempt;
      log('WARNING: Groq rate limit hit (attempt ' + attempt + '/3) — waiting ' + (waitMs / 1000) + 's before retrying.');
      await sleep(waitMs);
      return callLLM(prompt, attempt + 1, model, maxTokens);
    }
    throw new Error('Groq did not return content (model: ' + model + '): ' + JSON.stringify(data));
  }

  const choice = data.choices[0];
  let content = (choice.message && choice.message.content || '').trim();
  const finishReason = choice.finish_reason || 'unknown';

  // A length stop with no visible content means the reasoning phase consumed
  // the completion budget. Do NOT retry with a smaller budget (the old bug).
  // Retry once with a slightly larger budget while keeping reasoning LOW.
  if (!content && finishReason === 'length' && maxTokens < 2200) {
    log('WARNING: Groq response exhausted completion budget at ' + maxTokens + ' tokens — retrying once at 2200 with low reasoning.');
    await sleep(500);
    return callLLM(prompt, 1, model, 2200);
  }

  if (!content) {
    throw new Error('Groq returned an empty response (finish_reason: ' + finishReason + ', model: ' + model + ').');
  }

  // include_reasoning:false normally makes this unnecessary, but retain it
  // as a defensive cleanup for older/variant GPT-OSS responses.
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!content) {
    if (finishReason === 'length' && maxTokens < 2200) {
      log('WARNING: Groq output became empty after cleanup — retrying once at 2200.');
      return callLLM(prompt, 1, model, 2200);
    }
    throw new Error('Groq returned no usable content after cleanup (finish_reason: ' + finishReason + ', model: ' + model + ').');
  }

  await sleep(1200);
  return content;
}
`;

// Re-apply even when the previous v8 marker already exists. The previous
// version exited early, which meant its buggy 2400-token implementation was
// frozen into index.js forever. Replacing from the marker makes this patch
// self-healing on every run.
const updated = replaceFunction(s, '// QUALITY_PATCH_V8_TPM_SAFE', callLLMFn, 'callLLM');

try {
  new vm.Script(updated, { filename: file });
} catch (err) {
  throw new Error('QUALITY_PATCH_V8: generated index.js failed syntax validation: ' + err.message);
}

fs.writeFileSync(file, updated, 'utf8');
console.log('QUALITY_PATCH_V8_TPM_SAFE applied successfully.');
