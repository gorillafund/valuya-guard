// packages/agent/src/client/errors.ts
/**
 * Typed error thrown by agent HTTP client.
 * - message is human-friendly
 * - details keeps the full context for logging/debugging
 */
export class ValuyaApiError extends Error {
    name = "ValuyaApiError";
    details;
    constructor(details) {
        super(details.message);
        this.details = details;
    }
}
/**
 * Parse response body as JSON if possible, otherwise return text.
 */
export function parseJsonOrText(text) {
    const raw = text ?? "";
    if (raw === "")
        return { json: null, raw: "" };
    try {
        return { json: JSON.parse(raw), raw };
    }
    catch {
        return { json: null, raw };
    }
}
/**
 * Build best-effort error code/message from a JSON payload.
 * Supports common Laravel shapes:
 * - { error: "..." }
 * - { message: "..." }
 * - { errors: { field: [..] } } (validation)
 */
export function extractServerError(json) {
    if (!json || typeof json !== "object")
        return {};
    // Prefer explicit code fields
    const code = (typeof json.error === "string" && json.error) ||
        (typeof json.code === "string" && json.code) ||
        (typeof json.type === "string" && json.type) ||
        undefined;
    // Laravel validation: errors: { field: ["msg"] }
    if (json.errors && typeof json.errors === "object") {
        const msgs = [];
        for (const [field, arr] of Object.entries(json.errors)) {
            if (Array.isArray(arr) && arr.length > 0) {
                msgs.push(`${field}: ${String(arr[0])}`);
            }
        }
        if (msgs.length > 0) {
            return { code: code ?? "validation_error", message: msgs.join("; ") };
        }
    }
    const message = (typeof json.message === "string" && json.message) ||
        (typeof json.error === "string" && json.error) ||
        undefined;
    return { code, message };
}
/**
 * Short preview for logs/UI. Avoid dumping huge HTML pages into error messages.
 */
export function previewText(s, max = 600) {
    const t = (s ?? "").trim();
    if (t.length <= max)
        return t;
    return t.slice(0, max) + "…";
}
/**
 * Create a rich error from a failed HTTP response.
 */
export async function buildApiError(args) {
    const { res, method, url, path, responseText } = args;
    const { json, raw } = parseJsonOrText(responseText);
    const extracted = extractServerError(json);
    const requestId = res.headers.get("x-request-id") ||
        res.headers.get("x-correlation-id") ||
        res.headers.get("cf-ray") ||
        null;
    const code = extracted.code ?? null;
    // Human-friendly message
    const baseMsg = extracted.message ||
        (json &&
            typeof json === "object" &&
            typeof json.error === "string" &&
            json.error) ||
        `HTTP ${res.status} ${res.statusText}`;
    const messageParts = [
        baseMsg,
        code ? `(code=${code})` : null,
        requestId ? `(request_id=${requestId})` : null,
    ].filter(Boolean);
    const message = messageParts.join(" ");
    return new ValuyaApiError({
        status: res.status,
        statusText: res.statusText,
        method,
        url,
        path,
        requestId,
        code,
        message,
        body: json ?? undefined,
        rawText: json ? undefined : previewText(raw),
    });
}
/**
 * Type guard for caller-side error handling.
 */
export function isValuyaApiError(e) {
    return (typeof e === "object" &&
        e !== null &&
        e.name === "ValuyaApiError" &&
        typeof e.details?.status === "number");
}
