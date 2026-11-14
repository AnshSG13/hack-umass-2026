"""
fetch_reel.py - download a reel from TikTok / Instagram / YouTube and prep it for summarizing.

Setup:
    pip install -U yt-dlp
    # also install ffmpeg: brew install ffmpeg  |  sudo apt install ffmpeg  |  winget install ffmpeg

Usage:
    python fetch_reel.py <url> [<url> ...]
    python fetch_reel.py <url> --cookies cookies.txt     # for Instagram / YouTube bot checks

Output (per video) in ./reels/<platform>_<id>/:
    meta.json      title, caption, creator, duration, hashtags, thumbnail, subtitle info
    video.mp4      the video (<=480p)
    audio.mp3      audio track, ready for Whisper
    frames/*.jpg   keyframes on scene changes (max 20), ready to send to Claude
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import yt_dlp

OUT_ROOT = Path("reels")
MAX_FRAMES = 20
# convert to full-range YUV so newer ffmpeg's JPEG encoder accepts any input video
SCALE = "scale=768:-2:out_range=full,format=yuvj420p"


def fetch_metadata(url, cookies=None):
    opts = {"quiet": True, "skip_download": True}
    if cookies:
        opts["cookiefile"] = cookies
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


def download_video(url, out_dir, cookies=None):
    opts = {
        "quiet": True,
        "format": "bv*[height<=480]+ba/b[height<=480]/b",  # small is fine for summarizing
        "merge_output_format": "mp4",
        "outtmpl": str(out_dir / "video.%(ext)s"),
    }
    if cookies:
        opts["cookiefile"] = cookies
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    return next(out_dir.glob("video.*"))


def download_captions(url, out_dir, cookies=None):
    """Best effort: platform captions are a bonus, so a failure here (e.g. YouTube 429) never stops the run."""
    opts = {
        "quiet": True,
        "skip_download": True,
        "writeautomaticsub": True,
        "writesubtitles": True,
        "subtitleslangs": ["en"],
        "subtitlesformat": "vtt",
        "outtmpl": str(out_dir / "captions.%(ext)s"),
    }
    if cookies:
        opts["cookiefile"] = cookies
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as e:
        print(f"  captions skipped ({str(e).splitlines()[0][:80]}) - Whisper will cover it")
        return None
    return next(out_dir.glob("captions*.vtt"), None)


def extract_audio(video, out_dir):
    audio = out_dir / "audio.mp3"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-vn", "-ac", "1", "-b:a", "64k", str(audio)],
        check=True,
    )
    return audio


def extract_frames(video, out_dir):
    frames_dir = out_dir / "frames"
    frames_dir.mkdir(exist_ok=True)
    # one frame per scene change, resized to 768px wide
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
         "-vf", f"select='gt(scene,0.3)',{SCALE}", "-fps_mode", "vfr",
         "-q:v", "3", "-frames:v", str(MAX_FRAMES), str(frames_dir / "f_%03d.jpg")],
        check=True,
    )
    frames = sorted(frames_dir.glob("*.jpg"))
    if len(frames) < 4:  # few scene changes (e.g. one static shot): sample every 2s instead
        for f in frames:
            f.unlink()
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
             "-vf", f"fps=1/2,{SCALE}", "-q:v", "3", "-frames:v", str(MAX_FRAMES), str(frames_dir / "f_%03d.jpg")],
            check=True,
        )
        frames = sorted(frames_dir.glob("*.jpg"))
    return frames


def process(url, cookies=None):
    print(f"\n=== {url}")
    info = fetch_metadata(url, cookies)
    platform = info.get("extractor_key", "unknown").lower()
    out_dir = OUT_ROOT / f"{platform}_{info.get('id', 'video')}"
    out_dir.mkdir(parents=True, exist_ok=True)

    meta = {
        "url": url,
        "platform": platform,
        "id": info.get("id"),
        "title": info.get("title"),
        "caption": info.get("description"),
        "creator": info.get("uploader") or info.get("channel"),
        "duration_s": info.get("duration"),
        "upload_date": info.get("upload_date"),
        "hashtags": info.get("tags") or [],
        "thumbnail": info.get("thumbnail"),
        "has_platform_captions": bool(info.get("subtitles") or info.get("automatic_captions")),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    print(f"  metadata ok: {meta['title']!r} by {meta['creator']} ({meta['duration_s'] or '?'}s)")

    video = download_video(url, out_dir, cookies)
    print(f"  video ok: {video} ({video.stat().st_size / 1e6:.1f} MB)")

    if meta["has_platform_captions"]:
        caps = download_captions(url, out_dir, cookies)
        if caps:
            print(f"  captions ok: {caps}")

    audio = extract_audio(video, out_dir)
    print(f"  audio ok: {audio}")

    frames = extract_frames(video, out_dir)
    print(f"  frames ok: {len(frames)} in {out_dir / 'frames'}")
    return out_dir


def main():
    p = argparse.ArgumentParser()
    p.add_argument("urls", nargs="+")
    p.add_argument("--cookies", help="cookies.txt exported from a logged-in browser")
    args = p.parse_args()

    results = {}
    for url in args.urls:
        try:
            process(url, args.cookies)
            results[url] = "OK"
        except Exception as e:  # keep going so one blocked platform doesn't stop the test
            results[url] = f"FAILED: {str(e).splitlines()[0][:200]}"
            print(f"  {results[url]}")

    print("\n=== Summary")
    for url, status in results.items():
        print(f"  {status:<8} {url}")
    sys.exit(0 if all(s == "OK" for s in results.values()) else 1)


if __name__ == "__main__":
    main()