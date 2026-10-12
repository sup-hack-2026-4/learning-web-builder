package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	authn "github.com/haru-yoshi-5/learning-web-builder/backend/internal/auth"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/concept"
	projectpkg "github.com/haru-yoshi-5/learning-web-builder/backend/internal/project"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"go.yaml.in/yaml/v3"
)

// openapi/openapi.yaml と実装の食い違いを確かめる(#124)。
// 仕様書は手で書いているため、実装だけを直すと気づかないままずれていく。
// ここでは実際のルーターを呼び、受け付ける入力と返す応答を仕様書のスキーマで検証する。
//
// OpenAPIの文書としての妥当性(必須の項目や書式)は、CIの openapi-spec-validator で別に確かめる。

const (
	openAPIPath     = "../../../openapi/openapi.yaml"
	openAPIResource = "https://openapi.test/openapi.json"
	// 仕様書の servers に書いた、全エンドポイント共通の接頭辞。
	apiPrefix = "/api/v1"
	jsonMedia = "application/json"
)

var openAPIMethods = []string{"get", "post", "put", "delete", "patch"}

type openAPIContract struct {
	t        *testing.T
	document map[string]any
	compiler *jsonschema.Compiler
}

func loadOpenAPIContract(t *testing.T) openAPIContract {
	t.Helper()
	source, err := os.ReadFile(openAPIPath)
	if err != nil {
		t.Fatalf("read OpenAPI document: %v", err)
	}
	var parsed any
	if err := yaml.Unmarshal(source, &parsed); err != nil {
		t.Fatalf("parse OpenAPI document: %v", err)
	}
	// 検証器はJSONとして読んだ値を前提にするため、YAMLの値をJSONへ通してから渡す。
	encoded, err := json.Marshal(parsed)
	if err != nil {
		t.Fatalf("encode OpenAPI document: %v", err)
	}
	document, err := jsonschema.UnmarshalJSON(bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("decode OpenAPI document: %v", err)
	}
	root, ok := document.(map[string]any)
	if !ok {
		t.Fatalf("expected the OpenAPI document to be an object, got %T", document)
	}
	compiler := jsonschema.NewCompiler()
	compiler.AssertFormat()
	if err := compiler.AddResource(openAPIResource, document); err != nil {
		t.Fatalf("register OpenAPI document: %v", err)
	}
	return openAPIContract{t: t, document: root, compiler: compiler}
}

// pointer は、JSON Pointerの1区切りとして使えるように値を書き換えてつなぐ。
func pointer(tokens ...string) string {
	var builder strings.Builder
	for _, token := range tokens {
		builder.WriteString("/")
		builder.WriteString(strings.NewReplacer("~", "~0", "/", "~1").Replace(token))
	}
	return builder.String()
}

// lookup は、仕様書の中をたどって値を返す。途中の $ref は文書内の参照として解決する。
func (contract openAPIContract) lookup(tokens ...string) (any, string, bool) {
	var current any = contract.document
	location := ""
	for _, token := range tokens {
		object, ok := current.(map[string]any)
		if !ok {
			return nil, "", false
		}
		next, exists := object[token]
		if !exists {
			return nil, "", false
		}
		current = next
		location += pointer(token)
		// スキーマの中の $ref は検証器が解決するため、ここではたどらない。
		// それ以外(応答など)は、参照の先がまた参照でも最後までたどる。
		for token != "schema" {
			referenced, ok := current.(map[string]any)
			if !ok {
				break
			}
			reference, ok := referenced["$ref"].(string)
			if !ok {
				break
			}
			current, location = contract.dereference(reference)
		}
	}
	return current, location, true
}

