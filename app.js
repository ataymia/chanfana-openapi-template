// PDF Story Reader - Text to Speech Application
// Uses pdf.js for PDF extraction and Web Speech API for TTS

// Track if pdf.js has loaded
let pdfJsLoaded = false;

// Robust iOS/Safari detection for modern devices including iPhone 15
const isIOS = (() => {
    // Check for iOS via user agent
    const iosUA = /iPad|iPhone|iPod/.test(navigator.userAgent);
    // Check for iPad OS (reports as Mac with touch)
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    // Check via platform
    const iosPlatform = /iPhone|iPad|iPod/.test(navigator.platform);
    // Check for iOS-specific features
    const hasIOSWebkit = 'webkitAudioContext' in window && 'ontouchstart' in window && !navigator.userAgent.includes('Android');
    // Modern iOS detection via standalone mode support
    const supportsStandalone = 'standalone' in navigator;
    
    return iosUA || iPadOS || iosPlatform || (hasIOSWebkit && supportsStandalone);
})();

const isSafari = (() => {
    const ua = navigator.userAgent.toLowerCase();
    // Safari but not Chrome, Edge, or other Chromium browsers
    return ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium') && !ua.includes('edg');
})();

const isIOSSafari = isIOS || (isSafari && 'ontouchstart' in window);

// Debug logging for iOS detection
console.log('Device detection:', { isIOS, isSafari, isIOSSafari, userAgent: navigator.userAgent });

// Set up pdf.js worker when library is loaded
function initPdfJs() {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        pdfJsLoaded = true;
        console.log('PDF.js loaded successfully');
        return true;
    }
    return false;
}

// Constants for PDF.js loading
const PDFJS_CHECK_INTERVAL_MS = 100;
const PDFJS_MAX_WAIT_MS = 10000;

// Media Session artwork - URL-encoded SVG for lock screen display
const MEDIA_SESSION_ARTWORK_URL = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Ctext%20y%3D%22.9em%22%20font-size%3D%2290%22%3E%F0%9F%93%9A%3C%2Ftext%3E%3C%2Fsvg%3E';

// Promise-based wait for PDF.js to load
function waitForPdfJs(maxWaitMs = PDFJS_MAX_WAIT_MS) {
    return new Promise((resolve, reject) => {
        if (initPdfJs()) {
            resolve(true);
            return;
        }
        
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (initPdfJs()) {
                clearInterval(checkInterval);
                resolve(true);
            } else if (Date.now() - startTime > maxWaitMs) {
                clearInterval(checkInterval);
                reject(new Error('PDF library failed to load. Please check your internet connection and refresh the page.'));
            }
        }, PDFJS_CHECK_INTERVAL_MS);
    });
}

// Try to init pdf.js immediately, or start background loading
if (!initPdfJs()) {
    // Start background wait - don't block app initialization
    waitForPdfJs().catch(err => {
        console.error('PDF.js library failed to load:', err.message);
    });
}

class PDFStoryReader {
    constructor() {
        this.pdfDoc = null;
        this.textContent = [];
        this.paragraphs = [];
        this.currentParagraphIndex = 0;
        this.isPlaying = false;
        this.speechSynthesis = window.speechSynthesis;
        this.currentUtterance = null;
        this.voices = [];
        this.narratorVoice = null;
        this.dialogueVoice = null;
        this.speechRate = 1.0;
        this.smartVoices = true;
        this.currentSpeaker = null;
        this.speakerVoices = new Map();
        
        // iOS Safari workaround: timer to prevent speech from getting stuck
        this.iosSpeechTimer = null;
        this.iosSpeechInitialized = false;
        
        // Background audio element for Media Session API (enables lock screen controls)
        this.backgroundAudio = null;
        this.mediaSessionSupported = 'mediaSession' in navigator;
        
        this.initElements();
        this.initVoices();
        this.initBackgroundAudio();
        this.initMediaSession();
        this.initEventListeners();
    }

