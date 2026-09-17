package httpapi

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	authn "github.com/haru-yoshi-5/learning-web-builder/backend/internal/auth"
)

// AIを呼ぶエンドポイントの利用量。生成もチャットも1回でモデルを複数回叩きうるため、
// 認証なしで無制限に受けると費用と接続がすぐ枯れる。
//
// 学習者が普通に相談する速さ（数十秒に1回）は妨げず、連打や自動化だけを止める値にする。
const (
	aiRequestsPerWindow = 20
	aiRateLimitWindow   = time.Minute
	// 同時に走るAI呼び出しの上限。Renderの無料枠は接続数が少なく、
	// 待ち行列が伸びるとヘルスチェックまで巻き込まれる。
	aiConcurrencyLimit = 4
	// 掃除の間隔。古い記録を残し続けるとメモリが増える一方になる。
	rateLimitSweepInterval = 10 * time.Minute
)

// rateLimiter は、クライアントごとの固定ウィンドウでリクエスト数を数える。
//
// 1インスタンス内のメモリでしか数えないため、複数インスタンスへ広げるときは
// 共有ストアが要る。いまは1インスタンス構成であり、目的も
// 「際限のない呼び出しを止める」ことなので、これで足りる。
type rateLimiter struct {
	mutex       sync.Mutex
	counters    map[string]*rateCounter
	limit       int
	window      time.Duration
	lastSweptAt time.Time
	now         func() time.Time
}

type rateCounter struct {
	count       int
	windowStart time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		counters: make(map[string]*rateCounter),
		limit:    limit,
		window:   window,
		now:      time.Now,
	}
}

// allow は、このクライアントの呼び出しを受け付けてよいかを返す。
func (limiter *rateLimiter) allow(key string) (allowed bool, retryAfter time.Duration) {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()

	now := limiter.now()
	limiter.sweep(now)

	counter, exists := limiter.counters[key]
	if !exists || now.Sub(counter.windowStart) >= limiter.window {
		limiter.counters[key] = &rateCounter{count: 1, windowStart: now}
		return true, 0
	}
	if counter.count >= limiter.limit {
		return false, limiter.window - now.Sub(counter.windowStart)
	}
	counter.count++
	return true, 0
}

// sweep はウィンドウを過ぎた記録を捨てる。呼び出し側でロック済みであること。
func (limiter *rateLimiter) sweep(now time.Time) {
	if now.Sub(limiter.lastSweptAt) < rateLimitSweepInterval {
		return
	}
	limiter.lastSweptAt = now
	for key, counter := range limiter.counters {
		if now.Sub(counter.windowStart) >= limiter.window {
			delete(limiter.counters, key)
		}
	}
}

// limitAIUsage は、AIを呼ぶエンドポイントに回数と同時実行の上限をかける。
//
// 数える単位はログイン済みならユーザー、未ログインならIP。
// 同じ回線から複数人が使う教室を想定し、IP単位の上限は厳しくしすぎない。
func limitAIUsage(limiter *rateLimiter, slots chan struct{}) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			key := rateLimitKey(request)
			if allowed, retryAfter := limiter.allow(key); !allowed {
				writer.Header().Set("Retry-After", retryAfterSeconds(retryAfter))
				writeJSON(writer, http.StatusTooManyRequests, map[string]string{
					"error": "しばらく待ってからもう一度お試しください。",
				})
				return
			}

			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			default:
				// 待たせずにすぐ返す。AIの応答は元から遅く、
				// 待ち行列を作るとブラウザ側のタイムアウトと二重に待つことになる。
				writer.Header().Set("Retry-After", "5")
				writeJSON(writer, http.StatusServiceUnavailable, map[string]string{
					"error": "いま混み合っています。少し待ってからもう一度お試しください。",
				})
				return
			}

			next.ServeHTTP(writer, request)
		})
	}
}

// rateLimitKey は、数える単位を決める。
// ログイン済みならユーザー、未ログインならIP。
func rateLimitKey(request *http.Request) string {
	if identity, authenticated := authn.IdentityFromContext(request.Context()); authenticated {
		return "user:" + identity.UserID
	}
	// RealIP ミドルウェアが X-Forwarded-For を解決した値を入れている。
	return "ip:" + request.RemoteAddr
}

func retryAfterSeconds(duration time.Duration) string {
	seconds := int(duration.Seconds())
	if seconds < 1 {
		seconds = 1
	}
	return strconv.Itoa(seconds)
}
