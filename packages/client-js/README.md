# @valuya/client-js

Browser/client helper for Valuya Guard `402 payment_required` handling.

```ts
import { fetchWithValuya, redirectToPayment } from "@valuya/client-js"

const res = await fetchWithValuya("/api/premium")
if (!res.ok && res.status === 402) {
  redirectToPayment(res.payment)
}
```
