# MediaForge 🛠️

**MediaForge** is a high-energy, responsive web application built using **Python (Flask)** and **Vanilla JavaScript** to download audio (MP3) or video (MP4) from YouTube, Spotify, and other media links. 

The application is styled in a custom **Voxel-Brutalist** design language—featuring heavy borders, flat environmental colors, hard shadow offsets, blocky voxel success confetti, and playful Minecraft-themed crafting loader stages.

---

## 🚀 Features

- **Double Formats:** Support for high-quality audio extractions (MP3 up to 320kbps) and video downloads (MP4 resolutions up to 1080p).
- **Voxel-Brutalist UI:** A tactile layout built around solid-colored block metaphors, custom typography (Space Mono & Bricolage Grotesque), and zero-blur hard shadows.
- **Voxel Success Confetti:** Generates square confetti with physical outlines to match the blocky style on successful downloads.
- **Smart URL Detector:** Instantly identifies YouTube or Spotify links and formats the options accordingly.
- **Local Download History:** Displays a clean log of your last 10 downloads saved in browser storage.
- **Automatic Sweeper Daemon:** Background worker automatically deletes download files older than 10 minutes to save server storage.
- **SSRF Safety Protection:** Integrates deep IP resolution checking to block local network URLs, keeping the host server safe.

---

## 🛠️ Tech Stack

- **Backend:** Python, Flask, `yt-dlp` (YouTube/Generic), `spotdl` (Spotify)
- **Frontend:** Vanilla JS, TailwindCSS (for utility structure), Custom CSS overrides
- **Audio/Video Processing:** FFmpeg

---

## ⚙️ Setup & Running Locally

### 1. Install Prerequisites
Make sure **Python 3.8+** and **FFmpeg** are installed and added to your environment `PATH`.
- [Download FFmpeg](https://ffmpeg.org/download.html)

### 2. Install Dependencies
Run:
```bash
pip install -r requirements.txt
```

### 3. Run the Server
Launch the Flask development server:
```bash
python server.py
```
The app will be live at `http://localhost:5000`.
