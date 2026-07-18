package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
)

type Config struct {
	FrontendOrigin string
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
	router.Use(cors(config.FrontendOrigin))

	router.Route("/api/v1", func(api chi.Router) {
		api.Get("/health", func(writer http.ResponseWriter, _ *http.Request) {
			writeJSON(writer, http.StatusOK, map[string]string{"service": "learning-web-builder-api", "status": "ok", "version": "0.1.0"})
		})
		api.Post("/generate", generate)
	})

	return router
}

func generate(writer http.ResponseWriter, request *http.Request) {
	request.Body = http.MaxBytesReader(writer, request.Body, 16<<10)
	var input generateRequest
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	input.Topic = strings.TrimSpace(input.Topic)
	if input.Topic == "" || len([]rune(input.Topic)) > 100 {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "topic must be between 1 and 100 characters"})
		return
	}

	// 初期版は常に監修済み静的サンプルを返す。Gemini連携時も同じ構造へ検証してから返す。
	writeJSON(writer, http.StatusOK, map[string]any{"site": site.Sample(input.Topic), "provider": "static-sample"})
}

func cors(origin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			writer.Header().Set("Access-Control-Allow-Origin", origin)
			writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			if request.Method == http.MethodOptions {
				writer.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(writer, request)
		})
	}
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
