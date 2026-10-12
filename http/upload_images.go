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
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif":
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
		return nil, fmt.Errorf("仅允许上传 JPG、PNG、GIF、WEBP、BMP、AVIF 图片，文件内容必须与扩展名一致")
	}
	return reader, nil
}
