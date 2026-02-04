"use strict";
// packages/core/src/resource.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCanonicalResource = isCanonicalResource;
exports.asCanonicalResource = asCanonicalResource;
exports.makeResource = makeResource;
exports.parseResource = parseResource;
exports.httpRouteResource = httpRouteResource;
exports.tryAsCanonicalResource = tryAsCanonicalResource;
// Strict but practical: namespace + type are tokens, identifier is "rest of string"
var NS_RE = /^[a-z][a-z0-9_-]*$/; // allow dash/underscore
var TYPE_RE = /^[a-z][a-z0-9_-]*$/;
function isCanonicalResource(value) {
    if (typeof value !== "string")
        return false;
    // Must have at least 2 colons separating namespace and type
    var first = value.indexOf(":");
    if (first <= 0)
        return false;
    var second = value.indexOf(":", first + 1);
    if (second <= first + 1)
        return false;
    var namespace = value.slice(0, first);
    var type = value.slice(first + 1, second);
    var identifier = value.slice(second + 1); // may contain colons and anything else
    if (!NS_RE.test(namespace))
        return false;
    if (!TYPE_RE.test(type))
        return false;
    // Identifier must be non-empty and must not contain whitespace
    if (!identifier)
        return false;
    if (/\s/.test(identifier))
        return false;
    return true;
}
function asCanonicalResource(value) {
    if (!isCanonicalResource(value)) {
        throw new Error("Invalid CanonicalResource: ".concat(value));
    }
    return value;
}
/**
 * Build a CanonicalResource deterministically.
 * - namespace + type are validated tokens
 * - identifier is preserved exactly (no slash normalization)
 */
function makeResource(args) {
    var namespace = args.namespace, type = args.type, identifier = args.identifier;
    if (!NS_RE.test(namespace)) {
        throw new Error("Invalid resource namespace: ".concat(namespace));
    }
    if (!TYPE_RE.test(type)) {
        throw new Error("Invalid resource type: ".concat(type));
    }
    if (!identifier || /\s/.test(identifier)) {
        throw new Error("Invalid resource identifier: ".concat(identifier));
    }
    return "".concat(namespace, ":").concat(type, ":").concat(identifier);
}
/**
 * Parse a canonical resource into its components.
 * Identifier is "the rest" after the second colon (can contain colons).
 */
function parseResource(resource) {
    var first = resource.indexOf(":");
    var second = resource.indexOf(":", first + 1);
    return {
        namespace: resource.slice(0, first),
        type: resource.slice(first + 1, second),
        identifier: resource.slice(second + 1),
    };
}
/**
 * Convenience helper: canonical http route resource.
 * Example: http:route:GET:/api/v1/data
 *
 * IMPORTANT:
 * - preserves path exactly (including trailing slash)
 * - does NOT try to decode/encode or normalize slashes
 */
function httpRouteResource(method, path) {
    var m = method.trim().toUpperCase();
    var p = path; // preserve exactly per spec
    if (!m)
        throw new Error("HTTP method required");
    if (!p)
        throw new Error("HTTP path required");
    if (/\s/.test(p))
        throw new Error("Invalid HTTP path (contains whitespace): ".concat(p));
    return makeResource({
        namespace: "http",
        type: "route",
        identifier: "".concat(m, ":").concat(p),
    });
}
function tryAsCanonicalResource(value) {
    var _a;
    try {
        return { ok: true, value: asCanonicalResource(value) };
    }
    catch (e) {
        return { ok: false, error: (_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : "invalid_resource" };
    }
}
