package gemini

import (
	"bytes"
	"context"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/concept"
)

// testdata の429応答は、Gemini APIが返す google.rpc の詳細の形に合わせている（#193）。
func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return body
}

func writeQuotaError(t *testing.T, writer http.ResponseWriter, body []byte) {
	t.Helper()
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusTooManyRequests)
	if _, err := writer.Write(body); err != nil {
		t.Fatalf("write response: %v", err)
	}
}

// captureLog は標準のloggerの出力先を差し替える。グローバルな状態のため、
// これを使うテストは t.Parallel にしない。
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buffer bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&buffer)
	t.Cleanup(func() { log.SetOutput(previous) })
	return &buffer
}

// recordWaits は実際には待たずに、再試行の前に待とうとした時間を記録する。
// 経過時間で確かめると、CIの遅さで誤って失敗したり、待たなくても通ったりする。
func recordWaits(client *Client) *[]time.Duration {
	var waits []time.Duration
	client.wait = func(ctx context.Context, delay time.Duration) error {
		waits = append(waits, delay)
		return ctx.Err()
	}
	return &waits
}

// slowRoundTripper は、応答を返す前に止まる。応答を受け取った時点で
// 主モデルの持ち時間が切れている状況を作るために使う。
type slowRoundTripper struct {
	delay   time.Duration
	handler http.Handler
}

func (transport slowRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	recorder := httptest.NewRecorder()
	transport.handler.ServeHTTP(recorder, request)
	time.Sleep(transport.delay)
	return recorder.Result(), nil
}

const validGeneratedSite = `{
	"siteTitle":"学校の写真部",
	"tagline":"写真で学校の日常を記録します。",
	"theme":{"primary":"#2563eb","background":"#f8fafc","text":"#172033","fontFamily":"sans","spacing":6},
	"sections":[
		{"id":"hero","kind":"hero","title":"学校の写真部","body":"活動を紹介します。","imageAlt":"","visible":true},
		{"id":"about","kind":"about","title":"私たちについて","body":"写真を学んでいます。","imageAlt":"撮影中の部員","visible":true}
	]
}`

func TestNewHTTPErrorReadsQuotaDetails(t *testing.T) {
	tests := []struct {
		name           string
		body           string
		wantDaily      bool
		wantRetryDelay time.Duration
		wantQuotaIDs   []string
	}{
		{
			name:           "1日の上限",
			body:           string(readFixture(t, "quota_daily_429.json")),
			wantDaily:      true,
			wantRetryDelay: 52966 * time.Second,
			wantQuotaIDs:   []string{"GenerateRequestsPerDayPerProjectPerModel-FreeTier"},
		},
		{
			name:           "1分の上限",
			body:           string(readFixture(t, "quota_minute_429.json")),
			wantRetryDelay: 38200 * time.Millisecond,
			wantQuotaIDs:   []string{"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"},
		},
		{
			name: "日次と分次が同時に出たら日次として扱う",
			body: `{"error":{"status":"RESOURCE_EXHAUSTED","details":[
				{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"40s"},
				{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[
					{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"},
					{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}
				]}
			]}}`,
			wantDaily:      true,
			wantRetryDelay: 40 * time.Second,
			wantQuotaIDs: []string{
				"GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
				"GenerateRequestsPerDayPerProjectPerModel-FreeTier",
			},
		},
		{
			name: "詳細がない",
			body: `{"error":{"message":"Resource has been exhausted.","status":"RESOURCE_EXHAUSTED"}}`,
		},
		{
			name: "知らない型と読めない待ち時間は無視する",
			body: `{"error":{"status":"RESOURCE_EXHAUSTED","details":[
				{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"RATE_LIMIT_EXCEEDED"},
				{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"soon"}
			]}}`,
		},
		{
			name: "負の待ち時間は指定なしとみなす",
			body: `{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"-5s"}]}}`,
		},
		{
			name: "壊れた要素があっても残りを読む",
			body: `{"error":{"details":[
				{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":5},
				{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}
			]}}`,
			wantDaily:    true,
			wantQuotaIDs: []string{"GenerateRequestsPerDayPerProjectPerModel-FreeTier"},
		},
		{
			name: "JSONでない応答",
			body: `upstream connect error`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			responseErr := newHTTPError(http.StatusTooManyRequests, []byte(test.body))
			if responseErr.dailyQuota != test.wantDaily {
				t.Errorf("dailyQuota = %t, want %t", responseErr.dailyQuota, test.wantDaily)
			}
			if responseErr.retryDelay != test.wantRetryDelay {
				t.Errorf("retryDelay = %s, want %s", responseErr.retryDelay, test.wantRetryDelay)
			}
			if !slices.Equal(responseErr.quotaIDs, test.wantQuotaIDs) {
				t.Errorf("quotaIDs = %v, want %v", responseErr.quotaIDs, test.wantQuotaIDs)
			}
			if !strings.Contains(responseErr.Error(), "HTTP 429") {
				t.Errorf("expected status in error message, got %q", responseErr.Error())
			}
		})
	}
}