func (contract openAPIContract) dereference(reference string) (any, string) {
	contract.t.Helper()
	location, ok := strings.CutPrefix(reference, "#")
	if !ok {
		contract.t.Fatalf("expected a reference inside the document, got %q", reference)
	}
	var current any = contract.document
	for token := range strings.SplitSeq(strings.TrimPrefix(location, "/"), "/") {
		token = strings.NewReplacer("~1", "/", "~0", "~").Replace(token)
		object, ok := current.(map[string]any)
		if !ok {
			contract.t.Fatalf("reference %q does not resolve", reference)
		}
		if current, ok = object[token]; !ok {
			contract.t.Fatalf("reference %q does not resolve", reference)
		}
	}
	return current, location
}

// compile は、仕様書の中の位置にあるスキーマを検証できる形にする。
// 参照切れや、JSON Schemaとして読めない記述はここで失敗する。
func (contract openAPIContract) compile(location string) *jsonschema.Schema {
	contract.t.Helper()
	schema, err := contract.compiler.Compile(openAPIResource + "#" + location)
	if err != nil {
		contract.t.Fatalf("compile schema at %s: %v", location, err)
	}
	return schema
}

// requestSchema は、リクエスト本文のスキーマを返す。本文を取らない操作なら nil。
func (contract openAPIContract) requestSchema(method, path string) *jsonschema.Schema {
	contract.t.Helper()
	_, location, ok := contract.lookup("paths", path, method, "requestBody", "content", jsonMedia, "schema")
	if !ok {
		return nil
	}
	return contract.compile(location)
}

// responseSchema は、そのステータスの応答本文のスキーマを返す。
// documented は仕様書にそのステータスが書かれているか。本文のスキーマが無ければ schema は nil。
func (contract openAPIContract) responseSchema(method, path string, status int) (schema *jsonschema.Schema, documented bool) {
	contract.t.Helper()
	if _, _, ok := contract.lookup("paths", path, method, "responses", strconv.Itoa(status)); !ok {
		return nil, false
	}
	_, location, ok := contract.lookup("paths", path, method, "responses", strconv.Itoa(status), "content", jsonMedia, "schema")
	if !ok {
		return nil, true
	}
	return contract.compile(location), true
}

func decodeJSON(t *testing.T, encoded []byte) any {
	t.Helper()
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("decode JSON %s: %v", encoded, err)
	}
	return value
}

// operations は、仕様書に書かれた操作を「GET /health」の形で返す。
func (contract openAPIContract) operations() []string {
	contract.t.Helper()
	paths, ok := contract.document["paths"].(map[string]any)
	if !ok {
		contract.t.Fatal("expected paths in the OpenAPI document")
	}
	var operations []string
	for path, item := range paths {
		for _, method := range openAPIMethods {
			if _, exists := item.(map[string]any)[method]; exists {
				operations = append(operations, strings.ToUpper(method)+" "+path)
			}
		}
	}
	sort.Strings(operations)
	return operations
}

func TestOpenAPIDescribesExactlyTheRoutesTheRouterServes(t *testing.T) {
	contract := loadOpenAPIContract(t)

	routes, ok := NewRouter(Config{}).(chi.Routes)
	if !ok {
		t.Fatal("expected the router to expose its routes")
	}
	var served []string
	err := chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		path, ok := strings.CutPrefix(route, apiPrefix)
		if !ok {
			return fmt.Errorf("route %s is outside %s", route, apiPrefix)
		}
		served = append(served, method+" "+path)
		return nil
	})
	if err != nil {
		t.Fatalf("walk routes: %v", err)
	}
	sort.Strings(served)

	documented := contract.operations()
	if strings.Join(served, "\n") != strings.Join(documented, "\n") {
		t.Fatalf("routes and OpenAPI operations differ\nrouter:\n%s\nOpenAPI:\n%s", strings.Join(served, "\n"), strings.Join(documented, "\n"))
	}
}

