# Contract Harness

Shared contract tests assert canonical guard behavior:

- allow response
- deny response with checkout
- HTML accept => redirect
- JSON accept => 402 payload
- missing subject fails closed
- backend timeout fails closed
- invalid tenant token fails closed

Current implementations wired:

- gateway (`tests/contract/gateway.contract.test.mjs`)

Add additional adapters by implementing:

- `arrange({ mode })`
- `invoke(state, requestArgs)`

and calling `runContractSuite(...)`.
