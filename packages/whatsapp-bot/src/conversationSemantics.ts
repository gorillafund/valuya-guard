export type TaskType =
  | "shopping"
  | "recipe"
  | "cart_edit"
  | "checkout"
  | "support"
  | "smalltalk"
  | "unknown"

export type DialogueMove =
  | "new_request"
  | "continue"
  | "refine"
  | "correct"
  | "confirm"
  | "reject"
  | "switch_topic"
  | "ask_question"
  | "abort"

export type SelectionMode =
  | "append"
  | "replace"
  | "remove"
  | "set_quantity"
  | "browse_only"
  | "clarify"
  | "none"

export type ContextRelation =
  | "use_current"
  | "use_shown_options"
  | "use_cart"
  | "use_pending_question"
  | "discard_stale"
  | "unclear"

export type ReferenceStrength = "strong" | "weak" | "none"

export type DialogueUnderstanding = {
  task_type: TaskType
  dialogue_move: DialogueMove
  selection_mode: SelectionMode
  context_relation: ContextRelation
  reference_strength: ReferenceStrength
  clarification_needed: boolean
  clarification_reason: string | null
  confidence: number
}

