# AWS Lambda Integration

## Works with
- Lambda URLs (fastest)
- API Gateway HTTP API (Lambda proxy)
- ALB

## Behavior
- allowed → handler runs
- denied → 402 JSON with:
  - payment_url
  - session_id
  - required
  - evaluated_plan
  - resource

## Minimal env
- VALUYA_BASE
- DEFAULT_PLAN
- (optional) VALUYA_SITE_TOKEN

