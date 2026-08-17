# PDF Story Reader

A browser-based PDF audiobook reader with a synchronized page viewer, smart dialogue casting, voice controls, and on-device PDF processing.

## What changed in v2

- Large, responsive PDF page viewer powered by PDF.js
- Flip pages while narration continues, or turn on Follow Audio to sync the viewer to the spoken page
- Read This Page action to move narration to any page you are browsing
- Smarter narration pipeline that splits narration and quoted dialogue inside the same passage
- Best-effort speaker detection using common dialogue tags such as “said,” “asked,” “replied,” and “whispered”
- Detected-character cast panel with per-speaker voice overrides
- Natural-voice preference that ranks premium, enhanced, neural, and higher-quality device voices first when available
- Voice preview, speed, pitch, volume, text-size, and sleep-timer controls
- Approximate 15-second rewind/forward based on reading speed and word count
- Reading-position persistence for the same PDF on the same device
- Improved progress, time remaining, book stats, mobile layout, and iOS-friendly controls
- Media Session hooks and the prior quiet-audio workaround retained for better mobile lock-screen behavior

## Voice quality

This version still uses the browser’s Web Speech API, so final voice quality depends on the voices installed or exposed by the user’s operating system and browser. The app now prefers better local voices and performs dialogue with separate voices. Truly studio-grade neural audiobook audio would require a hosted text-to-speech provider and an API/backend layer.

## Run locally

Open `index.html` directly or serve the repository with a small static server:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy

The project is static HTML/CSS/JavaScript and can be deployed to GitHub Pages, Netlify, Vercel, Cloudflare Pages, or any basic static host.

## PDF support

- Best: text-based books and documents
- Limited: complex multi-column layouts
- Not supported without OCR: scanned/image-only PDFs

## Privacy

PDF parsing, text extraction, speaker analysis, page rendering, and speech synthesis all run in the browser. The project does not include analytics or a backend upload endpoint.