func TestGenerateStopsImmediatelyOnDailyQuota(t *testing.T) {
	logs := captureLog(t)
	dailyQuota := readFixture(t, "quota_daily_429.json")
	primaryRequestCount := 0
	fallbackRequestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1beta/models/gemini-primary:generateContent":
			primaryRequestCount++
			writeQuotaError(t, writer, dailyQuota)
		case "/v1beta/models/gemini-fallback:generateContent":
			fallbackRequestCount++
			writeCandidate(t, writer, validGeneratedSite)
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
	client.retryDelay = func(int) time.Duration { return 0 }

	_, err = client.Generate(context.Background(), "学校の写真部", concept.Draft{})
	if err == nil || !strings.Contains(err.Error(), "status=RESOURCE_EXHAUSTED") {
		t.Fatalf("expected quota error, got %v", err)
	}
	if primaryRequestCount != 1 {
		t.Errorf("expected one primary request, got %d", primaryRequestCount)
	}
	if fallbackRequestCount != 0 {
		t.Errorf("expected no fallback request, got %d", fallbackRequestCount)
	}
	logLine := logs.String()
	for _, want := range []string{
		"gemini quota exceeded",
		"model=gemini-primary",
		"reason=daily_quota",
		"daily=true",
		"retry_after=14h42m46s",
		"quota_ids=GenerateRequestsPerDayPerProjectPerModel-FreeTier",
	} {
		if !strings.Contains(logLine, want) {
			t.Errorf("expected log to contain %q, got %q", want, logLine)
		}
	}
}

func TestGenerateFallsBackWhenRetryDelayExceedsBudget(t *testing.T) {
	logs := captureLog(t)
	minuteQuota := readFixture(t, "quota_minute_429.json")
	primaryRequestCount := 0
	fallbackRequestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1beta/models/gemini-primary:generateContent":
			primaryRequestCount++
			writeQuotaError(t, writer, minuteQuota)
		case "/v1beta/models/gemini-fallback:generateContent":
			fallbackRequestCount++
			writeCandidate(t, writer, validGeneratedSite)
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
	client.retryDelay = func(int) time.Duration { return 0 }
	waits := recordWaits(client)

	model, err := client.Generate(context.Background(), "学校の写真部", concept.Draft{})
	if err != nil {
		t.Fatalf("generate with fallback: %v", err)
	}
	if model.SiteTitle != "学校の写真部" {
		t.Fatalf("unexpected model: %#v", model)
	}
	// 38秒待てと言われたら、主モデルの予算（8秒）を待ちで使い切らずに予備へ移る。
	if len(*waits) != 0 {
		t.Errorf("expected not to wait for the retry delay, waited %v", *waits)
	}
	if primaryRequestCount != 1 {
		t.Errorf("expected one primary request, got %d", primaryRequestCount)
	}
	if fallbackRequestCount != 1 {
		t.Errorf("expected one fallback request, got %d", fallbackRequestCount)
	}
	if !strings.Contains(logs.String(), "reason=retry_delay_exceeds_budget") {
		t.Errorf("expected retry delay reason in log, got %q", logs.String())
	}
}

func TestGenerateWaitsForServerRetryDelay(t *testing.T) {
	captureLog(t)
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		requestCount++
		if requestCount == 1 {
			writeQuotaError(t, writer, []byte(`{"error":{"status":"RESOURCE_EXHAUSTED","details":[
				{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"0.1s"}
			]}}`))
			return
		}
		writeCandidate(t, writer, validGeneratedSite)
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
	client.retryDelay = func(int) time.Duration { return 0 }
	waits := recordWaits(client)

	if _, err := client.Generate(context.Background(), "学校の写真部", concept.Draft{}); err != nil {
		t.Fatalf("generate after retry: %v", err)
	}
	if !slices.Equal(*waits, []time.Duration{100 * time.Millisecond}) {
		t.Errorf("expected to wait for the server retry delay once, waited %v", *waits)
	}
	if requestCount != 2 {
		t.Errorf("expected two requests, got %d", requestCount)
	}
}