func TestOpenAPISchemasCompile(t *testing.T) {
	contract := loadOpenAPIContract(t)

	schemas, _, ok := contract.lookup("components", "schemas")
	if !ok {
		t.Fatal("expected components.schemas in the OpenAPI document")
	}
	for name := range schemas.(map[string]any) {
		contract.compile(pointer("components", "schemas", name))
	}
	for _, operation := range contract.operations() {
		method, path, _ := strings.Cut(operation, " ")
		method = strings.ToLower(method)
		contract.requestSchema(method, path)
		responses, _, ok := contract.lookup("paths", path, method, "responses")
		if !ok {
			t.Fatalf("expected responses for %s", operation)
		}
		for status := range responses.(map[string]any) {
			code, err := strconv.Atoi(status)
			if err != nil {
				t.Fatalf("expected a numeric status for %s, got %q", operation, status)
			}
			contract.responseSchema(method, path, code)
		}
	}
}

// isObjectSchema は、オブジェクトを表すスキーマかどうか。
// properties を書かずに type: object だけを書いたものも、何でも送れてしまうため含める。
func isObjectSchema(node map[string]any) bool {
	if _, ok := node["properties"].(map[string]any); ok {
		return true
	}
	switch kind := node["type"].(type) {
	case string:
		return kind == "object"
	case []any:
		return slices.Contains(kind, any("object"))
	}
	return false
}

// 実装はリクエストの未知の項目を、入れ子の中も含めて断る。
// 仕様書の側で additionalProperties: false を書き忘れると、仕様では送れて実装では400になる。
// 応答も、書かれていない項目を返さないことを同じ書き方で示す。
func TestOpenAPIObjectSchemasForbidUndeclaredProperties(t *testing.T) {
	contract := loadOpenAPIContract(t)

	var visit func(location string, node any)
	visit = func(location string, node any) {
		switch value := node.(type) {
		case map[string]any:
			if isObjectSchema(value) {
				if allowed, declared := value["additionalProperties"].(bool); !declared || allowed {
					t.Errorf("%s must declare additionalProperties: false", location)
				}
			}
			for key, child := range value {
				visit(location+pointer(key), child)
			}
		case []any:
			for index, child := range value {
				visit(location+pointer(strconv.Itoa(index)), child)
			}
		}
	}
	visit("", contract.document)
}

// contractProjectID は、仕様書の format: uuid を満たす保存済みプロジェクトのID。
const contractProjectID = "11111111-1111-1111-1111-111111111111"

func contractRepository() *stubProjectRepository {
	now := time.Date(2026, time.October, 12, 12, 0, 0, 0, time.UTC)
	record := projectpkg.Record{
		ID:        contractProjectID,
		OwnerID:   "user_123",
		Site:      illustratedSite(),
		Learning:  sampleLearningRecord(),
		Version:   2,
		CreatedAt: now,
		UpdatedAt: now,
	}
	return &stubProjectRepository{
		record:  record,
		records: []projectpkg.Record{record},
		quality: []projectpkg.QualityResult{{
			ID:        "22222222-2222-2222-2222-222222222222",
			ProjectID: contractProjectID,
			CheckKey:  "alt",
			Passed:    true,
			Detail:    "表示中の画像に代替テキストがあります。",
			CheckedAt: now,
		}},
	}
}

func contractProjectBody(t *testing.T, fields string) string {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"site":    illustratedSite(),
		"notes":   sampleLearningRecord().Notes,
		"aiUsage": sampleLearningRecord().AIUsage,
	})
	if err != nil {
		t.Fatalf("marshal project request: %v", err)
	}
	return strings.TrimSuffix(string(body), "}") + fields + "}"
}

const (
	contractGenerateBody = `{"topic":"学校の写真部","concept":{"topic":"学校の写真部","audience":"新入生","goal":"入部してもらう","tone":"明るい","mustInclude":["活動日"]}}`
	contractChatBody     = `{"messages":[{"role":"user","text":"植物園"}],"draft":{"topic":"植物園","audience":"家族連れ"}}`
	contractQualityBody  = `{"results":[{"checkKey":"alt","passed":true,"detail":"表示中の画像に代替テキストがあります。"}]}`
)

