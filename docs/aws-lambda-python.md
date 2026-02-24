# AWS Lambda Python Adapter

Use `valuya_guard.valuya_protect` to enforce Valuya Guard in Lambda handlers.

```py
from valuya_guard import valuya_protect

@valuya_protect(resource="aws:lambda:demo:api:v1", plan="pro")
def handler(event, context):
    return {"statusCode": 200, "body": '{"ok":true}'}
```
