# go-middleware

Go net/http middleware for Valuya Guard.

```go
mux := http.NewServeMux()
mux.Handle("/premium", guard.Middleware(guard.MiddlewareConfig{
  Base: "https://pay.gorilla.build",
  TenantToken: os.Getenv("VALUYA_TENANT_TOKEN"),
  Plan: "pro",
}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
  w.Header().Set("Content-Type", "application/json")
  w.Write([]byte(`{"ok":true}`))
})))
```
