# @valuya/whatsapp-bot

WhatsApp bot for the Alfies concierge flow using Twilio inbound webhooks, an in-process JS concierge, `@valuya/agent` payment flow, and Valuya backend order dispatch.

## Features

- Receives inbound WhatsApp messages via `POST /twilio/whatsapp/webhook`
- Runs concierge logic in-process (`recipe`, `alt`, `confirm`, `cancel`)
- Uses keyword replies (no inline buttons): `order`, `alt`, `cancel`, `status`
- Supports secure Valuya account linking via `LINK gls_...` messages
- Shows managed-agent capacity on successful onboarding link and `status`:
  - wallet balance
  - spendable overall
  - spendable for this WhatsApp bot right now
- Runs Valuya whoami + delegated Guard payment flow on `order`
- After successful payment, posts confirmed orders to `/api/agent/orders` for backend email/CSV dispatch
- Responds using TwiML plain text

## Environment

Copy `.env.example` and configure all values.

Required for base flow:

- `TWILIO_AUTH_TOKEN`
- `VALUYA_GUARD_BASE_URL` (or `VALUYA_BASE`)
- `VALUYA_TENANT_TOKEN`
- `WHATSAPP_CHANNEL_APP_ID` (default `whatsapp_main`)
- `VALUYA_BACKEND_BASE_URL`
- `VALUYA_BACKEND_TOKEN`
- `VALUYA_ORDER_RESOURCE` (preferred payment/entitlement resource for marketplace + Guard autopay)
- `VALUYA_PAYMENT_ASSET` (optional, defaults to `EURe`)
- `VALUYA_PAYMENT_CURRENCY` (optional, defaults to `EUR`)
- `OPENAI_API_KEY` (optional; enables intent/slot extraction while keeping execution deterministic)
- `OPENAI_MODEL` (optional; defaults to `gpt-4.1-mini`)
- `ALFIES_TEST_API_ENABLED` (optional; when `true`, `address: ...` messages try to initialize a live Alfies test-shop session)
- `ALFIES_TEST_API_BASE_URL` (optional; defaults to `https://test-api.alfies.shop/api/v1`)
- `ALFIES_TEST_DEFAULT_LATITUDE` / `ALFIES_TEST_DEFAULT_LONGITUDE` (temporary coordinates used for test-shop session address setup)
- `ALFIES_TEST_SHIPPING_METHOD` (optional; defaults to `standard`)
- `ALFIES_TEST_PRODUCT_MAP_JSON` (optional; curated keyword -> Alfies product id mapping for live basket creation)

Canonical seeded Alfies WhatsApp marketplace resource:

`whatsapp:bot:meta:alfies_whatsapp_marketplace:491234567890`

## Twilio WhatsApp setup

1. Configure a WhatsApp sender in Twilio:
- For testing, use Twilio WhatsApp Sandbox.
- For production, use an approved WhatsApp sender number.

2. Set incoming webhook in Twilio Console:
- Method: `POST`
- URL: `https://<your-host>/twilio/whatsapp/webhook`

3. For local testing with ngrok:
- Run bot locally on `http://localhost:8788`
- Start tunnel: `ngrok http 8788`
- Use ngrok HTTPS URL for Twilio webhook
- If `TWILIO_VALIDATE_SIGNATURE=true`, set `TWILIO_WEBHOOK_PUBLIC_URL` to the exact public webhook URL

## Run

```bash
pnpm --filter @valuya/whatsapp-bot build
pnpm --filter @valuya/whatsapp-bot start
```

## Optional rollout to `@valuya/whatsapp-bot-agent`

The legacy WhatsApp bot can forward traffic to the new agent-based server in a controlled way.

Env vars:

- `WHATSAPP_AGENT_MODE=off|shadow|primary`
- `WHATSAPP_AGENT_BASE_URL=http://127.0.0.1:8789`
- `WHATSAPP_AGENT_ROLLOUT_PERCENT=0..100`
- `WHATSAPP_AGENT_INTERNAL_API_TOKEN=...` (optional shared secret for `/internal/message`)

Modes:

- `off`: legacy bot only
- `shadow`: call the new agent path, log the reply, but still answer with the legacy bot
- `primary`: selected users receive replies from the new agent path

## Message UX

- User sends dish text, e.g. `Paella`
- Optional: user sends `address: Kaiserstrasse 8/7a, 1070 Wien`
- Bot replies with recipe/cart text and instructions:
  - `order` = confirm and pay
  - `alt` = request alternatives
  - `cancel` = cancel active order
  - `status` = show current order status

## Endpoint

- `POST /twilio/whatsapp/webhook`

Twilio webhook payload is form-encoded. The bot validates `X-Twilio-Signature` when `TWILIO_VALIDATE_SIGNATURE=true`.

## Notes