    initElements() {
        // Upload elements
        this.uploadSection = document.getElementById('upload-section');
        this.readerSection = document.getElementById('reader-section');
        this.dropZone = document.getElementById('drop-zone');
        this.fileInput = document.getElementById('file-input');
        this.loadingOverlay = document.getElementById('loading-overlay');

        // Reader elements
        this.bookName = document.getElementById('book-name');
        this.changeBookBtn = document.getElementById('change-book');
        this.progressFill = document.getElementById('progress-fill');
        this.currentPosition = document.getElementById('current-position');
        this.totalPages = document.getElementById('total-pages');
        this.textDisplay = document.getElementById('text-display');
        this.currentText = document.getElementById('current-text');

        // Control elements
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.playIcon = document.getElementById('play-icon');
        this.playLabel = document.getElementById('play-label');
        this.rewindBtn = document.getElementById('rewind-btn');
        this.forwardBtn = document.getElementById('forward-btn');

        // Settings elements
        this.speedControl = document.getElementById('speed-control');
        this.speedValue = document.getElementById('speed-value');
        this.voiceSelect = document.getElementById('voice-select');
        this.dialogueVoiceSelect = document.getElementById('dialogue-voice-select');
        this.smartVoicesCheckbox = document.getElementById('smart-voices');
    }

    initVoices() {
        // Load voices when they become available
        const loadVoices = () => {
            this.voices = this.speechSynthesis.getVoices();
            if (this.voices.length > 0) {
                this.populateVoiceSelects();
            }
        };

        // Chrome needs this event
        if (this.speechSynthesis.onvoiceschanged !== undefined) {
            this.speechSynthesis.onvoiceschanged = loadVoices;
        }
        
        // Also try loading immediately for Firefox/Safari
        loadVoices();
        
        // iOS Safari workaround: voices may not be immediately available
        // Retry loading voices multiple times
        if (this.voices.length === 0) {
            let retryCount = 0;
            const maxRetries = 20;
            const retryInterval = setInterval(() => {
                retryCount++;
                this.voices = this.speechSynthesis.getVoices();
                if (this.voices.length > 0) {
                    this.populateVoiceSelects();
                    clearInterval(retryInterval);
                } else if (retryCount >= maxRetries) {
                    clearInterval(retryInterval);
                    console.warn('Could not load voices after multiple attempts');
                }
            }, 250);
        }
    }

    populateVoiceSelects() {
        // Clear existing options
        this.voiceSelect.innerHTML = '';
        this.dialogueVoiceSelect.innerHTML = '';

        // Group voices by language
        const englishVoices = this.voices.filter(v => v.lang.startsWith('en'));
        const otherVoices = this.voices.filter(v => !v.lang.startsWith('en'));

        // Add English voices first
        englishVoices.forEach((voice, index) => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = `${voice.name} (${voice.lang})`;
            this.voiceSelect.appendChild(option.cloneNode(true));
            this.dialogueVoiceSelect.appendChild(option);
        });

        // Add other voices
        otherVoices.forEach((voice, index) => {
            const option = document.createElement('option');
            option.value = voice.name;
            option.textContent = `${voice.name} (${voice.lang})`;
            this.voiceSelect.appendChild(option.cloneNode(true));
            this.dialogueVoiceSelect.appendChild(option);
        });