// contractCall は、仕様書のパス(path)と、そこへ実際に送るリクエストの組。
type contractCall struct {
	name   string
	method string
	// path は仕様書の書き方({projectId} のまま)。target は実際に呼ぶパス。空なら path と同じ。
	path   string
	target string
	body   string
	config Config
	status int
	// invalidRequest は、断られることを確かめる呼び出し。本文は仕様書のスキーマに合わなくてよい。
	invalidRequest bool
}

// serve は、新しいルーターで1回だけ呼ぶ。AIの回数制限をテスト同士で分け合わないようにするため。
func (call contractCall) serve(body string) *httptest.ResponseRecorder {
	target := call.target
	if target == "" {
		target = call.path
	}
	var request *http.Request
	if body == "" {
		request = httptest.NewRequest(strings.ToUpper(call.method), apiPrefix+target, nil)
	} else {
		request = httptest.NewRequest(strings.ToUpper(call.method), apiPrefix+target, strings.NewReader(body))
		request.Header.Set("Content-Type", jsonMedia)
	}
	response := httptest.NewRecorder()
	NewRouter(call.config).ServeHTTP(response, request)
	return response
}

func TestRequestsAndResponsesMatchOpenAPI(t *testing.T) {
	signedIn := stubAuthenticator{identity: authn.Identity{UserID: "user_123"}}
	withProjects := func(repository *stubProjectRepository) Config {
		return Config{Authenticator: signedIn, Projects: repository}
	}
	failing := func(err error) *stubProjectRepository {
		repository := contractRepository()
		repository.err = err
		return repository
	}
	projectPath := "/projects/{projectId}"
	projectTarget := "/projects/" + contractProjectID
	qualityPath := projectPath + "/quality-results"
	qualityTarget := projectTarget + "/quality-results"

	calls := []contractCall{
		{name: "health", method: "get", path: "/health", status: http.StatusOK},
		{name: "guest session", method: "get", path: "/session", status: http.StatusOK},
		{name: "signed-in session", method: "get", path: "/session", config: Config{Authenticator: signedIn}, status: http.StatusOK},

		{name: "generate with the static sample", method: "post", path: "/generate", body: contractGenerateBody, status: http.StatusOK},
		{
			name: "generate with Gemini", method: "post", path: "/generate", body: contractGenerateBody,
			config: Config{Generator: &stubGenerator{model: illustratedSite()}}, status: http.StatusOK,
		},
		{name: "generate without a topic", method: "post", path: "/generate", body: `{"topic":""}`, status: http.StatusBadRequest, invalidRequest: true},

		{name: "concept chat with the static sample", method: "post", path: "/concept/chat", body: contractChatBody, status: http.StatusOK},
		{
			name: "concept chat with Gemini", method: "post", path: "/concept/chat", body: contractChatBody,
			config: Config{Advisor: &stubAdvisor{reply: concept.Reply{
				Reply:   "このサイトで何をしてほしいですか。",
				Choices: []string{"来園してもらう", "イベントを知ってもらう"},
				Draft:   concept.Draft{Topic: "植物園", Audience: "家族連れ"},
			}}},
			status: http.StatusOK,
		},
		{name: "concept chat without messages", method: "post", path: "/concept/chat", body: `{"messages":[]}`, status: http.StatusBadRequest, invalidRequest: true},

		{name: "create project", method: "post", path: "/projects", body: contractProjectBody(t, ""), config: withProjects(contractRepository()), status: http.StatusCreated},
		{name: "create project with a null base version", method: "post", path: "/projects", body: contractProjectBody(t, `,"baseVersion":null`), config: withProjects(contractRepository()), status: http.StatusCreated},
		{name: "create project as a guest", method: "post", path: "/projects", body: contractProjectBody(t, ""), status: http.StatusUnauthorized},
		{name: "create project without a database", method: "post", path: "/projects", body: contractProjectBody(t, ""), config: Config{Authenticator: signedIn}, status: http.StatusServiceUnavailable},
		{name: "list projects", method: "get", path: "/projects", config: withProjects(contractRepository()), status: http.StatusOK},

		{name: "get project", method: "get", path: projectPath, target: projectTarget, config: withProjects(contractRepository()), status: http.StatusOK},
		{name: "get another owner's project", method: "get", path: projectPath, target: projectTarget, config: withProjects(failing(projectpkg.ErrNotFound)), status: http.StatusNotFound},
		{name: "get project with a malformed ID", method: "get", path: projectPath, target: "/projects/not-a-uuid", config: withProjects(contractRepository()), status: http.StatusBadRequest},
		{name: "update project", method: "put", path: projectPath, target: projectTarget, body: contractProjectBody(t, `,"baseVersion":1`), config: withProjects(contractRepository()), status: http.StatusOK},
		{
			name: "update project changed elsewhere", method: "put", path: projectPath, target: projectTarget, body: contractProjectBody(t, `,"baseVersion":1`),
			config: withProjects(failing(&projectpkg.ConflictError{CurrentVersion: 2})), status: http.StatusConflict,
		},
		{name: "delete project", method: "delete", path: projectPath, target: projectTarget, config: withProjects(contractRepository()), status: http.StatusNoContent},

		{name: "save quality results", method: "post", path: qualityPath, target: qualityTarget, body: contractQualityBody, config: withProjects(contractRepository()), status: http.StatusCreated},
		{name: "list quality results", method: "get", path: qualityPath, target: qualityTarget, config: withProjects(contractRepository()), status: http.StatusOK},
	}

	for _, call := range calls {
		t.Run(call.name, func(t *testing.T) {
			contract := loadOpenAPIContract(t)

			if call.body != "" && !call.invalidRequest {
				schema := contract.requestSchema(call.method, call.path)
				if schema == nil {
					t.Fatalf("expected OpenAPI to describe the request body of %s %s", call.method, call.path)
				}
				if err := schema.Validate(decodeJSON(t, []byte(call.body))); err != nil {
					t.Fatalf("expected OpenAPI to accept the request the server accepts: %v", err)
				}
			}

			response := call.serve(call.body)
			if response.Code != call.status {
				t.Fatalf("expected %d, got %d: %s", call.status, response.Code, response.Body.String())
			}
			schema, documented := contract.responseSchema(call.method, call.path, response.Code)
			if !documented {
				t.Fatalf("expected OpenAPI to describe status %d of %s %s", response.Code, call.method, call.path)
			}
			// 本文のスキーマを書いていなくてよいのは、エラーと、本文を返さない応答(204)だけ。
			// それらは、ステータスが書かれていることだけを確かめる。
			if schema == nil {
				if response.Code < http.StatusMultipleChoices && response.Body.Len() > 0 {
					t.Fatalf("expected OpenAPI to describe the body of status %d of %s %s: %s", response.Code, call.method, call.path, response.Body.String())
				}
				return
			}
			if err := schema.Validate(decodeJSON(t, response.Body.Bytes())); err != nil {
				t.Fatalf("expected the response to match OpenAPI: %v\n%s", err, response.Body.String())
			}
		})
	}
}