- State persistence is SQLite based (`WHATSAPP_STATE_FILE`).
- The built-in concierge is intentionally deterministic and mock-like for now; Alfies API integration can replace this module without changing the Twilio/payment flow.
- `AlfiesClient` is available for test-shop integration against `https://test-api.alfies.shop/api/v1` for address, basket, shipping, checkout preview, and order status.
- When `ALFIES_TEST_API_ENABLED=true`, the bot will attempt to turn `address: ...` messages into a live Alfies session address and fetch shipping methods using configured default coordinates.
- When `ALFIES_TEST_API_ENABLED=true`, recipe requests first try the locally indexed Alfies catalog, then fall back to `ALFIES_TEST_PRODUCT_MAP_JSON`.
- Import a local Alfies product index with:

```bash
pnpm --filter @valuya/whatsapp-bot import:alfies-catalog ./path/to/alfies-products.json
```

- If your source export is messy, normalize it first:

```bash
pnpm --filter @valuya/whatsapp-bot normalize:alfies-catalog ./raw-products.json ./alfies-products.normalized.json
pnpm --filter @valuya/whatsapp-bot import:alfies-catalog ./alfies-products.normalized.json
```

- The catalog JSON should be an array with entries like:

```json
[
  {
    "product_id": 101,
    "title": "Bio Spaghetti",
    "slug": "bio-spaghetti",
    "price_cents": 299,
    "currency": "EUR",
    "keywords": ["pasta", "spaghetti"],
    "category": "pasta"
  }
]
```

- Capture real semantic turns into suggested eval cases:

```bash
pnpm --filter @valuya/whatsapp-bot understanding:export ./.data/understanding-cases.json 250 --feedback-only
```

- Import reviewed eval cases back into the local SQLite store:

```bash
pnpm --filter @valuya/whatsapp-bot understanding:import ./.data/understanding-cases.json
```

- Replay the current understanding stack against the labeled cases:

```bash
pnpm --filter @valuya/whatsapp-bot understanding:run 500
```

- Or write a machine-readable report for trend tracking:

```bash
pnpm --filter @valuya/whatsapp-bot run understanding:run 500 --json-out ./.data/understanding-report.json
```

- Or write a timestamped historical snapshot and update `latest.json`:

```bash
pnpm --filter @valuya/whatsapp-bot run understanding:run 500 --json-history-dir ./.data/understanding-history
```

- Compare two saved reports:

```bash
node packages/whatsapp-bot/dist/whatsapp-bot/src/understandingEval.js compare ./.data/understanding-report.previous.json ./.data/understanding-report.json
```

- Or compare the newest two historical snapshots automatically:

```bash
pnpm --filter @valuya/whatsapp-bot understanding:compare-latest ./.data/understanding-history
```

This prints:
- overall pass/fail
- family scorecards
- failure-bucket scorecards
- failed cases grouped by family
- failed cases grouped by bucket

The JSON report includes:
- totals
- family scorecards
- failure-bucket scorecards
- failed cases grouped by family
- failed cases grouped by bucket

The compare command prints:
- total pass/fail deltas
- family-level deltas
- failure-bucket deltas

The historical snapshot mode writes:
- `understanding-report-YYYYMMDDTHHMMSSZ.json`
- `latest.json`

- Load the built-in seed cases for the highest-volume grocery families:

```bash
pnpm --filter @valuya/whatsapp-bot understanding:seed
```

- Suggested labeling guide for reviewed cases:

`expected_intent`
: top-level semantic intent like `browse_category`, `recipe_to_cart`, `add_to_cart`

`expected_route_kind`
: backend route like `browse_category`, `recipe_to_cart`, `cart_mutation`, `clarify`

`expected_route_action`
: only for `cart_mutation`, usually `add`, `remove`, or `update`

`expected_selection_mode`
: set `add_to_existing_cart` when a broad follow-up should append rather than replace

`expected_should_clarify`
: set `true` when the bot should ask a focused question instead of acting

`expected_family`
: normalized family/category anchor like `kaese`, `fleisch`, `getraenke`, `household_paper`, `baby`

`catastrophic_mismatch`
: set `true` when a wrong guess would be especially bad and clarification is safer

`suggested_failure_bucket`
: optional reviewer hint for the dominant failure mode, for example:
  `stale_context_hijack`, `wrong_selection_mode`, `invalid_numeric_grounding`,
  `invalid_yes_no_grounding`, `should_have_clarified`, `overconfident_sku_commitment`, `recipe_misrouted`

`governance_summary`
: exported from real traffic only; summarizes why the context-governance layer kept or discarded prior context

- Recommended weekly loop:

1. Export the most recent correction/refinement turns.
2. Review and label the JSON file.
3. Import it back with `understanding:import`.
4. Run `understanding:run`.
5. Fix the worst buckets first: `catastrophic_mismatch`, `stale_context_hijack`, `wrong_selection_mode`, `invalid_numeric_grounding`, and `overconfident_sku_commitment`.

- The built-in seed corpus now includes explicit examples for:
  - topic switches into recipe mode
  - append vs replace failures
  - weak numeric and yes/no grounding
  - broad family browse requests
  - correction turns like `Nein, ich meine ...`
  - occasion requests like `snacks fuer einen Fernsehabend`

- For larger multi-turn German training dialogues, use the dialogue corpus and training pipeline:

The default dialogue corpus now combines the hand-written seed file with a generated German shopping corpus of more than 1000 replayable user turns. It covers:
- broad family browsing like `Kaese`, `Fleisch`, `Milchprodukte`, `Klopapier`, `Baby Nahrung`
- additive follow-ups like `Ich brauche auch Brot`
- replace/narrow turns like `Nur Tegernseer Helles`
- stale-context overrides like `Ich moechte Musaka kochen`
- occasion requests like `Getraenke fuer eine Party mit 8 Leuten`
- correction turns like `Nein, ich meine Frischkaese`

```bash
pnpm --filter @valuya/whatsapp-bot training:seed-dialogues ./dialogue-training.seed.json ./.data/dialogue-eval-cases.json
pnpm --filter @valuya/whatsapp-bot training:run-dialogues ./dialogue-training.seed.json ./.data/dialogue-review.json
pnpm --filter @valuya/whatsapp-bot training:collect-failures ./.data/training-review.json 250
pnpm --filter @valuya/whatsapp-bot training:propose-improvements ./.data/training-review.json ./.data/training-proposals.json
pnpm --filter @valuya/whatsapp-bot training:apply-proposals ./.data/training-proposals.json ./training-accepted-proposals.json
```

The dialogue pipeline is useful for:
- realistic WhatsApp-style multi-turn German shopping conversations
- topic switches like `Ich moechte Musaka kochen`
- append vs replace follow-ups like `Ich brauche auch Brot`
- weak replies like `Ja`, `2`, `mehr`
- correction turns like `Nein, ich meine Frischkaese`

The generated review JSON includes:
- expected fields from the seed dialogue
- actual extracted intent / route / family
- suggested failure bucket
- a pending review status for human labeling

The generated proposal JSON clusters failing review entries by failure bucket and family, then suggests:
- family aliases to add or review
- deterministic guard phrases to tighten
- prompt examples for the extraction layer
- new seed cases to add to the eval corpus

To accept reviewed proposals, set `review_status` to `accepted` in the proposal JSON and run:

```bash
pnpm --filter @valuya/whatsapp-bot training:apply-proposals ./.data/training-proposals.json ./training-accepted-proposals.json
```

This writes [training-accepted-proposals.json](/home/colt/Software/valuya-guard/packages/whatsapp-bot/training-accepted-proposals.json)-style data containing:
- `accepted_aliases_by_family`
- `accepted_seed_dialogues`
- `accepted_prompt_examples`

Those accepted aliases and seed dialogues are automatically merged into the default generated training corpus on the next:
- `training:seed-dialogues`
- `training:run-dialogues`

Accepted family aliases are also merged into the live runtime family/category signals, so reviewed terms like `WC Papier`, `Toilettenrolle`, or new family synonyms can improve actual bot matching, not just offline replay coverage.

Recommended end-to-end training loop:

1. Build a replayable eval set from the seed corpus:
   `pnpm --filter @valuya/whatsapp-bot training:seed-dialogues`
2. Run the generated dialogues against the current extractor/router/governance stack:
   `pnpm --filter @valuya/whatsapp-bot training:run-dialogues`
3. Collect real failed traffic from production or staging:
   `pnpm --filter @valuya/whatsapp-bot training:collect-failures`
4. Cluster the failed review entries into concrete proposals:
   `pnpm --filter @valuya/whatsapp-bot training:propose-improvements`
5. Review the generated proposal JSON and accept the useful:
   - aliases
   - guard phrases
   - prompt examples
   - new seed cases
6. Add accepted improvements into code, prompts, or the seed corpus.
7. Re-run:
   - `pnpm --filter @valuya/whatsapp-bot test`
   - `pnpm --filter @valuya/whatsapp-bot understanding:run 500 --json-history-dir ./.data/understanding-history`

- The normalizer accepts looser source fields too, for example `id`, `name`, `price`, `category_name`, `brand`, `tags`, and `available`.
- When the local index has no match, `ALFIES_TEST_PRODUCT_MAP_JSON` remains the fallback.
- OpenAI is used only for intent/slot extraction when configured. Basket/payment/checkout execution remains tool- and code-driven.

Example `ALFIES_TEST_PRODUCT_MAP_JSON`:

```json
[
  {
    "label": "Pasta Bundle",
    "match": ["pasta", "spaghetti"],
    "products": [
      { "id": 101, "quantity": 1 },
      { "id": 202, "quantity": 1 }
    ]
  },
  {
    "label": "Snack Night",
    "match": ["snacks", "movie night"],
    "products": [
      { "id": 303, "quantity": 2 }
    ]
  }
]
```
- Outbound helper exists (`sendProactiveWhatsApp`) and can be used for proactive notifications.
- Keep `VALUYA_ORDER_RESOURCE` separate from `WHATSAPP_PAID_CHANNEL_RESOURCE`. The first is the resource used for marketplace order creation, delegated payment, and entitlement polling. The second is only for paid WhatsApp-channel access.
- Do not use `alfies.order` for payment or entitlement polling. If entitlements returns `product_not_registered`, treat that as a wrong resource configuration issue.
- Payment correlation logs use `event: "payment_trace"` with `trace_kind: "payment_correlation"`. Grep by `local_order_id` to collect the full subject/resource/plan/order tuple for backend debugging.
