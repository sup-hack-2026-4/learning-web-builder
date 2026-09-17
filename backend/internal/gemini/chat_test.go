package gemini

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/concept"
)

const validChatCandidate = `{
	"reply":"どんな人に一番読んでほしいですか。",
	"choices":["近所の家族連れ","植物が好きな大人"],
	"draft":{"topic":"地域の小さな植物園","audience":"","goal":"","tone":"","mustInclude":[]}
}`

func newChatClient(t *testing.T, serverURL string) *Client {
	t.Helper()
	client, err := NewClient(Config{
		APIKey:     "test-key",
		Model:      "gemini-test",
		BaseURL:    serverURL,
		HTTPClient: &http.Client{Timeout: 5 * time.Second},
	})
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	return client
}

func TestChatSendsRoleTaggedHistory(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		writeCandidate(t, writer, validChatCandidate)
	}))
	defer server.Close()

	client := newChatClient(t, server.URL)
	_, err := client.Chat(
		context.Background(),
		[]concept.Message{
			{Role: concept.RoleUser, Text: "地域の小さな植物園"},
			{Role: concept.RoleModel, Text: "どんな人に読んでほしいですか。"},
			{Role: concept.RoleUser, Text: "家族連れです"},
		},
		concept.Draft{Topic: "地域の小さな植物園"},
	)
	if err != nil {
		t.Fatalf("chat: %v", err)
	}

	contents, ok := received["contents"].([]any)
	if !ok {
		t.Fatal("expected contents array")
	}
	// 先頭に確定済み項目を伝える1件が入るため、履歴3件と合わせて4件になる。
	if len(contents) != 4 {
		t.Fatalf("expected draft context plus 3 messages, got %d", len(contents))
	}
	for index, item := range contents {
		entry, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("contents[%d] is not an object", index)
		}
		if entry["role"] == nil || entry["role"] == "" {
			t.Errorf("contents[%d] must carry a role", index)
		}
	}
	last, _ := contents[3].(map[string]any)
	if last["role"] != "user" {
		t.Errorf("expected the last message to be from the user, got %v", last["role"])
	}
	middle, _ := contents[2].(map[string]any)
	if middle["role"] != "model" {
		t.Errorf("expected the model turn to be tagged as model, got %v", middle["role"])
	}
}

func TestChatDoesNotSendRoleOnSystemInstruction(t *testing.T) {
	// systemInstruction と contents で同じ構造体を使い回しているため、
	// role が紛れ込むとリクエストが400で弾かれる。
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		writeCandidate(t, writer, validChatCandidate)
	}))
	defer server.Close()

	client := newChatClient(t, server.URL)
	if _, err := client.Chat(context.Background(), []concept.Message{{Role: concept.RoleUser, Text: "植物園"}}, concept.Draft{}); err != nil {
		t.Fatalf("chat: %v", err)
	}

	systemInstruction, ok := received["systemInstruction"].(map[string]any)
	if !ok {
		t.Fatal("expected systemInstruction")
	}
	if _, exists := systemInstruction["role"]; exists {
		t.Error("systemInstruction must not carry a role")
	}
}

func TestGenerateStillOmitsRole(t *testing.T) {
	// チャット対応で content に role を足したが、単発生成の形は変えない。
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
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

	client := newChatClient(t, server.URL)
	if _, err := client.Generate(context.Background(), "学校の写真部", concept.Draft{}); err != nil {
		t.Fatalf("generate: %v", err)
	}

	contents, ok := received["contents"].([]any)
	if !ok || len(contents) == 0 {
		t.Fatal("expected contents array")
	}
	entry, _ := contents[0].(map[string]any)
	if _, exists := entry["role"]; exists {
		t.Error("single-shot generation must not send a role")
	}
}

