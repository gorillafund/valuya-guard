# github.com/valuya/go-guard

Go `net/http` middleware for Valuya Guard.

## Install

```bash
go get github.com/valuya/go-guard
```

## Usage

```go
mux := http.NewServeMux()
mux.HandleFunc("/premium", func(w http.ResponseWriter, r *http.Request) {
  w.Write([]byte(`{"ok":true}`))
})

guarded := guard.Middleware(guard.Config{
  Base:        os.Getenv("VALUYA_BASE"),
  TenantToken: os.Getenv("VALUYA_TENANT_TOKEN"),
  DefaultPlan: "standard",
  WebRedirect: true,
})(mux)
```

Behavior:
- HTML => 302 redirect when payment is required
- API => 402 payment_required JSON
