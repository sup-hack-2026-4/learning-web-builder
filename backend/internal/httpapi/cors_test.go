package httpapi

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestParseAllowedOrigins(t *testing.T) {
	origins, err := ParseAllowedOrigins(" http://localhost:5173/, https://example.pages.dev,https://example.pages.dev ")
	if err != nil {
		t.Fatalf("parse origins: %v", err)
	}

	expected := []string{"http://localhost:5173", "https://example.pages.dev"}
	if !reflect.DeepEqual(origins, expected) {
		t.Fatalf("expected %#v, got %#v", expected, origins)
	}
}

func TestParseAllowedOriginsRejectsURLPath(t *testing.T) {
	_, err := ParseAllowedOrigins("https://example.pages.dev/app")
	if err == nil {
		t.Fatal("expected invalid origin error")
	}
}

func TestCORSAllowsConfiguredOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	request.Header.Set("Origin", "https://EXAMPLE.pages.dev")
	response := httptest.NewRecorder()
	NewRouter(Config{AllowedOrigins: []string{"https://example.pages.dev"}}).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if value := response.Header().Get("Access-Control-Allow-Origin"); value != "https://example.pages.dev" {
		t.Fatalf("unexpected allowed origin header: %q", value)
	}
	if !headerContains(response.Header().Values("Vary"), "Origin") {
		t.Fatalf("expected Vary: Origin, got %v", response.Header().Values("Vary"))
	}
}

// 公開しないと、別オリジンの画面はRetry-Afterを読めず、待ち時間を伝えられない(#133)。
// 回数制限と混雑で実際に断った応答に、待ち時間と公開の指定がそろって付くことを確かめる。
func TestCORSExposesRetryAfterOnRefusedAIRequests(t *testing.T) {
	const origin = "https://example.pages.dev"
	generate := func(handler http.Handler) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":"植物園"}`))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	assertReadableRetryAfter := func(t *testing.T, response *httptest.ResponseRecorder, expectedCode int) {
		t.Helper()
		if response.Code != expectedCode {
			t.Fatalf("expected %d, got %d: %s", expectedCode, response.Code, response.Body.String())
		}
		if value := response.Header().Get("Retry-After"); value == "" {
			t.Error("expected Retry-After on the refused response")
		}
		if !headerContains(response.Header().Values("Access-Control-Expose-Headers"), "Retry-After") {
			t.Errorf("expected Retry-After to be exposed, got %v", response.Header().Values("Access-Control-Expose-Headers"))
		}
		if value := response.Header().Get("Access-Control-Allow-Origin"); value != origin {
			t.Errorf("unexpected allowed origin header: %q", value)
		}
	}

	t.Run("回数制限(429)", func(t *testing.T) {
		router := NewRouter(Config{AllowedOrigins: []string{origin}, Generator: &stubGenerator{}})
		for attempt := 1; attempt <= aiRequestsPerWindow; attempt++ {
			if response := generate(router); response.Code != http.StatusOK {
				t.Fatalf("request %d should be within the limit, got %d", attempt, response.Code)
			}
		}
		assertReadableRetryAfter(t, generate(router), http.StatusTooManyRequests)
	})

	t.Run("混雑(503)", func(t *testing.T) {
		// 同時実行の枠を埋めておく。
		slots := make(chan struct{}, 1)
		slots <- struct{}{}
		limited := limitAIUsage(newRateLimiter(aiRequestsPerWindow, aiRateLimitWindow), slots, 0)
		handler := cors([]string{origin})(limited(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			t.Error("the handler must not run while all slots are in use")
		})))
		assertReadableRetryAfter(t, generate(handler), http.StatusServiceUnavailable)
	})
}

func TestCORSRejectsUnconfiguredOrigin(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	request.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	NewRouter(Config{AllowedOrigins: []string{"https://example.pages.dev"}}).ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", response.Code, response.Body.String())
	}
	if value := response.Header().Get("Access-Control-Allow-Origin"); value != "" {
		t.Fatalf("expected no allowed origin header, got %q", value)
	}
}

func TestCORSAllowsValidPreflight(t *testing.T) {
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/generate", nil)
	request.Header.Set("Origin", "https://example.pages.dev")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "authorization, content-type")
	response := httptest.NewRecorder()
	NewRouter(Config{AllowedOrigins: []string{"https://example.pages.dev"}}).ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", response.Code, response.Body.String())
	}
	if value := response.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(value, http.MethodPost) {
		t.Fatalf("expected POST in allowed methods, got %q", value)
	}
	if value := response.Header().Get("Access-Control-Max-Age"); value != "600" {
		t.Fatalf("expected max age 600, got %q", value)
	}
}

func TestCORSRejectsUnapprovedPreflightHeader(t *testing.T) {
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/generate", nil)
	request.Header.Set("Origin", "https://example.pages.dev")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "x-admin-token")
	response := httptest.NewRecorder()
	NewRouter(Config{AllowedOrigins: []string{"https://example.pages.dev"}}).ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", response.Code, response.Body.String())
	}
}

func TestCORSAllowsOriginlessRequest(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	response := httptest.NewRecorder()
	NewRouter(Config{}).ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
}

func headerContains(values []string, expected string) bool {
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			if strings.EqualFold(strings.TrimSpace(item), expected) {
				return true
			}
		}
	}
	return false
}
