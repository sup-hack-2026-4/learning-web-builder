package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/clerk/clerk-sdk-go/v2"
	clerkhttp "github.com/clerk/clerk-sdk-go/v2/http"
	"github.com/clerk/clerk-sdk-go/v2/jwks"
)

type Identity struct {
	UserID string
}

type identityContextKey struct{}

type Authenticator struct {
	verify func(http.Handler) http.Handler
}

func NewClerkAuthenticator(secretKey string, authorizedParties []string, httpClient *http.Client) (*Authenticator, error) {
	if strings.TrimSpace(secretKey) == "" {
		return nil, errors.New("Clerk secret key is required")
	}
	if len(authorizedParties) == 0 {
		return nil, errors.New("at least one Clerk authorized party is required")
	}
	if httpClient == nil {
		return nil, errors.New("Clerk HTTP client is required")
	}

	clientConfig := &clerk.ClientConfig{}
	clientConfig.Key = &secretKey
	clientConfig.HTTPClient = httpClient
	jwksClient := jwks.NewClient(clientConfig)

	return newAuthenticator(
		clerkhttp.JWKSClient(jwksClient),
		clerkhttp.AuthorizedPartyMatches(authorizedParties...),
	), nil
}

func newAuthenticator(options ...clerkhttp.AuthorizationOption) *Authenticator {
	failureHandler := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		writer.WriteHeader(http.StatusUnauthorized)
		_, _ = writer.Write([]byte(`{"error":"invalid authentication token"}` + "\n"))
	})
	options = append(options, clerkhttp.AuthorizationFailureHandler(failureHandler))

	return &Authenticator{
		verify: clerkhttp.WithHeaderAuthorization(options...),
	}
}

// Optional authenticates a supplied bearer token while allowing requests without one.
func (authenticator *Authenticator) Optional(next http.Handler) http.Handler {
	authenticatedHandler := authenticator.verify(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		claims, ok := clerk.SessionClaimsFromContext(request.Context())
		if !ok || strings.TrimSpace(claims.Subject) == "" {
			writeUnauthorized(writer)
			return
		}

		ctx := context.WithValue(request.Context(), identityContextKey{}, Identity{UserID: claims.Subject})
		next.ServeHTTP(writer, request.WithContext(ctx))
	}))

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if strings.TrimSpace(request.Header.Get("Authorization")) == "" {
			next.ServeHTTP(writer, request)
			return
		}
		authenticatedHandler.ServeHTTP(writer, request)
	})
}

func IdentityFromContext(ctx context.Context) (Identity, bool) {
	identity, ok := ctx.Value(identityContextKey{}).(Identity)
	return identity, ok
}

func ContextWithIdentity(ctx context.Context, identity Identity) context.Context {
	return context.WithValue(ctx, identityContextKey{}, identity)
}

func writeUnauthorized(writer http.ResponseWriter) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(http.StatusUnauthorized)
	_, _ = writer.Write([]byte(`{"error":"invalid authentication token"}` + "\n"))
}

func DefaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Second}
}
