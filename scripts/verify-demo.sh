#!/usr/bin/env bash
set -euo pipefail

# Valuya Guard – AWS Adapter Verification Script
#
# Usage:
#   ./verify-valuya-guard.sh https://<apiId>.execute-api.<region>.amazonaws.com/Prod/protected
#
# Optional env vars:
#   SUBJECT_HEADER="X-Valuya-Subject-Id: anon:526"
#   ANON_HEADER="x-valuya-anon-id: 526"
#   COOKIE_HEADER="Cookie: valuya_anon_id=526"
#   HTML_ACCEPT="text/html"

API_URL="${1:-}"
if [[ -z "${API_URL}" ]]; then
  echo "Usage: $0 <API_URL>"
  echo "Example: $0 https://ph78woidp4.execute-api.eu-central-1.amazonaws.com/Prod/protected"
  exit 1
fi

ANON_HEADER="${ANON_HEADER:-x-valuya-anon-id: 526}"
SUBJECT_HEADER="${SUBJECT_HEADER:-X-Valuya-Subject-Id: anon:alpha}"
COOKIE_HEADER="${COOKIE_HEADER:-Cookie: valuya_anon_id=cookie123}"
HTML_ACCEPT="${HTML_ACCEPT:-text/html}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "✅ %s\n" "$*"; }
fail() { printf "❌ %s\n" "$*"; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"
}

need curl
need node
need awk
need grep
need tr

request() {
  local name="$1"
  shift
  local headers=("$@")

  local hfile="$TMP_DIR/${name}.headers"
  local bfile="$TMP_DIR/${name}.body"

  # -sS: silent but show errors, -D: dump headers, -o: body to file
  curl -sS -D "$hfile" -o "$bfile" "${headers[@]}" "$API_URL" >/dev/null

  echo "$hfile|$bfile"
}

get_status() {
  local hfile="$1"
  # HTTP/2 402 -> extract 402
  awk 'NR==1{print $2}' "$hfile"
}

get_header() {
  local hfile="$1"
  local key="$2"
  # case-insensitive match, strip CR
  grep -i "^${key}:" "$hfile" | head -n1 | cut -d':' -f2- | sed 's/^[[:space:]]*//' | tr -d '\r' || true
}

json_get() {
  local bfile="$1"
  local expr="$2"
  node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(${expr});" "$bfile"
}

assert_eq() {
  local a="$1"
  local b="$2"
  local msg="$3"
  [[ "$a" == "$b" ]] || fail "$msg (got='$a' expected='$b')"
}

assert_includes() {
  local hay="$1"
  local needle="$2"
  local msg="$3"
  [[ "$hay" == *"$needle"* ]] || fail "$msg (missing '$needle')"
}

bold "Valuya Guard Verification"
echo "API: $API_URL"
echo

# 1) Agent/API flow -> 402 JSON
bold "1) API/Agent flow returns RFC 402 JSON"
pair="$(request api402 -H "$ANON_HEADER")"
HFILE="${pair%%|*}"
BFILE="${pair##*|}"

STATUS="$(get_status "$HFILE")"
assert_eq "$STATUS" "402" "Expected HTTP 402"

CT="$(get_header "$HFILE" "content-type")"
CC="$(get_header "$HFILE" "cache-control")"
PURL_H="$(get_header "$HFILE" "x-valuya-payment-url")"
SID_H="$(get_header "$HFILE" "x-valuya-session-id")"

[[ -n "$PURL_H" ]] || fail "Missing header x-valuya-payment-url"
[[ -n "$SID_H" ]]  || fail "Missing header x-valuya-session-id"

assert_includes "$CT" "application/json" "Expected JSON content-type"
assert_eq "$CC" "no-store" "Expected cache-control: no-store"

ERR="$(json_get "$BFILE" "j.error")"
REASON="$(json_get "$BFILE" "j.reason")"
PURL_B="$(json_get "$BFILE" "j.payment_url")"
SID_B="$(json_get "$BFILE" "j.session_id")"
REQ_TYPE="$(json_get "$BFILE" "j.required?.type")"
EPLAN="$(json_get "$BFILE" "j.evaluated_plan")"
RES="$(json_get "$BFILE" "j.resource")"

