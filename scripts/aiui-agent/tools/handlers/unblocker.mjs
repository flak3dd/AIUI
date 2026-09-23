/**
 * Bright Data Web Unlocker Tool Handler
 *
 * Integrates Bright Data Web Unlocker API and SuperProxy with support for:
 * - Manual 'expect' elements (x-unblock-expect: {"element": ".selector"})
 * - Manual 'expect' text (x-unblock-expect: {"text": "Target text"})
 * - Automated SPA URL fragment handling (x-unblock-url-fragment)
 * - Markdown format conversion (x-unblock-data-format: markdown)
 * - Full-page screenshot capture (x-unblock-data-format: screenshot)
 * - JavaScript browser rendering (render: true)
 * - Anti-bot bypass (Cloudflare Turnstile, Datadome, Kasada, PerimeterX)
 */

export const EXPECT_PRESETS = {
  /** Any interactive form input field (email, password, select, text, textarea) */
  FORM_INPUTS: 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), select, textarea',
  /** Registration or account creation forms */
  SIGNUP_FORM: 'form input[type="email"], form input[type="password"], [data-testid*="signup"], [data-testid*="register"]',
  /** Login or authentication portals */
  LOGIN_FORM: 'form input[type="email"], form input[name*="user"], form input[type="password"], [data-testid*="login"]',
  /** E-commerce checkout or billing forms */
  CHECKOUT_FORM: 'form#checkout, form input[name*="card"], [data-testid*="payment"], [data-testid*="checkout"]',
  /** Client-side SPA ready indicator (React/Vue/Next root rendered or loader complete) */
  SPA_READY: '#root > *:not(:empty), #__next > *:not(:empty), .pace-done, [data-hydrated="true"]',
};

/**
 * Extract form inputs from unblocked HTML using regex for environments without DOMParser
 */
export function extractFieldsFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const fields = [];
  const seen = new Set();

  // Match input, select, textarea tags
  const tagRegex = /<(input|select|textarea)([^>]*?)>/gi;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const attrsStr = match[2];

    const getAttr = (name) => {
      const m = new RegExp(`${name}=["']([^"']+)["']`, 'i').exec(attrsStr);
      return m ? m[1] : '';
    };

    const type = (getAttr('type') || (tagName === 'textarea' ? 'textarea' : tagName === 'select' ? 'select' : 'text')).toLowerCase();
    if (['hidden', 'submit', 'button', 'file', 'image', 'reset'].includes(type)) {
      continue;
    }

    const id = getAttr('id');
    const name = getAttr('name');
    const placeholder = getAttr('placeholder');
    const ariaLabel = getAttr('aria-label');
    const autocomplete = getAttr('autocomplete');

    let selector = '';
    if (id) selector = `#${id}`;
    else if (name) selector = `[name="${name}"]`;
    else if (placeholder) selector = `${tagName}[placeholder="${placeholder}"]`;
    else if (type && type !== 'text') selector = `${tagName}[type="${type}"]`;
    else selector = tagName;

    if (seen.has(selector)) continue;
    seen.add(selector);

    let label = ariaLabel || placeholder || name || id || `${type} field`;
    let kind = 'text';
    if (tagName === 'select') kind = 'select';
    else if (tagName === 'textarea') kind = 'text';
    else if (type === 'password') kind = 'password';
    else if (type === 'email' || /email/i.test(label) || /email/i.test(name)) kind = 'email';
    else if (type === 'checkbox' || type === 'radio') kind = 'checkbox';

    fields.push({
      label: label.slice(0, 50),
      selector,
      kind,
      type,
      autocomplete,
    });
  }

  return fields;
}

/**
 * Executes a Web Unlocker request with optional manual expect element/text
 */
