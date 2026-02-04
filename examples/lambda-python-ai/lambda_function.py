from valuya_guard import valuya_protect

@valuya_protect(resource="aws:lambda:demo:ai:v1", plan="pro")
def handler(event, context):
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json; charset=utf-8"},
        "body": '{"ok":true,"chat":{"messages":[{"role":"assistant","content":"✅ AI window active."}]}}'
    }
