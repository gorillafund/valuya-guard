package guard

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMiddlewareAllowsWhenActive(t *testing.T) {
	client := &http.Client{Transport: mockTransport(func(r *http.Request) (*http.Response, error) {
		if strings.Contains(r.URL.Path, "/entitlements") {
			return jsonResponse(200, `{"active":true,"evaluated_plan":"standard"}`), nil
		}
		return jsonResponse(404, `{"error":"not_found"}`), nil
	})}

	h := Middleware(Config{Base: "https://pay.example", TenantToken: "ttok", WebRedirect: true, HTTPClient: client})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))

	req := httptest.NewRequest(http.MethodGet, "/premium", nil)
	req.Header.Set("X-Valuya-Subject-Id", "user:1")
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)

	if res.Code != 200 {
		t.Fatalf("expected 200, got %d", res.Code)
	}
}

func TestMiddlewareDenyAPI402(t *testing.T) {
	client := &http.Client{Transport: mockTransport(func(r *http.Request) (*http.Response, error) {
		switch {
		case strings.Contains(r.URL.Path, "/entitlements"):
			return jsonResponse(200, `{"active":false,"reason":"subscription_inactive","required":{"type":"subscription","plan":"standard"},"evaluated_plan":"standard"}`), nil
		case strings.Contains(r.URL.Path, "/checkout/sessions"):
			return jsonResponse(200, `{"session_id":"cs_1","payment_url":"https://pay.example/1"}`), nil
		default:
			return jsonResponse(404, `{"error":"not_found"}`), nil
		}
	})}

	h := Middleware(Config{Base: "https://pay.example", TenantToken: "ttok", WebRedirect: true, HTTPClient: client})(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(200)
	}))

	req := httptest.NewRequest(http.MethodGet, "/premium", nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Valuya-Subject-Id", "user:1")
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)

	if res.Code != 402 {
		t.Fatalf("expected 402, got %d", res.Code)
	}
	body, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(body), "payment_required") {
		t.Fatalf("expected payment_required body, got %s", string(body))
	}
}

type mockTransport func(*http.Request) (*http.Response, error)

func (m mockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return m(req)
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(bytes.NewBufferString(body)), Header: make(http.Header)}
}
