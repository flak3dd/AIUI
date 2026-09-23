/**
 * Bright Data Web Unlocker Client
 *
 * Implements high-success unblocking with manual 'expect' elements (CSS selector / text),
 * SPA hash routing, JavaScript rendering, and automated form field extraction.
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
} as const;

export type ExpectPresetKey = keyof typeof EXPECT_PRESETS;

export interface WebUnlockerOptions {
  /** Bright Data zone name (defaults to "web_unlocker1"). */
  zone?: string;
  /** Force headless browser JavaScript rendering. */
  render?: boolean;
  /** Output data format: "raw" (HTML), "markdown" (LLM-ready), or "screenshot" (PNG). */
  dataFormat?: "raw" | "markdown" | "screenshot";
  /** Country code for geolocation targeting (e.g. "us", "gb", "au"). */
  country?: string;
  /** Manual 'expect' CSS selector: waits for element before returning. */
  expectElement?: string;
  /** Pre-configured expect selector preset key (e.g. "FORM_INPUTS" | "SIGNUP_FORM" | "LOGIN_FORM" | "CHECKOUT_FORM" | "SPA_READY") */
  expectPreset?: ExpectPresetKey;
  /** Manual 'expect' text: waits for text on page before returning. */
  expectText?: string;
  /** Single-page application URL fragment (e.g. "!/register" or "/signup"). Auto-extracted if URL contains # */
  urlFragment?: string;
  /** Custom request headers (requires Custom Headers enabled on zone). */
  headers?: Record<string, string>;
  /** Custom cookies to pass with the request. */
  cookies?: string;
  /** API key override. Defaults to BRIGHTDATA_API_KEY from env. */
  apiKey?: string;
  /** Endpoint override. Defaults to https://api.brightdata.com. */
  endpoint?: string;
  /** Request timeout in ms (default: 60_000ms). */
  timeoutMs?: number;
}

export interface WebUnlockerResult {
  ok: boolean;
  status: number;
  content?: string;
  error?: string;
  latencyMs: number;
  url: string;
  zone: string;
  dataFormat: "raw" | "markdown" | "screenshot";
  reqId?: string;
  captchaSolved?: boolean;
  fields?: Array<{ label: string; selector: string; kind: string; type: string }>;
}

export function extractFieldsFromHtml(html: string): Array<{
  label: string;
  selector: string;
  kind: "email" | "text" | "password" | "select" | "checkbox";
  type: string;
}> {
  if (typeof DOMParser === "undefined" || !html) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const fields: Array<{
      label: string;
      selector: string;
      kind: "email" | "text" | "password" | "select" | "checkbox";
      type: string;
    }> = [];
    const seen = new Set<string>();

    const inputs = doc.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), select, textarea',
    );

    inputs.forEach((el) => {
      const name = el.getAttribute("name") || "";
      const id = el.id || "";
      let selector = "";
      if (id) {
        selector = `#${id}`;
      } else if (name) {
        selector = `[name="${name}"]`;
      } else {
        const type = el.getAttribute("type") || "";
        selector = type ? `${el.tagName.toLowerCase()}[type="${type}"]` : el.tagName.toLowerCase();
      }

      if (!selector || seen.has(selector)) return;
      seen.add(selector);

      let label = "";
      if (id) {
        const l = doc.querySelector(`label[for="${id}"]`);
        if (l) label = (l.textContent || "").trim();
      }
      if (!label && el.closest("label")) {
        label = (el.closest("label")?.textContent || "").trim();
      }
      if (!label) label = el.getAttribute("aria-label") || "";
      if (!label) label = el.getAttribute("placeholder") || "";
      if (!label) label = name || id || "Field";

      let kind: "email" | "text" | "password" | "select" | "checkbox" = "text";
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (el.tagName === "SELECT") kind = "select";
      else if (el.tagName === "TEXTAREA") kind = "text";
      else if (type === "password") kind = "password";
      else if (type === "email" || /email/i.test(label) || /email/i.test(name)) kind = "email";
      else if (type === "checkbox" || type === "radio") kind = "checkbox";

      fields.push({
        label: label.slice(0, 50),
        selector,
        kind,
        type,
      });
    });

    return fields;
  } catch {
    return [];
  }
}