// eachObject は、JSONの値に含まれるオブジェクトを、決まった順にすべて訪ねる。
func eachObject(location string, value any, visit func(location string, object map[string]any)) {
	switch node := value.(type) {
	case map[string]any:
		visit(location, node)
		keys := make([]string, 0, len(node))
		for key := range node {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			eachObject(location+"."+key, node[key], visit)
		}
	case []any:
		for index, child := range node {
			eachObject(fmt.Sprintf("%s[%d]", location, index), child, visit)
		}
	}
}

// undeclaredFields は、オブジェクトへ足して試す、仕様書に無い項目名を返す。
// まったく知らない名前に加えて、既にある項目の大文字違いも足す。encoding/json は項目名の
// 大文字と小文字を区別せずに突き合わせるため、DisallowUnknownFields だけでは後者を断れない。
func undeclaredFields(object map[string]any) []string {
	names := []string{"unknownField"}
	for key := range object {
		if upper := strings.ToUpper(key); upper != key {
			names = append(names, upper)
		}
	}
	sort.Strings(names)
	return names
}

// addUndeclaredField は、項目を足す。既にある項目の大文字違いには元の値を入れ、
// 値の型が合わないことを理由に断られないようにする。
func addUndeclaredField(object map[string]any, name string) {
	var value any = true
	for key, existing := range object {
		if key != name && strings.ToUpper(key) == name {
			value = existing
		}
	}
	object[name] = value
}

