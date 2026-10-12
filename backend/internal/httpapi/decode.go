package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"
)

// decodeRequestJSON は、リクエストの本文を1つのJSONの値として destination へ読み込み、読んだ本文を返す。
// 型に無い項目と、2つ目以降の値は断る。本文の大きさの上限は、呼び出す側が http.MaxBytesReader で決める。
func decodeRequestJSON(request *http.Request, destination any) ([]byte, error) {
	body, err := io.ReadAll(request.Body)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("request body must contain a single JSON value")
	}
	// encoding/json は項目名の大文字と小文字を区別せずに突き合わせるため、DisallowUnknownFields だけでは
	// "TOPIC" が "topic" として通る。"topic" と両方を送ると、後に書いた方が黙って使われる。
	// OpenAPIはどちらも未知の項目として断るので、名前が完全に一致することをここで確かめる(#124)。
	if err := checkFieldNames(body, reflect.TypeOf(destination)); err != nil {
		return nil, err
	}
	return body, nil
}

var jsonUnmarshalerType = reflect.TypeFor[json.Unmarshaler]()

// checkFieldNames は、JSONのオブジェクトの項目名が、読み込み先の型のjsonタグと完全に一致するかを確かめる。
// 値の型が合うかは見ない。読み込みに成功したあとで呼ぶ前提で、型の合わない値は黙って通す。
func checkFieldNames(raw json.RawMessage, target reflect.Type) error {
	for target.Kind() == reflect.Pointer {
		target = target.Elem()
	}
	// 自分で読み込む型は、項目名の決まりを外から知る方法がない。
	if reflect.PointerTo(target).Implements(jsonUnmarshalerType) {
		return nil
	}
	switch target.Kind() {
	case reflect.Struct:
		var object map[string]json.RawMessage
		if err := json.Unmarshal(raw, &object); err != nil {
			return nil
		}
		fields := jsonFields(target)
		for name, value := range object {
			field, ok := fields[name]
			if !ok {
				return fmt.Errorf("unknown field %q", name)
			}
			if err := checkFieldNames(value, field); err != nil {
				return err
			}
		}
	case reflect.Slice, reflect.Array:
		var items []json.RawMessage
		if err := json.Unmarshal(raw, &items); err != nil {
			return nil
		}
		for _, item := range items {
			if err := checkFieldNames(item, target.Elem()); err != nil {
				return err
			}
		}
	case reflect.Map:
		var entries map[string]json.RawMessage
		if err := json.Unmarshal(raw, &entries); err != nil {
			return nil
		}
		for _, entry := range entries {
			if err := checkFieldNames(entry, target.Elem()); err != nil {
				return err
			}
		}
	}
	return nil
}

// jsonFields は、構造体がJSONで受け取る項目名と、その型を返す。
func jsonFields(target reflect.Type) map[string]reflect.Type {
	fields := make(map[string]reflect.Type, target.NumField())
	for index := range target.NumField() {
		field := target.Field(index)
		name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
		if name == "-" {
			continue
		}
		// 名前を付けずに埋め込んだ構造体の項目は、外側の項目として受け取る。
		if field.Anonymous && name == "" {
			embedded := field.Type
			for embedded.Kind() == reflect.Pointer {
				embedded = embedded.Elem()
			}
			if embedded.Kind() == reflect.Struct {
				for promoted, promotedType := range jsonFields(embedded) {
					if _, exists := fields[promoted]; !exists {
						fields[promoted] = promotedType
					}
				}
				continue
			}
		}
		if !field.IsExported() {
			continue
		}
		if name == "" {
			name = field.Name
		}
		fields[name] = field.Type
	}
	return fields
}
