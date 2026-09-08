package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/haru-yoshi-5/learning-web-builder/backend/internal/concept"
)

// 会話履歴を毎回まとめて受け取るため、生成APIの16KBでは足りない。
const maxConceptChatBodySize = 64 << 10

type conceptChatRequest struct {
	Messages []concept.Message `json:"messages"`
	Draft    concept.Draft     `json:"draft"`
}

// conceptChat は、生成前のコンセプトを固める相談の1ターンを返す。
//
// 生成APIと同じく、AIを使えないときは静的な応答へ落として画面を止めない。
// ここで site.Model には一切触れないため、進行中の下書きは影響を受けない。
func conceptChat(advisor ConceptAdvisor) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		request.Body = http.MaxBytesReader(writer, request.Body, maxConceptChatBodySize)
		var input conceptChatRequest
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

		if err := concept.ValidateMessages(input.Messages); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := concept.ValidateDraft(input.Draft); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		if advisor != nil {
			reply, err := advisor.Chat(request.Context(), input.Messages, input.Draft)
			if err == nil {
				err = sanitizeReply(&reply, input.Draft)
			}
			if err == nil {
				writeConceptReply(writer, reply, "gemini")
				return
			}
			log.Printf("concept chat failed; using static fallback request_id=%s error=%v", middleware.GetReqID(request.Context()), err)
		}

		writeConceptReply(writer, concept.Fallback(input.Messages, input.Draft), "static-sample")
	}
}

func writeConceptReply(writer http.ResponseWriter, reply concept.Reply, provider string) {
	// choices と missing は、空でも配列として返す。
	// null が来るとフロントで分岐が増えるため。
	if reply.Choices == nil {
		reply.Choices = []string{}
	}
	if reply.Missing == nil {
		reply.Missing = []string{}
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"reply":    reply.Reply,
		"choices":  reply.Choices,
		"draft":    reply.Draft,
		"missing":  reply.Missing,
		"ready":    reply.Ready,
		"provider": provider,
	})
}

// sanitizeReply は、Advisor が返した内容をこの層でもう一度整える。
//
// いまの Gemini 実装は自分で検証しているが、それはインターフェースの約束ではない。
// 別の実装に差し替わっても、確定済みの下書きが壊れたり、
// 空欄のまま ready が立ったりしないよう、ここで最後にそろえ直す。
func sanitizeReply(reply *concept.Reply, confirmed concept.Draft) error {
	reply.Draft = concept.MergeConfirmed(confirmed, reply.Draft)
	reply.Missing = concept.MissingFields(reply.Draft)
	reply.Ready = concept.IsReady(reply.Draft)
	return concept.ValidateReply(*reply)
}
