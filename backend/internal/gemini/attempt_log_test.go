package gemini

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/concept"
)

func writeCandidateWithUsage(t *testing.T, writer http.ResponseWriter, generatedJSON string) {
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
		"usageMetadata": map[string]any{
			"thoughtsTokenCount":   42,
			"candidatesTokenCount": 310,
		},
	}); err != nil {
		t.Fatalf("encode response: %v", err)
	}
}

// attemptLines は、ログのうち送信ごとの行だけを取り出す。
func attemptLines(output string) []string {
	var lines []string
	for line := range strings.SplitSeq(output, "\n") {
		if strings.Contains(line, "gemini attempt ") {
			lines = append(lines, line)
		}
	}
	return lines
}

func TestGenerateLogsEachAttemptWithElapsedTime(t *testing.T) {
	logs := captureLog(t)
	primaryRequestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		primaryRequestCount++
		if primaryRequestCount == 1 {
			writer.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		writeCandidateWithUsage(t, writer, validGeneratedSite)
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:     "test-key",
		Model:      "gemini-primary",
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
	})
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	recordWaits(client)

	if _, err := client.Generate(context.Background(), "学校の写真部", concept.Draft{}); err != nil {
		t.Fatalf("generate: %v", err)
	}

	lines := attemptLines(logs.String())
	if len(lines) != 2 {
		t.Fatalf("expected 2 attempt lines, got %d: %q", len(lines), logs.String())
	}
	elapsedPattern := regexp.MustCompile(` elapsed=[0-9.]+(ns|µs|ms|s)\b`)
	for _, line := range lines {
		if !elapsedPattern.MatchString(line) {
			t.Fatalf("expected elapsed time in %q", line)
		}
	}
	if !strings.Contains(lines[0], "model=gemini-primary attempt=1 result=http_503") {
		t.Fatalf("unexpected first attempt line: %q", lines[0])
	}
	if !strings.Contains(lines[1], "model=gemini-primary attempt=2 result=ok") ||
		!strings.HasSuffix(lines[1], "thoughts_tokens=42 output_tokens=310") {
		t.Fatalf("unexpected second attempt line: %q", lines[1])
	}
	if strings.Contains(logs.String(), "test-key") {
		t.Fatalf("API key must not be logged: %q", logs.String())
	}
}

func TestGenerateLogsPrimaryTimeoutBeforeFallback(t *testing.T) {
	logs := captureLog(t)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1beta/models/gemini-primary:generateContent":
			// 主モデルの持ち時間（50ms）より長く止まる。
			time.Sleep(200 * time.Millisecond)
		case "/v1beta/models/gemini-fallback:generateContent":
			writeCandidateWithUsage(t, writer, validGeneratedSite)
		default:
			t.Errorf("unexpected request path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:        "test-key",
		Model:         "gemini-primary",
		FallbackModel: "gemini-fallback",
		BaseURL:       server.URL,
		HTTPClient:    server.Client(),
	})
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	client.primaryModelTimeout = 50 * time.Millisecond
	client.generationTimeout = 5 * time.Second

	if _, err := client.Generate(context.Background(), "学校の写真部", concept.Draft{}); err != nil {
		t.Fatalf("generate after primary timeout: %v", err)
	}

	lines := attemptLines(logs.String())
	if len(lines) != 2 {
		t.Fatalf("expected 2 attempt lines, got %d: %q", len(lines), logs.String())
	}
	if !strings.Contains(lines[0], "model=gemini-primary attempt=1 result=deadline_exceeded") {
		t.Fatalf("unexpected primary attempt line: %q", lines[0])
	}
	if !strings.Contains(lines[1], "model=gemini-fallback attempt=1 result=ok") {
		t.Fatalf("unexpected fallback attempt line: %q", lines[1])
	}
}

func TestUsageFieldsIgnoresUnreadableBody(t *testing.T) {
	if got := usageFields([]byte("not json")); got != "" {
		t.Fatalf("expected empty usage fields, got %q", got)
	}
	if got := usageFields([]byte(`{}`)); got != "thoughts_tokens=0 output_tokens=0" {
		t.Fatalf("unexpected usage fields: %q", got)
	}
}
