package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	clerkhttp "github.com/clerk/clerk-sdk-go/v2/http"
)

func TestOptionalAllowsGuestWithoutAuthorizationHeader(t *testing.T) {
	authenticator := newTestAuthenticator(t)
	request := httptest.NewRequest(http.MethodGet, "/session", nil)
	response := httptest.NewRecorder()

	authenticator.Optional(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if _, ok := IdentityFromContext(request.Context()); ok {
			t.Error("guest request must not contain an identity")
		}
		writer.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", response.Code, response.Body.String())
	}
}

func TestOptionalAddsIdentityForValidToken(t *testing.T) {
	privateKey := generatePrivateKey(t)
	authenticator := newTestAuthenticatorWithKey(t, privateKey)
	token := signToken(t, privateKey, "user_123", "http://localhost:5173")
	request := httptest.NewRequest(http.MethodGet, "/session", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()

	authenticator.Optional(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		identity, ok := IdentityFromContext(request.Context())
		if !ok || identity.UserID != "user_123" {
			t.Fatalf("unexpected identity: %#v, %t", identity, ok)
		}
		writer.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", response.Code, response.Body.String())
	}
}

func TestOptionalRejectsUnauthorizedParty(t *testing.T) {
	privateKey := generatePrivateKey(t)
	authenticator := newTestAuthenticatorWithKey(t, privateKey)
	token := signToken(t, privateKey, "user_123", "https://attacker.example")
	request := httptest.NewRequest(http.MethodGet, "/session", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()

	authenticator.Optional(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler must not be called")
	})).ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", response.Code, response.Body.String())
	}
}

func TestOptionalRejectsExpiredToken(t *testing.T) {
	privateKey := generatePrivateKey(t)
	authenticator := newTestAuthenticatorWithKey(t, privateKey)
	token := signTokenWithExpiry(t, privateKey, "user_123", "http://localhost:5173", time.Now().Add(-time.Hour))
	request := httptest.NewRequest(http.MethodGet, "/session", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()

	authenticator.Optional(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler must not be called")
	})).ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", response.Code, response.Body.String())
	}
}

func TestOptionalRejectsMalformedToken(t *testing.T) {
	authenticator := newTestAuthenticator(t)
	request := httptest.NewRequest(http.MethodGet, "/session", nil)
	request.Header.Set("Authorization", "Bearer invalid")
	response := httptest.NewRecorder()

	authenticator.Optional(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler must not be called")
	})).ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", response.Code, response.Body.String())
	}
}

func newTestAuthenticator(t *testing.T) *Authenticator {
	t.Helper()
	return newTestAuthenticatorWithKey(t, generatePrivateKey(t))
}

func newTestAuthenticatorWithKey(t *testing.T, privateKey *rsa.PrivateKey) *Authenticator {
	t.Helper()
	publicKeyDER, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}
	publicKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicKeyDER})
	return newAuthenticator(
		clerkhttp.JSONWebKey(string(publicKeyPEM)),
		clerkhttp.AuthorizedPartyMatches("http://localhost:5173"),
	)
}

func generatePrivateKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate private key: %v", err)
	}
	return privateKey
}

func signToken(t *testing.T, privateKey *rsa.PrivateKey, subject, authorizedParty string) string {
	return signTokenWithExpiry(t, privateKey, subject, authorizedParty, time.Now().Add(time.Hour))
}

func signTokenWithExpiry(t *testing.T, privateKey *rsa.PrivateKey, subject, authorizedParty string, expiresAt time.Time) string {
	t.Helper()
	now := time.Now()
	header := encodeJSON(t, map[string]any{"alg": "RS256", "kid": "test-key", "typ": "JWT"})
	payload := encodeJSON(t, map[string]any{
		"iss": "https://clerk.example",
		"sub": subject,
		"sid": "sess_123",
		"azp": authorizedParty,
		"iat": now.Unix(),
		"nbf": now.Add(-time.Minute).Unix(),
		"exp": expiresAt.Unix(),
		"v":   2,
		"fva": []int64{1, -1},
	})
	signingInput := header + "." + payload
	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func encodeJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode JSON: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(encoded)
}
