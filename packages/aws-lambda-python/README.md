# valuya-guard (AWS Lambda Python)

Payment-aware authorization adapter for AWS Lambda.

## Install

```bash
pip install valuya-guard
```

## Usage

```python
from valuya_guard import valuya_protect

@valuya_protect(resource="aws:lambda:demo:api:v1", plan="pro")
def handler(event, context):
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json; charset=utf-8"},
        "body": "{\"ok\":true}"
    }
```

## Environment

```env
VALUYA_BASE=https://pay.gorilla.build
VALUYA_SITE_TOKEN=ttok_...
VALUYA_PLAN=pro
```

Behavior:
- entitlement active -> handler runs
- entitlement missing -> `402` with Valuya payment headers/body
