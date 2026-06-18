import json
import logging
import os
import re
import subprocess
import time
from functools import wraps

from flask import Blueprint, Response, jsonify, redirect, render_template, request, send_file, session, url_for
from werkzeug.security import check_password_hash

from .config import ADMIN_PASSWORD_HASH, ADMIN_USERNAME, DOWNLOAD_DIR, INFO_FETCH_TIMEOUT_SECONDS, RATE_LIMIT_DOWNLOAD, SEARCH_TIMEOUT_SECONDS, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
from .downloader import generate_download_events
from .extensions import limiter
from .security import detect_platform, is_safe_url, sanitize_filename

log = logging.getLogger(__name__)

bp = Blueprint("main", __name__)


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("logged_in"):
            if request.path.startswith("/api/"):
                return jsonify({"success": False, "error": "Unauthorized"}), 401
            return redirect(url_for("main.login"))
        return f(*args, **kwargs)
    return decorated


@bp.route("/login", methods=["GET", "POST"])
@limiter.limit("10 per minute")
def login():
    if session.get("logged_in"):
        return redirect(url_for("main.index"))
    error = None
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        if username == ADMIN_USERNAME and check_password_hash(ADMIN_PASSWORD_HASH, password):
            session.permanent = True   # expires after 7 days (set in create_app)
            session["logged_in"] = True
            return redirect(url_for("main.index"))
        time.sleep(1)                  # slow down brute-force attempts
        error = "Invalid username or password."
    return render_template("login.html", error=error)


@bp.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("main.login"))


@bp.route("/")
@login_required
def index():
    return render_template("index.html")


@bp.route("/api/search", methods=["POST"])
@login_required
def api_search():
    data = request.get_json(silent=True) or {}
    query = (data.get("query") or "").strip()
    if not query:
        return jsonify({"success": False, "error": "Query is required"}), 400

    sanitized_query = re.sub(r"[^\w\s\-\.\?\!\(\)]", "", query)
    if not sanitized_query.strip():
        return jsonify({"success": False, "error": "Invalid search query"}), 400

    log.info("Search requested: %s", sanitized_query)
    cmd = [
        "yt-dlp",
        f"ytsearch5:{sanitized_query}",
        "--dump-single-json",
        "--flat-playlist",
        "--retries", "3",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=SEARCH_TIMEOUT_SECONDS)
        if result.returncode != 0:
            log.error("yt-dlp search error: %s", result.stderr)
            return jsonify({"success": False, "error": "Search failed"}), 500

        search_data = json.loads(result.stdout)
        entries = search_data.get("entries", [])

        results = []
        for entry in entries:
            duration_secs = entry.get("duration")
            duration_str = ""
            if duration_secs is not None:
                try:
                    duration_secs = int(float(duration_secs))
                    duration_str = f"{duration_secs // 60}:{duration_secs % 60:02d}"
                except (ValueError, TypeError):
                    pass

            thumbnails = entry.get("thumbnails", [])
            thumbnail_url = thumbnails[-1].get("url") if thumbnails else ""

            results.append({
                "id": entry.get("id"),
                "title": entry.get("title", "Unknown Title"),
                "url": entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id')}",
                "uploader": entry.get("channel") or entry.get("uploader") or "Unknown Uploader",
                "duration": duration_str,
                "thumbnail": thumbnail_url,
                "view_count": entry.get("view_count", 0),
            })

        return jsonify({"success": True, "results": results})
    except subprocess.TimeoutExpired:
        return jsonify({"success": False, "error": "Search timed out"}), 504
    except Exception:
        log.exception("Search exception")
        return jsonify({"success": False, "error": "Search failed"}), 500


