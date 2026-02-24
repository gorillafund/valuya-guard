from fastapi import FastAPI
from valuya_fastapi import ValuyaGuardMiddleware

app = FastAPI()
app.add_middleware(ValuyaGuardMiddleware, plan="pro")

@app.get("/premium")
def premium():
    return {"ok": True}
