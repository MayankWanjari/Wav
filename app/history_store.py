import json
import os
import threading

from .config import HISTORY_FILE

_lock = threading.Lock()
MAX_HISTORY = 50


def get_history():
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def add_entry(entry):
    with _lock:
        history = get_history()
        history = [e for e in history if e.get("url") != entry.get("url")]
        history.insert(0, entry)
        history = history[:MAX_HISTORY]
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)


def clear_history():
    with _lock:
        if os.path.exists(HISTORY_FILE):
            os.remove(HISTORY_FILE)
