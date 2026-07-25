package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
)

type Config struct {
	AllowedOrigins []string
	Generator      SiteGenerator
}

type SiteGenerator interface {
	Generate(context.Context, string) (site.Model, error)
}

type generateRequest struct {
	Topic string `json:"topic"`
}

func NewRouter(config Config) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Recoverer)
	router.Use(middleware.Timeout(30 * time.Second))
	router.Use(cors(config.AllowedOrigins))

	router.Route("/api/v1", func(api chi.Router) {
		api.Get("/health", func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, http.StatusOK, map[string]string{"service": "learning-web-builder-api", "status": "ok", "version": "0.1.0"})
		})
		api.Post("/generate", generate(config.Generator))
	})

	return router
}

func generate(generator SiteGenerator) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		request.Body = http.MaxBytesReader(writer, request.Body, 16<<10)
		var input generateRequest
		decoder := json.NewDecoder(request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		input.Topic = strings.TrimSpace(input.Topic)
		if input.Topic == "" || len([]rune(input.Topic)) > 100 {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "topic must be between 1 and 100 characters"})
			return
		}

		if generator != nil {
			generatedSite, err := generator.Generate(request.Context(), input.Topic)
			if err == nil {
				err = site.Validate(generatedSite)
			}
			if err == nil {
				writeJSON(writer, http.StatusOK, map[string]any{"site": generatedSite, "provider": "gemini"})
				return
			}
			log.Printf("Gemini generation failed; using static fallback request_id=%s error=%v", middleware.GetReqID(request.Context()), err)
		}

		fallback := site.Sample(input.Topic)
		if err := site.Validate(fallback); err != nil {
			log.Printf("static fallback validation failed request_id=%s error=%v", middleware.GetReqID(request.Context()), err)
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "site generation failed"})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"site": fallback, "provider": "static-sample"})
	}
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
