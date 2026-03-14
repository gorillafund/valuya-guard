#!/usr/bin/env python3
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


HOST = os.getenv("HOST", "0.0.0.0").strip() or "0.0.0.0"
PORT = int(os.getenv("PORT", "8801"))
API_TOKEN = os.getenv("PYTHON_RUNTIME_TOKEN", "").strip()


class RuntimeHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/runtime":
            self._respond(404, {"ok": False, "error": "not_found"})
            return

        if API_TOKEN:
            auth = (self.headers.get("Authorization") or "").strip()
            if auth != f"Bearer {API_TOKEN}":
                self._respond(401, {"ok": False, "error": "unauthorized"})
                return

        try:
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0") or "0")).decode("utf-8")
            body = json.loads(raw or "{}")
            response = generate_structured_response(body)
            print(json.dumps({
                "level": "info",
                "event": "python_runtime_reference_request",
                "soul_id": read_str(body.get("soul", {}).get("id")),
                "protocol_subject_header": read_str(body.get("protocolSubjectHeader")),
                "message_preview": read_str(body.get("message", ""))[:120],
            }))
            self._respond(200, response)
        except Exception as exc:
            print(json.dumps({
                "level": "error",
                "event": "python_runtime_reference_error",
                "message": str(exc),
            }))
            self._respond(500, {
                "ok": False,
                "error": "internal_error",
                "message": "Python reference runtime failed.",
            })

    def log_message(self, format, *args):
        return

    def _respond(self, status, body):
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def generate_structured_response(body):
    soul = body.get("soul") or {}
    schema = soul.get("responseSchema") or {}
    locale = read_str(body.get("locale")) or read_str(soul.get("locale")) or "de"
    message = read_str(body.get("message")) or ""
    soul_name = read_str(soul.get("name")) or read_str(soul.get("id")) or "Assistant"
    summaries = body.get("memory", {}).get("summaries") if isinstance(body.get("memory"), dict) else []
    previous_summary = summaries[-1] if isinstance(summaries, list) and summaries else None
    root_pattern = detect_root_pattern(message.lower())

    reply_key = read_str(schema.get("replyKey")) or "reply"
    response = {
        reply_key: build_reply(soul_name, locale, root_pattern, previous_summary),
    }

    follow_up_key = read_str(schema.get("followUpQuestionKey"))
    next_step_key = read_str(schema.get("nextStepKey"))
    summary_key = read_str(schema.get("summaryKey"))
    user_profile_key = read_str(schema.get("userProfileKey"))
    root_pattern_key = read_str(schema.get("rootPatternKey"))

    if follow_up_key:
        response[follow_up_key] = build_question(locale, root_pattern)
    if next_step_key:
        response[next_step_key] = build_next_step(locale, root_pattern)
    if summary_key:
        response[summary_key] = f"Thema: {describe_pattern(root_pattern)}. Nachricht: {message[:140]}"
    if user_profile_key:
        response[user_profile_key] = {
            "preferred_language": locale,
            "current_focus": root_pattern,
        }
    if root_pattern_key:
        response[root_pattern_key] = root_pattern

    return response


def build_reply(soul_name, locale, root_pattern, previous_summary):
    if locale.startswith("de"):
        parts = [
            f"{soul_name}: Ich habe dein Anliegen aufgenommen.",
            f"Ich habe noch im Blick: {previous_summary}" if previous_summary else None,
            f"Im Moment klingt es fuer mich vor allem nach {describe_pattern(root_pattern)}.",
        ]
    else:
        parts = [
            f"{soul_name}: I picked up your message.",
            f"I still have this in mind: {previous_summary}" if previous_summary else None,
            f"Right now this sounds mostly like {describe_pattern(root_pattern)}.",
        ]
    return " ".join([part for part in parts if part])


def build_question(locale, root_pattern):
    de = {
        "stress": "Was fuehlt sich daran gerade am engsten oder schwersten an?",
        "decision": "Zwischen welchen zwei Optionen stehst du gerade wirklich?",
        "support": "Was genau blockiert dich im Moment am staerksten?",
        "clarity": "Wenn du dein Thema in einem Satz zuspitzen muesstest, wie wuerde er lauten?",
    }
    en = {
        "stress": "What part of this feels the tightest or heaviest right now?",
        "decision": "What are the two real options you are weighing?",
        "support": "What exactly is blocking you the most right now?",
        "clarity": "If you had to sharpen this into one sentence, what would it be?",
    }
    return de[root_pattern] if locale.startswith("de") else en[root_pattern]


def build_next_step(locale, root_pattern):
    de = {
        "stress": "Nenne zuerst nur den einen Teil, den du heute beeinflussen kannst.",
        "decision": "Schreibe die wichtigste Abwaegung in einem kurzen Satz auf.",
        "support": "Beschreibe zuerst den letzten Schritt vor dem Fehler oder Hindernis.",
        "clarity": "Formuliere zuerst, was du dir nach diesem Gespraech konkret erhoffst.",
    }
    en = {
        "stress": "Start by naming the one part you can influence today.",
        "decision": "Write down the main tradeoff in one short sentence.",
        "support": "Start with the last step right before the issue happened.",
        "clarity": "Start by stating what concrete outcome you want from this conversation.",
    }
    return de[root_pattern] if locale.startswith("de") else en[root_pattern]


def detect_root_pattern(message):
    if any(token in message for token in ["stress", "druck", "ueberfordert", "überfordert", "erschöpft", "erschoepft"]):
        return "stress"
    if any(token in message for token in ["entscheidung", "decide", "option", "wahl", "choose"]):
        return "decision"
    if any(token in message for token in ["kunde", "support", "bug", "problem", "fehler", "issue"]):
        return "support"
    return "clarity"


def describe_pattern(root_pattern):
    descriptions = {
        "stress": "pressure and overload",
        "decision": "a decision that still needs shape",
        "support": "a concrete support issue",
        "clarity": "something that needs more clarity",
    }
    return descriptions[root_pattern]


def read_str(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), RuntimeHandler)
    print(json.dumps({
        "level": "info",
        "event": "python_runtime_reference_started",
        "host": HOST,
        "port": PORT,
        "path": "/runtime",
        "auth_required": bool(API_TOKEN),
    }))
    server.serve_forever()
