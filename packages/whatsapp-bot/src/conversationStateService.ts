import type {
  ActiveProductCandidate,
  CartState,
  ConversationProfile,
  ConversationReferenceItem,
  ConversationState,
  FileStateStore,
  InteractionState,
  OnboardingStage,
  PaymentHandoffState,
} from "./stateStore.js"
import {
  confirmedMutationInteractionState,
  deriveInteractionStateForActiveQuestion,
  deriveInteractionStateForClarification,
  deriveInteractionStateForPendingOptions,
  idleInteractionState,
} from "./interactionStateService.js"

export type ConversationSnapshot = {
  subjectId: string
  onboardingStage?: OnboardingStage
  conversation?: ConversationState | null
  profile?: ConversationProfile
}

export class ConversationStateService {
  private readonly store: FileStateStore

  constructor(store: FileStateStore) {
    this.store = store
  }

  async getSnapshot(subjectId: string): Promise<ConversationSnapshot> {
    const [conversation, profile] = await Promise.all([
      this.store.get(subjectId),
      this.store.getProfile(subjectId),
    ])
    return {
      subjectId,
      onboardingStage: profile?.onboardingStage,
      conversation,
      profile: profile?.profile,
    }
  }

  async recordInboundMessage(subjectId: string, message: string): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    const history = appendBounded(snapshot.profile?.recentConversationHistory, `user: ${message}`)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        latestMessage: message,
        recentConversationHistory: history,
      },
    })
  }

  async recordAssistantMessage(subjectId: string, message: string): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    const history = appendBounded(snapshot.profile?.recentConversationHistory, `assistant: ${message}`)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        recentConversationHistory: history,
      },
    })
  }

  async recordUnderstanding(subjectId: string, args: {
    intent: string
    entities?: Record<string, unknown>
    semantics?: Record<string, unknown>
    clarification?: { kind: string; question: string; reason?: string | null } | null
  }): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        extractedIntent: args.intent,
        extractedEntities: {
          ...(args.entities || {}),
          ...(args.semantics ? { semantics: args.semantics } : {}),
        },
        pendingClarification: args.clarification
          ? {
              kind: args.clarification.kind,
              question: args.clarification.question,
              askedAt: new Date().toISOString(),
            }
          : undefined,
        ...(args.clarification
          ? {
              interactionState: deriveInteractionStateForClarification({
                kind: args.clarification.kind,
                question: args.clarification.question,
                reason: args.clarification.reason,
              }),
            }
          : {}),
      },
    })
  }

  async clearPendingClarification(subjectId: string): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        pendingClarification: undefined,
        interactionState: idleInteractionState(),
      },
    })
  }

  async recordShownProducts(subjectId: string, products: ConversationReferenceItem[]): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        lastShownProducts: products.slice(0, 8),
      },
    })
  }

  async setActiveProduct(subjectId: string, args: {
    product?: ActiveProductCandidate
    question?: ConversationProfile["activeQuestion"]
    editMode?: ConversationProfile["activeEditMode"]
  }): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        activeProductCandidate: args.product,
        activeQuestion: args.question,
        activeEditMode: args.editMode,
        interactionState: args.question
          ? deriveInteractionStateForActiveQuestion(args.question, args.editMode)
          : undefined,
      },
    })
  }

  async clearActiveProduct(subjectId: string): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        activeProductCandidate: undefined,
        activeQuestion: undefined,
        activeEditMode: undefined,
        interactionState: snapshot.profile?.pendingOptions
          ? deriveInteractionStateForPendingOptions(snapshot.profile.pendingOptions)
          : idleInteractionState(),
      },
    })
  }

  async setPendingOptions(subjectId: string, pendingOptions: ConversationProfile["pendingOptions"]): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        pendingOptions,
        interactionState: deriveInteractionStateForPendingOptions(pendingOptions),
      },
    })
  }

  async clearPendingOptions(subjectId: string): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        pendingOptions: undefined,
        interactionState: snapshot.profile?.activeQuestion
          ? deriveInteractionStateForActiveQuestion(
              snapshot.profile.activeQuestion,
              snapshot.profile.activeEditMode,
            )
          : idleInteractionState(),
      },
    })
  }

  async recordRecipeAndCart(subjectId: string, args: {
    recipeTitle?: string
    cart?: CartState
  }): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        selectedRecipeTitle: args.recipeTitle,
        currentCartSnapshot: args.cart,
      },
    })
  }

  async recordPaymentHandoff(subjectId: string, payment: PaymentHandoffState): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        paymentHandoffState: payment,
        interactionState: {
          phase: "checkout",
          last_assistant_act: "summarized_state",
          expected_reply_type: "free_text",
          repair_mode: false,
          assumption_under_discussion: { type: "payment", value: payment.status },
        },
      },
    })
  }

  async setInteractionState(subjectId: string, interactionState: InteractionState): Promise<void> {
    const snapshot = await this.getSnapshot(subjectId)
    await this.store.upsertProfile(subjectId, {
      onboardingStage: snapshot.onboardingStage ?? "guided",
      profile: {
        interactionState,
      },
    })
  }

  async recordConfirmedMutation(subjectId: string, productTitle?: string): Promise<void> {
    await this.setInteractionState(subjectId, confirmedMutationInteractionState(productTitle))
  }

  buildContextSummary(snapshot: ConversationSnapshot): string {
    const parts: string[] = []
    if (snapshot.profile?.shoppingPreferences) {
      const active = [
        snapshot.profile.shoppingPreferences.cheapest ? "cheapest" : null,
        snapshot.profile.shoppingPreferences.regional ? "regional" : null,
        snapshot.profile.shoppingPreferences.bio ? "bio" : null,
      ].filter(Boolean)
      if (active.length) parts.push(`preferences=${active.join(",")}`)
    }
    if (snapshot.profile?.deliveryAddressHint) {
      parts.push(`address_hint=${snapshot.profile.deliveryAddressHint}`)
    }
    if (snapshot.profile?.selectedRecipeTitle) {
      parts.push(`selected_recipe=${snapshot.profile.selectedRecipeTitle}`)
    }
    if (snapshot.profile?.lastShownProducts?.length) {
      parts.push(`last_shown=${snapshot.profile.lastShownProducts.map((item) => item.title).join("|")}`)
    }
    if (snapshot.profile?.pendingClarification?.question) {
      parts.push(`pending_clarification=${snapshot.profile.pendingClarification.question}`)
    }
    if (snapshot.profile?.interactionState) {
      parts.push(`phase=${snapshot.profile.interactionState.phase}`)
      parts.push(`expected_reply=${snapshot.profile.interactionState.expected_reply_type}`)
      if (snapshot.profile.interactionState.assumption_under_discussion?.value) {
        parts.push(`assumption=${snapshot.profile.interactionState.assumption_under_discussion.value}`)
      }
    }
    const semantics = snapshot.profile?.extractedEntities?.semantics
    if (semantics && typeof semantics === "object") {
      const record = semantics as Record<string, unknown>
      if (typeof record.dialogue_move === "string") parts.push(`dialogue_move=${record.dialogue_move}`)
      if (typeof record.selection_mode === "string") parts.push(`selection_mode=${record.selection_mode}`)
      if (typeof record.context_relation === "string") parts.push(`context_relation=${record.context_relation}`)
    }
    if (snapshot.profile?.recentConversationHistory?.length) {
      parts.push(`history=${snapshot.profile.recentConversationHistory.slice(-4).join(" || ")}`)
    }
    return parts.join("; ")
  }
}

function appendBounded(history: string[] | undefined, value: string): string[] {
  const next = [...(history || []), value]
  return next.slice(-8)
}
