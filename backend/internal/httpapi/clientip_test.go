package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientIP(t *testing.T) {
	tests := []struct {
		name         string
		remoteAddr   string
		forwardedFor []string
		hops         int
		want         string
	}{
		{name: "プロキシなしでは接続元のIPからポートを除く", remoteAddr: "203.0.113.7:51000", hops: 0, want: "203.0.113.7"},
		{name: "プロキシなしではX-Forwarded-Forを見ない", remoteAddr: "203.0.113.7:51000", forwardedFor: []string{"198.51.100.1"}, hops: 0, want: "203.0.113.7"},
		{name: "IPv6の接続元からもポートを除く", remoteAddr: "[2001:db8::1]:51000", hops: 0, want: "2001:db8::1"},
		{name: "ポートのない接続元はそのまま使う", remoteAddr: "203.0.113.7", hops: 0, want: "203.0.113.7"},
		{name: "1段ならプロキシが足した末尾の値を使う", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"203.0.113.7"}, hops: 1, want: "203.0.113.7"},
		{name: "クライアントが先頭に足した値は使わない", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"198.51.100.1, 203.0.113.7"}, hops: 1, want: "203.0.113.7"},
		{name: "2段なら右から2つ目を使う", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"198.51.100.1, 203.0.113.7, 172.16.0.1"}, hops: 2, want: "203.0.113.7"},
		{name: "複数行に分かれていても右から数える", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"198.51.100.1", "203.0.113.7, 172.16.0.1"}, hops: 2, want: "203.0.113.7"},
		{name: "段数より要素が少なければ接続元のIPを使う", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"203.0.113.7"}, hops: 2, want: "10.0.0.1"},
		{name: "ヘッダーが無ければ接続元のIPを使う", remoteAddr: "10.0.0.1:443", hops: 1, want: "10.0.0.1"},
		{name: "IPとして読めない値なら接続元のIPを使う", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"unknown"}, hops: 1, want: "10.0.0.1"},
		// 読めない値のときに左側の別の要素へさかのぼると、クライアントが決めた値を使ってしまう。
		{name: "選んだ位置が空なら左へさかのぼらない", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"198.51.100.1, "}, hops: 1, want: "10.0.0.1"},
		{name: "選んだ位置がポート付きなら左へさかのぼらない", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"198.51.100.1, 203.0.113.7:51000"}, hops: 1, want: "10.0.0.1"},
		{name: "選んだ位置が角かっこ付きのIPv6なら左へさかのぼらない", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"198.51.100.1, [2001:db8::1]:51000"}, hops: 1, want: "10.0.0.1"},
		// 空の要素を詰めると、右から数えた位置がずれる。
		{name: "空の要素も1つとして数える", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"198.51.100.1,,203.0.113.7"}, hops: 2, want: "10.0.0.1"},
		{name: "空の要素より右は通常どおり選ぶ", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"198.51.100.1,,203.0.113.7"}, hops: 1, want: "203.0.113.7"},
		// 同じアドレスの書き方を変えて、別の枠を得られないようにする。
		{name: "IPv6の書き方の違いをそろえる", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"2001:DB8:0:0:0:0:0:1"}, hops: 1, want: "2001:db8::1"},
		{name: "IPv4射影のIPv6はIPv4と同じに扱う", remoteAddr: "10.0.0.1:443", forwardedFor: []string{"::ffff:203.0.113.7"}, hops: 1, want: "203.0.113.7"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", nil)
			request.RemoteAddr = test.remoteAddr
			for _, value := range test.forwardedFor {
				request.Header.Add(forwardedForHeader, value)
			}

			if got := clientIP(request, test.hops); got != test.want {
				t.Errorf("expected %q, got %q", test.want, got)
			}
		})
	}
}

func TestParseTrustedProxyHops(t *testing.T) {
	for raw, want := range map[string]int{"": 0, " ": 0, "0": 0, "2": 2, " 1 ": 1} {
		got, err := ParseTrustedProxyHops(raw)
		if err != nil || got != want {
			t.Errorf("ParseTrustedProxyHops(%q) = %d, %v; expected %d", raw, got, err, want)
		}
	}
	for _, raw := range []string{"-1", "1.5", "two"} {
		if _, err := ParseTrustedProxyHops(raw); err == nil {
			t.Errorf("ParseTrustedProxyHops(%q) must be rejected", raw)
		}
	}
}

