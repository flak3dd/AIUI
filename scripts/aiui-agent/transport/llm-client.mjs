import {
  SPARK_QWEN_HOST,
  FEATHERLESS_DIRECT_URL,
  CLOUD_KEY_PROXY_URL,
  DEFAULT_MODEL,
  loadOptimizerPolicy,
  sparkVllmChatUrls,
} from '../config.mjs';
import { AGENT_TOOLS } from '../tools/registry.mjs';
import { rgb, c } from '../ui/skins.mjs';
import { sendCliDebugEvent } from './telemetry.mjs';

/**
 * Creates an AbortSignal combining a timeout with an optional user abort signal.
 */
function createCombinedSignal(timeoutMs, userSignal) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timeoutSignal, userSignal]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(userSignal.reason || new Error('Aborted by user'));
  const onTimeout = () => controller.abort(new Error(`Timeout after ${timeoutMs}ms`));
  if (userSignal.aborted) {
    controller.abort(userSignal.reason);
    return controller.signal;
  }
  userSignal.addEventListener('abort', onAbort, { once: true });
  timeoutSignal.addEventListener('abort', onTimeout, { once: true });
  return controller.signal;
}

/**
 * Perform chat completion request to active LLM (vLLM or Featherless)
 * with automatic endpoint failover, dynamic headroom clamping, and keep-alive optimization.
 */
