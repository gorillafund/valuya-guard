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

type MiddlewareConfig struct {
	Base            string
	TenantToken     string
	Plan            string
	Resource        string
	SubjectResolver func(r *http.Request) Subject
}

type entitlementsResponse struct {
	Active        bool            `json:"active"`
	Reason        string          `json:"reason"`
	EvaluatedPlan string          `json:"evaluated_plan"`
	Required      json.RawMessage `json:"required"`
}

func Middleware(cfg MiddlewareConfig, next http.Handler) http.Handler {
	if cfg.Plan == "" {
		cfg.Plan = "pro"
	}
	if cfg.SubjectResolver == nil {
		cfg.SubjectResolver = defaultSubject
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		subject := cfg.SubjectResolver(r)
		resource := cfg.Resource
		if resource == "" {
			resource = fmt.Sprintf("http:route:%s:%s", strings.ToUpper(r.Method), r.URL.Path)
		}

		ent, err := fetchEntitlements(cfg, subject, resource)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		if ent.Active {
			next.ServeHTTP(w, r)
			return
		}

		required := map[string]any{"type": "subscription", "plan": cfg.Plan}
		if len(ent.Required) > 0 {
			_ = json.Unmarshal(ent.Required, &required)
		}
		evaluated := ent.EvaluatedPlan
		if evaluated == "" {
			evaluated = cfg.Plan
		}

		session, err := createCheckout(cfg, subject, resource, required, evaluated)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Valuya-Payment-Url", session.PaymentURL)
		w.Header().Set("X-Valuya-Session-Id", session.SessionID)
		w.WriteHeader(http.StatusPaymentRequired)
		_ = json.NewEncoder(w).Encode(map[string]any{
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

type checkoutSession struct {
	SessionID  string `json:"session_id"`
	PaymentURL string `json:"payment_url"`
}

func fetchEntitlements(cfg MiddlewareConfig, subject Subject, resource string) (entitlementsResponse, error) {
	var out entitlementsResponse
	u, _ := url.Parse(strings.TrimRight(cfg.Base, "/") + "/api/v2/entitlements")
	q := u.Query()
	q.Set("plan", cfg.Plan)
	q.Set("resource", resource)
	u.RawQuery = q.Encode()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	applyHeaders(req, cfg, subject)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("valuya_entitlements_failed:%d:%s", resp.StatusCode, string(b))
	}
	if len(b) == 0 {
		return out, nil
	}
	return out, json.Unmarshal(b, &out)
}

func createCheckout(cfg MiddlewareConfig, subject Subject, resource string, required map[string]any, plan string) (checkoutSession, error) {
	var out checkoutSession
	payload := map[string]any{
		"plan":           plan,
		"evaluated_plan": plan,
		"resource":       resource,
		"subject":        subject,
		"required":       required,
		"currency":       "EUR",
		"amount_cents":   1,
	}
	b, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, strings.TrimRight(cfg.Base, "/")+"/api/v2/checkout/sessions", bytes.NewReader(b))
	applyHeaders(req, cfg, subject)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return out, fmt.Errorf("valuya_checkout_failed:%d:%s", resp.StatusCode, string(body))
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return out, err
	}
	if out.SessionID == "" {
		return out, fmt.Errorf("valuya_checkout_invalid_response")
	}
	return out, nil
}

func applyHeaders(req *http.Request, cfg MiddlewareConfig, subject Subject) {
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Valuya-Subject-Id", fmt.Sprintf("%s:%s", subject.Type, subject.ID))
	req.Header.Set("X-Valuya-Subject-Type", subject.Type)
	req.Header.Set("X-Valuya-Subject-Id-Raw", subject.ID)
	if cfg.TenantToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.TenantToken)
	}
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
