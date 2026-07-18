package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/httpapi"
)

func main() {
	port := envOr("PORT", "8080")
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           httpapi.NewRouter(httpapi.Config{FrontendOrigin: envOr("FRONTEND_ORIGIN", "http://localhost:5173")}),
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
