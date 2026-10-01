package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	authn "github.com/haru-yoshi-5/learning-web-builder/backend/internal/auth"
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

// headerAuthenticator は、リクエストごとに別のユーザーを名乗れるようにする。
// stubAuthenticator はルーターごとに1人しか表せず、回数の記録もルーターごとに持つため、
// 同じルーターを別々のユーザーで呼ぶにはこちらが要る。ヘッダーが無ければゲストとして通す。
type headerAuthenticator struct{}

const testUserHeader = "X-Test-User"

func (headerAuthenticator) Optional(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		userID := request.Header.Get(testUserHeader)
		if userID == "" {
			next.ServeHTTP(writer, request)
			return
		}
		ctx := authn.ContextWithIdentity(request.Context(), authn.Identity{UserID: userID})
		next.ServeHTTP(writer, request.WithContext(ctx))
	})
}

func TestAILimitCountsSignedInUsersOnTheSameIPSeparately(t *testing.T) {
	// 教室のように同じ回線から使う場面。ログインしていれば、ほかの人の利用に巻き込まれないこと(#120)。
	router := NewRouter(Config{
		Authenticator: headerAuthenticator{},
		Generator:     &stubGenerator{},
		Advisor:       &stubAdvisor{reply: concept.Reply{Reply: "質問です。"}},
	})
	const sharedIP = "203.0.113.7"
	call := func(path, body, userID string) int {
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.RemoteAddr = sharedIP
		if userID != "" {
			request.Header.Set(testUserHeader, userID)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		return recorder.Code
	}
	generate := func(userID string) int { return call("/api/v1/generate", `{"topic":"植物園"}`, userID) }
	chat := func(userID string) int {
		return call("/api/v1/concept/chat", `{"messages":[{"role":"user","text":"植物園"}],"draft":{}}`, userID)
	}

	for attempt := 1; attempt <= aiRequestsPerWindow; attempt++ {
		if code := generate("user_a"); code == http.StatusTooManyRequests {
			t.Fatalf("request %d of user_a should be within the limit", attempt)
		}
	}
	if code := generate("user_a"); code != http.StatusTooManyRequests {
		t.Fatalf("expected user_a to be limited after %d requests, got %d", aiRequestsPerWindow, code)
	}
	// 生成と相談は同じ枠で数える。
	if code := chat("user_a"); code != http.StatusTooManyRequests {
		t.Errorf("expected chat of user_a to share the limit with generate, got %d", code)
	}

	if code := generate("user_b"); code == http.StatusTooManyRequests {
		t.Error("another signed-in user on the same IP must not be limited by user_a")
	}
	if code := chat("user_b"); code == http.StatusTooManyRequests {
		t.Error("chat of another signed-in user on the same IP must not be limited by user_a")
	}
	// ログインしたユーザーの利用は、同じIPのゲストの枠を減らさない。
	if code := generate(""); code == http.StatusTooManyRequests {
		t.Error("a guest on the same IP must not be limited by signed-in users")
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