assert_eq "$ERR" "payment_required" "Expected error=payment_required"
[[ -n "$REASON" ]] || fail "Expected non-empty reason"
[[ -n "$REQ_TYPE" ]] || fail "Expected required.type"
[[ -n "$EPLAN" ]] || fail "Expected evaluated_plan"
[[ -n "$RES" ]] || fail "Expected resource"

assert_eq "$PURL_H" "$PURL_B" "Header payment url must match body payment_url"
assert_eq "$SID_H" "$SID_B"   "Header session id must match body session_id"

ok "402 JSON response matches headers/body invariants"

echo "  required.type: $REQ_TYPE"
echo "  evaluated_plan: $EPLAN"
echo "  resource: $RES"
echo "  session_id: $SID_B"
echo

# 2) HTML flow -> redirect
#bold "2) HTML Accept returns redirect (302/303) with Location"
#pair="$(request html -H "Accept: $HTML_ACCEPT" -H "$ANON_HEADER")"
#HFILE="${pair%%|*}"

#STATUS="$(get_status "$HFILE")"
#if [[ "$STATUS" != "302" && "$STATUS" != "303" ]]; then
 # fail "Expected 302/303 for HTML, got $STATUS"
#fi

#LOC="$(get_header "$HFILE" "location")"
#[[ -n "$LOC" ]] || fail "Expected Location header on HTML redirect"
#CC="$(get_header "$HFILE" "cache-control")"
#assert_eq "$CC" "no-store" "Expected cache-control: no-store on redirect"

#ok "HTML redirect is working"
#echo "  Location: $LOC"
#echo

# 3) Subject resolution precedence: explicit header wins
bold "3) Subject resolution: explicit X-Valuya-Subject-Id should win (smoke)"
pair="$(request subj -H "$SUBJECT_HEADER" -H "$ANON_HEADER")"
HFILE="${pair%%|*}"
BFILE="${pair##*|}"
STATUS="$(get_status "$HFILE")"
assert_eq "$STATUS" "402" "Expected 402 for explicit subject smoke test"
ok "Explicit subject header accepted (backend should see anon:alpha or provided subject)"
echo

# 4) Cookie subject works
bold "4) Cookie subject resolution (smoke)"
pair="$(request cookie -H "$COOKIE_HEADER")"
HFILE="${pair%%|*}"
STATUS="$(get_status "$HFILE")"
# could be 402 or 200 depending on mandates; accept both, but ensure not 404
if [[ "$STATUS" == "404" ]]; then
  fail "Got 404 on cookie subject test (routing issue)"
fi
ok "Cookie request reached function (status $STATUS)"
echo

# 5) Idempotency test: same subject should yield same session_id (if backend enforces)
bold "5) Checkout idempotency: repeated deny should reuse session (if enabled)"
# Use a dedicated subject for idempotency test
IDEM_SUBJ="x-valuya-anon-id: idemtest"
pair1="$(request idem1 -H "$IDEM_SUBJ")"
b1="${pair1##*|}"
sid1="$(json_get "$b1" "j.session_id")"

sleep 0.2

pair2="$(request idem2 -H "$IDEM_SUBJ")"
b2="${pair2##*|}"
sid2="$(json_get "$b2" "j.session_id")"

echo "  session_id #1: $sid1"
echo "  session_id #2: $sid2"

if [[ "$sid1" == "$sid2" ]]; then
  ok "Idempotency appears enabled (session reused)"
else
  echo "⚠️  Idempotency not enforced yet (sessions differ). Backend must honor Idempotency-Key to pass this check."
fi
echo

# 6) Retry after payment (manual)
bold "6) Post-payment retry (manual step)"
PAY_URL="$(json_get "$TMP_DIR/api402.body" "j.payment_url")"
echo "Complete payment at:"
echo "  $PAY_URL"
echo
echo "Then re-run:"
echo "  curl -i -H \"$ANON_HEADER\" \"$API_URL\""
echo
ok "Script completed"
