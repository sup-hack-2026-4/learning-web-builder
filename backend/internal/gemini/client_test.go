package gemini

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGenerateReturnsValidatedModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1beta/models/gemini-test:generateContent" {
			t.Errorf("unexpected request path: %s", request.URL.Path)
		}
		if request.Header.Get("x-goog-api-key") != "test-key" {
			t.Error("expected API key header")
		}

		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		generationConfig, ok := body["generationConfig"].(map[string]any)
		if !ok {
			t.Error("expected generationConfig")
		}
		if _, exists := generationConfig["responseSchema"]; exists {
			t.Error("responseSchema must not be sent")
		}
		responseSchema, ok := generationConfig["responseJsonSchema"].(map[string]any)
		if !ok {
			t.Fatal("expected responseJsonSchema")
		}
		if responseSchema["type"] != "object" {
			t.Errorf("expected JSON Schema object type, got %#v", responseSchema["type"])
		}
		if responseSchema["additionalProperties"] != false {
			t.Error("expected unknown properties to be rejected")
		}

		writeCandidate(t, writer, `{
			"siteTitle":"学校の写真部",
			"tagline":"写真で学校の日常を記録します。",
			"theme":{"primary":"#2563eb","background":"#f8fafc","text":"#172033","fontFamily":"sans","spacing":6},
			"sections":[
				{"id":"hero","kind":"hero","title":"学校の写真部","body":"活動を紹介します。","imageAlt":"","visible":true},
				{"id":"about","kind":"about","title":"私たちについて","body":"写真を学んでいます。","imageAlt":"撮影中の部員","visible":true}
			]
		}`)
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:     "test-key",
		Model:      "gemini-test",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("create client: %v", err)
	}

	model, err := client.Generate(context.Background(), "学校の写真部")
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if model.ID == "" {
		t.Error("expected server-generated ID")
	}
	if model.Topic != "学校の写真部" {
		t.Errorf("unexpected topic: %s", model.Topic)
	}
}

func TestGenerateRejectsUnknownGeneratedField(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writeCandidate(t, writer, `{
			"siteTitle":"写真部",
			"tagline":"",
			"theme":{"primary":"#2563eb","background":"#f8fafc","text":"#172033","fontFamily":"sans","spacing":6},
			"sections":[
				{"id":"hero","kind":"hero","title":"写真部","body":"","imageAlt":"","visible":true},
				{"id":"about","kind":"about","title":"紹介","body":"","imageAlt":"","visible":true}
			],
			"unexpected":"value"
		}`)
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:     "test-key",
		Model:      "gemini-test",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("create client: %v", err)
	}

	_, err = client.Generate(context.Background(), "写真部")
	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected unknown field error, got %v", err)
	}
}

func TestGenerateRejectsHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"error": map[string]any{
				"code":    http.StatusBadRequest,
				"message": "Invalid JSON payload received.\nUnknown name responseSchema.",
				"status":  "INVALID_ARGUMENT",
			},
		})
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:     "test-key",
		Model:      "gemini-test",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("create client: %v", err)
	}

	_, err = client.Generate(context.Background(), "写真部")
	if err == nil ||
		!strings.Contains(err.Error(), "HTTP 400") ||
		!strings.Contains(err.Error(), "status=INVALID_ARGUMENT") ||
		!strings.Contains(err.Error(), "message=Invalid JSON payload received. Unknown name responseSchema.") {
		t.Fatalf("expected HTTP error, got %v", err)
	}
}

func writeCandidate(t *testing.T, writer http.ResponseWriter, generatedJSON string) {
	t.Helper()
	writer.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(writer).Encode(map[string]any{
		"candidates": []any{
			map[string]any{
				"content": map[string]any{
					"parts": []any{map[string]any{"text": generatedJSON}},
				},
			},
		},
	}); err != nil {
		t.Fatalf("encode response: %v", err)
	}
}
