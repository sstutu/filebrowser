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
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif", ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi":
		return true
	}
	return false
}

func imageUploadHeader(path string, header []byte) bool {
	ext := strings.ToLower(filepath.Ext(path))
	mime := http.DetectContentType(header)
	switch ext {
	case ".jpg", ".jpeg":
		return mime == "image/jpeg"
	case ".png":
		return mime == "image/png"
	case ".gif":
		return mime == "image/gif"
	case ".bmp":
		return mime == "image/bmp"
	case ".webp":
		return len(header) >= 12 && string(header[:4]) == "RIFF" && string(header[8:12]) == "WEBP"
	case ".avif":
		return len(header) >= 16 && string(header[4:8]) == "ftyp" && (string(header[8:12]) == "avif" || string(header[8:12]) == "avis" || bytes.Contains(header[16:], []byte("avif")))
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
		return nil, fmt.Errorf("仅允许上传图片或视频，支持 JPG、PNG、GIF、WEBP、BMP、AVIF、MP4、M4V、MOV、WEBM、MKV、AVI；文件头必须符合对应格式")
	}
	return reader, nil
}
