# 📚 PDF Story Reader - Text to Speech

A beautiful, browser-based PDF reader that reads your books aloud like a professional storyteller. Simply upload your PDF and enjoy hands-free reading with smart voice changes for different characters.

## ✨ Features

- **📖 PDF Upload**: Drag & drop or click to upload any PDF book
- **🎙️ Text-to-Speech**: Uses your browser's built-in speech synthesis
- **▶️ Playback Controls**: Play, Pause, Rewind, and Fast Forward
- **🎭 Smart Voice Changes**: Automatically detects dialogue and changes voices for different speakers
- **🎚️ Speed Control**: Adjust reading speed from 0.5x to 2x
- **🔊 Voice Selection**: Choose different voices for narration and dialogue
- **📊 Progress Tracking**: Visual progress bar with page indicators
- **💾 No Backend Required**: Everything runs in your browser - no server needed!
- **🔒 Background Playback**: Keep listening when your phone is locked or in another app
- **🎛️ Lock Screen Controls**: Control playback from your phone's control center/lock screen
- **📚 Smart Text Chunking**: Larger, more natural reading chunks that keep dialogue together

## 🚀 Getting Started

### Option 1: Open Directly (Simplest)
Just open `index.html` in any modern web browser (Chrome, Firefox, Edge, Safari).

```bash
# On macOS
open index.html

# On Linux
xdg-open index.html

# On Windows
start index.html
```

### Option 2: Use a Local Server (Recommended)
For the best experience, use a simple HTTP server:

```bash
# Using Python 3
python -m http.server 8000

# Using Node.js (if you have npx)
npx serve

# Using PHP
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

### Option 3: Deploy to GitHub Pages
1. Push this repository to GitHub
2. Go to Settings → Pages
3. Select "Deploy from a branch" → main → / (root)
4. Your reader will be available at `https://yourusername.github.io/repo-name`

### Option 4: Deploy to Netlify/Vercel
Simply connect your repository - no configuration needed! These platforms will automatically serve the static files.

## 📱 How to Use

1. **Upload Your PDF**: Drag and drop a PDF file onto the upload area, or click to browse
2. **Wait for Processing**: The app will extract text from your PDF
3. **Press Play**: Click the play button to start listening
4. **Control Playback**:
   - ⏪ **Rewind**: Go back ~5 paragraphs
   - ▶️/⏸️ **Play/Pause**: Start or stop reading
   - ⏩ **Forward**: Skip ahead ~5 paragraphs
   - Click the progress bar to jump to any position
5. **Adjust Settings**:
   - **Speed**: Make it read faster or slower
   - **Narrator Voice**: Choose the main reading voice
   - **Dialogue Voice**: Choose a different voice for quoted speech
   - **Smart Voice Changes**: Toggle automatic voice switching for characters

## 🎭 Smart Voice Features

The reader intelligently detects:
- **Quoted dialogue** ("Hello!" she said)
- **Speaker identification** (John said, Mary replied)
- **Character consistency** (same character = same voice throughout)

This makes the reading experience feel like listening to an audiobook with multiple voice actors!

## 🌐 Browser Compatibility

Works best in:
- ✅ Google Chrome (best voice selection)
- ✅ Microsoft Edge
- ✅ Safari (desktop and mobile)
- ✅ Firefox
- ✅ **iOS Safari** (iPhone/iPad) - with optimized touch handling and speech synthesis workarounds

### iOS Safari Notes
- Touch events are fully supported with tactile feedback
- Speech synthesis includes workarounds for iOS-specific timing issues
- Viewport is optimized for the iOS Safari address bar and safe areas
- **Background playback**: Continue listening when phone is locked (uses Media Session API)
- **Control Center integration**: Play/Pause/Skip controls work from lock screen
- For best results, use iOS 15.4 or later

Note: Voice availability depends on your operating system and browser.

## 🔒 Privacy

- **100% Client-Side**: Your PDFs never leave your device
- **No Data Collection**: No analytics, no tracking, no cookies
- **No Server Required**: Everything happens in your browser

## 📄 Supported PDF Types

- ✅ Text-based PDFs (most ebooks, documents)
- ⚠️ Scanned PDFs may not work well (requires OCR)
- ⚠️ PDFs with complex layouts may have reading order issues

## 🛠️ Technical Details

Built with:
- **PDF.js**: Mozilla's PDF rendering library for text extraction
- **Web Speech API**: Browser's built-in text-to-speech capability
- **Vanilla JavaScript**: No frameworks, just pure JS
- **CSS3**: Modern styling with gradients and animations

## 📝 License

MIT License - Feel free to use, modify, and distribute!