        // Set default voices - try to pick different voices for narrator and dialogue
        if (englishVoices.length > 0) {
            this.narratorVoice = englishVoices[0];
            this.dialogueVoice = englishVoices.length > 1 ? englishVoices[1] : englishVoices[0];
            
            // Try to find a good narrator voice (prefer deeper/male voices for narration)
            const maleVoice = englishVoices.find(v => 
                v.name.toLowerCase().includes('male') || 
                v.name.toLowerCase().includes('david') ||
                v.name.toLowerCase().includes('james') ||
                v.name.toLowerCase().includes('daniel')
            );
            if (maleVoice) this.narratorVoice = maleVoice;

            // Try to find a different voice for dialogue
            const femaleVoice = englishVoices.find(v => 
                v.name.toLowerCase().includes('female') || 
                v.name.toLowerCase().includes('samantha') ||
                v.name.toLowerCase().includes('victoria') ||
                v.name.toLowerCase().includes('karen')
            );
            if (femaleVoice && femaleVoice !== this.narratorVoice) {
                this.dialogueVoice = femaleVoice;
            }

            this.voiceSelect.value = this.narratorVoice.name;
            this.dialogueVoiceSelect.value = this.dialogueVoice.name;
        }
    }

    initBackgroundAudio() {
        // Create a silent audio element that loops to keep the audio session active
        // This enables background playback when the phone is locked or app is in background
        // Using a data URL for a tiny silent WAV file (avoids network requests)
        const silentWavBase64 = 'UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        
        this.backgroundAudio = document.createElement('audio');
        this.backgroundAudio.id = 'background-audio';
        this.backgroundAudio.loop = true;
        this.backgroundAudio.volume = 0; // Silent - just to keep audio session active
        this.backgroundAudio.src = 'data:audio/wav;base64,' + silentWavBase64;
        
        // Ensure audio can play in background on iOS
        this.backgroundAudio.setAttribute('playsinline', '');
        this.backgroundAudio.setAttribute('webkit-playsinline', '');
        
        // Append to body (hidden)
        this.backgroundAudio.style.display = 'none';
        document.body.appendChild(this.backgroundAudio);
        
        console.log('Background audio element initialized for lock screen support');
    }

    initMediaSession() {
        if (!this.mediaSessionSupported) {
            console.log('Media Session API not supported');
            return;
        }
        
        console.log('Initializing Media Session API for control center integration');
        
        // Set up media session action handlers for lock screen controls
        navigator.mediaSession.setActionHandler('play', () => {
            console.log('Media Session: play');
            this.play();
        });
        
        navigator.mediaSession.setActionHandler('pause', () => {
            console.log('Media Session: pause');
            this.pause();
        });
        
        navigator.mediaSession.setActionHandler('previoustrack', () => {
            console.log('Media Session: previoustrack (rewind)');
            this.rewind();
        });
        
        navigator.mediaSession.setActionHandler('nexttrack', () => {
            console.log('Media Session: nexttrack (forward)');
            this.forward();
        });
        
        // Seek backward/forward handlers (for scrubbing controls)
        try {
            navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                console.log('Media Session: seekbackward', details);
                this.rewind();
            });
            
            navigator.mediaSession.setActionHandler('seekforward', (details) => {
                console.log('Media Session: seekforward', details);
                this.forward();
            });
        } catch (e) {
            console.log('Seek handlers not supported:', e.message);
        }
    }

    updateMediaSessionMetadata() {
        if (!this.mediaSessionSupported) return;
        
        const currentParagraph = this.paragraphs[this.currentParagraphIndex];
        const bookTitle = this.bookName ? this.bookName.textContent : 'PDF Story Reader';
        const pageInfo = currentParagraph ? `Page ${currentParagraph.page}` : '';
        
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: bookTitle,
                artist: 'PDF Story Reader',
                album: pageInfo,
                artwork: [
                    { src: MEDIA_SESSION_ARTWORK_URL, sizes: '96x96', type: 'image/svg+xml' }
                ]
            });
        } catch (e) {
            console.log('Error setting media metadata:', e.message);
        }
    }

    updateMediaSessionState() {
        if (!this.mediaSessionSupported) return;
        
        try {
            navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
        } catch (e) {
            console.log('Error setting playback state:', e.message);
        }
    }

    startBackgroundAudio() {
        if (!this.backgroundAudio) return;
        
        // Play the silent audio to keep the session active in background
        const playPromise = this.backgroundAudio.play();
        if (playPromise !== undefined) {
            playPromise.catch(e => {
                console.log('Background audio play error (expected on first load):', e.message);
            });
        }
        
        this.updateMediaSessionMetadata();
        this.updateMediaSessionState();
    }

    stopBackgroundAudio() {
        if (!this.backgroundAudio) return;
        
        this.backgroundAudio.pause();
        this.updateMediaSessionState();
    }

    initEventListeners() {
        // Constants for touch handling
        const TOUCH_CLICK_THRESHOLD_MS = 500; // Time to distinguish touch from click
        
        // Helper to add unified touch/click handlers for iOS compatibility
        // This prevents double-firing while ensuring responsiveness
        const addTapHandler = (element, handler, options = {}) => {
            let touchMoved = false;
            let lastTouchTime = 0;
            
            // Track touch movement to distinguish taps from scrolls
            element.addEventListener('touchstart', (e) => {
                touchMoved = false;
            }, { passive: true });
            
            element.addEventListener('touchmove', () => {
                touchMoved = true;
            }, { passive: true });
            
            element.addEventListener('touchend', (e) => {
                // Capture state to avoid race conditions
                const wasTouchMove = touchMoved;
                if (!wasTouchMove) {
                    e.preventDefault();
                    lastTouchTime = Date.now();
                    // Execute handler immediately on touchend for responsiveness
                    handler(e);
                }
            }, { passive: false });
            
            // Fallback click handler for non-touch devices
            element.addEventListener('click', (e) => {
                // Ignore click if it came from a recent touch event
                const timeSinceTouch = Date.now() - lastTouchTime;
                if (timeSinceTouch > TOUCH_CLICK_THRESHOLD_MS) {
                    if (options.preventDefault !== false) {
                        e.preventDefault();
                    }
                    handler(e);
                }
            });
        };
        
        // File upload events with unified touch/click handling
        addTapHandler(this.dropZone, () => {
            this.fileInput.click();
        });
        
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Drag and drop - need to handle dragenter, dragover, dragleave, and drop
        // Both dragenter and dragover need preventDefault to allow drop
        this.dropZone.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dropZone.classList.add('dragover');
        });
        
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dropZone.classList.add('dragover');
        });
        
        this.dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dropZone.classList.remove('dragover');
        });
        
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.dropZone.classList.remove('dragover');
            
            const file = e.dataTransfer.files[0];
            this.processFile(file);
        });

        // Reader controls with unified touch/click handling
        addTapHandler(this.changeBookBtn, () => this.resetReader());
        addTapHandler(this.playPauseBtn, () => this.togglePlayPause());
        addTapHandler(this.rewindBtn, () => this.rewind());
        addTapHandler(this.forwardBtn, () => this.forward());

        // Progress bar - handle both touch and click for seeking
        const progressBar = document.querySelector('.progress-bar');
        
        if (progressBar) {
            const handleProgressSeek = (clientX) => {
                const rect = progressBar.getBoundingClientRect();
                const percent = (clientX - rect.left) / rect.width;
                this.seekToPercent(Math.max(0, Math.min(1, percent)));
            };
            
            progressBar.addEventListener('click', (e) => {
                handleProgressSeek(e.clientX);
            });
            
            progressBar.addEventListener('touchend', (e) => {
                if (e.changedTouches && e.changedTouches.length > 0) {
                    e.preventDefault();
                    handleProgressSeek(e.changedTouches[0].clientX);
                }
            }, { passive: false });
        }

        // Settings
        this.speedControl.addEventListener('input', (e) => {
            this.speechRate = parseFloat(e.target.value);
            this.speedValue.textContent = `${this.speechRate.toFixed(1)}x`;
        });

        this.voiceSelect.addEventListener('change', (e) => {
            this.narratorVoice = this.voices.find(v => v.name === e.target.value);
        });

        this.dialogueVoiceSelect.addEventListener('change', (e) => {
            this.dialogueVoice = this.voices.find(v => v.name === e.target.value);
        });

        this.smartVoicesCheckbox.addEventListener('change', (e) => {
            this.smartVoices = e.target.checked;
        });

        // Handle page visibility - DO NOT pause when tab is hidden to allow background playback
        // The background audio and Media Session API will keep playback going when locked
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isPlaying) {
                // Keep playing in background - update media session state
                this.updateMediaSessionState();
                console.log('Page hidden, continuing background playback');
            } else if (!document.hidden && this.isPlaying) {
                // Page visible again - ensure display is updated
                this.updateDisplay();
            }
        });

        // Prevent browser from opening files dropped outside the drop zone
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
        });
    }

    // Helper method to validate and process a file
    processFile(file) {
        if (!file) {
            alert('No file detected. Please try again.');
            return;
        }
        
        // Check file extension as MIME type may be unreliable
        const isPdf = file.type === 'application/pdf' || 
                      file.name.toLowerCase().endsWith('.pdf');
        if (isPdf) {
            this.loadPDF(file);
        } else {
            alert('Please upload a PDF file. Received: ' + (file.name || 'unknown file'));
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        this.processFile(file);
    }

    async loadPDF(file) {
        this.showLoading(true);
        
        try {
            // Wait for pdf.js to load if it hasn't yet
            if (typeof pdfjsLib === 'undefined' || !pdfJsLoaded) {
                console.log('PDF.js not loaded yet, waiting...');
                await waitForPdfJs(PDFJS_MAX_WAIT_MS);
            }
            
            const arrayBuffer = await file.arrayBuffer();
            this.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            this.bookName.textContent = file.name.replace('.pdf', '');
            this.totalPages.textContent = `of ${this.pdfDoc.numPages} pages`;
            
            await this.extractText();
            
            this.uploadSection.classList.add('hidden');
            this.readerSection.classList.remove('hidden');
            
            this.updateDisplay();
        } catch (error) {
            console.error('Error loading PDF:', error);
            alert(error.message || 'Error loading PDF. Please try another file.');
        } finally {
            this.showLoading(false);
        }
    }

    async extractText() {
        this.textContent = [];
        this.paragraphs = [];
        
        for (let i = 1; i <= this.pdfDoc.numPages; i++) {
            const page = await this.pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            
            let pageText = '';
            let lastY = null;
            
            textContent.items.forEach(item => {
                // Detect new paragraphs based on Y position changes
                if (lastY !== null && Math.abs(item.transform[5] - lastY) > 12) {
                    pageText += '\n\n';
                } else if (lastY !== null) {
                    pageText += ' ';
                }
                pageText += item.str;
                lastY = item.transform[5];
            });
            
            this.textContent.push({
                page: i,
                text: pageText.trim()
            });
        }

        // Split into readable paragraphs/sentences
        this.paragraphs = [];
        this.textContent.forEach(pageContent => {
            const text = pageContent.text;
            // Split by paragraphs (double newlines) or by sentences for better TTS chunks
            const chunks = text.split(/\n\n+/).filter(p => p.trim());
            
            chunks.forEach(chunk => {
                // Further split long paragraphs into sentences for better reading
                const sentences = this.splitIntoSentences(chunk);
                sentences.forEach(sentence => {
                    if (sentence.trim()) {
                        this.paragraphs.push({
                            page: pageContent.page,
                            text: sentence.trim(),
                            isDialogue: this.detectDialogue(sentence),
                            speaker: this.detectSpeaker(sentence)
                        });
                    }
                });
            });
        });
    }

    splitIntoSentences(text) {
        // Split into larger, more natural chunks for TTS
        // Target ~800-1000 chars to reduce interruptions, but respect natural breaks
        const chunks = [];
        let current = '';
        
        // Constants for chunk sizing
        const TARGET_MIN_SIZE = 600;  // Minimum preferred chunk size
        const TARGET_MAX_SIZE = 1200; // Maximum chunk size before forcing split
        const HARD_MAX_SIZE = 1500;   // Absolute maximum to prevent TTS issues
        
        // Split on sentence endings
        const parts = text.split(/(?<=[.!?])\s+/);
        
        parts.forEach(part => {
            const potentialLength = current.length + part.length + 1;
            
            // Smart chunking rules:
            // 1. If under target min, always accumulate
            // 2. If within target range, keep accumulating (dialogue-aware)
            // 3. If getting long, look for good break points
            // 4. At hard limit, must split
            
            if (current.length < TARGET_MIN_SIZE) {
                // Under minimum - always add more
                current += (current ? ' ' : '') + part;
            } else if (potentialLength < TARGET_MAX_SIZE) {
                // Within target range - continue accumulating
                // This keeps dialogue and related text together naturally
                current += (current ? ' ' : '') + part;
            } else if (potentialLength < HARD_MAX_SIZE) {
                // Getting long but not at hard limit - look for good break points
                const isGoodBreak = /[.!?]["']?\s*$/.test(current) && !/^\s*["']/.test(part);
                
                if (isGoodBreak) {
                    if (current) chunks.push(current);
                    current = part;
                } else {
                    // Not a good break - continue accumulating
                    current += (current ? ' ' : '') + part;
                }
            } else {
                // At hard limit - must split
                if (current) chunks.push(current);
                current = part;
            }
        });
        
        if (current) chunks.push(current);
        
        return chunks;
    }

    detectDialogue(text) {
        // Detect if text contains dialogue (quoted speech)
        const dialoguePatterns = [
            /"[^"]*"/,           // Double quotes
            /'[^']*'/,           // Single quotes
            /「[^」]*」/,         // Japanese quotes
            /«[^»]*»/,           // French quotes
            /„[^"]*"/            // German quotes
        ];
        
        return dialoguePatterns.some(pattern => pattern.test(text));
    }

    detectSpeaker(text) {
        // Try to detect who is speaking based on context
        // Look for patterns like: "Hello," said John. or John said, "Hello"
        const speakerPatterns = [
            /said\s+(\w+)/i,
            /(\w+)\s+said/i,
            /(\w+)\s+replied/i,
            /replied\s+(\w+)/i,
            /(\w+)\s+asked/i,
            /asked\s+(\w+)/i,
            /(\w+)\s+exclaimed/i,
            /(\w+)\s+whispered/i,
            /(\w+)\s+shouted/i,
            /(\w+)\s+muttered/i,
            /(\w+)\s+called/i,
            /(\w+)\s+answered/i
        ];

        for (const pattern of speakerPatterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    }

    getVoiceForSpeaker(speaker) {
        if (!speaker || !this.smartVoices) {
            return this.narratorVoice;
        }

        // Check if we've already assigned a voice to this speaker
        if (this.speakerVoices.has(speaker)) {
            return this.speakerVoices.get(speaker);
        }

        // Assign a new voice to this speaker
        const englishVoices = this.voices.filter(v => v.lang.startsWith('en'));
        const usedVoices = Array.from(this.speakerVoices.values());
        
        // Find an unused voice
        let newVoice = englishVoices.find(v => 
            !usedVoices.includes(v) && 
            v !== this.narratorVoice
        );

        if (!newVoice) {
            // If all voices used, cycle through them
            const index = this.speakerVoices.size % englishVoices.length;
            newVoice = englishVoices[index];
        }

        this.speakerVoices.set(speaker, newVoice);
        return newVoice;
    }

    updateDisplay() {
        if (this.paragraphs.length === 0) return;
        
        const currentParagraph = this.paragraphs[this.currentParagraphIndex];
        
        // Update text display with highlighting
        let displayText = currentParagraph.text;
        
        // Highlight dialogue
        if (currentParagraph.isDialogue) {
            displayText = displayText.replace(
                /(["'][^"']*["'])/g, 
                '<span class="dialogue">$1</span>'
            );
        }
        
        this.currentText.innerHTML = displayText;
        
        // Update progress
        const progress = ((this.currentParagraphIndex + 1) / this.paragraphs.length) * 100;
        this.progressFill.style.width = `${progress}%`;
        this.currentPosition.textContent = `Page ${currentParagraph.page}`;
    }

    togglePlayPause() {
        console.log('togglePlayPause called, isPlaying:', this.isPlaying);
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        // iOS Safari speech init constants
        const IOS_INIT_VOLUME = 0.01; // Nearly silent volume for init utterance
        const IOS_INIT_RATE = 10; // Maximum rate for quick init
        const IOS_INIT_DELAY_MS = 100; // Delay after init utterance
        
        if (this.paragraphs.length === 0) {
            console.log('No paragraphs to play');
            return;
        }
        
        console.log('Play triggered, isIOSSafari:', isIOSSafari, 'iosSpeechInitialized:', this.iosSpeechInitialized);
        
        // iOS Safari workaround: Initialize speech synthesis with a user gesture
        // by speaking a short utterance first - empty string may not work
        if (isIOSSafari && !this.iosSpeechInitialized) {
            console.log('Initializing iOS Safari speech synthesis');
            this.speechSynthesis.cancel();
            // Use a very short word instead of empty string for better iOS compatibility
            const initUtterance = new SpeechSynthesisUtterance(' ');
            initUtterance.volume = IOS_INIT_VOLUME;
            initUtterance.rate = IOS_INIT_RATE;
            this.speechSynthesis.speak(initUtterance);
            this.iosSpeechInitialized = true;
            
            // Wait a tiny bit for the init utterance to process
            setTimeout(() => {
                this.isPlaying = true;
                this.updatePlayButton();
                this.startIOSSpeechTimer();
                this.startBackgroundAudio(); // Enable background playback
                this.speakCurrent();
            }, IOS_INIT_DELAY_MS);
            return;
        }
        
        this.isPlaying = true;
        this.updatePlayButton();
        
        // Start background audio for lock screen control support
        this.startBackgroundAudio();
        
        // iOS Safari workaround: Start a timer to periodically resume speech
        // This prevents iOS Safari from pausing speech unexpectedly
        if (isIOSSafari) {
            this.startIOSSpeechTimer();
        }
        
        this.speakCurrent();
    }

    pause() {
        this.isPlaying = false;
        this.speechSynthesis.cancel();
        this.updatePlayButton();
        
        // Stop background audio
        this.stopBackgroundAudio();
        
        // iOS Safari workaround: Stop the resume timer
        if (isIOSSafari) {
            this.stopIOSSpeechTimer();
        }
    }
    
    // iOS Safari workaround: Timer to prevent speech from getting stuck
    startIOSSpeechTimer() {
        this.stopIOSSpeechTimer();
        this.iosSpeechTimer = setInterval(() => {
            if (this.isPlaying && this.speechSynthesis.paused) {
                this.speechSynthesis.resume();
            }
        }, 10000); // Check every 10 seconds
    }
    
    stopIOSSpeechTimer() {
        if (this.iosSpeechTimer) {
            clearInterval(this.iosSpeechTimer);
            this.iosSpeechTimer = null;
        }
    }

    updatePlayButton() {
        if (this.isPlaying) {
            this.playIcon.textContent = '⏸️';
            this.playLabel.textContent = 'Pause';
        } else {
            this.playIcon.textContent = '▶️';
            this.playLabel.textContent = 'Play';
        }
    }

    speakCurrent() {
        if (!this.isPlaying || this.currentParagraphIndex >= this.paragraphs.length) {
            this.isPlaying = false;
            this.updatePlayButton();
            this.stopBackgroundAudio(); // Stop background audio when done
            // iOS Safari workaround: Stop the timer when done
            if (isIOSSafari) {
                this.stopIOSSpeechTimer();
            }
            return;
        }

        const paragraph = this.paragraphs[this.currentParagraphIndex];
        this.updateDisplay();
        this.updateMediaSessionMetadata(); // Update lock screen info

        // Cancel any ongoing speech
        this.speechSynthesis.cancel();
        
        // iOS Safari workaround: Small delay after cancel to ensure clean state
        const speakDelay = isIOSSafari ? 50 : 0;
        
        setTimeout(() => {
            // Get the text to speak - chunk long text for iOS Safari
            let textToSpeak = paragraph.text;
            
            // iOS Safari has issues with very long utterances (can fail after ~15 seconds)
            // Increased limits since we now have smarter chunking at the paragraph level
            // These are fallback limits for any remaining very long chunks
            const maxChars = isIOSSafari ? 800 : 1500;
            if (textToSpeak.length > maxChars) {
                // Find a good break point (prefer sentence boundaries over word boundaries)
                let breakPoint = textToSpeak.lastIndexOf('. ', maxChars);
                // If no sentence break found in the latter half, fall back to word break
                // Using maxChars/2 ensures we don't create tiny chunks from early sentence breaks
                if (breakPoint < maxChars / 2) {
                    breakPoint = textToSpeak.lastIndexOf(' ', maxChars);
                }
                if (breakPoint > 0) {
                    textToSpeak = textToSpeak.substring(0, breakPoint + 1);
                }
            }

            // Create utterance
            const utterance = new SpeechSynthesisUtterance(textToSpeak);
            utterance.rate = this.speechRate;

            // Smart voice selection
            if (this.smartVoices) {
                if (paragraph.isDialogue) {
                    // If we detected a speaker, use their assigned voice
                    if (paragraph.speaker) {
                        utterance.voice = this.getVoiceForSpeaker(paragraph.speaker);
                    } else {
                        utterance.voice = this.dialogueVoice;
                    }
                    // Slightly increase pitch for dialogue to differentiate
                    utterance.pitch = 1.1;
                } else {
                    utterance.voice = this.narratorVoice;
                    utterance.pitch = 1.0;
                }
            } else {
                utterance.voice = this.narratorVoice;
            }

            // Handle completion
            utterance.onend = () => {
                this.currentParagraphIndex++;
                if (this.isPlaying) {
                    // Small delay between paragraphs for natural pacing
                    setTimeout(() => this.speakCurrent(), 300);
                }
            };

            utterance.onerror = (e) => {
                console.error('Speech error:', e);
                // iOS Safari workaround: Try to recover from speech errors
                if (isIOSSafari) {
                    this.speechSynthesis.cancel();
                }
                // Try to continue despite error
                this.currentParagraphIndex++;
                if (this.isPlaying) {
                    setTimeout(() => this.speakCurrent(), isIOSSafari ? 500 : 300);
                }
            };

            this.currentUtterance = utterance;
            this.speechSynthesis.speak(utterance);
        }, speakDelay);
    }

    rewind() {
        const wasPlaying = this.isPlaying;
        this.pause();
        
        // Go back 5 paragraphs (roughly 10-15 seconds)
        this.currentParagraphIndex = Math.max(0, this.currentParagraphIndex - 5);
        this.updateDisplay();
        
        if (wasPlaying) {
            setTimeout(() => this.play(), 100);
        }
    }

    forward() {
        const wasPlaying = this.isPlaying;
        this.pause();
        
        // Skip forward 5 paragraphs
        this.currentParagraphIndex = Math.min(
            this.paragraphs.length - 1, 
            this.currentParagraphIndex + 5
        );
        this.updateDisplay();
        
        if (wasPlaying) {
            setTimeout(() => this.play(), 100);
        }
    }

    seekToPercent(percent) {
        const wasPlaying = this.isPlaying;
        this.pause();
        
        this.currentParagraphIndex = Math.floor(percent * this.paragraphs.length);
        this.currentParagraphIndex = Math.max(0, Math.min(this.paragraphs.length - 1, this.currentParagraphIndex));
        this.updateDisplay();
        
        if (wasPlaying) {
            setTimeout(() => this.play(), 100);
        }
    }

    resetReader() {
        this.pause();
        
        // iOS Safari workaround: Clean up the speech timer
        if (isIOSSafari) {
            this.stopIOSSpeechTimer();
            this.iosSpeechInitialized = false;
        }
        
        this.pdfDoc = null;
        this.textContent = [];
        this.paragraphs = [];
        this.currentParagraphIndex = 0;
        this.speakerVoices.clear();
        
        this.readerSection.classList.add('hidden');
        this.uploadSection.classList.remove('hidden');
        
        // Reset file input
        this.fileInput.value = '';
    }

    showLoading(show) {
        if (show) {
            this.loadingOverlay.classList.remove('hidden');
        } else {
            this.loadingOverlay.classList.add('hidden');
        }
    }
}

// iOS Safari viewport height fix
// Sets a CSS variable to the actual viewport height
function setViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}

// Set initial viewport height and update on resize/orientation change
setViewportHeight();
window.addEventListener('resize', setViewportHeight);
window.addEventListener('orientationchange', () => {
    // Small delay to allow iOS Safari to finish orientation animation
    setTimeout(setViewportHeight, 100);
});

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new PDFStoryReader();
});