func TestGenerateDoesNotFallBackOnDailyQuotaAfterPrimaryTimeout(t *testing.T) {
	captureLog(t)
	dailyQuota := readFixture(t, "quota_daily_429.json")
	fallbackRequestCount := 0
	handler := http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if strings.Contains(request.URL.Path, "gemini-fallback:") {
			fallbackRequestCount++
			writeCandidate(t, writer, validGeneratedSite)
			return
		}
		writeQuotaError(t, writer, dailyQuota)
	})

	client, err := NewClient(Config{
		APIKey:        "test-key",
		Model:         "gemini-primary",
		FallbackModel: "gemini-fallback",
		BaseURL:       "http://gemini.test",
		// 1日の上限の429を受け取った時点で、主モデルの持ち時間を過ぎている。
		HTTPClient: &http.Client{Transport: slowRoundTripper{delay: 100 * time.Millisecond, handler: handler}},
	})
	if err != nil {
		t.Fatalf("create client: %v", err)
	}
	client.primaryModelTimeout = 20 * time.Millisecond
	client.generationTimeout = 5 * time.Second

	_, err = client.Generate(context.Background(), "学校の写真部", concept.Draft{})
	if !isDailyQuotaExceeded(err) {
		t.Fatalf("expected daily quota error, got %v", err)
	}
	if fallbackRequestCount != 0 {
		t.Errorf("expected no fallback request, got %d", fallbackRequestCount)
	}
}

func TestGenerateKeepsQuotaErrorWhenRetryWaitIsInterrupted(t *testing.T) {
	logs := captureLog(t)
	minuteQuota := []byte(`{"error":{"status":"RESOURCE_EXHAUSTED","details":[
		{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"0.1s"}
	]}}`)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writeQuotaError(t, writer, minuteQuota)
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
	client.wait = func(context.Context, time.Duration) error { return context.Canceled }

	_, err = client.Generate(context.Background(), "学校の写真部", concept.Draft{})
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected the interruption to be kept, got %v", err)
	}
	var responseErr *geminiHTTPError
	if !errors.As(err, &responseErr) || responseErr.statusCode != http.StatusTooManyRequests {
		t.Errorf("expected the 429 response to be kept, got %v", err)
	}
	if !strings.Contains(logs.String(), "reason=wait_interrupted") {
		t.Errorf("expected interruption reason in log, got %q", logs.String())
	}
}

func TestGenerateLogsDailyQuotaOnLastAttempt(t *testing.T) {
	logs := captureLog(t)
	dailyQuota := readFixture(t, "quota_daily_429.json")
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		requestCount++
		if requestCount < maxGenerateAttempts {
			writer.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		writeQuotaError(t, writer, dailyQuota)
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
	recordWaits(client)

	if _, err := client.Generate(context.Background(), "学校の写真部", concept.Draft{}); !isDailyQuotaExceeded(err) {
		t.Fatalf("expected daily quota error, got %v", err)
	}
	if requestCount != maxGenerateAttempts {
		t.Errorf("expected %d requests, got %d", maxGenerateAttempts, requestCount)
	}
	if !strings.Contains(logs.String(), "reason=daily_quota") {
		t.Errorf("expected daily quota reason on the last attempt, got %q", logs.String())
	}
}

func TestFitsInBudget(t *testing.T) {
	if !fitsInBudget(context.Background(), time.Hour) {
		t.Error("expected any delay to fit without a deadline")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if !fitsInBudget(ctx, time.Second) {
		t.Error("expected a short delay to fit in the remaining budget")
	}
	if fitsInBudget(ctx, time.Minute) {
		t.Error("expected a delay that uses up the whole budget not to fit")
	}
	if fitsInBudget(ctx, time.Hour) {
		t.Error("expected a longer delay not to fit")
	}
}

func TestGenerateKeepsRetryingServerErrors(t *testing.T) {
	logs := captureLog(t)
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		requestCount++
		writer.WriteHeader(http.StatusServiceUnavailable)
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
	client.retryDelay = func(int) time.Duration { return 0 }

	if _, err := client.Generate(context.Background(), "学校の写真部", concept.Draft{}); err == nil {
		t.Fatal("expected error")
	}
	if requestCount != maxGenerateAttempts {
		t.Errorf("expected %d requests, got %d", maxGenerateAttempts, requestCount)
	}
	// 回数の上限ではない失敗は、上限のログに出さない。
	if strings.Contains(logs.String(), "gemini quota exceeded") {
		t.Errorf("expected no quota log for server errors, got %q", logs.String())
	}
}

func TestChatStopsImmediatelyOnDailyQuota(t *testing.T) {
	captureLog(t)
	dailyQuota := readFixture(t, "quota_daily_429.json")
	var requestedPaths []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestedPaths = append(requestedPaths, request.URL.Path)
		if strings.Contains(request.URL.Path, "gemini-test:") {
			writeQuotaError(t, writer, dailyQuota)
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
	client.retryDelay = func(int) time.Duration { return 0 }

	if _, err := client.Chat(context.Background(), []concept.Message{{Role: concept.RoleUser, Text: "植物園"}}, concept.Draft{}); err == nil {
		t.Fatal("expected quota error")
	}
	if len(requestedPaths) != 1 || !strings.Contains(requestedPaths[0], "gemini-test:") {
		t.Errorf("expected only one primary request, got %v", requestedPaths)
	}
}
