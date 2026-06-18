import re
import os
import socket
import ipaddress
import logging
from urllib.parse import urlparse

log = logging.getLogger(__name__)

URL_PATTERNS = {
    "youtube": re.compile(
        r"^(https?://)?(www\.)?"
        r"(youtube\.com/(watch\?v=|shorts/|embed/|playlist\?list=)|youtu\.be/)[a-zA-Z0-9_-]+"
    ),
    "spotify": re.compile(
        r"^(https?://)?(open\.)?spotify\.com/(track|album|playlist)/[a-zA-Z0-9]+"
    ),
}


def detect_platform(url: str) -> str | None:
    for platform, pattern in URL_PATTERNS.items():
        if pattern.match(url):
            return platform
    if url.startswith("http://") or url.startswith("https://"):
        return "generic"
    return None


def sanitize_filename(filename: str) -> str:
    filename = os.path.basename(filename)
    filename = filename.replace("\x00", "")
    filename = re.sub(r'[<>:"/\\|?*]', "_", filename)
    # Collapse path-traversal sequences
    filename = filename.replace("..", "_")
    # Strip leading dots, trailing dots and spaces (Windows reserves these)
    filename = filename.strip(". ")
    return filename if re.search(r"[a-zA-Z0-9]", filename) else "download"


def is_safe_url(url: str) -> bool:
    """SSRF protection: reject URLs that resolve to private/local addresses."""
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
        if not hostname:
            return False

        addr_info = socket.getaddrinfo(hostname, None)
        for _family, _type, _proto, _canonname, sockaddr in addr_info:
            ip_str = sockaddr[0]
            try:
                addr = ipaddress.ip_address(ip_str)
            except ValueError:
                return False

            if (
                addr.is_private
                or addr.is_loopback
                or addr.is_link_local
                or addr.is_multicast
                or addr.is_reserved
                or addr.is_unspecified
            ):
                return False

        return True
    except Exception as exc:
        log.warning("SSRF check failed for %s: %s", url, exc)
        return False
