from valuya_guard import valuya_protect

@valuya_protect(resource="aws:lambda:demo:api:v1", plan="pro")
def handler(event, context):
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json; charset=utf-8"},
        "body": '{"ok":true,"data":[{"id":1,"name":"Immovatic Demo Asset"}]}'
    }
