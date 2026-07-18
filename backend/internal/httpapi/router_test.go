package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealth(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	response := httptest.NewRecorder()
	NewRouter(Config{FrontendOrigin: "http://localhost:5173"}).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
}

func TestGenerateRejectsEmptyTopic(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":""}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewRouter(Config{}).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
}

func TestGenerateReturnsStaticSample(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":"学校の写真部"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewRouter(Config{}).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"provider":"static-sample"`) {
		t.Fatalf("expected static sample response, got %s", response.Body.String())
	}
}
