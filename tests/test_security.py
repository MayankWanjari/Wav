"""Tests for security helpers: sanitize_filename, detect_platform, is_safe_url."""
import pytest
import socket
from unittest.mock import patch

from app.security import sanitize_filename, detect_platform, is_safe_url


class TestSanitizeFilename:
    def test_strips_reserved_chars(self):
        # Use a name without path separators so os.path.basename doesn't truncate it
        result = sanitize_filename('a<b>c:d"g|h?i*j.mp3')
        assert result == "a_b_c_d_g_h_i_j.mp3"

    def test_strips_path_traversal(self):
        result = sanitize_filename("../../etc/passwd")
        assert ".." not in result
        assert "/" not in result

    def test_strips_null_bytes(self):
        assert "\x00" not in sanitize_filename("evil\x00file.mp3")

    def test_strips_leading_dot(self):
        assert not sanitize_filename(".hidden").startswith(".")

    def test_strips_trailing_dot_and_space(self):
        name = sanitize_filename("file. ")
        assert not name.endswith(".")
        assert not name.endswith(" ")

    def test_basename_only(self):
        result = sanitize_filename("C:/Windows/System32/cmd.exe")
        assert "/" not in result
        assert "\\" not in result

    def test_empty_fallback(self):
        assert sanitize_filename("...") == "download"

    def test_normal_filename_unchanged(self):
        assert sanitize_filename("my_song_2024.mp3") == "my_song_2024.mp3"

    def test_zip_extension_preserved(self):
        assert sanitize_filename("Playlist_abc123.zip").endswith(".zip")


class TestDetectPlatform:
    @pytest.mark.parametrize("url", [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/abc123",
        "https://www.youtube.com/playlist?list=PLabc123",
    ])
    def test_detects_youtube(self, url):
        assert detect_platform(url) == "youtube"

    @pytest.mark.parametrize("url", [
        "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        "https://open.spotify.com/album/abc123",
        "https://open.spotify.com/playlist/xyz789",
    ])
    def test_detects_spotify(self, url):
        assert detect_platform(url) == "spotify"

    @pytest.mark.parametrize("url", [
        "https://example.com/audio.mp3",
        "http://media.site.com/video.mp4",
    ])
    def test_detects_generic(self, url):
        assert detect_platform(url) == "generic"

    @pytest.mark.parametrize("url", [
        "not-a-url",
        "",
        "ftp://example.com/file.mp3",
    ])
    def test_rejects_invalid(self, url):
        assert detect_platform(url) is None


class TestIsSafeUrl:
    def _mock_addrinfo(self, ip: str):
        family = socket.AF_INET6 if ":" in ip else socket.AF_INET
        return [(family, None, None, None, (ip, 0))]

    def test_blocks_loopback_ipv4(self):
        with patch("socket.getaddrinfo", return_value=self._mock_addrinfo("127.0.0.1")):
            assert is_safe_url("http://localhost/") is False

    def test_blocks_private_10(self):
        with patch("socket.getaddrinfo", return_value=self._mock_addrinfo("10.0.0.1")):
            assert is_safe_url("http://internal/") is False

    def test_blocks_private_192_168(self):
        with patch("socket.getaddrinfo", return_value=self._mock_addrinfo("192.168.1.1")):
            assert is_safe_url("http://router/") is False

    def test_blocks_private_172_16(self):
        with patch("socket.getaddrinfo", return_value=self._mock_addrinfo("172.16.0.1")):
            assert is_safe_url("http://vpn/") is False

    def test_blocks_link_local_ipv4(self):
        with patch("socket.getaddrinfo", return_value=self._mock_addrinfo("169.254.1.1")):
            assert is_safe_url("http://169.254.1.1/") is False

    def test_blocks_ipv6_loopback(self):
        with patch("socket.getaddrinfo", return_value=self._mock_addrinfo("::1")):
            assert is_safe_url("http://[::1]/") is False

    def test_blocks_ipv6_unique_local(self):
        with patch("socket.getaddrinfo", return_value=self._mock_addrinfo("fd00::1")):
            assert is_safe_url("http://[fd00::1]/") is False

    def test_blocks_ipv6_link_local(self):
        with patch("socket.getaddrinfo", return_value=self._mock_addrinfo("fe80::1")):
            assert is_safe_url("http://[fe80::1]/") is False

    def test_allows_public_ipv4(self):
        with patch("socket.getaddrinfo", return_value=self._mock_addrinfo("8.8.8.8")):
            assert is_safe_url("http://8.8.8.8/") is True

    def test_blocks_missing_hostname(self):
        assert is_safe_url("not-a-url") is False

    def test_blocks_on_dns_failure(self):
        with patch("socket.getaddrinfo", side_effect=socket.gaierror("fail")):
            assert is_safe_url("http://doesnotexist.invalid/") is False
