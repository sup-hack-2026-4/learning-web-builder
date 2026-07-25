package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/gemini"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/httpapi"
)

func main() {
	port := envOr("PORT", "8080")
	routerConfig := httpapi.Config{
		FrontendOrigin: envOr("FRONTEND_ORIGIN", "http://localhost:5173"),
	}
	if apiKey := os.Getenv("GEMINI_API_KEY"); apiKey != "" {
		geminiClient, err := gemini.NewClient(gemini.Config{
			APIKey:     apiKey,
			Model:      envOr("GEMINI_MODEL", "gemini-2.5-flash"),
			HTTPClient: &http.Client{Timeout: 20 * time.Second},
		})
		if err != nil {
			log.Fatalf("configure Gemini client: %v", err)
		}
		routerConfig.Generator = geminiClient
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
