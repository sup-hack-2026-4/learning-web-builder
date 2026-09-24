package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	authn "github.com/haru-yoshi-5/learning-web-builder/backend/internal/auth"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/project"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/site"
)

type saveProjectRequest struct {
	Site site.Model `json:"site"`
}

// saveProjectPresence は、site.Modelではゼロ値と区別できない必須項目が
// リクエストに含まれていたかだけを確かめるための型。
// site.ModelはGeminiの出力や保存済みデータの復元でも使うため、型そのものは変えず、
// 保存APIの入口でだけ省略とnullを拒否する。
type saveProjectPresence struct {
	Site struct {
		Tagline  *string `json:"tagline"`
		Sections []struct {
			Body     *string `json:"body"`
			ImageAlt *string `json:"imageAlt"`
			Visible  *bool   `json:"visible"`
		} `json:"sections"`
	} `json:"site"`
}

func (presence saveProjectPresence) hasRequiredFields() bool {
	if presence.Site.Tagline == nil {
		return false
	}
	for _, section := range presence.Site.Sections {
		if section.Body == nil || section.ImageAlt == nil || section.Visible == nil {
			return false
		}
	}
	return true
}

type projectResponse struct {
	ID        string     `json:"id"`
	Site      site.Model `json:"site"`
	Version   int        `json:"version"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

type projectListResponse struct {
	Projects []projectResponse `json:"projects"`
}

func createProject(repository project.Repository) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		identity, ok := requireIdentity(writer, request)
		if !ok {
			return
		}
		if repository == nil {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "project persistence is unavailable"})
			return
		}

		input, ok := decodeSaveProjectRequest(writer, request)
		if !ok {
			return
		}
		record, err := repository.Create(request.Context(), identity.UserID, input.Site)
		if err != nil {
			log.Printf("create project failed: %v", err)
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "project could not be saved"})
			return
		}
		writeJSON(writer, http.StatusCreated, newProjectResponse(record))
	}
}

func updateProject(repository project.Repository) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		identity, ok := requireIdentity(writer, request)
		if !ok {
			return
		}
		if repository == nil {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "project persistence is unavailable"})
			return
		}

		projectID := chi.URLParam(request, "projectId")
		if _, err := uuid.Parse(projectID); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "projectId must be a UUID"})
			return
		}
		input, ok := decodeSaveProjectRequest(writer, request)
		if !ok {
			return
		}
		record, err := repository.Update(request.Context(), identity.UserID, projectID, input.Site)
		if errors.Is(err, project.ErrNotFound) {
			writeJSON(writer, http.StatusNotFound, map[string]string{"error": "project not found"})
			return
		}
		if err != nil {
			log.Printf("update project failed: %v", err)
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "project could not be saved"})
			return
		}
		writeJSON(writer, http.StatusOK, newProjectResponse(record))
	}
}

func getProject(repository project.Repository) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		identity, ok := requireIdentity(writer, request)
		if !ok {
			return
		}
		if repository == nil {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "project persistence is unavailable"})
			return
		}

		projectID := chi.URLParam(request, "projectId")
		if _, err := uuid.Parse(projectID); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "projectId must be a UUID"})
			return
		}
		record, err := repository.Get(request.Context(), identity.UserID, projectID)
		if errors.Is(err, project.ErrNotFound) {
			writeJSON(writer, http.StatusNotFound, map[string]string{"error": "project not found"})
			return
		}
		if err != nil {
			log.Printf("get project failed: %v", err)
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "project could not be loaded"})
			return
		}
		writeJSON(writer, http.StatusOK, newProjectResponse(record))
	}
}

func deleteProject(repository project.Repository) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		identity, ok := requireIdentity(writer, request)
		if !ok {
			return
		}
		if repository == nil {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "project persistence is unavailable"})
			return
		}

		projectID := chi.URLParam(request, "projectId")
		if _, err := uuid.Parse(projectID); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "projectId must be a UUID"})
			return
		}
		err := repository.Delete(request.Context(), identity.UserID, projectID)
		if errors.Is(err, project.ErrNotFound) {
			writeJSON(writer, http.StatusNotFound, map[string]string{"error": "project not found"})
			return
		}
		if err != nil {
			log.Printf("delete project failed: %v", err)
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "project could not be deleted"})
			return
		}
		writer.WriteHeader(http.StatusNoContent)
	}
}

func listProjects(repository project.Repository) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		identity, ok := requireIdentity(writer, request)
		if !ok {
			return
		}
		if repository == nil {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "project persistence is unavailable"})
			return
		}

		records, err := repository.List(request.Context(), identity.UserID)
		if err != nil {
			log.Printf("list projects failed: %v", err)
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "projects could not be loaded"})
			return
		}
		projects := make([]projectResponse, 0, len(records))
		for _, record := range records {
			projects = append(projects, newProjectResponse(record))
		}
		writeJSON(writer, http.StatusOK, projectListResponse{Projects: projects})
	}
}

func decodeSaveProjectRequest(writer http.ResponseWriter, request *http.Request) (saveProjectRequest, bool) {
	request.Body = http.MaxBytesReader(writer, request.Body, 1<<20)
	// 項目の有無の検査でもう一度読むため、先に本文をまとめて読み込む。
	body, err := io.ReadAll(request.Body)
	if err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return saveProjectRequest{}, false
	}
	var input saveProjectRequest
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return saveProjectRequest{}, false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return saveProjectRequest{}, false
	}
	var presence saveProjectPresence
	if err := json.Unmarshal(body, &presence); err != nil || !presence.hasRequiredFields() {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "site model is invalid"})
		return saveProjectRequest{}, false
	}
	if err := site.Validate(input.Site); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "site model is invalid"})
		return saveProjectRequest{}, false
	}
	return input, true
}

func requireIdentity(writer http.ResponseWriter, request *http.Request) (authn.Identity, bool) {
	identity, ok := authn.IdentityFromContext(request.Context())
	if !ok {
		writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "authentication is required"})
		return authn.Identity{}, false
	}
	return identity, true
}

func newProjectResponse(record project.Record) projectResponse {
	return projectResponse{
		ID:        record.ID,
		Site:      record.Site,
		Version:   record.Version,
		CreatedAt: record.CreatedAt,
		UpdatedAt: record.UpdatedAt,
	}
}
