package fbhttp

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/filebrowser/filebrowser/v2/settings"
	"github.com/filebrowser/filebrowser/v2/users"
)

func TestUploadSizeLimit(t *testing.T) {
	scope := t.TempDir()
	key := []byte("test-signing-key")
	perm := users.Permissions{Create: true, Modify: true}
	st := scopedUserStorage(t, scope, perm, key)
	config, err := st.Settings.Get()
	if err != nil {
		t.Fatal(err)
	}
	config.MaxUploadSizeMB = 1
	config.UploadImagesOnly = true
	if err := st.Settings.Save(config); err != nil {
		t.Fatal(err)
	}
	token := signToken(t, perm, key)
	cache := newMemoryUploadCache()
	t.Cleanup(cache.Close)
	post := handle(tusPostHandler(cache), "", st, &settings.Server{})
	req := httptest.NewRequest("POST", "/large.gif", http.NoBody)
	req.Header.Set("X-Auth", token)
	req.Header.Set("Upload-Length", "1048577")
	rec := httptest.NewRecorder()
	post.ServeHTTP(rec, req)
	if rec.Code != 413 {
		t.Fatalf("TUS size limit: %d", rec.Code)
	}
	if _, err := os.Stat(scope + "/large.gif"); !os.IsNotExist(err) {
		t.Fatal("oversized TUS created a file")
	}
	if err := os.WriteFile(scope+"/existing.gif", []byte("GIF89a-original"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"POST", "PUT"} {
		handler := handle(resourcePostHandler(nil), "", st, &settings.Server{})
		if method == "PUT" {
			handler = handle(resourcePutHandler, "", st, &settings.Server{})
		}
		target := "/existing.gif"
		if method == "POST" {
			target = "/new.gif"
		}
		req = httptest.NewRequest(method, target+"?override=true", strings.NewReader("GIF89a"+strings.Repeat("x", 1<<20)))
		req.ContentLength = -1 // Chunked uploads must also be bounded.
		req.Header.Set("X-Auth", token)
		rec = httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != 413 {
			t.Fatalf("%s size limit: %d %s", method, rec.Code, rec.Body.String())
		}
		saved, _ := os.ReadFile(scope + "/existing.gif")
		if string(saved) != "GIF89a-original" {
			t.Fatal("oversized upload changed existing file")
		}
	}
	entries, _ := os.ReadDir(scope)
	if len(entries) != 1 {
		t.Fatal("upload temporary files leaked")
	}
	if (&settings.Settings{}).UploadLimitBytes() != 100<<20 {
		t.Fatal("missing safe default")
	}
}
