package main

import "testing"

func TestTrustedProxyHopsMustBeSetInProduction(t *testing.T) {
	// 未設定のまま本番へ出すと、ゲスト全員がプロキシのIPで1つの枠を分け合う(#132)。
	for _, rawHops := range []string{"", "  "} {
		if _, err := trustedProxyHopsFor("production", rawHops); err == nil {
			t.Errorf("an unset TRUSTED_PROXY_HOPS (%q) must stop the production server", rawHops)
		}
	}
}

func TestTrustedProxyHopsFor(t *testing.T) {
	tests := []struct {
		appEnv  string
		rawHops string
		want    int
	}{
		// プロキシを通さない本番構成は、明示的に0を設定すれば起動できる。
		{appEnv: "production", rawHops: "0", want: 0},
		{appEnv: "production", rawHops: "2", want: 2},
		// ローカル開発では未設定でよい。
		{appEnv: "development", rawHops: "", want: 0},
		{appEnv: "", rawHops: "", want: 0},
	}
	for _, test := range tests {
		got, err := trustedProxyHopsFor(test.appEnv, test.rawHops)
		if err != nil || got != test.want {
			t.Errorf("trustedProxyHopsFor(%q, %q) = %d, %v; expected %d", test.appEnv, test.rawHops, got, err, test.want)
		}
	}
	if _, err := trustedProxyHopsFor("production", "-1"); err == nil {
		t.Error("an invalid value must be rejected")
	}
}
