import os
import secrets

from werkzeug.security import generate_password_hash

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

HISTORY_FILE = os.path.join(BASE_DIR, "history.json")


# ── Secret key ────────────────────────────────────────────────────────────────
# Generated once on first run and saved to .secret_key so sessions survive
# restarts. Override with SECRET_KEY env var on a real server.
def _load_or_create_secret_key() -> str:
    if env_key := os.environ.get("SECRET_KEY"):
        return env_key
    key_file = os.path.join(BASE_DIR, ".secret_key")
    if os.path.exists(key_file):
        key = open(key_file).read().strip()
        if len(key) >= 32:
            return key
    key = secrets.token_hex(32)
    with open(key_file, "w") as f:
        f.write(key)
    return key


SECRET_KEY = _load_or_create_secret_key()


# ── Admin credentials ─────────────────────────────────────────────────────────
# ADMIN_PASSWORD must be set via env var — the app refuses to start without it.
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
_raw_password  = os.environ.get("ADMIN_PASSWORD")
if not _raw_password:
    raise RuntimeError(
        "ADMIN_PASSWORD environment variable is not set. "
        "Set it before starting the app: export ADMIN_PASSWORD=<your-password>"
    )
ADMIN_PASSWORD_HASH = generate_password_hash(_raw_password)
del _raw_password  # wipe plaintext from module namespace


# ── Spotify API credentials ───────────────────────────────────────────────────
# Must be set via env vars — no hardcoded fallbacks.
SPOTIFY_CLIENT_ID     = os.environ.get("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET")


# ── Download paths ────────────────────────────────────────────────────────────
DOWNLOAD_DIR = os.path.join(BASE_DIR, "downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

CLEANUP_MAX_AGE_SECONDS      = 600
CLEANUP_CHECK_INTERVAL_SECONDS = 60

AUDIO_DOWNLOAD_TIMEOUT_SECONDS = 300
VIDEO_DOWNLOAD_TIMEOUT_SECONDS = 1800
INFO_FETCH_TIMEOUT_SECONDS     = 15
SEARCH_TIMEOUT_SECONDS         = 20

RATE_LIMIT_DOWNLOAD = "5 per minute"
RATE_LIMIT_SEARCH   = "30 per minute"
RATE_LIMIT_INFO     = "60 per minute"
