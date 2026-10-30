package fbhttp

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
)

func imageUploadExtension(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif", ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz":
		return true
	}
	return false
}

func imageUploadHeader(path string, header []byte) bool {
	ext := strings.ToLower(filepath.Ext(path))
	mime := http.DetectContentType(header)
	// Image filenames may retain an older extension after conversion. Validate
	// the actual supported image format independently of that image extension.
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".avif":
		switch mime {
		case "image/jpeg", "image/png", "image/gif", "image/bmp":
			return true
		}
		return (len(header) >= 12 && string(header[:4]) == "RIFF" && string(header[8:12]) == "WEBP") ||
			(len(header) >= 16 && string(header[4:8]) == "ftyp" && (string(header[8:12]) == "avif" || string(header[8:12]) == "avis" || bytes.Contains(header[16:], []byte("avif"))))
	}
	switch ext {
	case ".zip":
		return bytes.HasPrefix(header, []byte("PK\x03\x04")) || bytes.HasPrefix(header, []byte("PK\x05\x06")) || bytes.HasPrefix(header, []byte("PK\x07\x08"))
	case ".rar":
		return bytes.HasPrefix(header, []byte("Rar!\x1a\x07\x00")) || bytes.HasPrefix(header, []byte("Rar!\x1a\x07\x01\x00"))
	case ".7z":
		return bytes.HasPrefix(header, []byte{'7', 'z', 0xbc, 0xaf, 0x27, 0x1c})
	case ".gz", ".tgz":
		return bytes.HasPrefix(header, []byte{0x1f, 0x8b, 0x08})
	case ".tar":
		return len(header) >= 262 && string(header[257:262]) == "ustar"
	case ".mp4", ".m4v", ".mov":
		if len(header) < 16 || string(header[4:8]) != "ftyp" {
			return false
		}
		switch string(header[8:12]) {
		case "isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "dash", "M4V ", "M4VH", "M4VP", "qt  ":
			return true
		}
	case ".webm", ".mkv":
		return bytes.HasPrefix(header, []byte{0x1a, 0x45, 0xdf, 0xa3}) &&
			bytes.Contains(header, []byte(map[string]string{".webm": "webm", ".mkv": "matroska"}[ext]))
	case ".avi":
		return len(header) >= 12 && string(header[:4]) == "RIFF" && string(header[8:12]) == "AVI "
	}
	return false
}

func validateImageUploadBody(path string, body io.Reader) (io.Reader, error) {
	reader := bufio.NewReader(body)
	header, err := reader.Peek(512)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if !imageUploadHeader(path, header) {
		return nil, fmt.Errorf("%s：仅允许上传图片、视频或压缩包，无法识别文件内容为支持的格式", filepath.Base(path))
	}
	return reader, nil
}
