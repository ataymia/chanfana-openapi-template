// PDF Story Reader - Text to Speech Application
// Uses pdf.js for PDF extraction and Web Speech API for TTS

// Track if pdf.js has loaded
let pdfJsLoaded = false;

// Set up pdf.js worker when library is loaded
function initPdfJs() {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        pdfJsLoaded = true;
        return true;
    }
    return false;
}

// Try to init pdf.js immediately or wait for it
if (!initPdfJs()) {
    // If not loaded yet, set up a check
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max wait
    const checkPdfJs = setInterval(() => {
        attempts++;
        if (initPdfJs()) {
            clearInterval(checkPdfJs);
        } else if (attempts >= maxAttempts) {
            clearInterval(checkPdfJs);
            console.error('PDF.js library failed to load. PDF functionality may not work.');
        }
    }, 100);
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
        
        this.initElements();
        this.initVoices();
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
            this.populateVoiceSelects();
        };

        // Chrome needs this event
        if (this.speechSynthesis.onvoiceschanged !== undefined) {
            this.speechSynthesis.onvoiceschanged = loadVoices;
        }
        
        // Also try loading immediately for Firefox/Safari
        loadVoices();
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

    initEventListeners() {
        // File upload events
        this.dropZone.addEventListener('click', () => this.fileInput.click());
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
            if (file) {
                // Check file extension as MIME type may be unreliable
                const isPdf = file.type === 'application/pdf' || 
                              file.name.toLowerCase().endsWith('.pdf');
                if (isPdf) {
                    this.loadPDF(file);
                } else {
                    alert('Please upload a PDF file. Received: ' + (file.name || 'unknown file'));
                }
            } else {
                alert('No file detected. Please try again.');
            }
        });

        // Reader controls
        this.changeBookBtn.addEventListener('click', () => this.resetReader());
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.rewindBtn.addEventListener('click', () => this.rewind());
        this.forwardBtn.addEventListener('click', () => this.forward());

        // Progress bar click to seek
        document.querySelector('.progress-bar').addEventListener('click', (e) => {
            const rect = e.target.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            this.seekToPercent(percent);
        });

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

        // Handle page visibility to pause speech when tab is hidden
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isPlaying) {
                this.pause();
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

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            // Check file extension as MIME type may be unreliable
            const isPdf = file.type === 'application/pdf' || 
                          file.name.toLowerCase().endsWith('.pdf');
            if (isPdf) {
                this.loadPDF(file);
            } else {
                alert('Please upload a PDF file. Received: ' + (file.name || 'unknown file'));
            }
        }
    }

    async loadPDF(file) {
        this.showLoading(true);
        
        try {
            // Check if pdf.js is loaded
            if (typeof pdfjsLib === 'undefined') {
                throw new Error('PDF library not loaded. Please refresh the page and try again.');
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
        // Split into sentences but keep them reasonably sized for TTS
        const sentences = [];
        let current = '';
        
        // Split on sentence endings
        const parts = text.split(/(?<=[.!?])\s+/);
        
        parts.forEach(part => {
            if (current.length + part.length < 300) {
                current += (current ? ' ' : '') + part;
            } else {
                if (current) sentences.push(current);
                current = part;
            }
        });
        
        if (current) sentences.push(current);
        
        return sentences;
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
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        if (this.paragraphs.length === 0) return;
        
        this.isPlaying = true;
        this.updatePlayButton();
        this.speakCurrent();
    }

    pause() {
        this.isPlaying = false;
        this.speechSynthesis.cancel();
        this.updatePlayButton();
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
            return;
        }

        const paragraph = this.paragraphs[this.currentParagraphIndex];
        this.updateDisplay();

        // Cancel any ongoing speech
        this.speechSynthesis.cancel();

        // Create utterance
        const utterance = new SpeechSynthesisUtterance(paragraph.text);
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
            // Try to continue despite error
            this.currentParagraphIndex++;
            if (this.isPlaying) {
                setTimeout(() => this.speakCurrent(), 300);
            }
        };

        this.currentUtterance = utterance;
        this.speechSynthesis.speak(utterance);
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

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new PDFStoryReader();
});