// 受け付けるリクエストのどの階層に未知の項目を足しても、仕様書と実装がそろって断ることを確かめる。
func TestUnknownFieldsAreRejectedByBothOpenAPIAndTheServer(t *testing.T) {
	signedIn := Config{Authenticator: stubAuthenticator{identity: authn.Identity{UserID: "user_123"}}}
	withProjects := func() Config {
		config := signedIn
		config.Projects = contractRepository()
		return config
	}
	projectPath := "/projects/{projectId}"
	projectTarget := "/projects/" + contractProjectID

	calls := []contractCall{
		{name: "generate", method: "post", path: "/generate", body: contractGenerateBody, status: http.StatusOK},
		{name: "concept chat", method: "post", path: "/concept/chat", body: contractChatBody, status: http.StatusOK},
		{name: "create project", method: "post", path: "/projects", body: contractProjectBody(t, ""), config: withProjects(), status: http.StatusCreated},
		{name: "update project", method: "put", path: projectPath, target: projectTarget, body: contractProjectBody(t, `,"baseVersion":1`), config: withProjects(), status: http.StatusOK},
		{
			name: "save quality results", method: "post", path: projectPath + "/quality-results", target: projectTarget + "/quality-results",
			body: contractQualityBody, config: withProjects(), status: http.StatusCreated,
		},
	}

	for _, call := range calls {
		t.Run(call.name, func(t *testing.T) {
			contract := loadOpenAPIContract(t)
			schema := contract.requestSchema(call.method, call.path)
			if schema == nil {
				t.Fatalf("expected OpenAPI to describe the request body of %s %s", call.method, call.path)
			}
			// 足す前の本文が通らなければ、足したあとに断られても未知の項目が理由とは言えない。
			if err := schema.Validate(decodeJSON(t, []byte(call.body))); err != nil {
				t.Fatalf("expected OpenAPI to accept the unmodified request: %v", err)
			}
			if response := call.serve(call.body); response.Code != call.status {
				t.Fatalf("expected the server to accept the unmodified request with %d, got %d: %s", call.status, response.Code, response.Body.String())
			}

			var additions [][]string
			eachObject("$", decodeJSON(t, []byte(call.body)), func(_ string, object map[string]any) {
				additions = append(additions, undeclaredFields(object))
			})
			for target, names := range additions {
				for _, name := range names {
					body := decodeJSON(t, []byte(call.body))
					index, location := 0, ""
					eachObject("$", body, func(current string, object map[string]any) {
						if index == target {
							addUndeclaredField(object, name)
							location = current + "." + name
						}
						index++
					})
					t.Run(location, func(t *testing.T) {
						if err := schema.Validate(body); err == nil {
							t.Errorf("expected OpenAPI to reject the undeclared field %s", location)
						}
						encoded, err := json.Marshal(body)
						if err != nil {
							t.Fatalf("marshal request: %v", err)
						}
						if response := call.serve(string(encoded)); response.Code != http.StatusBadRequest {
							t.Errorf("expected the server to reject the undeclared field %s with 400, got %d: %s", location, response.Code, response.Body.String())
						}
					})
				}
			}
		})
	}
}
