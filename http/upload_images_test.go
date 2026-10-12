package fbhttp

import (
	"bytes"
	"github.com/filebrowser/filebrowser/v2/settings"
	"github.com/filebrowser/filebrowser/v2/users"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestImageUploadHeaders(t *testing.T) {
	for _, test := range []struct {
		path    string
		header  []byte
		allowed bool
	}{
		{"a.JPG", []byte{0xff, 0xd8, 0xff, 0xe0}, true},
		{"a.png", []byte("\x89PNG\r\n\x1a\n"), true},
		{"a.gif", []byte("GIF89a"), true},
		{"a.webp", []byte("RIFF1234WEBP"), true},
		{"a.avif", []byte("\x00\x00\x00\x18ftypavif\x00\x00\x00\x00"), true},
		{"a.jpg", []byte("<script>alert(1)</script>"), false},
		{"a.jpg", []byte("\x89PNG\r\n\x1a\n"), false},
		{"a.svg", []byte("<svg/>"), false},
		{"a.png", nil, false},
	} {
		t.Run(test.path+string(test.header), func(t *testing.T) {
			_, err := validateImageUploadBody(test.path, bytes.NewReader(test.header))
			if (err == nil) != test.allowed {
				t.Fatalf("allowed=%v, err=%v", test.allowed, err)
			}
		})
	}
}

func TestImageOnlyUploadEndpoints(t *testing.T) {
	scope := t.TempDir()
	key := []byte("test-signing-key")
	perm := users.Permissions{Create: true, Modify: true}
	st := scopedUserStorage(t, scope, perm, key)
	config, err := st.Settings.Get()
	if err != nil {
		t.Fatal(err)
	}
	config.UploadImagesOnly = true
	if err := st.Settings.Save(config); err != nil {
		t.Fatal(err)
	}
	token := signToken(t, perm, key)
	cache := newMemoryUploadCache()
	t.Cleanup(cache.Close)
	request := func(handler http.Handler, method, path, body string, headers map[string]string) int {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("X-Auth", token)
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}
	post := handle(tusPostHandler(cache), "", st, &settings.Server{})
	patch := handle(tusPatchHandler(cache), "", st, &settings.Server{})
	if code := request(post, "POST", "/bad.txt", "", map[string]string{"Upload-Length": "4"}); code != 415 {
		t.Fatalf("non-image POST: %d", code)
	}
	for _, content := range []string{"fake image", "GIF89a"} {
		if code := request(post, "POST", "/image.gif", "", map[string]string{"Upload-Length": strconv.Itoa(len(content))}); code != 201 {
			t.Fatalf("POST: %d", code)
		}
		code := request(patch, "PATCH", "/image.gif", content, map[string]string{"Upload-Offset": "0", "Content-Type": "application/offset+octet-stream"})
		if content == "fake image" {
			if code != 415 {
				t.Fatalf("fake PATCH: %d", code)
			}
			if _, err := os.Stat(scope + "/image.gif"); !os.IsNotExist(err) {
				t.Fatal("rejected upload left on disk")
			}
		} else if code != 204 {
			t.Fatalf("image PATCH: %d", code)
		}
	}
	resource := handle(resourcePostHandler(nil), "", st, &settings.Server{})
	if code := request(resource, "POST", "/folder/", "", nil); code != 200 {
		t.Fatalf("directory POST: %d", code)
	}
	if code := request(resource, "POST", "/fake.png", "text", nil); code != 415 {
		t.Fatalf("ordinary POST: %d", code)
	}
}
