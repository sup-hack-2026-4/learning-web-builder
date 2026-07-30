package main

import (
	"context"
	"log"
	"net/http"
	"os"
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
	routerConfig := httpapi.Config{
		AllowedOrigins: allowedOrigins,
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

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
