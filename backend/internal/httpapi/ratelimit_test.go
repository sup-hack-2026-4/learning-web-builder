package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/concept"
)

func TestRateLimiterAllowsUpToTheLimit(t *testing.T) {
	limiter := newRateLimiter(3, time.Minute)

	for attempt := 1; attempt <= 3; attempt++ {
		if allowed, _ := limiter.allow("ip:1.2.3.4"); !allowed {
			t.Fatalf("request %d should be allowed", attempt)
		}
	}
	allowed, retryAfter := limiter.allow("ip:1.2.3.4")
	if allowed {
		t.Error("the fourth request should be rejected")
	}
	if retryAfter <= 0 {
		t.Errorf("expected a positive retry-after, got %v", retryAfter)
	}
}

func TestRateLimiterCountsClientsSeparately(t *testing.T) {
	// 教室のように同じ回線を複数人が使う場面で、他人の利用に巻き込まれないこと。
	limiter := newRateLimiter(1, time.Minute)

	if allowed, _ := limiter.allow("user:a"); !allowed {
		t.Fatal("first client should be allowed")
	}
	if allowed, _ := limiter.allow("user:b"); !allowed {
		t.Error("a different client must not be blocked by the first one")
	}
}

func TestRateLimiterResetsAfterTheWindow(t *testing.T) {
	limiter := newRateLimiter(1, time.Minute)
	now := time.Now()
	limiter.now = func() time.Time { return now }

	limiter.allow("ip:1.2.3.4")
	if allowed, _ := limiter.allow("ip:1.2.3.4"); allowed {
		t.Fatal("expected the second request in the window to be rejected")
	}

	now = now.Add(time.Minute + time.Second)
	if allowed, _ := limiter.allow("ip:1.2.3.4"); !allowed {
		t.Error("expected the counter to reset after the window")
	}
}

func TestConceptChatRejectsTooManyRequests(t *testing.T) {
	router := NewRouter(Config{Advisor: &stubAdvisor{reply: concept.Reply{Reply: "質問です。"}}})
	body := `{"messages":[{"role":"user","text":"植物園"}],"draft":{}}`

	var lastCode int
	for attempt := 0; attempt < aiRequestsPerWindow+1; attempt++ {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/concept/chat", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		lastCode = recorder.Code
	}

	if lastCode != http.StatusTooManyRequests {
		t.Errorf("expected 429 once the limit is exceeded, got %d", lastCode)
	}
}

func TestGenerateStaysWithinTheSameLimit(t *testing.T) {
	// 生成もチャットと同じ経路でモデルを叩くため、まとめて絞る。
	router := NewRouter(Config{Generator: &stubGenerator{}})

	var lastCode int
	for attempt := 0; attempt < aiRequestsPerWindow+1; attempt++ {
		request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":"植物園"}`))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		lastCode = recorder.Code
	}

	if lastCode != http.StatusTooManyRequests {
		t.Errorf("expected 429 once the limit is exceeded, got %d", lastCode)
	}
}

func TestHealthIsNotRateLimited(t *testing.T) {
	// 監視まで巻き込むと、混雑時にサービスが落ちていると誤判定される。
	router := NewRouter(Config{})

	for attempt := 0; attempt < aiRequestsPerWindow+5; attempt++ {
		request := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("health must stay available, got %d on attempt %d", recorder.Code, attempt+1)
		}
	}
}

func TestConceptChatKeepsConfirmedDraftWhenAdvisorOverwritesIt(t *testing.T) {
	// Advisor の実装が差し替わっても、確定済みの項目は守られること。
	advisor := &stubAdvisor{reply: concept.Reply{
		Reply: "書き換えます。",
		Draft: concept.Draft{Topic: "動物園", Audience: "専門家", Goal: ""},
		Ready: true,
	}}
	body := `{"messages":[{"role":"user","text":"はい"}],"draft":{"topic":"植物園","audience":"近所の家族連れ","goal":"週末に来てほしい"}}`

	recorder := postConceptChat(t, Config{Advisor: advisor}, body)

	payload := decodeConceptResponse(t, recorder)
	draft, _ := payload["draft"].(map[string]any)
	if draft["topic"] != "植物園" || draft["audience"] != "近所の家族連れ" {
		t.Errorf("confirmed fields must survive the advisor response, got %#v", draft)
	}
	if draft["goal"] != "週末に来てほしい" {
		t.Errorf("an empty proposal must not erase a confirmed field, got %#v", draft["goal"])
	}
}

func TestGenerateAlignsConceptTopicWithTheRequestTopic(t *testing.T) {
	// 題材の入力元が2つあると、どちらが正なのか分からなくなる。
	generator := &stubGenerator{}
	body := `{"topic":"植物園","concept":{"topic":"まったく別の題材","audience":"家族連れ"}}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	NewRouter(Config{Generator: generator}).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if generator.draft == nil {
		t.Fatal("expected the generator to be called")
	}
	if generator.draft.Topic != "植物園" {
		t.Errorf("expected the request topic to win, got %q", generator.draft.Topic)
	}
}
