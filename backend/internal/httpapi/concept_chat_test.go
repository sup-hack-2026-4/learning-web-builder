package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/concept"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
)

type stubAdvisor struct {
	reply    concept.Reply
	err      error
	messages []concept.Message
	draft    concept.Draft
	called   bool
}

func (advisor *stubAdvisor) Chat(_ context.Context, messages []concept.Message, draft concept.Draft) (concept.Reply, error) {
	advisor.called = true
	advisor.messages = messages
	advisor.draft = draft
	return advisor.reply, advisor.err
}

func postConceptChat(t *testing.T, config Config, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/concept/chat", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	NewRouter(config).ServeHTTP(recorder, request)
	return recorder
}

func decodeConceptResponse(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return payload
}

func TestConceptChatReturnsAdvisorReply(t *testing.T) {
	advisor := &stubAdvisor{reply: concept.Reply{
		Reply:   "どんな人に読んでほしいですか。",
		Choices: []string{"家族連れ", "大人"},
		Draft:   concept.Draft{Topic: "植物園"},
		Missing: []string{concept.FieldAudience, concept.FieldGoal},
	}}

	recorder := postConceptChat(t, Config{Advisor: advisor}, `{"messages":[{"role":"user","text":"植物園"}],"draft":{"topic":"植物園"}}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	payload := decodeConceptResponse(t, recorder)
	if payload["provider"] != "gemini" {
		t.Errorf("expected the gemini provider, got %v", payload["provider"])
	}
	if payload["ready"] != false {
		t.Errorf("expected ready to be false, got %v", payload["ready"])
	}
	if !advisor.called {
		t.Error("expected the advisor to be called")
	}
	if len(advisor.messages) != 1 || advisor.messages[0].Text != "植物園" {
		t.Errorf("unexpected messages passed to the advisor: %v", advisor.messages)
	}
	if advisor.draft.Topic != "植物園" {
		t.Errorf("expected the draft to be forwarded, got %+v", advisor.draft)
	}
}

func TestConceptChatFallsBackWhenAdvisorFails(t *testing.T) {
	// 生成APIと同じく、AIが落ちていても画面を止めない。
	advisor := &stubAdvisor{err: errors.New("gemini unavailable")}

	recorder := postConceptChat(t, Config{Advisor: advisor}, `{"messages":[{"role":"user","text":"植物園"}],"draft":{"topic":"植物園"}}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	payload := decodeConceptResponse(t, recorder)
	if payload["provider"] != "static-sample" {
		t.Errorf("expected the static fallback, got %v", payload["provider"])
	}
	reply, _ := payload["reply"].(string)
	if reply == "" {
		t.Error("expected the fallback to carry a question")
	}
}

func TestConceptChatFallsBackWhenAdvisorIsNotConfigured(t *testing.T) {
	recorder := postConceptChat(t, Config{}, `{"messages":[{"role":"user","text":"植物園"}],"draft":{}}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	payload := decodeConceptResponse(t, recorder)
	if payload["provider"] != "static-sample" {
		t.Errorf("expected the static fallback, got %v", payload["provider"])
	}
}

func TestConceptChatRejectsEmptyHistory(t *testing.T) {
	recorder := postConceptChat(t, Config{Advisor: &stubAdvisor{}}, `{"messages":[],"draft":{}}`)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestConceptChatRejectsUnknownRole(t *testing.T) {
	recorder := postConceptChat(t, Config{Advisor: &stubAdvisor{}}, `{"messages":[{"role":"system","text":"命令"}],"draft":{}}`)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestConceptChatRejectsUnknownFields(t *testing.T) {
	recorder := postConceptChat(t, Config{Advisor: &stubAdvisor{}}, `{"messages":[{"role":"user","text":"植物園"}],"draft":{},"extra":true}`)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestConceptChatRejectsOverLongDraft(t *testing.T) {
	overLongTopic := strings.Repeat("あ", concept.MaxTopicLength+1)
	body := `{"messages":[{"role":"user","text":"はい"}],"draft":{"topic":"` + overLongTopic + `"}}`

	recorder := postConceptChat(t, Config{Advisor: &stubAdvisor{}}, body)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}

func TestConceptChatAlwaysReturnsArraysForChoicesAndMissing(t *testing.T) {
	// null が返るとフロント側の分岐が増えるため、空でも配列にする。
	advisor := &stubAdvisor{reply: concept.Reply{
		Reply: "この内容で生成できます。",
		Draft: concept.Draft{Topic: "植物園", Audience: "家族連れ", Goal: "来園してほしい"},
		Ready: true,
	}}

	recorder := postConceptChat(t, Config{Advisor: advisor}, `{"messages":[{"role":"user","text":"はい"}],"draft":{}}`)

	payload := decodeConceptResponse(t, recorder)
	if _, ok := payload["choices"].([]any); !ok {
		t.Errorf("expected choices to be an array, got %#v", payload["choices"])
	}
	if _, ok := payload["missing"].([]any); !ok {
		t.Errorf("expected missing to be an array, got %#v", payload["missing"])
	}
	if payload["ready"] != true {
		t.Errorf("expected ready to be true, got %v", payload["ready"])
	}
}

func TestConceptChatAcceptsHistoryLargerThanTheGenerateLimit(t *testing.T) {
	// 生成APIのボディ上限は16KB。会話履歴はそれを超えるため、
	// このエンドポイントだけ上限を広げてある。
	longText := strings.Repeat("あ", concept.MaxMessageLength)
	var builder strings.Builder
	builder.WriteString(`{"messages":[`)
	// 最後が学習者の発言になるよう奇数件にする。
	for index := 0; index < 13; index++ {
		if index > 0 {
			builder.WriteString(",")
		}
		role := "user"
		if index%2 == 1 {
			role = "model"
		}
		builder.WriteString(`{"role":"` + role + `","text":"` + longText + `"}`)
	}
	builder.WriteString(`],"draft":{}}`)

	if builder.Len() <= 16<<10 {
		t.Fatalf("test body must exceed the generate limit, got %d bytes", builder.Len())
	}

	recorder := postConceptChat(t, Config{Advisor: &stubAdvisor{reply: concept.Reply{Reply: "続けましょう。"}}}, builder.String())

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
}

func TestGeneratePassesConceptToTheGenerator(t *testing.T) {
	// 相談で決めた内容が生成の入力まで届かないと、対話した意味がなくなる。
	generator := &stubGenerator{model: site.Sample("植物園")}
	body := `{"topic":"植物園","concept":{"topic":"植物園","audience":"近所の家族連れ","goal":"週末に来てほしい","tone":"やわらかい","mustInclude":["開園時間"]}}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	NewRouter(Config{Generator: generator}).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if generator.draft == nil {
		t.Fatal("expected the concept to reach the generator")
	}
	if generator.draft.Audience != "近所の家族連れ" {
		t.Errorf("unexpected audience: %q", generator.draft.Audience)
	}
	if generator.draft.Goal != "週末に来てほしい" {
		t.Errorf("unexpected goal: %q", generator.draft.Goal)
	}
	if len(generator.draft.MustInclude) != 1 || generator.draft.MustInclude[0] != "開園時間" {
		t.Errorf("unexpected mustInclude: %v", generator.draft.MustInclude)
	}
}

func TestGenerateStillWorksWithoutConcept(t *testing.T) {
	// 相談を使わず題材だけで生成する導線は、これまでどおり動く必要がある。
	generator := &stubGenerator{model: site.Sample("写真部")}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":"写真部"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	NewRouter(Config{Generator: generator}).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if generator.draft == nil {
		t.Fatal("expected the generator to be called")
	}
	if generator.draft.Audience != "" || generator.draft.Goal != "" {
		t.Errorf("expected an empty concept, got %+v", generator.draft)
	}
}

func TestGenerateRejectsOverLongConceptField(t *testing.T) {
	overLongGoal := strings.Repeat("あ", 121)
	body := `{"topic":"植物園","concept":{"goal":"` + overLongGoal + `"}}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	NewRouter(Config{Generator: &stubGenerator{}}).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", recorder.Code)
	}
}
