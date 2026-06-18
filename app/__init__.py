import logging
import os
import subprocess
import sys
import threading
import time
from datetime import timedelta

from flask import Flask

from .config import CLEANUP_CHECK_INTERVAL_SECONDS, CLEANUP_MAX_AGE_SECONDS, DOWNLOAD_DIR, SECRET_KEY

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
log = logging.getLogger(__name__)

# Add virtualenv Scripts/bin to PATH so subprocesses can find yt-dlp, spotdl, ffmpeg
for _venv_subdir in ("Scripts", "bin"):
    _d = os.path.join(sys.prefix, _venv_subdir)
    if os.path.isdir(_d):
        os.environ["PATH"] = _d + os.pathsep + os.environ.get("PATH", "")


def _cleanup_daemon(directory: str, max_age_seconds: int, check_interval: int) -> None:
    while True:
        try:
            now = time.time()
            for filename in os.listdir(directory):
                filepath = os.path.join(directory, filename)
                if os.path.isfile(filepath) and now - os.path.getmtime(filepath) > max_age_seconds:
                    try:
                        os.remove(filepath)
                        log.info("Daemon cleaned up: %s", filepath)
                    except OSError as exc:
                        log.warning("Cleanup failed for %s: %s", filepath, exc)
        except Exception as exc:
            log.error("Cleanup daemon error: %s", exc)
        time.sleep(check_interval)


def create_app() -> Flask:
    app = Flask(__name__, template_folder="../templates", static_folder="../static")

    app.secret_key = SECRET_KEY

    # ── Session security ───────────────────────────────────────────────────────
    app.config.update(
        PERMANENT_SESSION_LIFETIME=timedelta(days=7),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=not app.debug,  # True in production (HTTPS), False for local dev
    )

    # ── Rate limiter ───────────────────────────────────────────────────────────
    from .extensions import limiter
    limiter.init_app(app)

    from .routes import bp
    app.register_blueprint(bp)

    # Guard against Werkzeug reloader double-start
    if not app.debug or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        threading.Thread(
            target=_cleanup_daemon,
            args=(DOWNLOAD_DIR, CLEANUP_MAX_AGE_SECONDS, CLEANUP_CHECK_INTERVAL_SECONDS),
            daemon=True,
        ).start()

    return app


def check_dependencies() -> None:
    missing = []
    for dep in ("ffmpeg", "yt-dlp", "spotdl"):
        cmd = [dep, "-version" if dep == "ffmpeg" else "--version"]
        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            log.info("Dependency OK: %s", dep)
        except (FileNotFoundError, subprocess.SubprocessError):
            missing.append(dep)
            log.error("Dependency MISSING: %s", dep)
    if missing:
        log.warning("Missing dependencies: %s — downloads will fail.", ", ".join(missing))
