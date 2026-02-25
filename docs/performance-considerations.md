# Performance Considerations

## Request path overhead

Guarded requests add one upstream entitlements call on the critical path.

Typical impact drivers:

- network RTT to guard backend
- timeout/retry policy
- subject/resource resolver complexity

## Recommended defaults

- timeout: 5-10s
- retries: 1-2 attempts on retryable failures
- backoff: short fixed or bounded exponential (e.g., `300,1200` ms)

## Caching strategy

- Cache positive entitlement decisions briefly where acceptable.
- Keep deny decisions uncached or short-lived to avoid stale payment state.
- Avoid long caching on identity-dependent resources unless strongly scoped.

## Horizontal scaling

- Middleware/adapters are stateless and scale with app instances.
- Gateway service is stateless and can be horizontally scaled behind LB.

## Throughput guidance

- Benchmark with realistic subject diversity and deny ratios.
- Track p50/p95 for:
  - entitlements request latency
  - checkout creation latency
  - gateway total overhead

## Reverse-proxy mode notes

- Proxy + gateway adds one extra hop; keep gateway near upstream service.
- Propagate trace/request IDs end-to-end for latency analysis.
