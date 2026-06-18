import os
import re
import glob
import json
import uuid
import shutil
import logging
import zipfile
import subprocess

from .config import DOWNLOAD_DIR
from .security import sanitize_filename, detect_platform

log = logging.getLogger(__name__)


def zip_files(file_paths: list, zip_path: str) -> None:
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for file in file_paths:
            if os.path.exists(file):
                zipf.write(file, os.path.basename(file))


def generate_download_events(url_or_queries: str | list, format_type: str, quality: str):
    """Generator that yields SSE-formatted strings for a download request."""
    if isinstance(url_or_queries, list):
        platform = "spotify"
        is_playlist = len(url_or_queries) > 1
        playlist_flag = "--yes-playlist" if is_playlist else "--no-playlist"
    else:
        platform = detect_platform(url_or_queries)
        is_playlist = "playlist" in url_or_queries or "album" in url_or_queries or "show" in url_or_queries
        playlist_flag = "--yes-playlist" if is_playlist else "--no-playlist"
    temp_id = uuid.uuid4().hex[:8]
    temp_dir = None

    if platform in ("youtube", "generic"):
        output_template = os.path.join(DOWNLOAD_DIR, f"%(title)s_{temp_id}.%(ext)s")
        if format_type == "video":
            if quality == "best":
                format_str = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
            else:
                format_str = f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
            cmd = [
                "yt-dlp",
                "-f", format_str,
                "--merge-output-format", "mp4",
                "--extractor-args", "youtube:player_client=ios,web",
                playlist_flag,
                "--print-json",
                "--retries", "3",
                "--fragment-retries", "3",
                "--concurrent-fragments", "8",
                "--downloader", "m3u8:ffmpeg",
                "-o", output_template,
                "--",
                url_or_queries,
            ]
        else:
            cmd = [
                "yt-dlp",
                "-x", "--audio-format", "mp3", "--audio-quality", quality,
                "--extractor-args", "youtube:player_client=ios,web",
                playlist_flag,
                "--print-json",
                "--retries", "3",
                "--fragment-retries", "3",
                "--concurrent-fragments", "8",
                "-o", output_template,
                "--",
                url_or_queries,
            ]
    else:  # spotify
        temp_dir = os.path.join(DOWNLOAD_DIR, temp_id)
        os.makedirs(temp_dir, exist_ok=True)
        bitrate = quality.lower()
        if not bitrate.endswith("k"):
            bitrate += "k"
        
        cmd = [
            "spotdl",
            "--output", temp_dir,
            "--format", "mp3",
            "--bitrate", bitrate,
            "download",
        ]
        if isinstance(url_or_queries, list):
            cmd += url_or_queries
        else:
            cmd += [url_or_queries]

    yield _sse("log", message="Initializing download subprocess...")

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True,
        )

        progress_re = re.compile(r"\[download\]\s+(\d+\.\d+)%")
        json_lines = []

        while True:
            line = process.stdout.readline()
            if not line and process.poll() is not None:
                break
            if not line:
                continue
            stripped = line.strip()
            if not stripped:
                continue

            yield _sse("log", message=stripped)

            m = progress_re.search(stripped)
            if m:
                yield _sse("progress", percent=float(m.group(1)))

            if stripped.startswith("{"):
                json_lines.append(stripped)

        return_code = process.wait()

        if return_code != 0:
            if temp_dir:
                shutil.rmtree(temp_dir, ignore_errors=True)
            yield _sse("error", message=f"Subprocess failed with code {return_code}")
            return

        if platform in ("youtube", "generic"):
            files = glob.glob(os.path.join(DOWNLOAD_DIR, f"*{temp_id}*.*"))
            files = [f for f in files if f.endswith((".mp3", ".mp4", ".mkv", ".webm", ".m4a"))]
        else:
            files = [os.path.join(temp_dir, f) for f in os.listdir(temp_dir) if f.endswith(".mp3")]

        if not files:
            if temp_dir:
                shutil.rmtree(temp_dir, ignore_errors=True)
            yield _sse("error", message="Downloaded files not found on disk")
            return

        if len(files) > 1:
            yield _sse("log", message=f"Packaging {len(files)} tracks into a single ZIP archive...")

            playlist_title = "Playlist"
            if platform in ("youtube", "generic") and json_lines:
                try:
                    meta = json.loads(json_lines[-1])
                    playlist_title = meta.get("playlist_title") or meta.get("playlist") or "YouTube_Playlist"
                except Exception:
                    pass
            elif platform == "spotify":
                playlist_title = "Spotify_Playlist"

            zip_name = sanitize_filename(f"{playlist_title}_{temp_id}.zip")
            zip_path = os.path.join(DOWNLOAD_DIR, zip_name)
            zip_files(files, zip_path)

            for f in files:
                try:
                    os.remove(f)
                except OSError:
                    pass
            if temp_dir:
                shutil.rmtree(temp_dir, ignore_errors=True)

            output_path = zip_path
            title = playlist_title
            filename = zip_name

        else:
            output_path = files[0]
            if platform in ("youtube", "generic"):
                meta = {}
                if json_lines:
                    try:
                        meta = json.loads(json_lines[-1])
                    except Exception:
                        pass
                title = meta.get("title", "Unknown Title")

                if format_type == "video":
                    for f in files:
                        if f.endswith((".mp4", ".mkv", ".webm")):
                            output_path = f
                            break
                else:
                    for f in files:
                        if f.endswith(".mp3"):
                            output_path = f
                            break

                filename = sanitize_filename(os.path.basename(output_path))
                if filename != os.path.basename(output_path):
                    new_path = os.path.join(DOWNLOAD_DIR, filename)
                    os.rename(output_path, new_path)
                    output_path = new_path
            else:
                original_filename = os.path.basename(output_path)
                title = original_filename.rsplit(".", 1)[0]
                filename = sanitize_filename(original_filename)
                new_path = os.path.join(DOWNLOAD_DIR, filename)
                os.replace(output_path, new_path)
                if temp_dir:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                output_path = new_path

        file_size_bytes = os.path.getsize(output_path) if os.path.exists(output_path) else 0
        yield _sse(
            "success",
            title=title,
            filename=filename,
            download_url=f"/api/file/{filename}",
            size_bytes=file_size_bytes,
        )

    except Exception:
        log.exception("Exception in SSE download generator")
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)
        yield _sse("error", message="An internal server error occurred during download")


def _sse(event_type: str, **kwargs) -> str:
    import json
    payload = {"type": event_type, **kwargs}
    return f"data: {json.dumps(payload)}\n\n"
