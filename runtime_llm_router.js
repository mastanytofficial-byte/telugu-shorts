const fs = require("fs");
const path = require("path");
const child = require("child_process");

const SOURCE = path.join(__dirname, "index.js");
const RUNTIME = path.join(__dirname, ".index.runtime.js");

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("Could not find matching brace");
}

function replaceFunction(source, signature, replacement) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error("Function anchor not found: " + signature);
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error("Opening brace not found: " + signature);
  const close = findMatchingBrace(source, open);
  return source.slice(0, start) + replacement + source.slice(close + 1);
}

const callLLMReplacement = String.raw`async function callLLM(prompt, attempt = 1, model = "") {
  if (!callLLM.disabledProviders) callLLM.disabledProviders = new Set();

  const providers = [
    {
      name: "groq-120b",
      key: (process.env.GROQ_API_KEY || "").trim(),
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "openai/gpt-oss-120b",
      maxTokens: 6000
    },
    {
      name: "groq-20b",
      key: (process.env.GROQ_API_KEY || "").trim(),
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "openai/gpt-oss-20b",
      maxTokens: 6000
    },
    {
      name: "gemini",
      key: (process.env.GEMINI_API_KEY || "").trim(),
      url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      model: "gemini-2.5-flash",
      maxTokens: 6000
    },
    {
      name: "openai",
      key: (process.env.OPENAI_API_KEY || "").trim(),
      url: "https://api.openai.com/v1/chat/completions",
      model: "gpt-5.4-mini",
      maxTokens: 6000
    },
    {
      name: "openrouter",
      key: (process.env.OPENROUTER_API_KEY || "").trim(),
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: "openrouter/free",
      maxTokens: 6000
    }
  ].filter(p => p.key && !callLLM.disabledProviders.has(p.name));

  if (!providers.length) {
    throw new Error("LLM_PROVIDER_EXHAUSTED: no configured LLM provider is available.");
  }

  for (const provider of providers) {
    try {
      log("LLM provider: " + provider.name + " (" + provider.model + ")");
      let content = "";

      if (provider.name === "gemini") {
        const response = await fetchWithTimeout(provider.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": provider.key
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.25,
              maxOutputTokens: provider.maxTokens,
              thinkingConfig: { thinkingBudget: 0 }
            }
          })
        }, 30000);

        const data = await response.json();
        if (!response.ok) {
          throw new Error("HTTP " + response.status + ": " + ((data.error && data.error.message) || "Gemini request failed"));
        }

        const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        content = Array.isArray(parts) ? parts.map(p => p && p.text).filter(Boolean).join("") : "";
      } else {
        const headers = {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + provider.key
        };
        if (provider.name === "openrouter") {
          headers["HTTP-Referer"] = "https://github.com/mastanytofficial-byte/telugu-shorts";
          headers["X-Title"] = "Telugu Amazing Facts Shorts";
        }

        const response = await fetchWithTimeout(provider.url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: provider.maxTokens,
            temperature: 0.25
          })
        }, 30000);

        const data = await response.json();
        if (!response.ok) {
          throw new Error("HTTP " + response.status + ": " + ((data.error && (data.error.message || data.error.code)) || "LLM request failed"));
        }

        const choice = data && data.choices && data.choices[0];
        content = choice && choice.message && choice.message.content ? String(choice.message.content) : "";
      }

      content = String(content).replace(/<think>[\\s\\S]*?<\\/think>/gi, "").trim();
      if (!content) throw new Error("empty LLM response");

      log("LLM provider success: " + provider.name);
      return content;
    } catch (error) {
      callLLM.disabledProviders.add(provider.name);
      log("WARNING: " + provider.name + " failed: " + error.message + " — trying next provider.");
    }
  }

  throw new Error("LLM_PROVIDER_EXHAUSTED: all configured providers failed for this run.");
}`;

let source = fs.readFileSync(SOURCE, "utf8");
source = replaceFunction(source, "async function callLLM(", callLLMReplacement);
fs.writeFileSync(RUNTIME, source, "utf8");

child.execFileSync(process.execPath, ["--check", RUNTIME], { stdio: "inherit" });
console.log("Stable LLM router syntax check passed.");
require(RUNTIME);
