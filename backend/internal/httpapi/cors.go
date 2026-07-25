package httpapi

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
)

var (
	allowedCORSMethods = map[string]struct{}{
		http.MethodGet:     {},
		http.MethodPost:    {},
		http.MethodPut:     {},
		http.MethodDelete:  {},
		http.MethodOptions: {},
	}
	allowedCORSHeaders = map[string]struct{}{
		"authorization": {},
		"content-type":  {},
	}
)

// ParseAllowedOrigins validates a comma-separated list of browser origins.
func ParseAllowedOrigins(rawOrigins string) ([]string, error) {
	if strings.TrimSpace(rawOrigins) == "" {
		return nil, nil
	}

	seen := make(map[string]struct{})
	origins := make([]string, 0)
	for _, rawOrigin := range strings.Split(rawOrigins, ",") {
		origin, err := normalizeOrigin(rawOrigin)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[origin]; exists {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	return origins, nil
}

func cors(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[origin] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			requestOrigin := request.Header.Get("Origin")
			if requestOrigin == "" {
				next.ServeHTTP(writer, request)
				return
			}

			writer.Header().Add("Vary", "Origin")
			normalizedOrigin, err := normalizeOrigin(requestOrigin)
			if err != nil {
				writeJSON(writer, http.StatusForbidden, map[string]string{"error": "origin is not allowed"})
				return
			}
			if _, exists := allowed[normalizedOrigin]; !exists {
				writeJSON(writer, http.StatusForbidden, map[string]string{"error": "origin is not allowed"})
				return
			}

			writer.Header().Set("Access-Control-Allow-Origin", normalizedOrigin)
			if !isPreflight(request) {
				next.ServeHTTP(writer, request)
				return
			}

			writer.Header().Add("Vary", "Access-Control-Request-Method")
			writer.Header().Add("Vary", "Access-Control-Request-Headers")
			requestedMethod := strings.ToUpper(strings.TrimSpace(request.Header.Get("Access-Control-Request-Method")))
			if _, exists := allowedCORSMethods[requestedMethod]; !exists {
				writeJSON(writer, http.StatusForbidden, map[string]string{"error": "CORS method is not allowed"})
				return
			}
			if !corsHeadersAllowed(request.Header.Get("Access-Control-Request-Headers")) {
				writeJSON(writer, http.StatusForbidden, map[string]string{"error": "CORS headers are not allowed"})
				return
			}

			writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			writer.Header().Set("Access-Control-Max-Age", "600")
			writer.WriteHeader(http.StatusNoContent)
		})
	}
}

func normalizeOrigin(rawOrigin string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawOrigin))
	if err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" ||
		parsed.User != nil ||
		parsed.RawQuery != "" ||
		parsed.Fragment != "" ||
		(parsed.Path != "" && parsed.Path != "/") {
		return "", errors.New("frontend origin must be an http(s) origin without a path, query, or fragment")
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), nil
}

func isPreflight(request *http.Request) bool {
	return request.Method == http.MethodOptions &&
		request.Header.Get("Access-Control-Request-Method") != ""
}

func corsHeadersAllowed(rawHeaders string) bool {
	if strings.TrimSpace(rawHeaders) == "" {
		return true
	}
	for _, rawHeader := range strings.Split(rawHeaders, ",") {
		header := strings.ToLower(strings.TrimSpace(rawHeader))
		if _, exists := allowedCORSHeaders[header]; !exists {
			return false
		}
	}
	return true
}
