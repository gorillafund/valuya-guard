package guard

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type Subject struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type Config struct {
	Base            string
	TenantToken     string
	DefaultPlan     string
	DefaultResource string
	WebRedirect     bool
	SubjectResolver func(r *http.Request) Subject
	HTTPClient      *http.Client
}

type entitlementsResponse struct {
	Active        bool            `json:"active"`
	Reason        string          `json:"reason"`
	EvaluatedPlan string          `json:"evaluated_plan"`
	Required      json.RawMessage `json:"required"`
}

type checkoutSession struct {
	SessionID  string `json:"session_id"`
	PaymentURL string `json:"payment_url"`
}

func Middleware(cfg Config) func(http.Handler) http.Handler {
	if cfg.DefaultPlan == "" {
		cfg.DefaultPlan = "standard"
	}
	if cfg.SubjectResolver == nil {
		cfg.SubjectResolver = defaultSubject
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = http.DefaultClient
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			subject := cfg.SubjectResolver(r)
			resource := cfg.DefaultResource
			if resource == "" {
				resource = fmt.Sprintf("http:route:%s:%s", strings.ToUpper(r.Method), r.URL.Path)
			}

			ent, err := fetchEntitlements(cfg, subject, resource)
			if err != nil {
				writeJSON(w, 503, map[string]any{"ok": false, "error": "valuya_guard_unavailable"})
				return
			}
			if ent.Active {
				next.ServeHTTP(w, r)
				return
			}

			required := map[string]any{"type": "subscription", "plan": cfg.DefaultPlan}
			if len(ent.Required) > 0 {
				_ = json.Unmarshal(ent.Required, &required)
			}

			evaluated := ent.EvaluatedPlan
			if evaluated == "" {
				evaluated = cfg.DefaultPlan
			}

			session, err := createCheckout(cfg, subject, resource, required, evaluated)
			if err != nil {
				writeJSON(w, 503, map[string]any{"ok": false, "error": "valuya_guard_unavailable"})
				return
			}

			if cfg.WebRedirect && wantsHTML(r) && session.PaymentURL != "" {
				w.Header().Set("Location", session.PaymentURL)
				w.Header().Set("X-Valuya-Session-Id", session.SessionID)
				w.WriteHeader(http.StatusFound)
				return
			}

			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Valuya-Payment-Url", session.PaymentURL)
			w.Header().Set("X-Valuya-Session-Id", session.SessionID)
			w.Header().Set("Access-Control-Expose-Headers", "X-Valuya-Payment-Url, X-Valuya-Session-Id")
			writeJSON(w, http.StatusPaymentRequired, map[string]any{
				"error":          "payment_required",
				"reason":         ent.Reason,
				"required":       required,
				"evaluated_plan": evaluated,
				"resource":       resource,
				"session_id":     session.SessionID,
				"payment_url":    session.PaymentURL,
			})
		})
	}
}

func fetchEntitlements(cfg Config, subject Subject, resource string) (entitlementsResponse, error) {
	var out entitlementsResponse
	u, _ := url.Parse(strings.TrimRight(cfg.Base, "/") + "/api/v2/entitlements")
	q := u.Query()
	q.Set("plan", cfg.DefaultPlan)
	q.Set("resource", resource)
	u.RawQuery = q.Encode()

	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	applyHeaders(req, cfg, subject)
	res, err := cfg.HTTPClient.Do(req)
	if err != nil {
		return out, err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 400 {
		return out, fmt.Errorf("valuya_entitlements_failed:%d:%s", res.StatusCode, string(b))
	}
	if len(b) == 0 {
		return out, nil
	}
	return out, json.Unmarshal(b, &out)
}

func createCheckout(cfg Config, subject Subject, resource string, required map[string]any, plan string) (checkoutSession, error) {
	var out checkoutSession
	payload := map[string]any{
		"resource":       resource,
		"plan":           plan,
		"evaluated_plan": plan,
		"subject":        subject,
		"principal":      subject,
		"required":       required,
		"mode":           "agent",
	}
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, strings.TrimRight(cfg.Base, "/")+"/api/v2/checkout/sessions", bytes.NewReader(b))
	applyHeaders(req, cfg, subject)
	req.Header.Set("Content-Type", "application/json")
	res, err := cfg.HTTPClient.Do(req)
	if err != nil {
		return out, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 400 {
		return out, fmt.Errorf("valuya_checkout_failed:%d:%s", res.StatusCode, string(body))
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return out, err
	}
	if out.SessionID == "" {
		return out, fmt.Errorf("valuya_checkout_invalid_response")
	}
	return out, nil
}

func applyHeaders(req *http.Request, cfg Config, subject Subject) {
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.TenantToken)
	req.Header.Set("X-Valuya-Subject-Id", fmt.Sprintf("%s:%s", subject.Type, subject.ID))
}

func defaultSubject(r *http.Request) Subject {
	raw := r.Header.Get("X-Valuya-Subject-Id")
	if strings.Contains(raw, ":") {
		parts := strings.SplitN(raw, ":", 2)
		return Subject{Type: parts[0], ID: parts[1]}
	}
	anon := r.Header.Get("X-Valuya-Anon-Id")
	if anon == "" {
		anon = "unknown"
	}
	return Subject{Type: "anon", ID: anon}
}

func wantsHTML(r *http.Request) bool {
	return strings.Contains(strings.ToLower(r.Header.Get("Accept")), "text/html")
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