export async function callLlm(messages, ctx) {
  const userSignal = ctx.activeTurnAbortController?.signal;
  if (userSignal?.aborted) {
    throw new Error('Aborted by user');
  }

  const isSpark = ctx.provider === 'spark';
  const policy = loadOptimizerPolicy();
  const isOptimized = ctx.optimize || Boolean(policy?.enabled);
  const tempBias = isOptimized ? (policy?.temperatureBias ?? 0) : 0;
  const effectiveTemp = isOptimized ? Math.max(0.05, Math.min(1.0, 0.2 + tempBias)) : 0.2;

  const toolsPayload = [...AGENT_TOOLS, ...(ctx.dynamicTools || [])].sort((a, b) =>
    (a.function?.name || '').localeCompare(b.function?.name || '')
  );

  // Conservative token estimator: 1 token ≈ 3.4 characters for JSON/code
  const approxInputTokens = Math.ceil(
    (JSON.stringify(messages).length + JSON.stringify(toolsPayload).length) / 3.4
  );
  const maxModelLen = isSpark
    ? parseInt(process.env.SPARK_MAX_MODEL_LEN || process.env.CTX, 10) || 32768
    : 131072; // Featherless cloud supports 128k context natively
  const maxHeadroom = maxModelLen - approxInputTokens - 64;
  const safeMaxTokens = Math.max(256, Math.min(4096, maxHeadroom));

  // Transport-level invariant: Ensure at least one valid 'user' message exists for vLLM qwen3_coder tool parser
  const validatedMessages = [...messages];
  const hasUserQuery = validatedMessages.some(
    (m) => m && m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0
  );
  if (!hasUserQuery) {
    const fallbackText = ctx.activeGoal || 'Continue autonomous task execution and fulfill the objective.';
    const insertIdx = validatedMessages.length > 0 && validatedMessages[0]?.role === 'system' ? 1 : 0;
    validatedMessages.splice(insertIdx, 0, {
      role: 'user',
      content: fallbackText,
    });
  }

  const payload = {
    model: ctx.model,
    messages: validatedMessages,
    tools: toolsPayload,
    tool_choice: 'auto',
    temperature: effectiveTemp,
    max_tokens: safeMaxTokens,
    presence_penalty: 0.1,
    frequency_penalty: 0.1,
    ...(isSpark ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };

  const headers = {
    'Content-Type': 'application/json',
    Connection: 'keep-alive',
  };
  if (ctx.apiKey && !isSpark) {
    headers['Authorization'] = `Bearer ${ctx.apiKey}`;
  }

  let url = `${ctx.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  if (ctx.logVerbose) {
    ctx.logVerbose('Calling LLM', { provider: ctx.provider, url, model: ctx.model, messageCount: messages.length });
  }

  let res;
  let sparkUnavailable = false;

  function raceSparkCompletions(urls) {
    const controllers = urls.map(() => new AbortController());
    const failures = [];
    // Non-streaming vLLM sends headers with the finished body. A dead host
    // refuses immediately; a live host must be allowed to generate.
    const completionMs = 120000;
    return new Promise((resolve) => {
      let pending = urls.length;
      let settled = false;
      const finish = (winner) => resolve({ winner, failures });
      if (!urls.length) {
        finish(null);
        return;
      }
      urls.forEach((chatUrl, index) => {
        let host = chatUrl;
        try { host = new URL(chatUrl).host; } catch { /* keep raw url */ }
        const timer = setTimeout(() => controllers[index].abort(new Error(`timed out after ${completionMs / 1000}s`)), completionMs);
        const onUser = () => controllers[index].abort(userSignal?.reason);
        userSignal?.addEventListener('abort', onUser);
        fetch(chatUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controllers[index].signal,
        })
          .then((response) => {
            clearTimeout(timer);
            if (settled || response.status >= 500) {
              userSignal?.removeEventListener('abort', onUser);
              response.body?.cancel?.().catch(() => {});
              throw new Error(response.status >= 500 ? `HTTP ${response.status}` : 'superseded');
            }
            settled = true;
            controllers.forEach((controller, i) => {
              if (i !== index) controller.abort();
            });
            finish({ res: response, url: chatUrl });
          })
          .catch((err) => {
            clearTimeout(timer);
            userSignal?.removeEventListener('abort', onUser);
            if (!settled && err?.message !== 'superseded') {
              const reason = err?.cause?.code || err?.message || 'connection failed';
              failures.push(`${host} ${reason}`);
            }
            pending -= 1;
            if (!settled && pending <= 0) finish(null);
          });
      });
    });
  }

  // Fast connection timeout for direct Spark GPU (5s) so offline host doesn't freeze the agent for 90s
  const initialTimeout = isSpark ? 5000 : 90000;
  const t0 = performance.now();
  const lastUserMsg = messages.filter((m) => m?.role === 'user').pop()?.content || '';
  sendCliDebugEvent({
    type: 'request',
    model: payload.model,
    provider: ctx.provider,
    round: ctx.round || 1,
    userPrompt: typeof lastUserMsg === 'string' ? lastUserMsg.slice(0, 300) : '',
    messageCount: messages.length,
    url,
  });

  try {
    if (isSpark) {
      const sparkUrls = [...new Set([url, ...sparkVllmChatUrls()])];
      if (ctx.logVerbose) ctx.logVerbose('Racing Spark vLLM endpoints', { sparkUrls });
      const raced = await raceSparkCompletions(sparkUrls);
      ctx.lastSparkFailures = raced.failures;
      const winner = raced.winner;
      if (userSignal?.aborted) throw new Error('Aborted by user');
      if (!winner) {
        sparkUnavailable = true;
      } else {
        res = winner.res;
        url = winner.url;
        ctx.baseUrl = winner.url.replace(/\/chat\/completions$/, '');
      }
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: createCombinedSignal(initialTimeout, userSignal),
      });
    }
  } catch (fetchErr) {
    if (userSignal?.aborted || (fetchErr instanceof Error && fetchErr.message === 'Aborted by user')) {
      throw new Error('Aborted by user');
    }

    if (isSpark) {
      sparkUnavailable = true;
    } else if (ctx.baseUrl !== FEATHERLESS_DIRECT_URL) {
      url = `${FEATHERLESS_DIRECT_URL}/chat/completions`;
      if (ctx.logVerbose) {
        ctx.logVerbose('Primary LLM endpoint failed, falling back to direct Featherless', { url });
      }
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: createCombinedSignal(90000, userSignal),
      });
    } else {
      throw fetchErr;
    }
  }

  // Detect if Spark returned 502 / 503 / 504 bad gateway (container stopped or frozen)
  if (isSpark && (sparkUnavailable || !res || res.status === 502 || res.status === 503 || res.status === 504)) {
    const statusLabel = (ctx.lastSparkFailures && ctx.lastSparkFailures.length)
      ? ctx.lastSparkFailures.join('; ')
      : (res ? `HTTP ${res.status}` : 'no response');
    if (ctx.log && ctx.skin && !ctx.hasWarnedSparkFallback) {
      ctx.hasWarnedSparkFallback = true;
      ctx.log(`\n  ${rgb(...ctx.skin.warning)}⚡ Spark vLLM unavailable (${statusLabel}) → Auto-routing to Featherless Cloud${c.reset}`);
      ctx.log(`  ${c.dim}(To start local Spark GPU: run 'npm run spark:restart' or type '/spark restart')${c.reset}\n`);
    }

    // Auto-failover to Featherless Cloud via key proxy
    const cloudModel = (ctx.model === 'qwen-abliterated' || !ctx.model)
      ? DEFAULT_MODEL
      : ctx.model;

    const cloudPayload = {
      ...payload,
      model: cloudModel,
      max_tokens: Math.min(safeMaxTokens, 4096),
    };
    delete cloudPayload.chat_template_kwargs;

    const cloudUrl = `${CLOUD_KEY_PROXY_URL.replace(/\/+$/, '')}/chat/completions`;
    const cloudHeaders = {
      'Content-Type': 'application/json',
      Connection: 'keep-alive',
    };
    if (ctx.apiKey) {
      cloudHeaders['Authorization'] = `Bearer ${ctx.apiKey}`;
    }

    try {
      res = await fetch(cloudUrl, {
        method: 'POST',
        headers: cloudHeaders,
        body: JSON.stringify(cloudPayload),
        signal: createCombinedSignal(90000, userSignal),
      });
    } catch (cloudErr) {
      if (userSignal?.aborted) {
        throw new Error('Aborted by user');
      }
      // Fallback directly to Featherless Cloud API if local proxy is not running
      const directUrl = `${FEATHERLESS_DIRECT_URL}/chat/completions`;
      if (cloudUrl !== directUrl) {
        try {
          res = await fetch(directUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Connection: 'keep-alive',
              ...(ctx.apiKey ? { Authorization: `Bearer ${ctx.apiKey}` } : {}),
            },
            body: JSON.stringify(cloudPayload),
            signal: createCombinedSignal(90000, userSignal),
          });
        } catch {
          throw new Error(
            `DGX Spark vLLM (${SPARK_QWEN_HOST}:8000) is offline (${statusLabel}), and Cloud fallback failed: ${cloudErr.message}\n` +
            `  • To start the Spark GPU container: run 'npm run spark:restart'\n` +
            `  • To inspect Spark status: run 'aiui spark' or type '/spark status'`
          );
        }
      } else {
        throw new Error(
          `DGX Spark vLLM (${SPARK_QWEN_HOST}:8000) is offline (${statusLabel}), and Cloud fallback failed: ${cloudErr.message}\n` +
          `  • To start the Spark GPU container: run 'npm run spark:restart'\n` +
          `  • To inspect Spark status: run 'aiui spark' or type '/spark status'`
        );
      }
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');

    // Auto-heal if context limit was exceeded
    const contextOverflowMatch = errText.match(
      /maximum context length is (\d+) tokens.*requested (\d+) output tokens.*contains at least (\d+) input tokens/i
    );
    if (contextOverflowMatch && !ctx._retryAfterOverflow) {
      const maxLen = parseInt(contextOverflowMatch[1], 10);
      const actualInputTokens = parseInt(contextOverflowMatch[3], 10);
      const remainingForOutput = maxLen - actualInputTokens - 64;
      // A few hundred output tokens can finish the same request. Less than that
      // cannot carry a tool call, so the agent checkpoints and continues itself.
      if (remainingForOutput >= 512) {
        if (ctx.log && ctx.skin) {
          ctx.log(
            `  ${rgb(...ctx.skin.warning)}⚡ Context window near ceiling (${actualInputTokens}/${maxLen} tokens). Dynamically adjusting max_tokens to ${remainingForOutput}...${c.reset}`
          );
        }
        ctx._retryAfterOverflow = true;
        payload.max_tokens = remainingForOutput;
        try {
          const retryRes = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: createCombinedSignal(90000, userSignal),
          });
          if (retryRes.ok) {
            const data = await retryRes.json();
            return data.choices?.[0]?.message || { role: 'assistant', content: '' };
          }
        } finally {
          ctx._retryAfterOverflow = false;
        }
      }
      const overflowErr = new Error(
        `CONTEXT_OVERFLOW: prompt uses at least ${actualInputTokens} of ${maxLen} tokens`
      );
      overflowErr.code = 'CONTEXT_OVERFLOW';
      throw overflowErr;
    }

    if (isSpark && (res.status === 502 || res.status === 503 || res.status === 504)) {
      throw new Error(
        `DGX Spark vLLM (${SPARK_QWEN_HOST}:8000) is offline or unreachable.\n` +
        `  • To start the Spark GPU container: run 'npm run spark:restart'\n` +
        `  • To switch to Cloud inference: type '/provider featherless'`
      );
    }

    sendCliDebugEvent({
      type: 'error',
      model: payload.model,
      provider: ctx.provider,
      error: `HTTP ${res.status}: ${errText.slice(0, 300)}`,
    });
    throw new Error(`LLM Error HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  const assistantMsg = data.choices?.[0]?.message || { role: 'assistant', content: '' };

  // Sanitize degenerate repetitive token loops (e.g. {"!!!!!!!!!!!!!!!!... or repeated single character runs)
  if (typeof assistantMsg.content === 'string' && assistantMsg.content.length > 0) {
    if (/(.)\1{20,}/.test(assistantMsg.content) || /^\{"[^a-zA-Z0-9]{8,}/.test(assistantMsg.content)) {
      assistantMsg.content = assistantMsg.content.replace(/(.)\1{10,}/g, '$1$1$1').trim();
    }
  }

  const durationMs = Math.round(performance.now() - t0);
  sendCliDebugEvent({
    type: 'response',
    model: payload.model,
    provider: ctx.provider,
    durationMs,
    responseText: assistantMsg.content ? assistantMsg.content.slice(0, 350) : (assistantMsg.tool_calls ? `[${assistantMsg.tool_calls.length} tool calls]` : ''),
    tokens: data.usage?.total_tokens || undefined,
  });
  return assistantMsg;
}