/**
 * Fetch and unblock a web page using Bright Data Web Unlocker API.
 */
export async function unlockPage(
  url: string,
  options: WebUnlockerOptions = {},
): Promise<WebUnlockerResult> {
  const apiKey = (
    options.apiKey ||
    (typeof globalThis !== 'undefined' &&
      'process' in globalThis &&
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BRIGHTDATA_API_KEY) ||
    ''
  )
    .toString()
    .trim();
  const zone = (options.zone || "web_unlocker1").trim();
  const base = (options.endpoint || "https://api.brightdata.com").replace(/\/+$/, "");
  const dataFormat = options.dataFormat ?? "raw";
  const timeoutMs = options.timeoutMs ?? 60_000;

  if (!apiKey) {
    return {
      ok: false,
      status: 401,
      error: "Bright Data API key not configured",
      latencyMs: 0,
      url,
      zone,
      dataFormat,
    };
  }

  const customHeaders: Record<string, string> = { ...(options.headers ?? {}) };

  // Resolve expect selector: explicit expectElement takes priority, followed by preset
  const expectSelector = options.expectElement || (options.expectPreset ? EXPECT_PRESETS[options.expectPreset] : undefined);

  // Manual 'expect' elements & text per Bright Data Web Unlocker spec
  if (expectSelector) {
    customHeaders["x-unblock-expect"] = JSON.stringify({ element: expectSelector });
  } else if (options.expectText) {
    customHeaders["x-unblock-expect"] = JSON.stringify({ text: options.expectText });
  }

  // Fragmented URL support (# or #!)
  let targetUrl = url;
  if (options.urlFragment) {
    customHeaders["x-unblock-url-fragment"] = options.urlFragment.replace(/^#/, "");
  } else if (url.includes("#")) {
    const parts = url.split("#");
    targetUrl = parts[0];
    const fragment = parts.slice(1).join("#");
    if (fragment && !customHeaders["x-unblock-url-fragment"]) {
      customHeaders["x-unblock-url-fragment"] = fragment;
    }
  }

  if (options.cookies) {
    customHeaders["Cookie"] = options.cookies;
  }

  const payload: Record<string, unknown> = {
    zone,
    url: targetUrl,
    format: "raw",
  };

  if (options.render !== false) {
    payload.render = "true";
  }

  if (dataFormat === "markdown") {
    payload.data_format = "markdown";
  } else if (dataFormat === "screenshot") {
    payload.data_format = "screenshot";
  }

  if (options.country) {
    payload.country = options.country.toLowerCase();
  }

  if (Object.keys(customHeaders).length > 0) {
    payload.headers = customHeaders;
  }

  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const latencyMs = Math.round(performance.now() - t0);
    clearTimeout(timer);

    const reqId = res.headers.get("x-luminati-req-id") || res.headers.get("x-req-id") || undefined;
    const captchaSolved = res.headers.get("x-captcha-solved") === "true";

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: `Bright Data Unlocker responded ${res.status}: ${errText.slice(0, 250)}`,
        latencyMs,
        url: targetUrl,
        zone,
        dataFormat,
        reqId,
        captchaSolved,
      };
    }

    const content = await res.text();
    const fields = dataFormat === "raw" ? extractFieldsFromHtml(content) : undefined;

    return {
      ok: true,
      status: res.status,
      content,
      latencyMs,
      url: targetUrl,
      zone,
      dataFormat,
      reqId,
      captchaSolved,
      fields,
    };
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      error: `Network/Unlock error: ${msg}`,
      latencyMs,
      url: targetUrl,
      zone,
      dataFormat,
    };
  }
}
