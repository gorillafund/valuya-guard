package main

import (
	"net/http"
	"os"

	"github.com/valuya/go-guard/guard"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/premium", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	h := guard.Middleware(guard.Config{
		Base:        os.Getenv("VALUYA_BASE"),
		TenantToken: os.Getenv("VALUYA_TENANT_TOKEN"),
		DefaultPlan: "standard",
		WebRedirect: true,
	})(mux)

	_ = http.ListenAndServe(":8080", h)
}
