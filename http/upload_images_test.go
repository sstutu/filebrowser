package fbhttp

import (
	"bytes"
	"github.com/filebrowser/filebrowser/v2/settings"
	"github.com/filebrowser/filebrowser/v2/users"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
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
		{"a.jpg", []byte("\x89PNG\r\n\x1a\n"), true},
		{"a.png", []byte{0xff, 0xd8, 0xff, 0xe0}, true},
		{"a.svg", []byte("<svg/>"), false},
		{"a.png", nil, false},
		{"a.zip", []byte("PK\x03\x04"), true},
		{"empty.zip", []byte("PK\x05\x06"), true},
		{"a.rar", []byte("Rar!\x1a\x07\x00"), true},
		{"a.7z", []byte{'7', 'z', 0xbc, 0xaf, 0x27, 0x1c}, true},
		{"a.gz", []byte{0x1f, 0x8b, 0x08}, true},
		{"a.tgz", []byte{0x1f, 0x8b, 0x08}, true},
		{"fake.zip", []byte("text"), false},
		{"a.MP4", []byte("\x00\x00\x00\x18ftypisom\x00\x00\x00\x00"), true},
		{"a.mov", []byte("\x00\x00\x00\x18ftypqt  \x00\x00\x00\x00"), true},
		{"a.m4v", []byte("\x00\x00\x00\x18ftypM4V \x00\x00\x00\x00"), true},
		{"a.webm", []byte("\x1a\x45\xdf\xa3\x42\x82\x84webm"), true},
		{"a.mkv", []byte("\x1a\x45\xdf\xa3\x42\x82\x88matroska"), true},
		{"a.avi", []byte("RIFF1234AVI "), true},
		{"a.mp4", []byte("not a video"), false},
		{"a.mp4", []byte("\x00\x00\x00\x18ftypavif\x00\x00\x00\x00"), false},
		{"a.webm", []byte("\x1a\x45\xdf\xa3matroska"), false},
	} {
		t.Run(test.path+string(test.header), func(t *testing.T) {
			_, err := validateImageUploadBody(test.path, bytes.NewReader(test.header))
			if (err == nil) != test.allowed {
				t.Fatalf("allowed=%v, err=%v", test.allowed, err)
			}
		})
	}
}

func TestMixedJPEGPNGConcurrentUploads(t *testing.T) {
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
	post := handle(tusPostHandler(cache), "", st, &settings.Server{})
	patch := handle(tusPatchHandler(cache), "", st, &settings.Server{})
	var jpg, pngData bytes.Buffer
	if err := jpeg.Encode(&jpg, image.NewRGBA(image.Rect(0, 0, 8, 8)), nil); err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for _, test := range []struct {
		name string
		body []byte
	}{
		{"normal.jpg", jpg.Bytes()}, {"normal.png", pngData.Bytes()},
		{"png-content.jpg", pngData.Bytes()}, {"jpeg-content.png", jpg.Bytes()},
	} {
		wg.Add(1)
		go func(name string, body []byte) {
			defer wg.Done()
			req := httptest.NewRequest("POST", "/"+name, http.NoBody)
			req.Header.Set("X-Auth", token)
			req.Header.Set("Upload-Length", strconv.Itoa(len(body)))
			rec := httptest.NewRecorder()
			post.ServeHTTP(rec, req)
			if rec.Code != 201 {
				t.Errorf("%s create: %d", name, rec.Code)
				return
			}
			req = httptest.NewRequest("PATCH", "/"+name, bytes.NewReader(body))
			req.Header.Set("X-Auth", token)
			req.Header.Set("Upload-Offset", "0")
			req.Header.Set("Content-Type", "application/offset+octet-stream")
			rec = httptest.NewRecorder()
			patch.ServeHTTP(rec, req)
			if rec.Code != 204 {
				t.Errorf("%s upload: %d %s", name, rec.Code, rec.Body.String())
				return
			}
			saved, err := os.ReadFile(scope + "/" + name)
			if err != nil || !bytes.Equal(saved, body) {
				t.Errorf("%s content mismatch: %v", name, err)
			}
		}(test.name, test.body)
	}
	wg.Wait()
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
