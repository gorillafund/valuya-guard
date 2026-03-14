import type { DialogueMove } from "./conversationSemantics.js"
import type { InteractionState } from "./stateStore.js"

export type ResponsePlan = {
  reply_mode: "acknowledge_and_act" | "ask_clarifying_question" | "show_options" | "confirm_change" | "answer_question" | "summarize_state"
  reply_length: "micro" | "short" | "medium"
  tone_mode: "compact" | "warm" | "supportive"
  acknowledgment: string | null
}

export function planResponse(args: {
  kind: "clarify" | "options" | "mutation" | "answer"
  userMessage: string
  dialogueMove?: DialogueMove
  interactionState?: InteractionState
}): ResponsePlan {
  const shortTurn = normalize(args.userMessage).split(" ").filter(Boolean).length <= 3
  const repair = args.interactionState?.repair_mode === true || args.kind === "clarify"
  const acknowledgment = chooseAcknowledgment(args.dialogueMove, shortTurn, repair, args.interactionState)

  switch (args.kind) {
    case "clarify":
      return {
        reply_mode: "ask_clarifying_question",
        reply_length: "short",
        tone_mode: "compact",
        acknowledgment,
      }
    case "options":
      return {
        reply_mode: "show_options",
        reply_length: shortTurn ? "short" : "medium",
        tone_mode: "warm",
        acknowledgment,
      }
    case "mutation":
      return {
        reply_mode: "confirm_change",
        reply_length: "short",
        tone_mode: "compact",
        acknowledgment,
      }
    default:
      return {
        reply_mode: "answer_question",
        reply_length: shortTurn ? "micro" : "short",
        tone_mode: "compact",
        acknowledgment,
      }
  }
}

export function applyResponsePlan(text: string, plan: ResponsePlan): string {
  const body = String(text || "").trim()
  if (!body) return plan.acknowledgment || ""
  if (!plan.acknowledgment) return body
  if (startsWithAcknowledgment(body)) return body
  return `${plan.acknowledgment}\n\n${body}`
}

function chooseAcknowledgment(
  dialogueMove: DialogueMove | undefined,
  shortTurn: boolean,
  repairMode: boolean,
  interactionState?: InteractionState,
): string | null {
  const repairReason = interactionState?.pending_clarification_reason || null
  if (repairMode && repairReason === "invalid_pending_question_grounding") return "Meinst du die letzte Auswahl?"
  if (repairMode && repairReason === "invalid_shown_options_grounding") return "Meinst du die letzte Liste?"
  if (repairMode && repairReason === "missing_cart_context") return "Es gibt gerade keinen aktiven Warenkorb."
  if (repairMode && (repairReason === "discard_stale_context" || repairReason === "topic_switch")) return "Okay, wir wechseln."
  if (dialogueMove === "correct" || dialogueMove === "reject") return "Verstanden."
  if (dialogueMove === "refine" || dialogueMove === "confirm") return "Alles klar."
  if (dialogueMove === "switch_topic") return "Okay."
  if (repairMode && shortTurn) return "Okay."
  if (shortTurn) return "Alles klar."
  return null
}

function startsWithAcknowledgment(text: string): boolean {
  return /^(alles klar|okay|ok|verstanden|mache ich)\b/i.test(text)
}

function normalize(value: string): string {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim()
}
