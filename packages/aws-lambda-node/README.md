# Valuya Guard – AWS Lambda Integration

This package enables **headless entitlement checks and payments**
for AWS Lambda APIs using Valuya Guard.

The Lambda never renders UI. It only:

1. Checks entitlements
2. Creates checkout sessions if required
3. Returns structured JSON responses

---

## Environment Variables

```env
VALUYA_BASE=https://pay.example.com
VALUYA_TENANT_TOKEN=vt_xxx
```
