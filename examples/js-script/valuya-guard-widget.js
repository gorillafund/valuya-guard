;(() => {
  const DEFAULTS = {
    resultSelector: "#valuya-result",
    autoRetryAfterReturn: true,
    retryParam: "valuya_retry",
    paidParam: "valuya_paid",
    maxAutoRetries: 1,
    timeoutMs: 20000,
  }

  function $(sel, root = document) {
    return root.querySelector(sel)
  }

  function getOrCreateAnonId() {
    // Stable across visits, per browser
    const k = "valuya_anon_subject_id"
    let v = localStorage.getItem(k)
    if (!v) {
      v =
        crypto?.randomUUID?.() ||
        String(Date.now()) + "_" + Math.random().toString(16).slice(2)
      localStorage.setItem(k, v)
    }
    return v
  }

  function escapeHtml(str) {
    return String(str).replace(
      /[&<>"']/g,
      (s) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[s],
    )
  }

  function toJsonSafe(v) {
    try {
      return JSON.stringify(v, null, 2)
    } catch {
      return String(v)
    }
  }

  function getAttr(el, name, fallback = null) {
    const v = el.getAttribute(name)
    return v === null || v === "" ? fallback : v
  }

  function withTimeout(promise, ms) {
    let t
    const timeout = new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error("Request timed out")), ms)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
  }

  function safeUrl(url, base) {
    try {
      return new URL(url, base || window.location.href)
    } catch {
      return null
    }
  }

  function addQueryParam(url, k, v) {
    const u = safeUrl(url, window.location.origin)
    if (!u) return url
    u.searchParams.set(k, v)
    return u.toString()
  }

  function buildReturnUrl(btn) {
    // Remove hash to avoid weird callback behavior
    const base = window.location.href.split("#")[0]
    const u = safeUrl(base, window.location.origin)
    if (!u) return base

    u.searchParams.set(DEFAULTS.retryParam, "1")
    u.searchParams.set(DEFAULTS.paidParam, "1")

    // prevent infinite loops across reloads
    const key = "__valuya_autoretry_" + (getAttr(btn, "id", "btn") || "btn")
    const already = Number(sessionStorage.getItem(key) || "0")
    if (already >= DEFAULTS.maxAutoRetries) {
      // still return, but don't auto-run again
      u.searchParams.set(DEFAULTS.retryParam, "0")
    }

    return u.toString()
  }

  function buildPayload(btn) {
    const endpoint = getAttr(btn, "data-valuya-endpoint")
    const resource = getAttr(btn, "data-valuya-resource")
    const plan = getAttr(btn, "data-valuya-plan", "standard")
    const publishable = getAttr(btn, "data-valuya-publishable")

    const subjectType = getAttr(btn, "data-valuya-subject-type", "anon")
    let subjectId = getAttr(btn, "data-valuya-subject-id") // can be empty
    const task = getAttr(btn, "data-valuya-task", "")

    if (!endpoint) throw new Error("Missing data-valuya-endpoint")
    if (!publishable) throw new Error("Missing data-valuya-publishable")
    if (!resource) throw new Error("Missing data-valuya-resource")

    // ✅ one anon id, used consistently
    const anonId = getOrCreateAnonId()

    // ✅ if anon and blade didn't provide an id, use localStorage id
    if (String(subjectType).toLowerCase() === "anon") {
      subjectId = subjectId || anonId
    }

    if (!subjectId) throw new Error("Missing subject id")

    return {
      endpoint,
      payload: {
        publishable_key: String(publishable),
        subject: { type: String(subjectType), id: String(subjectId) },
        resource: String(resource),
        plan: String(plan),
        ...(task ? { task: String(task) } : {}),
        meta: {
          // ✅ CRITICAL: must match anon subject when anon
          anon_subject_id:
            String(subjectType).toLowerCase() === "anon"
              ? String(subjectId)
              : anonId,
        },
      },
    }
  }

  function normalizeGuardResponse(any) {
    // Supports:
    // 1) { statusCode, body:{ error, required:{ payment_url, expires_at }, ... } }
    // 2) { error, required:{...} }
    // 3) flat: { payment_url }
    const statusCode = Number(any?.statusCode ?? any?.status ?? 200)
    const body = any?.body ?? any

    const required = body?.required ?? body?.body?.required ?? null

    const paymentUrl =
      body?.payment_url ||
      body?.paymentUrl ||
      required?.payment_url ||
      required?.paymentUrl ||
      required?.checkout_url ||
      required?.checkoutUrl ||
      null

    const expiresAt =
      body?.expires_at ||
      body?.expiresAt ||
      required?.expires_at ||
      required?.expiresAt ||
      null

    const resultText =
      body?.result ||
      body?.output ||
      body?.data?.result ||
      body?.data?.output ||
      body?.body?.result ||
      null

    const error = body?.error || body?.body?.error || null

    return {
      statusCode,
      body,
      required,
      paymentUrl,
      expiresAt,
      resultText,
      error,
    }
  }

  function renderState(resultEl, state) {
    resultEl.innerHTML = `
      <div style="
        border:1px solid rgba(0,0,0,.08);
        border-radius:16px;
        padding:14px;
        background:#fff;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;">
        <div style="display:flex; gap:10px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
          <div style="font-weight:800;">Valuya Guard</div>
          <span style="
            font-size:12px;
            padding:6px 10px;
            border-radius:999px;
            background: rgba(37,93,241,.10);
            color: rgba(20,60,170,1);
            font-weight:800;">
            ${escapeHtml(state.badge || "Ready")}
          </span>
        </div>

        ${state.subtitle ? `<div style="margin-top:8px; color:rgba(0,0,0,.65); font-size:14px;">${escapeHtml(state.subtitle)}</div>` : ""}

        ${state.actionsHtml ? `<div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">${state.actionsHtml}</div>` : ""}

        ${state.contentHtml ? `<div style="margin-top:12px;">${state.contentHtml}</div>` : ""}

        ${
          state.debugJson
            ? `
          <details style="margin-top:10px;">
            <summary style="cursor:pointer; color:rgba(0,0,0,.6); font-size:12px;">Debug</summary>
            <pre style="
              margin-top:8px; overflow:auto; max-height:260px;
              background: rgba(0,0,0,.04);
              border-radius:12px; padding:10px; font-size:12px;">${escapeHtml(state.debugJson)}</pre>
          </details>
        `
            : ""
        }
      </div>
    `
  }

  function buildPaymentUrl(originalPaymentUrl, returnUrl) {
    let url = originalPaymentUrl

    // Try common return param names (your checkout might support one of them)
    url = addQueryParam(url, "success_url", returnUrl)
    url = addQueryParam(url, "successUrl", returnUrl)
    url = addQueryParam(url, "return_url", returnUrl)
    url = addQueryParam(url, "returnUrl", returnUrl)

    return url
  }

  async function fetchJson(endpoint, payload, timeoutMs) {
    const publishableKey =
      payload?.publishable_key || payload?.publishableKey || null

    const csrf = document
      .querySelector('meta[name="csrf-token"]')
      ?.getAttribute("content")

    const req = fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",

        ...(csrf ? { "X-CSRF-TOKEN": csrf } : {}),
        "X-Requested-With": "XMLHttpRequest",

        ...(publishableKey
          ? { "X-Valuya-Publishable-Key": publishableKey }
          : {}),
      },
      body: JSON.stringify(payload),

      // ✅ must send cookies so Laravel can validate CSRF
      credentials: "same-origin",

      cache: "no-store",
    })

    const res = await withTimeout(req, timeoutMs)

    const text = await res.text().catch(() => "")
    let json = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      json = { raw: text }
    }

    return { httpStatus: res.status, json }
  }

  async function runGuard(btn, resultEl) {
    const debug = getAttr(btn, "data-valuya-debug", "0") === "1"
    const timeoutMs = Number(
      getAttr(btn, "data-valuya-timeout-ms", DEFAULTS.timeoutMs),
    )

    const { endpoint, payload } = buildPayload(btn)

    renderState(resultEl, {
      badge: "Running…",
      subtitle: "Checking access and running the task…",
    })

    const { httpStatus, json } = await fetchJson(endpoint, payload, timeoutMs)
    const norm = normalizeGuardResponse(json)

    // Payment required (either statusCode=402 or semantic error)
    const paymentRequired =
      norm.statusCode === 402 ||
      httpStatus === 402 ||
      norm.error === "payment_required" ||
      norm.body?.error === "payment_required"

    if (paymentRequired && norm.paymentUrl) {
      const returnUrl = buildReturnUrl(btn)
      const paymentUrl = buildPaymentUrl(norm.paymentUrl, returnUrl)

      const actionsHtml = `
    <a href="${escapeHtml(paymentUrl)}" target="_blank" rel="noreferrer"
       style="
        display:inline-flex; align-items:center; justify-content:center;
        padding:10px 14px; border-radius:12px;
        background:#255df1; color:#fff; font-weight:900; text-decoration:none;">
      Open payment flow
    </a>
    <button data-valuya-retry type="button"
      style="
        padding:10px 14px; border-radius:12px;
        border:1px solid rgba(0,0,0,.12); background:#fff; font-weight:900; cursor:pointer;">
      I already paid → retry
    </button>
  `

      const responseJson = toJsonSafe(norm.body)

      renderState(resultEl, {
        badge: "Payment required",
        subtitle: "Machine-readable payment response (no mandate yet).",
        actionsHtml,
        contentHtml: `
      <div style="margin-top:8px;">
        <div style="font-weight:700; margin-bottom:6px;">Payment Response JSON</div>
        <pre style="
          border:1px solid rgba(0,0,0,.08);
          border-radius:14px;
          padding:12px;
          background: rgba(0,0,0,.02);
          overflow:auto;
          max-height: 300px;
          white-space: pre-wrap;
          word-break: break-word;
        ">${escapeHtml(responseJson)}</pre>
      </div>
    `,
        debugJson: debug
          ? toJsonSafe({ httpStatus, json, normalized: norm })
          : null,
      })

      const retryBtn = resultEl.querySelector("[data-valuya-retry]")
      if (retryBtn) retryBtn.onclick = () => runGuard(btn, resultEl)

      return
    }

    // Unlocked / success
    const ok =
      httpStatus >= 200 &&
      httpStatus < 300 &&
      (norm.statusCode === 200 ||
        norm.statusCode === 0 ||
        Number.isNaN(norm.statusCode) ||
        norm.error === null)

    const content = norm.resultText
      ? `<div style="
            border:1px solid rgba(0,0,0,.08);
            border-radius:14px;
            padding:12px;
            background: rgba(0,0,0,.02);
            white-space:pre-wrap;
            line-height:1.4;">${escapeHtml(norm.resultText)}</div>`
      : `<pre style="
            border:1px solid rgba(0,0,0,.08);
            border-radius:14px;
            padding:12px;
            background: rgba(0,0,0,.02);
            overflow:auto; max-height: 340px;">${escapeHtml(toJsonSafe(norm.body))}</pre>`

    if (ok) {
      renderState(resultEl, {
        badge: "Unlocked",
        subtitle: "Access granted. Here is the result:",
        contentHtml: content,
        actionsHtml: `
          <button data-valuya-runagain type="button"
            style="
              padding:10px 14px; border-radius:12px;
              border:1px solid rgba(0,0,0,.12); background:#fff; font-weight:900; cursor:pointer;">
            Run again
          </button>
        `,
        debugJson: debug
          ? toJsonSafe({ httpStatus, json, normalized: norm })
          : null,
      })

      const runAgain = resultEl.querySelector("[data-valuya-runagain]")
      if (runAgain) runAgain.onclick = () => runGuard(btn, resultEl)

      return
    }

    // Unexpected / error
    renderState(resultEl, {
      badge: "Error",
      subtitle: "Unexpected response from the agent endpoint.",
      contentHtml: `<pre style="
        border:1px solid rgba(0,0,0,.08);
        border-radius:14px;
        padding:12px;
        background: rgba(255,0,0,.03);
        overflow:auto; max-height: 340px;">${escapeHtml(toJsonSafe({ httpStatus, json }))}</pre>`,
      debugJson: debug
        ? toJsonSafe({ httpStatus, json, normalized: norm })
        : null,
    })
  }

  function initOne(btn) {
    const resultSel = getAttr(
      btn,
      "data-valuya-result",
      DEFAULTS.resultSelector,
    )
    const resultEl = $(resultSel) || btn.parentElement

    btn.addEventListener("click", (e) => {
      e.preventDefault()
      runGuard(btn, resultEl).catch((err) => {
        renderState(resultEl, {
          badge: "Error",
          subtitle: err?.message || String(err),
          debugJson: toJsonSafe(err),
        })
      })
    })

    // Auto-retry after returning from payment (best effort)
    const qp = new URLSearchParams(window.location.search)
    if (DEFAULTS.autoRetryAfterReturn && qp.get(DEFAULTS.retryParam) === "1") {
      const key = "__valuya_autoretry_" + (getAttr(btn, "id", "btn") || "btn")
      const already = Number(sessionStorage.getItem(key) || "0")
      if (already < DEFAULTS.maxAutoRetries) {
        sessionStorage.setItem(key, String(already + 1))
        setTimeout(() => runGuard(btn, resultEl).catch(() => {}), 300)
      }
    }
  }

  function init() {
    const buttons = document.querySelectorAll("[data-valuya-guard]")
    buttons.forEach(initOne)
  }

  // Support late-rendered buttons (common in CMS)
  function observe() {
    const mo = new MutationObserver(() => {
      const buttons = document.querySelectorAll(
        "[data-valuya-guard]:not([data-valuya-bound])",
      )
      buttons.forEach((btn) => {
        btn.setAttribute("data-valuya-bound", "1")
        initOne(btn)
      })
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      init()
      observe()
    })
  } else {
    init()
    observe()
  }
})()