@bp.route("/api/info", methods=["POST"])
@login_required
def api_info():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()

    platform = detect_platform(url)
    if not url or not platform:
        return jsonify({"success": False, "error": "Invalid URL"}), 400

    if not is_safe_url(url):
        return jsonify({"success": False, "error": "Access to local or private addresses is forbidden."}), 400

    if platform in ("youtube", "generic"):
        try:
            cmd = ["yt-dlp", "-J", "--no-playlist", "--", url]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=INFO_FETCH_TIMEOUT_SECONDS)
            if result.returncode != 0:
                return jsonify({"success": False, "error": "Failed to fetch metadata"}), 400

            meta = json.loads(result.stdout)
            duration = meta.get("duration", 0)
            formats = meta.get("formats", [])

            audio_sizes = {
                "320K": duration * 40000,
                "256K": duration * 32000,
                "192K": duration * 24000,
                "128K": duration * 16000,
            }

            video_sizes = {"best": 0, "1080": 0, "720": 0, "480": 0, "360": 0}
            best_v = 0
            best_a = 0

            for f in formats:
                size = f.get("filesize") or f.get("filesize_approx") or 0
                h = f.get("height")
                vcodec = f.get("vcodec")
                acodec = f.get("acodec")

                if h and vcodec != "none":
                    if h >= 1080 and size > video_sizes["1080"]: video_sizes["1080"] = size
                    if h >= 720 and size > video_sizes["720"]: video_sizes["720"] = size
                    if h >= 480 and size > video_sizes["480"]: video_sizes["480"] = size
                    if h >= 360 and size > video_sizes["360"]: video_sizes["360"] = size
                    if size > best_v: best_v = size

                if acodec != "none" and vcodec == "none":
                    if size > best_a: best_a = size

            video_sizes["best"] = best_v + best_a
            for k in ["1080", "720", "480", "360"]:
                if video_sizes[k] > 0:
                    video_sizes[k] += best_a

            return jsonify({"success": True, "audio": audio_sizes, "video": video_sizes})

        except Exception:
            log.exception("Info fetch failed")
            return jsonify({"success": False, "error": "Failed to fetch media info"}), 500

    # Spotify: sizes are unknown ahead of time
    return jsonify({
        "success": True,
        "audio": {"320K": -1, "256K": -1, "192K": -1, "128K": -1},
        "video": {},
    })

@bp.route("/api/spotify/preview", methods=["POST"])
@login_required
def api_spotify_preview():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()

    if not url:
        return jsonify({"success": False, "error": "URL is required"}), 400

    platform = detect_platform(url)
    if platform != "spotify":
        return jsonify({"success": False, "error": "Only Spotify URLs are supported for preview"}), 400

    if not is_safe_url(url):
        return jsonify({"success": False, "error": "Access to local or private addresses is forbidden."}), 400

    from spotdl.utils.spotify import SpotifyClient
    from spotdl.types.playlist import Playlist
    from spotdl.types.album import Album
    from spotdl.types.song import Song

    try:
        SpotifyClient.init(
            client_id=SPOTIFY_CLIENT_ID,
            client_secret=SPOTIFY_CLIENT_SECRET,
            use_official_api=True,
        )
    except Exception:
        # Already initialized
        pass

    try:
        tracks = []
        list_name = "Spotify Download"
        list_cover = None

        if "playlist" in url:
            metadata, songs = Playlist.get_metadata(url)
            list_name = metadata.get("name", "Playlist")
            list_cover = metadata.get("cover_url")
            for s in songs:
                tracks.append({
                    "spotify_url": s.url,
                    "name": s.name,
                    "artists": s.artists,
                    "duration": s.duration,
                    "album": s.album_name or list_name,
                    "cover_url": s.cover_url or list_cover
                })
        elif "album" in url:
            metadata, songs = Album.get_metadata(url)
            list_name = metadata.get("name", "Album")
            list_cover = metadata.get("cover_url")
            for s in songs:
                tracks.append({
                    "spotify_url": s.url,
                    "name": s.name,
                    "artists": s.artists,
                    "duration": s.duration,
                    "album": s.album_name or list_name,
                    "cover_url": s.cover_url or list_cover
                })
        elif "track" in url:
            song = Song.from_url(url)
            list_name = song.name
            list_cover = song.cover_url
            tracks.append({
                "spotify_url": song.url,
                "name": song.name,
                "artists": song.artists,
                "duration": song.duration,
                "album": song.album_name,
                "cover_url": song.cover_url
            })
        else:
            return jsonify({"success": False, "error": "Unsupported Spotify link type. Please use playlist, album, or track links."}), 400

        return jsonify({
            "success": True,
            "title": list_name,
            "cover_url": list_cover,
            "tracks": tracks
        })
    except Exception as exc:
        log.exception("Spotify preview failed")
        return jsonify({"success": False, "error": f"Failed to load Spotify details: {str(exc)}"}), 500


@bp.route("/api/download", methods=["POST"])
@login_required
@limiter.limit(RATE_LIMIT_DOWNLOAD)
def api_download():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    tracks = data.get("tracks")
    format_type = (data.get("format") or "audio").strip().lower()
    quality = (data.get("quality") or ("320K" if format_type == "audio" else "best")).strip()

    if not url and not tracks:
        return jsonify({"success": False, "error": "No URL or tracks provided"}), 400

    if tracks:
        # Validate all URLs in tracks to prevent SSRF
        for t in tracks:
            s_url = t.get("spotify_url")
            y_url = t.get("youtube_url")
            if s_url and not is_safe_url(s_url):
                return jsonify({"success": False, "error": "Access to local or private addresses is forbidden."}), 400
            if y_url and not is_safe_url(y_url):
                return jsonify({"success": False, "error": "Access to local or private addresses is forbidden."}), 400

        # Build queries list
        queries = []
        for t in tracks:
            s_url = t.get("spotify_url")
            y_url = t.get("youtube_url")
            if y_url:
                queries.append(f"{y_url}|{s_url}")
            else:
                queries.append(s_url)

        platform = "spotify"
        url_or_queries = queries
    else:
        if not is_safe_url(url):
            return jsonify({"success": False, "error": "Access to local or private addresses is forbidden."}), 400

        platform = detect_platform(url)
        if platform is None:
            return jsonify({
                "success": False,
                "error": "Invalid URL. Please provide a valid media link starting with http:// or https://.",
            }), 400
        url_or_queries = url

    if platform == "spotify" and format_type == "video":
        return jsonify({"success": False, "error": "Spotify only supports audio downloads."}), 400

    log.info("Download requested  platform=%s  format=%s  url=%s", platform, format_type, url or f"{len(tracks)} tracks")

    response = Response(
        generate_download_events(url_or_queries, format_type, quality),
        mimetype="text/event-stream",
    )
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


