"""Integration-style tests for Flask routes (no real subprocesses)."""
import json
import os
import pytest
from unittest.mock import patch

# Provide required env vars before the app module is imported
os.environ.setdefault("ADMIN_PASSWORD", "test-password-for-ci")

from app import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    app.config["RATELIMIT_ENABLED"] = False
    with app.test_client() as c:
        with c.session_transaction() as sess:
            sess["logged_in"] = True
        yield c


def post_json(client, path, payload):
    return client.post(path, data=json.dumps(payload), content_type="application/json")


# ---------------------------------------------------------------------------
# /api/search
# ---------------------------------------------------------------------------

class TestApiSearch:
    def test_missing_query_returns_400(self, client):
        resp = post_json(client, "/api/search", {})
        assert resp.status_code == 400
        assert resp.get_json()["success"] is False

    def test_empty_query_returns_400(self, client):
        resp = post_json(client, "/api/search", {"query": "   "})
        assert resp.status_code == 400

    def test_valid_query_calls_ytdlp(self, client):
        fake_output = json.dumps({
            "entries": [{
                "id": "abc",
                "title": "Test Song",
                "url": "https://www.youtube.com/watch?v=abc",
                "channel": "Artist",
                "duration": 180,
                "thumbnails": [{"url": "http://img.example.com/t.jpg"}],
                "view_count": 1000,
            }]
        })
        mock_result = type("R", (), {"returncode": 0, "stdout": fake_output, "stderr": ""})()
        with patch("subprocess.run", return_value=mock_result):
            resp = post_json(client, "/api/search", {"query": "test song"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["results"][0]["title"] == "Test Song"
        assert data["results"][0]["duration"] == "3:00"


# ---------------------------------------------------------------------------
# /api/info
# ---------------------------------------------------------------------------

class TestApiInfo:
    def test_invalid_url_returns_400(self, client):
        resp = post_json(client, "/api/info", {"url": "not-a-url"})
        assert resp.status_code == 400

    def test_private_ip_returns_400(self, client):
        import socket
        with patch("socket.getaddrinfo", return_value=[
            (socket.AF_INET, None, None, None, ("127.0.0.1", 0))
        ]):
            resp = post_json(client, "/api/info", {"url": "http://localhost/"})
        assert resp.status_code == 400
        assert "forbidden" in resp.get_json()["error"].lower()

    def test_spotify_returns_unknown_sizes(self, client):
        with patch("app.security.is_safe_url", return_value=True):
            resp = post_json(client, "/api/info", {
                "url": "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"
            })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["audio"]["320K"] == -1


# ---------------------------------------------------------------------------
# /api/spotify/preview
# ---------------------------------------------------------------------------

class TestApiSpotifyPreview:
    def test_missing_url_returns_400(self, client):
        resp = post_json(client, "/api/spotify/preview", {})
        assert resp.status_code == 400
        assert resp.get_json()["success"] is False

    def test_non_spotify_url_returns_400(self, client):
        resp = post_json(client, "/api/spotify/preview", {"url": "https://www.youtube.com/watch?v=abc"})
        assert resp.status_code == 400
        assert "only spotify urls" in resp.get_json()["error"].lower()

    def test_valid_spotify_track_preview(self, client):
        class FakeSong:
            name = "Aquel diciembre"
            artists = ["Young Miko", "Rauw Alejandro"]
            duration = 202
            album_name = "Ragini MMS 2"
            cover_url = "http://example.com/cover.jpg"
            url = "https://open.spotify.com/track/6A2VAtuRu5p5LymL4RSCBG"

        with patch("app.security.is_safe_url", return_value=True):
            with patch("spotdl.types.song.Song.from_url", return_value=FakeSong()):
                resp = post_json(client, "/api/spotify/preview", {
                    "url": "https://open.spotify.com/track/6A2VAtuRu5p5LymL4RSCBG"
                })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["title"] == "Aquel diciembre"
        assert len(data["tracks"]) == 1
        assert data["tracks"][0]["name"] == "Aquel diciembre"
        assert data["tracks"][0]["artists"] == ["Young Miko", "Rauw Alejandro"]


# ---------------------------------------------------------------------------
# /api/download
# ---------------------------------------------------------------------------

class TestApiDownload:
    def test_missing_url_returns_400(self, client):
        resp = post_json(client, "/api/download", {})
        assert resp.status_code == 400

    def test_invalid_url_returns_400(self, client):
        resp = post_json(client, "/api/download", {"url": "not-a-url"})
        assert resp.status_code == 400

    def test_private_ip_blocked(self, client):
        import socket
        with patch("socket.getaddrinfo", return_value=[
            (socket.AF_INET, None, None, None, ("10.0.0.1", 0))
        ]):
            resp = post_json(client, "/api/download", {"url": "http://10.0.0.1/"})
        assert resp.status_code == 400

    def test_spotify_video_rejected(self, client):
        with patch("app.security.is_safe_url", return_value=True):
            resp = post_json(client, "/api/download", {
                "url": "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
                "format": "video",
            })
        assert resp.status_code == 400
        assert "audio" in resp.get_json()["error"].lower()


# ---------------------------------------------------------------------------
# /api/file
# ---------------------------------------------------------------------------

class TestApiFile:
    def test_missing_file_returns_404(self, client):
        resp = client.get("/api/file/nonexistent_file_xyz.mp3")
        assert resp.status_code == 404

    def test_path_traversal_blocked(self, client):
        resp = client.get("/api/file/../../etc/passwd")
        # Either 404 (sanitized to safe name and not found) or 400 — never a real file leak
        assert resp.status_code in (400, 404)
