# Valuya Guard Gateway

Minimal reverse-proxy auth gateway for Valuya Guard.

## Env

- `VALUYA_BASE`
- `VALUYA_TENANT_TOKEN`
- `VALUYA_PLAN` (default `standard`)
- `VALUYA_RESOURCE` (optional)
- `VALUYA_WEB_REDIRECT` (default `true`)

## Endpoint

- `GET/POST /guard/check`

Returns:
- `200` allow
- `302` redirect for web requests when payment required
- `402` canonical JSON for API requests when payment required
