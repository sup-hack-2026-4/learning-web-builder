package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/project"
)

const (
	maxQualityResultsPerRequest = 4
	maxQualityDetailLength      = 1000
)

var validQualityCheckKeys = map[string]struct{}{
	"headings": {},
	"alt":      {},
	"mobile":   {},
	"axe":      {},
}

type qualityResultInput struct {
	CheckKey string `json:"checkKey"`
	Passed   bool   `json:"passed"`
	Detail   string `json:"detail"`
}

type saveQualityResultsRequest struct {
	Results []qualityResultInput `json:"results"`
}

type qualityResultResponse struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"projectId"`
	CheckKey  string    `json:"checkKey"`
	Passed    bool      `json:"passed"`
	Detail    string    `json:"detail"`
	CheckedAt time.Time `json:"checkedAt"`
}

type qualityResultListResponse struct {
	Results []qualityResultResponse `json:"results"`
}

func saveQualityResults(repository project.Repository) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		identity, ok := requireIdentity(writer, request)
		if !ok {
			return
		}
		if repository == nil {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "project persistence is unavailable"})
			return
		}
		projectID, ok := validatedProjectID(writer, request)
		if !ok {
			return
		}
		input, ok := decodeQualityResultsRequest(writer, request)
		if !ok {
			return
		}

		results, err := repository.SaveQualityResults(request.Context(), identity.UserID, projectID, input)
		if errors.Is(err, project.ErrNotFound) {
			writeJSON(writer, http.StatusNotFound, map[string]string{"error": "project not found"})
			return
		}
		if err != nil {
			log.Printf("save quality results failed: %v", err)
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "quality results could not be saved"})
			return
		}
		writeJSON(writer, http.StatusCreated, newQualityResultListResponse(results))
	}
}

func listQualityResults(repository project.Repository) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		identity, ok := requireIdentity(writer, request)
		if !ok {
			return
		}
		if repository == nil {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "project persistence is unavailable"})
			return
		}
		projectID, ok := validatedProjectID(writer, request)
		if !ok {
			return
		}

		results, err := repository.ListQualityResults(request.Context(), identity.UserID, projectID)
		if errors.Is(err, project.ErrNotFound) {
			writeJSON(writer, http.StatusNotFound, map[string]string{"error": "project not found"})
			return
		}
		if err != nil {
			log.Printf("list quality results failed: %v", err)
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "quality results could not be loaded"})
			return
		}
		writeJSON(writer, http.StatusOK, newQualityResultListResponse(results))
	}
}

func validatedProjectID(writer http.ResponseWriter, request *http.Request) (string, bool) {
	projectID := chi.URLParam(request, "projectId")
	if _, err := uuid.Parse(projectID); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "projectId must be a UUID"})
		return "", false
	}
	return projectID, true
}

func decodeQualityResultsRequest(writer http.ResponseWriter, request *http.Request) ([]project.QualityResultInput, bool) {
	request.Body = http.MaxBytesReader(writer, request.Body, 64<<10)
	var input saveQualityResultsRequest
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return nil, false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return nil, false
	}
	if len(input.Results) == 0 || len(input.Results) > maxQualityResultsPerRequest {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "results must contain between 1 and 4 items"})
		return nil, false
	}

	seen := make(map[string]struct{}, len(input.Results))
	results := make([]project.QualityResultInput, 0, len(input.Results))
	for _, result := range input.Results {
		if _, exists := validQualityCheckKeys[result.CheckKey]; !exists {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "checkKey is invalid"})
			return nil, false
		}
		if _, exists := seen[result.CheckKey]; exists {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "checkKey must be unique within results"})
			return nil, false
		}
		seen[result.CheckKey] = struct{}{}
		result.Detail = strings.TrimSpace(result.Detail)
		if result.Detail == "" || utf8.RuneCountInString(result.Detail) > maxQualityDetailLength {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "detail must be between 1 and 1000 characters"})
			return nil, false
		}
		results = append(results, project.QualityResultInput{
			CheckKey: result.CheckKey,
			Passed:   result.Passed,
			Detail:   result.Detail,
		})
	}
	return results, true
}

func newQualityResultListResponse(results []project.QualityResult) qualityResultListResponse {
	response := make([]qualityResultResponse, 0, len(results))
	for _, result := range results {
		response = append(response, qualityResultResponse{
			ID:        result.ID,
			ProjectID: result.ProjectID,
			CheckKey:  result.CheckKey,
			Passed:    result.Passed,
			Detail:    result.Detail,
			CheckedAt: result.CheckedAt,
		})
	}
	return qualityResultListResponse{Results: response}
}
