# Valuya Guard (AWS Lambda)

Payment-aware authorization for AWS Lambda (Node + Python).

- If access is allowed → runs Lambda handler
- If not allowed → returns 402 with `payment_url` + `session_id`
- After payment → retry → allowed

## Env
- VALUYA_BASE=https://pay.gorilla.build
- VALUYA_SITE_TOKEN=wp_site_... (optional but recommended)
- DEFAULT_PLAN=pro

## Node example
```ts
import { withValuya } from "@valuya/aws-lambda-node";

export const handler = withValuya(
  { resource: "aws:lambda:demo:api:v1", plan: "pro" },
  async () => ({ statusCode: 200, body: JSON.stringify({ ok: true }) })
);

