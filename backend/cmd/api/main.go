package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	authn "github.com/haru-yoshi-5/learning-web-builder/backend/internal/auth"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/gemini"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/httpapi"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/project"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	port := envOr("PORT", "8080")
	allowedOrigins, err := httpapi.ParseAllowedOrigins(envOr("FRONTEND_ORIGIN", "http://localhost:5173"))
	if err != nil {
		log.Fatalf("configure frontend origins: %v", err)
	}
	trustedProxyHops, err := trustedProxyHopsFor(os.Getenv("APP_ENV"), os.Getenv("TRUSTED_PROXY_HOPS"))
	if err != nil {
		log.Fatalf("configure trusted proxies: %v", err)
	}
	routerConfig := httpapi.Config{
		AllowedOrigins:   allowedOrigins,
		TrustedProxyHops: trustedProxyHops,
	}
	if secretKey := os.Getenv("CLERK_SECRET_KEY"); secretKey != "" {
		authenticator, err := authn.NewClerkAuthenticator(secretKey, allowedOrigins, authn.DefaultHTTPClient())
		if err != nil {
			log.Fatalf("configure Clerk authentication: %v", err)
		}
		routerConfig.Authenticator = authenticator
	}
	if apiKey := os.Getenv("GEMINI_API_KEY"); apiKey != "" {
		geminiClient, err := gemini.NewClient(gemini.Config{
			APIKey:        apiKey,
			Model:         envOr("GEMINI_MODEL", "gemini-3.5-flash"),
			FallbackModel: envOr("GEMINI_FALLBACK_MODEL", "gemini-3.5-flash-lite"),
			HTTPClient:    &http.Client{Timeout: 20 * time.Second},
		})
		if err != nil {
			log.Fatalf("configure Gemini client: %v", err)
		}
		routerConfig.Generator = geminiClient
		// 生成と相談で同じクライアントを使う。時間予算だけがメソッド側で違う。
		routerConfig.Advisor = geminiClient
	}
	var databasePool *pgxpool.Pool
	if databaseURL := os.Getenv("DATABASE_URL"); databaseURL != "" {
		databaseContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		databasePool, err = pgxpool.New(databaseContext, databaseURL)
		if err != nil {
			log.Fatalf("configure database pool: %v", err)
		}
		if err := databasePool.Ping(databaseContext); err != nil {
			databasePool.Close()
			log.Fatalf("connect to database: %v", err)
		}
		defer databasePool.Close()
		routerConfig.Projects = project.NewPostgresRepository(databasePool)
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           httpapi.NewRouter(routerConfig),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("learning-web-builder API listening on :%s", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

// trustedProxyHopsFor は、回数制限で信頼するプロキシの段数を決める。
//
// 本番では未設定を許さない。0として動かすと、ゲスト全員がプロキシのIPで1つの枠を分け合ってしまう。
// 起動に失敗すればRenderはデプロイを止め、それまでの版を動かし続ける(#132)。
// プロキシを通さない構成なら、明示的に0を設定する。
func trustedProxyHopsFor(appEnv, rawHops string) (int, error) {
	if appEnv == "production" && strings.TrimSpace(rawHops) == "" {
		return 0, errors.New("TRUSTED_PROXY_HOPS must be set in production")
	}
	return httpapi.ParseTrustedProxyHops(rawHops)
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
