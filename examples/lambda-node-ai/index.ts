import { withValuya } from "@valuya/aws-lambda-node"

export const handler = withValuya(
  { resource: "aws:lambda:demo:ai:v1", plan: "pro" },
  async () => ({
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: true,
      chat: {
        messages: [
          {
            role: "assistant",
            content: "✅ AI window active. Ask me anything.",
          },
          {
            role: "assistant",
            content: "Demo: I can produce a 1-page memo + risk bullets.",
          },
        ],
      },
    }),
  }),
)
