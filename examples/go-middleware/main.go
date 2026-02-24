package main

import (
	"net/http"
	"os"

	"github.com/valuya/go-middleware/guard"
)

func main() {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	})

	h := guard.Middleware(guard.MiddlewareConfig{
		Base: os.Getenv("VALUYA_BASE"),
		TenantToken: os.Getenv("VALUYA_TENANT_TOKEN"),
		Plan: "pro",
	}, next)

	http.ListenAndServe(":8080", h)
}
