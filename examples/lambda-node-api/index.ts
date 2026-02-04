import { withValuya } from "@valuya/aws-lambda-node"

export const handler = withValuya(
  { resource: "aws:lambda:demo:api:v1", plan: "pro" },
  async () => ({
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: true,
      data: [
        { id: 1, name: "Immovatic Demo Asset", apy: "7.2%" },
        { id: 2, name: "Energy Transition Basket", apy: "5.9%" },
      ],
    }),
  }),
)
