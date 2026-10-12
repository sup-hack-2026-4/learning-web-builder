package httpapi

import (
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
)

const forwardedForHeader = "X-Forwarded-For"

// ParseTrustedProxyHops は、手前にある信頼できるプロキシの段数を読む。空なら0（プロキシなし）。
func ParseTrustedProxyHops(rawHops string) (int, error) {
	if strings.TrimSpace(rawHops) == "" {
		return 0, nil
	}
	hops, err := strconv.Atoi(strings.TrimSpace(rawHops))
	if err != nil || hops < 0 {
		return 0, errors.New("trusted proxy hops must be a non-negative integer")
	}
	return hops, nil
}

// clientIP は、回数を数える単位にするクライアントのIPを返す。
//
// X-Forwarded-For は、プロキシが受け取った値の末尾に接続元のIPを足していく。
// 先頭側はクライアントが好きな値を送れるため、信頼できるのは手前のプロキシが足した末尾側だけになる。
// そこで、信頼できるプロキシの段数だけ右から数えた値を使う。
// True-Client-IP と X-Real-IP は、プロキシが上書きする保証がないため見ない(#132)。
func clientIP(request *http.Request, trustedProxyHops int) string {
	if trustedProxyHops > 0 {
		// ヘッダーが複数行に分かれて届いても、行の順序は保たれる。
		forwarded := strings.Split(strings.Join(request.Header.Values(forwardedForHeader), ","), ",")
		if index := len(forwarded) - trustedProxyHops; index >= 0 {
			if ip := net.ParseIP(strings.TrimSpace(forwarded[index])); ip != nil {
				return ip.String()
			}
		}
	}

	// ポート番号は接続ごとに変わる。残すと、接続を張り直すたびに別のクライアントとして数えてしまう。
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil {
		return request.RemoteAddr
	}
	return host
}