@bp.route("/api/file/<path:filename>")
@login_required
def api_file(filename):
    safe_name = sanitize_filename(os.path.basename(filename))
    filepath = os.path.join(DOWNLOAD_DIR, safe_name)

    if not os.path.isfile(filepath):
        return jsonify({"success": False, "error": "File not found"}), 404

    return send_file(filepath, as_attachment=True, download_name=safe_name)


# ── History ──────────────────────────────────────────────────────────────────

@bp.route("/api/history", methods=["GET"])
@login_required
def api_get_history():
    from .history_store import get_history
    return jsonify({"success": True, "history": get_history()})


@bp.route("/api/history/add", methods=["POST"])
@login_required
def api_add_history():
    from .history_store import add_entry
    entry = request.get_json(silent=True) or {}
    add_entry(entry)
    return jsonify({"success": True})


@bp.route("/api/history", methods=["DELETE"])
@login_required
def api_clear_history():
    from .history_store import clear_history
    clear_history()
    return jsonify({"success": True})


# ── File manager ──────────────────────────────────────────────────────────────

@bp.route("/files")
@login_required
def files_page():
    return render_template("files.html")


@bp.route("/api/files", methods=["GET"])
@login_required
def api_files():
    files = []
    try:
        for name in os.listdir(DOWNLOAD_DIR):
            path = os.path.join(DOWNLOAD_DIR, name)
            if os.path.isfile(path):
                stat = os.stat(path)
                files.append({"name": name, "size": stat.st_size, "modified": stat.st_mtime})
    except Exception:
        pass
    files.sort(key=lambda f: f["modified"], reverse=True)
    return jsonify({"success": True, "files": files})


@bp.route("/api/files/<path:filename>", methods=["DELETE"])
@login_required
def api_delete_file(filename):
    safe_name = sanitize_filename(os.path.basename(filename))
    filepath = os.path.join(DOWNLOAD_DIR, safe_name)
    if not os.path.isfile(filepath):
        return jsonify({"success": False, "error": "File not found"}), 404
    try:
        os.remove(filepath)
        return jsonify({"success": True})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


# ── Disk stats ────────────────────────────────────────────────────────────────

@bp.route("/api/stats", methods=["GET"])
@login_required
def api_stats():
    total_size = 0
    file_count = 0
    try:
        for name in os.listdir(DOWNLOAD_DIR):
            path = os.path.join(DOWNLOAD_DIR, name)
            if os.path.isfile(path):
                total_size += os.path.getsize(path)
                file_count += 1
    except Exception:
        pass
    return jsonify({"success": True, "total_size": total_size, "file_count": file_count})


# ── ID3 tag editor ────────────────────────────────────────────────────────────

@bp.route("/api/tags/<path:filename>", methods=["POST"])
@login_required
def api_set_tags(filename):
    safe_name = sanitize_filename(os.path.basename(filename))
    filepath = os.path.join(DOWNLOAD_DIR, safe_name)
    if not os.path.isfile(filepath):
        return jsonify({"success": False, "error": "File not found"}), 404

    data = request.get_json(silent=True) or {}
    title  = (data.get("title")  or "").strip()
    artist = (data.get("artist") or "").strip()
    album  = (data.get("album")  or "").strip()

    try:
        from mutagen.id3 import ID3, TIT2, TPE1, TALB, ID3NoHeaderError
        try:
            tags = ID3(filepath)
        except ID3NoHeaderError:
            tags = ID3()
        if title:  tags["TIT2"] = TIT2(encoding=3, text=title)
        if artist: tags["TPE1"] = TPE1(encoding=3, text=artist)
        if album:  tags["TALB"] = TALB(encoding=3, text=album)
        tags.save(filepath)
        return jsonify({"success": True})
    except Exception as exc:
        log.exception("Tag write failed")
        return jsonify({"success": False, "error": str(exc)}), 500