func TestChatDerivesReadyOnServerSide(t *testing.T) {
	// モデルの自己申告は受け取らず、必須項目がそろったかは下書きから判定する。
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writeCandidate(t, writer, `{
			"reply":"この内容で生成できます。",
			"choices":[],
			"draft":{"topic":"植物園","audience":"家族連れ","goal":"週末に来てほしい","tone":"やわらかい","mustInclude":["開園時間"]}
		}`)
	}))
	defer server.Close()

	client := newChatClient(t, server.URL)
	reply, err := client.Chat(context.Background(), []concept.Message{{Role: concept.RoleUser, Text: "はい"}}, concept.Draft{})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}

	if !reply.Ready {
		t.Error("expected ready to be derived as true")
	}
	if len(reply.Missing) != 0 {
		t.Errorf("expected no missing fields, got %v", reply.Missing)
	}
}

func TestChatReportsMissingFieldsWhenDraftIsIncomplete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writeCandidate(t, writer, validChatCandidate)
	}))
	defer server.Close()

	client := newChatClient(t, server.URL)
	reply, err := client.Chat(context.Background(), []concept.Message{{Role: concept.RoleUser, Text: "植物園"}}, concept.Draft{})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}

	if reply.Ready {
		t.Error("expected ready to be false while audience and goal are empty")
	}
	if len(reply.Missing) != 2 {
		t.Errorf("expected audience and goal to be missing, got %v", reply.Missing)
	}
}

func TestChatRejectsUnknownFieldsInReply(t *testing.T) {
	// スキーマ外の項目が混ざった応答は、画面へ出す前に落とす。
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writeCandidate(t, writer, `{
			"reply":"質問です。",
			"choices":[],
			"draft":{"topic":"植物園","audience":"","goal":"","tone":"","mustInclude":[]},
			"ready":true
		}`)
	}))
	defer server.Close()

	client := newChatClient(t, server.URL)
	if _, err := client.Chat(context.Background(), []concept.Message{{Role: concept.RoleUser, Text: "植物園"}}, concept.Draft{}); err == nil {
		t.Error("expected an unknown field to be rejected")
	}
}

func TestChatRejectsOverLongReply(t *testing.T) {
	overLongReply := strings.Repeat("あ", concept.MaxReplyLength+1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writeCandidate(t, writer, `{
			"reply":"`+overLongReply+`",
			"choices":[],
			"draft":{"topic":"植物園","audience":"","goal":"","tone":"","mustInclude":[]}
		}`)
	}))
	defer server.Close()

	client := newChatClient(t, server.URL)
	if _, err := client.Chat(context.Background(), []concept.Message{{Role: concept.RoleUser, Text: "植物園"}}, concept.Draft{}); err == nil {
		t.Error("expected an over-long reply to be rejected")
	}
}

func TestChatRequiresMessages(t *testing.T) {
	client := newChatClient(t, "https://example.test")

	if _, err := client.Chat(context.Background(), nil, concept.Draft{}); err == nil {
		t.Error("expected an empty history to be rejected before calling Gemini")
	}
}

func TestChatFallsBackToSecondaryModel(t *testing.T) {
	var requestedPaths []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestedPaths = append(requestedPaths, request.URL.Path)
		if strings.Contains(request.URL.Path, "gemini-test:") {
			writer.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		writeCandidate(t, writer, validChatCandidate)
	}))
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:        "test-key",
		Model:         "gemini-test",
		FallbackModel: "gemini-test-lite",
		BaseURL:       server.URL,
		HTTPClient:    &http.Client{Timeout: 5 * time.Second},
	})
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	client.retryDelay = func(int) time.Duration { return time.Millisecond }

	if _, err := client.Chat(context.Background(), []concept.Message{{Role: concept.RoleUser, Text: "植物園"}}, concept.Draft{}); err != nil {
		t.Fatalf("chat: %v", err)
	}

	last := requestedPaths[len(requestedPaths)-1]
	if !strings.Contains(last, "gemini-test-lite:") {
		t.Errorf("expected the fallback model to answer, got %s", last)
	}
}