// guestGenerate は、ゲストとして生成を1回呼び、ステータスコードを返す。
func guestGenerate(router http.Handler, remoteAddr string, headers map[string]string) int {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/generate", strings.NewReader(`{"topic":"植物園"}`))
	request.Header.Set("Content-Type", "application/json")
	request.RemoteAddr = remoteAddr
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder.Code
}

func TestAILimitIgnoresForwardedHeadersWithoutTrustedProxy(t *testing.T) {
	// プロキシを通さない構成では、転送ヘッダーはすべてクライアントが決めた値になる(#132)。
	router := NewRouter(Config{Generator: &stubGenerator{}})

	for attempt := 1; attempt <= aiRequestsPerWindow; attempt++ {
		if code := guestGenerate(router, "203.0.113.7:51000", nil); code != http.StatusOK {
			t.Fatalf("request %d should be within the limit, got %d", attempt, code)
		}
	}

	// 接続を張り直すとポートが変わる。
	if code := guestGenerate(router, "203.0.113.7:51001", nil); code != http.StatusTooManyRequests {
		t.Errorf("a new source port must stay in the same limit, got %d", code)
	}
	for _, header := range []string{"True-Client-IP", "X-Real-IP", forwardedForHeader} {
		if code := guestGenerate(router, "203.0.113.7:51000", map[string]string{header: "198.51.100.1"}); code != http.StatusTooManyRequests {
			t.Errorf("%s from the client must not open a new limit, got %d", header, code)
		}
	}
	if code := guestGenerate(router, "203.0.113.8:51000", nil); code != http.StatusOK {
		t.Errorf("another IP must be counted separately, got %d", code)
	}
}

func TestAILimitUsesTheAddressAppendedByTrustedProxies(t *testing.T) {
	// プロキシ2段の構成。右から2つ目が、外側のプロキシから見た接続元になる(#132)。
	router := NewRouter(Config{Generator: &stubGenerator{}, TrustedProxyHops: 2})
	const proxy = "10.0.0.1:443"
	forwarded := func(value string) map[string]string { return map[string]string{forwardedForHeader: value} }

	for attempt := 1; attempt <= aiRequestsPerWindow; attempt++ {
		if code := guestGenerate(router, proxy, forwarded("203.0.113.7, 172.16.0.1")); code != http.StatusOK {
			t.Fatalf("request %d should be within the limit, got %d", attempt, code)
		}
	}

	// クライアントが自分でX-Forwarded-Forを付けると、プロキシはその後ろに足す。
	if code := guestGenerate(router, proxy, forwarded("198.51.100.1, 203.0.113.7, 172.16.0.1")); code != http.StatusTooManyRequests {
		t.Errorf("a forged X-Forwarded-For entry must not open a new limit, got %d", code)
	}
	for _, header := range []string{"True-Client-IP", "X-Real-IP"} {
		headers := forwarded("203.0.113.7, 172.16.0.1")
		headers[header] = "198.51.100.1"
		if code := guestGenerate(router, proxy, headers); code != http.StatusTooManyRequests {
			t.Errorf("%s from the client must not open a new limit, got %d", header, code)
		}
	}
	// 内側のプロキシが別の接続やIPから届けても、同じクライアントとして数える。
	if code := guestGenerate(router, "10.0.0.2:8443", forwarded("203.0.113.7, 172.16.0.9")); code != http.StatusTooManyRequests {
		t.Errorf("a different proxy connection must stay in the same limit, got %d", code)
	}
	// 同じプロキシ経由でも、別のクライアントは別に数える。
	if code := guestGenerate(router, proxy, forwarded("203.0.113.8, 172.16.0.1")); code != http.StatusOK {
		t.Errorf("another client behind the same proxy must be counted separately, got %d", code)
	}
}
