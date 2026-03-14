import test from "node:test"
import assert from "node:assert/strict"
import { applyResponsePlan, planResponse } from "./responsePlanner.js"

test("response planner acknowledges correction clarifications compactly", () => {
  const plan = planResponse({
    kind: "clarify",
    userMessage: "nein, ich meinte bier",
    dialogueMove: "correct",
  })

  assert.equal(plan.reply_mode, "ask_clarifying_question")
  assert.equal(plan.acknowledgment, "Verstanden.")
  assert.equal(
    applyResponsePlan("Meinst du Weissbier oder Helles?", plan),
    "Verstanden.\n\nMeinst du Weissbier oder Helles?",
  )
})

test("response planner keeps short mutation replies compact", () => {
  const plan = planResponse({
    kind: "mutation",
    userMessage: "auch milch",
    dialogueMove: "refine",
  })

  assert.equal(plan.reply_mode, "confirm_change")
  assert.equal(plan.acknowledgment, "Alles klar.")
  assert.equal(
    applyResponsePlan("Ich habe Vollmilch hinzugefuegt.", plan),
    "Alles klar.\n\nIch habe Vollmilch hinzugefuegt.",
  )
})

test("response planner uses repair-specific acknowledgments", () => {
  const plan = planResponse({
    kind: "clarify",
    userMessage: "2",
    interactionState: {
      phase: "disambiguation",
      last_assistant_act: "asked_clarification",
      expected_reply_type: "free_text",
      repair_mode: true,
      pending_clarification_reason: "invalid_pending_question_grounding",
      assumption_under_discussion: null,
    },
  })

  assert.equal(plan.acknowledgment, "Meinst du die letzte Auswahl?")
  assert.equal(
    applyResponsePlan("Ich habe gerade keine offene Auswahl mehr.", plan),
    "Meinst du die letzte Auswahl?\n\nIch habe gerade keine offene Auswahl mehr.",
  )
})