export async function webUnblockerHandler(args = {}, ctx = {}) {
  const url = typeof args === 'string' ? args : (args.url || args.targetUrl);
  if (!url) {
    return JSON.stringify({ ok: false, error: 'URL parameter is required', exitCode: 1 });
  }

  const apiKey = (args.apiKey || process.env.BRIGHTDATA_API_KEY || '').trim();
  const zone = (args.zone || process.env.BRIGHTDATA_ZONE || 'web_unlocker1').trim();
  const dataFormat = args.dataFormat || (args.asMarkdown ? 'markdown' : 'markdown'); // Default to markdown for LLM consumption
  const render = args.render !== false; // Default true to allow expect element evaluation
  const country = args.country || args.geo;
  const timeoutMs = parseInt(args.timeoutMs, 10) || 60000;

  // Resolve expect element: explicit parameter, preset key, or general form fallback
  let expectElement = args.expectElement;
  if (!expectElement && args.expectPreset) {
    expectElement = EXPECT_PRESETS[args.expectPreset] || EXPECT_PRESETS[args.expectPreset.toUpperCase()];
  }
  const expectText = args.expectText;

  const customHeaders = { ...(args.headers || {}) };

  // Manual 'expect' header formatting per Bright Data spec
  if (expectElement) {
    customHeaders['x-unblock-expect'] = JSON.stringify({ element: expectElement });
  } else if (expectText) {
    customHeaders['x-unblock-expect'] = JSON.stringify({ text: expectText });
  }

  // Fragmented URL support (# or #!)
  let targetUrl = url;
  if (args.urlFragment) {
    customHeaders['x-unblock-url-fragment'] = args.urlFragment.replace(/^#/, '');
  } else if (url.includes('#')) {
    const parts = url.split('#');
    targetUrl = parts[0];
    const fragment = parts.slice(1).join('#');
    if (fragment && !customHeaders['x-unblock-url-fragment']) {
      customHeaders['x-unblock-url-fragment'] = fragment;
    }
  }

  if (args.cookies) {
    customHeaders['Cookie'] = args.cookies;
  }

  if (!apiKey) {
    return JSON.stringify({
      ok: false,
      error: 'BRIGHTDATA_API_KEY is not configured in environment or tool arguments.',
      tip: 'Set BRIGHTDATA_API_KEY and BRIGHTDATA_ZONE in environment or pass apiKey parameter.',
      exitCode: 1,
    });
  }

  const payload = {
    zone,
    url: targetUrl,
    format: 'raw',
  };

  if (render) payload.render = 'true';
  if (dataFormat === 'markdown') payload.data_format = 'markdown';
  else if (dataFormat === 'screenshot') payload.data_format = 'screenshot';

  if (country) payload.country = country.toLowerCase();
  if (Object.keys(customHeaders).length > 0) payload.headers = customHeaders;

  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = process.env.BRIGHTDATA_ENDPOINT || 'https://api.brightdata.com';
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/request`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - t0);

    const reqId = res.headers.get('x-luminati-req-id') || res.headers.get('x-req-id') || undefined;
    const captchaSolved = res.headers.get('x-captcha-solved') === 'true';

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return JSON.stringify({
        ok: false,
        status: res.status,
        error: `Bright Data Unlocker responded HTTP ${res.status}: ${errText.slice(0, 300)}`,
        latencyMs,
        url: targetUrl,
        expectElement,
        exitCode: 1,
      });
    }

    let content = '';
    let screenshotBase64 = null;
    let extractedFields = [];

    if (dataFormat === 'screenshot') {
      const buffer = await res.arrayBuffer();
      screenshotBase64 = Buffer.from(buffer).toString('base64');
      content = `[Screenshot captured: ${buffer.byteLength} bytes]`;
    } else {
      content = await res.text();
      extractedFields = extractFieldsFromHtml(content);
    }

    return JSON.stringify({
      ok: true,
      status: res.status,
      latencyMs,
      url: targetUrl,
      zone,
      dataFormat,
      expectElement: expectElement || null,
      expectText: expectText || null,
      reqId,
      captchaSolved,
      fieldsCount: extractedFields.length,
      fields: extractedFields.slice(0, 20),
      contentPreview: content.slice(0, 1500),
      contentLength: content.length,
      screenshotBase64: screenshotBase64 ? screenshotBase64.slice(0, 100) + '...' : undefined,
      exitCode: 0,
    });
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - t0);
    return JSON.stringify({
      ok: false,
      error: `Web Unlocker error: ${err.message}`,
      latencyMs,
      url: targetUrl,
      expectElement,
      exitCode: 1,
    });
  }
}
