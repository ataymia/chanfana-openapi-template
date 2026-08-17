const PDFJS_SOURCES = [
  {
    lib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  },
  {
    lib: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
  }
];
const SETTINGS_KEY = 'pdf-story-reader-v2-settings';
const POSITION_KEY_PREFIX = 'pdf-story-reader-v2-position:';
const MEDIA_SESSION_ARTWORK_URL = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20rx%3D%2222%22%20fill%3D%22%238b7cff%22%2F%3E%3Ctext%20x%3D%2250%22%20y%3D%2261%22%20text-anchor%3D%22middle%22%20font-size%3D%2236%22%20font-family%3D%22Arial%22%20font-weight%3D%22700%22%20fill%3D%22white%22%3ESR%3C%2Ftext%3E%3C%2Fsvg%3E';
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeSpaces(text) {
  return String(text || '')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([“"'])\s+/g, '$1')
    .replace(/\s+([”"'])/g, '$1')
    .trim();
}

function wordCount(text) {
  const match = String(text || '').trim().match(/\b[\p{L}\p{N}’'-]+\b/gu);
  return match ? match.length : 0;
}

function loadExternalScript(src, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find(script => script.src === src);
    if (existing && typeof pdfjsLib !== 'undefined') {
      resolve();
      return;
    }

    const script = existing || document.createElement('script');
    let settled = false;
    const finish = callback => value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const onLoad = finish(resolve);
    const onError = finish(() => reject(new Error('Could not load PDF support.')));
    const timer = setTimeout(finish(() => reject(new Error('PDF support took too long to load.'))) , timeoutMs);

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      document.head.appendChild(script);
    }
  });
}

class PDFStoryReader {
  constructor() {
    this.pdfDoc = null;
    this.file = null;
    this.fileKey = '';
    this.pageTexts = [];
    this.units = [];
    this.currentUnitIndex = 0;
    this.currentSegmentIndex = 0;
    this.viewerPage = 1;
    this.renderTask = null;
    this.isPlaying = false;
    this.sessionToken = 0;
    this.speechSynthesis = 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.voices = [];
    this.narratorVoice = null;
    this.dialogueVoice = null;
    this.speakerVoiceNames = new Map();
    this.detectedSpeakers = [];
    this.speechRate = 1;
    this.speechPitch = 1;
    this.speechVolume = 1;
    this.smartVoices = true;
    this.preferNaturalVoices = true;
    this.followNarration = true;
    this.pageZoom = 110;
    this.readerFontSize = 21;
    this.sleepTimerId = null;
    this.backgroundAudio = null;
    this.iosKeepAliveTimer = null;
    this.toastTimer = null;
    this.lastRenderedPage = null;
    this.settings = this.loadSettings();

    this.cacheElements();
    this.applySavedSettings();
    this.initVoices();
    this.initBackgroundAudio();
    this.initMediaSession();
    this.bindEvents();
    this.setUploadStatus('Choose a PDF to begin.');
  }

  cacheElements() {
    const byId = id => document.getElementById(id);

    this.uploadSection = byId('upload-section');
    this.readerSection = byId('reader-section');
    this.dropZone = byId('drop-zone');
    this.chooseFileBtn = byId('choose-file-btn');
    this.fileInput = byId('file-input');
    this.uploadStatus = byId('upload-status');
    this.changeBook = byId('change-book');

    this.bookName = byId('book-name');
    this.bookPages = byId('book-pages');
    this.bookWords = byId('book-words');
    this.bookTime = byId('book-time');
    this.jumpViewerToAudio = byId('jump-viewer-to-audio');
    this.readViewedPage = byId('read-viewed-page');

    this.followNarrationCheckbox = byId('follow-narration');
    this.pdfCanvas = byId('pdf-canvas');
    this.pageRenderStatus = byId('page-render-status');
    this.prevPage = byId('prev-page');
    this.nextPage = byId('next-page');
    this.pageNumber = byId('page-number');
    this.pageCount = byId('page-count');
    this.pageZoomControl = byId('page-zoom');
    this.pageZoomValue = byId('page-zoom-value');

    this.currentLocation = byId('current-location');
    this.speakerChip = byId('speaker-chip');
    this.textDisplay = byId('text-display');
    this.currentText = byId('current-text');
    this.progressBar = byId('progress-bar');
    this.progressFill = byId('progress-fill');
    this.progressThumb = byId('progress-thumb');
    this.progressLabel = byId('progress-label');
    this.remainingTime = byId('remaining-time');
    this.rewindBtn = byId('rewind-btn');
    this.playPauseBtn = byId('play-pause-btn');
    this.playIcon = byId('play-icon');
    this.forwardBtn = byId('forward-btn');

    this.speedControl = byId('speed-control');
    this.speedValue = byId('speed-value');
    this.pitchControl = byId('pitch-control');
    this.pitchValue = byId('pitch-value');
    this.volumeControl = byId('volume-control');
    this.volumeValue = byId('volume-value');
    this.fontSizeControl = byId('font-size-control');
    this.fontSizeValue = byId('font-size-value');
    this.sleepTimer = byId('sleep-timer');
    this.voiceSelect = byId('voice-select');
    this.dialogueVoiceSelect = byId('dialogue-voice-select');
    this.smartVoicesCheckbox = byId('smart-voices');
    this.preferNaturalVoicesCheckbox = byId('prefer-natural-voices');
    this.previewVoices = byId('preview-voices');
    this.castList = byId('cast-list');
    this.castCount = byId('cast-count');

    this.loadingOverlay = byId('loading-overlay');
    this.loadingTitle = byId('loading-title');
    this.loadingMessage = byId('loading-message');
    this.loadingFill = byId('loading-fill');
    this.loadingPercent = byId('loading-percent');
    this.toast = byId('toast');

    this.canvasContext = this.pdfCanvas?.getContext?.('2d', { alpha: false }) || null;
  }

  loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  saveSettings() {
    const payload = {
      speechRate: this.speechRate,
      speechPitch: this.speechPitch,
      speechVolume: this.speechVolume,
      smartVoices: this.smartVoices,
      preferNaturalVoices: this.preferNaturalVoices,
      followNarration: this.followNarration,
      pageZoom: this.pageZoom,
      readerFontSize: this.readerFontSize,
      narratorVoiceName: this.narratorVoice?.name || '',
      dialogueVoiceName: this.dialogueVoice?.name || ''
    };

    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
    } catch {
      // Settings persistence is optional.
    }
  }

  applySavedSettings() {
    this.speechRate = Number(this.settings.speechRate) || 1;
    this.speechPitch = Number(this.settings.speechPitch) || 1;
    this.speechVolume = Number(this.settings.speechVolume) || 1;
    this.smartVoices = this.settings.smartVoices !== false;
    this.preferNaturalVoices = this.settings.preferNaturalVoices !== false;
    this.followNarration = this.settings.followNarration !== false;
    this.pageZoom = Number(this.settings.pageZoom) || 110;
    this.readerFontSize = Number(this.settings.readerFontSize) || 21;

    if (this.speedControl) this.speedControl.value = String(this.speechRate);
    if (this.pitchControl) this.pitchControl.value = String(this.speechPitch);
    if (this.volumeControl) this.volumeControl.value = String(this.speechVolume);
    if (this.smartVoicesCheckbox) this.smartVoicesCheckbox.checked = this.smartVoices;
    if (this.preferNaturalVoicesCheckbox) this.preferNaturalVoicesCheckbox.checked = this.preferNaturalVoices;
    if (this.followNarrationCheckbox) this.followNarrationCheckbox.checked = this.followNarration;
    if (this.pageZoomControl) this.pageZoomControl.value = String(this.pageZoom);
    if (this.fontSizeControl) this.fontSizeControl.value = String(this.readerFontSize);
    this.updateSettingLabels();
  }

  updateSettingLabels() {
    if (this.speedValue) this.speedValue.textContent = `${this.speechRate.toFixed(2)}×`;
    if (this.pitchValue) this.pitchValue.textContent = this.speechPitch.toFixed(2);
    if (this.volumeValue) this.volumeValue.textContent = `${Math.round(this.speechVolume * 100)}%`;
    if (this.fontSizeValue) this.fontSizeValue.textContent = `${this.readerFontSize}px`;
    if (this.pageZoomValue) this.pageZoomValue.textContent = `${this.pageZoom}%`;
    document.documentElement.style.setProperty('--reader-font-size', `${this.readerFontSize}px`);
  }

  bindEvents() {
    const on = (element, eventName, handler, options) => {
      if (element?.addEventListener) element.addEventListener(eventName, handler, options);
    };

    const openPicker = () => {
      if (!this.fileInput) return;
      try {
        if (typeof this.fileInput.showPicker === 'function') this.fileInput.showPicker();
        else this.fileInput.click();
      } catch {
        this.fileInput.click();
      }
    };

    on(this.dropZone, 'click', event => {
      if (event.target?.closest?.('#choose-file-btn') || event.target === this.fileInput) return;
      openPicker();
    });

    on(this.dropZone, 'keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPicker();
      }
    });

    on(this.fileInput, 'change', event => {
      const input = event.currentTarget;
      const file = input?.files?.[0];
      if (!file) {
        this.setUploadStatus('No file selected.');
        return;
      }

      this.setUploadStatus(`Selected ${file.name}. Opening…`);
      input.value = '';
      this.processFile(file).catch(error => this.handleLoadError(error));
    });

    ['dragenter', 'dragover'].forEach(type => {
      on(this.dropZone, type, event => {
        event.preventDefault();
        event.stopPropagation();
        this.dropZone?.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(type => {
      on(this.dropZone, type, event => {
        event.preventDefault();
        event.stopPropagation();
        this.dropZone?.classList.remove('dragover');
      });
    });

    on(this.dropZone, 'drop', event => {
      const file = event.dataTransfer?.files?.[0];
      if (file) this.processFile(file).catch(error => this.handleLoadError(error));
    });

    document.addEventListener('dragover', event => event.preventDefault());
    document.addEventListener('drop', event => event.preventDefault());

    on(this.changeBook, 'click', () => this.resetReader());
    on(this.playPauseBtn, 'click', () => this.togglePlayPause());
    on(this.rewindBtn, 'click', () => this.seekBySeconds(-15));
    on(this.forwardBtn, 'click', () => this.seekBySeconds(15));

    on(this.prevPage, 'click', () => this.browsePage(this.viewerPage - 1));
    on(this.nextPage, 'click', () => this.browsePage(this.viewerPage + 1));
    on(this.pageNumber, 'change', () => this.browsePage(Number(this.pageNumber.value)));
    on(this.pageNumber, 'keydown', event => {
      if (event.key === 'Enter') this.browsePage(Number(this.pageNumber.value));
    });

    on(this.pageZoomControl, 'input', () => {
      this.pageZoom = Number(this.pageZoomControl.value);
      this.updateSettingLabels();
      this.saveSettings();
      this.renderPage(this.viewerPage, true);
    });

    on(this.followNarrationCheckbox, 'change', () => {
      this.followNarration = this.followNarrationCheckbox.checked;
      this.saveSettings();
      if (this.followNarration && this.units.length) {
        this.viewerPage = this.units[this.currentUnitIndex].page;
        this.renderPage(this.viewerPage, true);
      }
    });

    on(this.jumpViewerToAudio, 'click', () => {
      if (!this.units.length) return;
      this.followNarration = true;
      if (this.followNarrationCheckbox) this.followNarrationCheckbox.checked = true;
      this.viewerPage = this.units[this.currentUnitIndex].page;
      this.renderPage(this.viewerPage, true);
      this.saveSettings();
    });

    on(this.readViewedPage, 'click', () => this.jumpAudioToPage(this.viewerPage));

    on(this.speedControl, 'input', () => {
      this.speechRate = Number(this.speedControl.value);
      this.updateSettingLabels();
      this.saveSettings();
      if (this.isPlaying) this.restartCurrentSegment();
      this.updateProgressMeta();
    });

    on(this.pitchControl, 'input', () => {
      this.speechPitch = Number(this.pitchControl.value);
      this.updateSettingLabels();
      this.saveSettings();
      if (this.isPlaying) this.restartCurrentSegment();
    });

    on(this.volumeControl, 'input', () => {
      this.speechVolume = Number(this.volumeControl.value);
      this.updateSettingLabels();
      this.saveSettings();
      if (this.isPlaying) this.restartCurrentSegment();
    });

    on(this.fontSizeControl, 'input', () => {
      this.readerFontSize = Number(this.fontSizeControl.value);
      this.updateSettingLabels();
      this.saveSettings();
    });

    on(this.smartVoicesCheckbox, 'change', () => {
      this.smartVoices = this.smartVoicesCheckbox.checked;
      this.saveSettings();
      if (this.isPlaying) this.restartCurrentSegment();
    });

    on(this.preferNaturalVoicesCheckbox, 'change', () => {
      this.preferNaturalVoices = this.preferNaturalVoicesCheckbox.checked;
      this.saveSettings();
      this.populateVoiceSelects(true);
      this.renderCastList();
      if (this.isPlaying) this.restartCurrentSegment();
    });

    on(this.voiceSelect, 'change', () => {
      this.narratorVoice = this.voices.find(voice => voice.name === this.voiceSelect.value) || this.narratorVoice;
      this.saveSettings();
      if (this.isPlaying) this.restartCurrentSegment();
    });

    on(this.dialogueVoiceSelect, 'change', () => {
      this.dialogueVoice = this.voices.find(voice => voice.name === this.dialogueVoiceSelect.value) || this.dialogueVoice;
      this.saveSettings();
      if (this.isPlaying) this.restartCurrentSegment();
    });

    on(this.previewVoices, 'click', () => this.previewSelectedVoices());
    on(this.sleepTimer, 'change', () => this.configureSleepTimer(Number(this.sleepTimer.value)));
    on(this.progressBar, 'pointerdown', event => this.seekFromProgressEvent(event));
    on(this.progressBar, 'keydown', event => {
      if (!this.units.length) return;
      if (event.key === 'ArrowLeft') this.seekBySeconds(-15);
      if (event.key === 'ArrowRight') this.seekBySeconds(15);
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isPlaying) this.updateDisplay();
    });
  }

  initVoices() {
    if (!this.speechSynthesis?.getVoices) {
      this.voices = [];
      if (this.voiceSelect) this.voiceSelect.disabled = true;
      if (this.dialogueVoiceSelect) this.dialogueVoiceSelect.disabled = true;
      if (this.previewVoices) this.previewVoices.disabled = true;
      return;
    }

    const refresh = () => {
      try {
        const voices = this.speechSynthesis.getVoices() || [];
        if (!voices.length) return;
        this.voices = voices;
        this.populateVoiceSelects(false);
        this.renderCastList();
      } catch (error) {
        console.warn('Could not load voices:', error);
      }
    };

    refresh();
    if ('onvoiceschanged' in this.speechSynthesis) this.speechSynthesis.onvoiceschanged = refresh;

    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      refresh();
      if (this.voices.length || attempts > 20) clearInterval(timer);
    }, 250);
  }

  voiceScore(voice) {
    const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
    let score = 0;
    if (/premium|enhanced|natural|neural|studio|eloquence/.test(name)) score += 100;
    if (/ava|samantha|serena|daniel|alex|allison|arthur|zoe|jamie|joelle|reed|nicky|evan/.test(name)) score += 35;
    if (voice.localService) score += 8;
    if (/en-us|en-gb|en-au|en-ca/.test(voice.lang.toLowerCase())) score += 12;
    return score;
  }

  getSortedVoices() {
    const english = this.voices.filter(voice => voice.lang.toLowerCase().startsWith('en'));
    const others = this.voices.filter(voice => !voice.lang.toLowerCase().startsWith('en'));
    const sorter = (a, b) => this.preferNaturalVoices
      ? this.voiceScore(b) - this.voiceScore(a) || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name);
    return [...english.sort(sorter), ...others.sort(sorter)];
  }

  populateVoiceSelects(preserveCurrent = true) {
    if (!this.voices.length || !this.voiceSelect || !this.dialogueVoiceSelect) return;

    const sorted = this.getSortedVoices();
    const previousNarrator = preserveCurrent
      ? (this.narratorVoice?.name || this.settings.narratorVoiceName)
      : this.settings.narratorVoiceName;
    const previousDialogue = preserveCurrent
      ? (this.dialogueVoice?.name || this.settings.dialogueVoiceName)
      : this.settings.dialogueVoiceName;

    const fill = select => {
      select.innerHTML = '';
      sorted.forEach(voice => {
        const option = document.createElement('option');
        const quality = this.voiceScore(voice) >= 70 ? ' • natural' : '';
        option.value = voice.name;
        option.textContent = `${voice.name} (${voice.lang})${quality}`;
        select.appendChild(option);
      });
    };

    fill(this.voiceSelect);
    fill(this.dialogueVoiceSelect);

    const narrator = sorted.find(voice => voice.name === previousNarrator) || sorted[0];
    const dialogue = sorted.find(voice => voice.name === previousDialogue)
      || sorted.find(voice => voice.name !== narrator?.name)
      || sorted[0];

    this.narratorVoice = narrator || null;
    this.dialogueVoice = dialogue || narrator || null;
    if (this.narratorVoice) this.voiceSelect.value = this.narratorVoice.name;
    if (this.dialogueVoice) this.dialogueVoiceSelect.value = this.dialogueVoice.name;
  }

  setUploadStatus(message) {
    if (this.uploadStatus) this.uploadStatus.textContent = message;
  }

  handleLoadError(error) {
    console.error(error);
    let message = error?.message || 'Could not open that PDF.';
    if (error?.name === 'PasswordException') message = 'This PDF is password-protected.';
    this.setUploadStatus(message);
    this.showToast(message);
  }

  async ensurePdfJs() {
    if (typeof pdfjsLib !== 'undefined') return pdfjsLib;

    let lastError = null;
    for (const source of PDFJS_SOURCES) {
      try {
        this.setUploadStatus('Loading PDF support…');
        await loadExternalScript(source.lib);
        if (typeof pdfjsLib !== 'undefined') {
          pdfjsLib.GlobalWorkerOptions.workerSrc = source.worker;
          return pdfjsLib;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('PDF support could not load.');
  }

  async processFile(file) {
    if (!file) return;

    const name = String(file.name || 'book.pdf');
    const isPdf = file.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      this.setUploadStatus('That file is not a PDF.');
      this.showToast('Please choose a PDF file.');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      this.setUploadStatus('That PDF is larger than 100 MB.');
      this.showToast('This reader supports PDFs up to 100 MB.');
      return;
    }

    await this.loadPDF(file);
  }

  async loadPDF(file) {
    this.showLoading(true, 'Opening your book', `Preparing ${file.name}…`, 2);
    this.setUploadStatus(`Opening ${file.name}…`);

    try {
      const pdfjs = await this.ensurePdfJs();
      this.pause(false);
      this.file = file;
      this.fileKey = `${file.name}|${file.size}|${file.lastModified}`;

      this.showLoading(true, 'Opening your book', 'Reading the PDF file…', 4);
      const arrayBuffer = await file.arrayBuffer();
      this.pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

      if (this.pageCount) this.pageCount.textContent = `/ ${this.pdfDoc.numPages}`;
      if (this.pageNumber) this.pageNumber.max = String(this.pdfDoc.numPages);
      if (this.bookName) this.bookName.textContent = file.name.replace(/\.pdf$/i, '');
      if (this.bookPages) this.bookPages.textContent = `${this.pdfDoc.numPages.toLocaleString()} pages`;

      await this.extractBook();
      this.detectedSpeakers = this.collectDetectedSpeakers();
      this.assignDefaultCharacterVoices();
      this.renderCastList();
      this.updateBookStats();
      this.restoreBookPosition();
      this.viewerPage = this.units[this.currentUnitIndex]?.page || 1;
      this.followNarration = true;
      if (this.followNarrationCheckbox) this.followNarrationCheckbox.checked = true;

      this.uploadSection?.classList.add('hidden');
      this.readerSection?.classList.remove('hidden');
      this.changeBook?.classList.remove('hidden');
      await this.renderPage(this.viewerPage, true);

      if (this.units.length) {
        this.updateDisplay();
        this.setUploadStatus('Book ready.');
        this.showToast('Book ready. Press Play.');
      } else {
        if (this.currentLocation) this.currentLocation.textContent = `Page ${this.viewerPage}`;
        if (this.currentText) {
          this.currentText.textContent = 'This PDF opened, but it does not contain selectable text to narrate. It may be a scanned-image PDF.';
        }
        this.setUploadStatus('PDF opened, but no selectable text was found.');
        this.showToast('PDF opened. No selectable text was found for narration.');
      }

      this.updateMediaSessionMetadata();
    } catch (error) {
      this.handleLoadError(error);
    } finally {
      this.showLoading(false);
    }
  }

  async extractBook() {
    this.pageTexts = [];
    this.units = [];
    const total = this.pdfDoc.numPages;
    const context = { recentSpeakers: [], lastDialogueSpeaker: null };

    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      const percent = 5 + Math.round((pageNumber / total) * 77);
      this.showLoading(true, 'Reading your book', `Extracting page ${pageNumber} of ${total}…`, percent);
      const page = await this.pdfDoc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = this.buildPageText(textContent.items);
      this.pageTexts.push(pageText);
      this.buildUnitsForPage(pageText, pageNumber, context);
      if (pageNumber % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }

    this.showLoading(true, 'Finishing', 'Preparing voices and pages…', 90);
    await new Promise(resolve => setTimeout(resolve, 40));
  }

  buildPageText(items) {
    if (!items?.length) return '';
    let result = '';
    let previous = null;

    for (const item of items) {
      const text = item.str || '';
      if (!text) continue;
      const x = item.transform?.[4] ?? 0;
      const y = item.transform?.[5] ?? 0;

      if (previous) {
        const yDiff = Math.abs(y - previous.y);
        if (previous.hasEOL || yDiff > 10) result += yDiff > 18 ? '\n\n' : '\n';
        else if (x > previous.x && !result.endsWith(' ') && !result.endsWith('\n')) result += ' ';
      }

      result += text;
      previous = { x, y, hasEOL: Boolean(item.hasEOL) };
    }

    return result
      .replace(/-\n(?=[a-z])/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  buildUnitsForPage(pageText, page, context) {
    if (!pageText.trim()) return;
    const paragraphs = pageText
      .split(/\n\s*\n|\n(?=\s{0,4}[A-Z“"])/)
      .map(normalizeSpaces)
      .filter(Boolean);

    paragraphs.forEach(paragraph => {
      const sentences = this.segmentSentences(paragraph);
      let bucket = '';

      const flush = () => {
        const text = normalizeSpaces(bucket);
        if (!text) return;
        const segments = this.buildPerformanceSegments(text, context);
        this.units.push({ page, text, segments, words: wordCount(text) });
        bucket = '';
      };

      sentences.forEach(sentence => {
        const candidate = `${bucket}${bucket ? ' ' : ''}${sentence}`;
        const hasDialogueBoundary = /[”"]\s*$/.test(bucket) || /^[“"]/.test(sentence);
        if (bucket && (candidate.length > 460 || (bucket.length > 220 && hasDialogueBoundary))) flush();
        bucket += `${bucket ? ' ' : ''}${sentence}`;
      });

      flush();
    });
  }

  segmentSentences(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
        return Array.from(segmenter.segment(text), entry => entry.segment.trim()).filter(Boolean);
      } catch {
        // Fall through to regex segmentation.
      }
    }

    return (text.match(/[^.!?]+(?:[.!?]+[”"']?|$)/g) || [text])
      .map(part => part.trim())
      .filter(Boolean);
  }

  buildPerformanceSegments(text, context) {
    const quotePattern = /([“"][^”"]{1,1200}[”"]|«[^»]{1,1200}»)/g;
    const segments = [];
    let lastIndex = 0;
    let match;

    while ((match = quotePattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'narration', text: text.slice(lastIndex, match.index), speaker: null });
      }

      const before = text.slice(Math.max(0, match.index - 180), match.index);
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 180);
      const speaker = this.detectSpeaker(`${before} ${after}`) || this.inferDialogueSpeaker(context);
      if (speaker) this.rememberSpeaker(context, speaker);
      segments.push({ type: 'dialogue', text: match[0], speaker: speaker || null });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      segments.push({ type: 'narration', text: text.slice(lastIndex), speaker: null });
    }
    if (!segments.length) segments.push({ type: 'narration', text, speaker: null });

    return segments
      .map(segment => ({ ...segment, text: normalizeSpaces(segment.text) }))
      .filter(segment => segment.text);
  }

  detectSpeaker(contextText) {
    const verbs = 'said|asked|replied|answered|whispered|shouted|murmured|muttered|called|cried|added|continued|exclaimed|snapped|laughed|yelled|breathed|remarked|responded|insisted';
    const properName = '([A-Z][a-z]{1,24}(?:\\s+[A-Z][a-z]{1,24})?)';
    const patterns = [
      new RegExp(`${properName}\\s+(?:${verbs})\\b`, 'g'),
      new RegExp(`\\b(?:${verbs})\\s+${properName}`, 'g')
    ];

    let best = null;
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(contextText)) !== null) {
        const candidate = match[1];
        if (candidate && !/^(He|She|They|I|We|You|It|His|Her|Their|The|A|An)$/i.test(candidate)) best = candidate;
      }
    }
    return best;
  }

  inferDialogueSpeaker(context) {
    const recent = context.recentSpeakers.slice(-2);
    if (recent.length < 2) return context.lastDialogueSpeaker;
    const [a, b] = recent;
    return context.lastDialogueSpeaker === b ? a : b;
  }

  rememberSpeaker(context, speaker) {
    const name = speaker.trim();
    context.recentSpeakers = context.recentSpeakers.filter(item => item !== name);
    context.recentSpeakers.push(name);
    context.recentSpeakers = context.recentSpeakers.slice(-4);
    context.lastDialogueSpeaker = name;
  }

  collectDetectedSpeakers() {
    const counts = new Map();
    this.units.forEach(unit => unit.segments.forEach(segment => {
      if (segment.type === 'dialogue' && segment.speaker) {
        counts.set(segment.speaker, (counts.get(segment.speaker) || 0) + 1);
      }
    }));

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([name, count]) => ({ name, count }));
  }

  assignDefaultCharacterVoices() {
    if (!this.voices.length) return;
    const candidates = this.getSortedVoices().filter(voice => voice.name !== this.narratorVoice?.name);
    this.detectedSpeakers.forEach((speaker, index) => {
      if (!this.speakerVoiceNames.has(speaker.name) && candidates.length) {
        this.speakerVoiceNames.set(speaker.name, candidates[index % candidates.length].name);
      }
    });
  }

  renderCastList() {
    if (!this.castList || !this.castCount) return;
    this.castCount.textContent = String(this.detectedSpeakers.length);

    if (!this.detectedSpeakers.length) {
      this.castList.innerHTML = '<div class="empty-cast">No named speakers detected yet.</div>';
      return;
    }

    const voices = this.getSortedVoices();
    this.castList.innerHTML = '';

    this.detectedSpeakers.forEach(({ name, count }) => {
      const row = document.createElement('div');
      row.className = 'cast-row';

      const nameWrap = document.createElement('div');
      nameWrap.className = 'cast-name';
      nameWrap.title = `${name} • ${count} detected line${count === 1 ? '' : 's'}`;
      nameWrap.textContent = name;

      const select = document.createElement('select');
      select.setAttribute('aria-label', `Voice for ${name}`);
      const current = this.speakerVoiceNames.get(name) || '';

      voices.forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.name;
        option.textContent = voice.name;
        select.appendChild(option);
      });

      if (current && voices.some(voice => voice.name === current)) select.value = current;
      select.addEventListener('change', () => {
        this.speakerVoiceNames.set(name, select.value);
        if (this.isPlaying) this.restartCurrentSegment();
      });

      row.append(nameWrap, select);
      this.castList.appendChild(row);
    });
  }

  updateBookStats() {
    const words = this.units.reduce((sum, unit) => sum + unit.words, 0);
    const minutes = words ? Math.max(1, Math.round(words / 155)) : 0;
    if (this.bookWords) this.bookWords.textContent = `${words.toLocaleString()} words`;
    if (this.bookTime) this.bookTime.textContent = minutes ? `~${this.formatMinutes(minutes)}` : 'No narration text';
  }

  formatMinutes(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins ? `${hours} hr ${mins} min` : `${hours} hr`;
  }

  restoreBookPosition() {
    if (!this.units.length) {
      this.currentUnitIndex = 0;
      this.currentSegmentIndex = 0;
      return;
    }

    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(POSITION_KEY_PREFIX + this.fileKey) || 'null');
    } catch {
      saved = null;
    }

    this.currentUnitIndex = clamp(Number(saved?.unitIndex) || 0, 0, this.units.length - 1);
    this.currentSegmentIndex = 0;
  }

  saveBookPosition() {
    if (!this.fileKey || !this.units.length) return;
    try {
      localStorage.setItem(POSITION_KEY_PREFIX + this.fileKey, JSON.stringify({
        unitIndex: this.currentUnitIndex,
        updatedAt: Date.now()
      }));
    } catch {
      // Position persistence is optional.
    }
  }

  async renderPage(pageNumber, force = false) {
    if (!this.pdfDoc || !this.pdfCanvas || !this.canvasContext) return;
    const page = clamp(Math.round(pageNumber), 1, this.pdfDoc.numPages);
    if (!force && page === this.lastRenderedPage) return;

    this.viewerPage = page;
    if (this.pageNumber) this.pageNumber.value = String(page);
    this.pageRenderStatus?.classList.remove('hidden');

    try {
      if (this.renderTask) {
        try {
          this.renderTask.cancel();
        } catch {
          // Nothing to cancel.
        }
      }

      const pdfPage = await this.pdfDoc.getPage(page);
      const cssScale = this.pageZoom / 100;
      const baseViewport = pdfPage.getViewport({ scale: cssScale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const renderViewport = pdfPage.getViewport({ scale: cssScale * pixelRatio });

      this.pdfCanvas.width = Math.floor(renderViewport.width);
      this.pdfCanvas.height = Math.floor(renderViewport.height);
      this.pdfCanvas.style.width = `${Math.floor(baseViewport.width)}px`;
      this.pdfCanvas.style.height = `${Math.floor(baseViewport.height)}px`;

      this.renderTask = pdfPage.render({ canvasContext: this.canvasContext, viewport: renderViewport });
      await this.renderTask.promise;
      this.lastRenderedPage = page;
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') {
        console.error('Page render failed:', error);
        this.showToast('The page viewer could not render that page.');
      }
    } finally {
      this.pageRenderStatus?.classList.add('hidden');
    }
  }

  browsePage(page) {
    if (!this.pdfDoc) return;
    this.followNarration = false;
    if (this.followNarrationCheckbox) this.followNarrationCheckbox.checked = false;
    this.saveSettings();
    this.renderPage(clamp(page, 1, this.pdfDoc.numPages), true);
  }

  jumpAudioToPage(page) {
    if (!this.units.length) {
      this.showToast('This PDF does not have readable text to narrate.');
      return;
    }

    const index = this.units.findIndex(unit => unit.page >= page);
    if (index < 0) return;

    const wasPlaying = this.isPlaying;
    this.pause(false);
    this.currentUnitIndex = index;
    this.currentSegmentIndex = 0;
    this.followNarration = true;
    if (this.followNarrationCheckbox) this.followNarrationCheckbox.checked = true;
    this.viewerPage = this.units[index].page;
    this.updateDisplay();
    this.renderPage(this.viewerPage, true);
    this.saveBookPosition();
    if (wasPlaying) this.play();
  }

  updateDisplay() {
    if (!this.units.length) return;
    const unit = this.units[this.currentUnitIndex];
    if (!unit) return;

    if (this.currentLocation) this.currentLocation.textContent = `Page ${unit.page}`;
    const active = unit.segments[this.currentSegmentIndex];
    if (this.speakerChip) {
      this.speakerChip.textContent = active?.type === 'dialogue'
        ? (active.speaker || 'Dialogue')
        : 'Narrator';
    }

    if (this.currentText) {
      this.currentText.innerHTML = unit.segments.map((segment, index) => {
        const classes = [
          'speech-segment',
          segment.type === 'dialogue' ? 'dialogue' : '',
          index === this.currentSegmentIndex && this.isPlaying ? 'active' : ''
        ].filter(Boolean).join(' ');

        const label = segment.type === 'dialogue' && segment.speaker
          ? `<span class="speaker-label">${escapeHtml(segment.speaker)}</span>`
          : '';

        return `<span class="${classes}" data-segment="${index}">${label}${escapeHtml(segment.text)}</span>${index < unit.segments.length - 1 ? ' ' : ''}`;
      }).join('');
    }

    if (this.followNarration && this.viewerPage !== unit.page) {
      this.viewerPage = unit.page;
      this.renderPage(unit.page);
    }

    this.updateProgressMeta();
    this.saveBookPosition();
    this.updateMediaSessionMetadata();
  }

  updateProgressMeta() {
    if (!this.units.length) {
      if (this.progressFill) this.progressFill.style.width = '0%';
      if (this.progressThumb) this.progressThumb.style.left = '0%';
      if (this.progressLabel) this.progressLabel.textContent = '0%';
      if (this.remainingTime) this.remainingTime.textContent = 'No narration text';
      return;
    }

    const current = this.units[this.currentUnitIndex];
    const progress = (
      (this.currentUnitIndex + this.currentSegmentIndex / Math.max(1, current.segments.length))
      / this.units.length
    ) * 100;
    const safeProgress = clamp(progress, 0, 100);

    if (this.progressFill) this.progressFill.style.width = `${safeProgress}%`;
    if (this.progressThumb) this.progressThumb.style.left = `${safeProgress}%`;
    if (this.progressLabel) this.progressLabel.textContent = `${Math.round(safeProgress)}%`;
    if (this.progressBar) this.progressBar.setAttribute('aria-valuenow', String(Math.round(safeProgress)));

    const remainingWords = this.units
      .slice(this.currentUnitIndex)
      .reduce((sum, unit) => sum + unit.words, 0);
    const minutes = Math.max(0, Math.ceil(remainingWords / (155 * this.speechRate)));
    if (this.remainingTime) this.remainingTime.textContent = minutes ? `~${this.formatMinutes(minutes)} left` : 'Finishing…';
  }

  togglePlayPause() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  play() {
    if (!this.units.length) {
      this.showToast('This PDF has no readable text to narrate.');
      return;
    }

    if (!this.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      this.showToast('Narration is unavailable here. Open the site in Safari or Chrome.');
      return;
    }

    this.isPlaying = true;
    this.sessionToken += 1;
    if (this.playIcon) this.playIcon.textContent = 'Ⅱ';
    this.playPauseBtn?.setAttribute('aria-label', 'Pause');
    this.startBackgroundAudio();
    this.startIOSKeepAlive();
    this.updateDisplay();
    this.speakCurrentSegment(this.sessionToken);
    this.updateMediaSessionState();
  }

  pause(stopBackground = true) {
    this.isPlaying = false;
    this.sessionToken += 1;
    if (this.speechSynthesis) {
      try {
        this.speechSynthesis.cancel();
      } catch {
        // Speech cancellation is optional.
      }
    }

    if (this.playIcon) this.playIcon.textContent = '▶';
    this.playPauseBtn?.setAttribute('aria-label', 'Play');
    this.stopIOSKeepAlive();
    if (stopBackground) this.stopBackgroundAudio();
    this.updateDisplay();
    this.updateMediaSessionState();
  }

  restartCurrentSegment() {
    if (!this.isPlaying || !this.speechSynthesis) return;
    this.sessionToken += 1;
    try {
      this.speechSynthesis.cancel();
    } catch {
      // Continue with restart.
    }

    const token = this.sessionToken;
    setTimeout(() => this.speakCurrentSegment(token), isIOS ? 80 : 35);
  }

  speakCurrentSegment(token) {
    if (!this.isPlaying || token !== this.sessionToken) return;
    if (this.currentUnitIndex >= this.units.length) {
      this.finishPlayback();
      return;
    }

    const unit = this.units[this.currentUnitIndex];
    if (this.currentSegmentIndex >= unit.segments.length) {
      this.currentUnitIndex += 1;
      this.currentSegmentIndex = 0;
      if (this.currentUnitIndex >= this.units.length) {
        this.finishPlayback();
        return;
      }
      this.updateDisplay();
      setTimeout(() => this.speakCurrentSegment(token), 170);
      return;
    }

    const segment = unit.segments[this.currentSegmentIndex];
    this.updateDisplay();
    const chunks = this.splitForSpeech(segment.text, isIOS ? 340 : 620);
    this.speakChunkSequence(chunks, segment, 0, token);
  }

  splitForSpeech(text, maxChars) {
    if (text.length <= maxChars) return [text];
    const parts = this.segmentSentences(text);
    const chunks = [];
    let current = '';

    parts.forEach(part => {
      if (current && `${current} ${part}`.length > maxChars) {
        chunks.push(current);
        current = part;
      } else {
        current += `${current ? ' ' : ''}${part}`;
      }
    });

    if (current) chunks.push(current);
    if (chunks.length) return chunks;

    const fallback = [];
    for (let i = 0; i < text.length; i += maxChars) fallback.push(text.slice(i, i + maxChars));
    return fallback;
  }

  speakChunkSequence(chunks, segment, chunkIndex, token) {
    if (!this.isPlaying || token !== this.sessionToken || !this.speechSynthesis) return;

    if (chunkIndex >= chunks.length) {
      this.currentSegmentIndex += 1;
      setTimeout(
        () => this.speakCurrentSegment(token),
        segment.type === 'dialogue' ? 115 : 85
      );
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
    utterance.rate = this.speechRate;
    utterance.pitch = clamp(this.speechPitch + (segment.type === 'dialogue' ? 0.02 : 0), 0.1, 2);
    utterance.volume = this.speechVolume;
    utterance.voice = this.getVoiceForSegment(segment);

    utterance.onend = () => {
      if (this.isPlaying && token === this.sessionToken) {
        this.speakChunkSequence(chunks, segment, chunkIndex + 1, token);
      }
    };

    utterance.onerror = event => {
      if (event.error === 'canceled' || token !== this.sessionToken) return;
      console.warn('Speech error:', event.error);
      setTimeout(() => this.speakChunkSequence(chunks, segment, chunkIndex + 1, token), 120);
    };

    this.speechSynthesis.speak(utterance);
  }

  getVoiceForSegment(segment) {
    if (!this.smartVoices || segment.type !== 'dialogue') return this.narratorVoice;
    if (segment.speaker) {
      const name = this.speakerVoiceNames.get(segment.speaker);
      const voice = this.voices.find(candidate => candidate.name === name);
      if (voice) return voice;
    }
    return this.dialogueVoice || this.narratorVoice;
  }

  finishPlayback() {
    this.isPlaying = false;
    if (this.playIcon) this.playIcon.textContent = '▶';
    this.stopIOSKeepAlive();
    this.stopBackgroundAudio();
    this.updateMediaSessionState();
    this.showToast('End of book.');
  }

  seekBySeconds(seconds) {
    if (!this.units.length) return;
    const targetWords = Math.max(20, Math.round(Math.abs(seconds) * (155 * this.speechRate) / 60));
    const direction = Math.sign(seconds) || 1;
    let index = this.currentUnitIndex;
    let traversed = 0;

    while (traversed < targetWords) {
      const next = index + direction;
      if (next < 0 || next >= this.units.length) break;
      index = next;
      traversed += this.units[index].words;
    }

    const wasPlaying = this.isPlaying;
    this.pause(false);
    this.currentUnitIndex = index;
    this.currentSegmentIndex = 0;
    this.updateDisplay();
    if (wasPlaying) this.play();
  }

  seekFromProgressEvent(event) {
    if (!this.units.length || !this.progressBar) return;
    const rect = this.progressBar.getBoundingClientRect();
    const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const index = clamp(Math.floor(percent * this.units.length), 0, this.units.length - 1);
    const wasPlaying = this.isPlaying;

    this.pause(false);
    this.currentUnitIndex = index;
    this.currentSegmentIndex = 0;
    this.updateDisplay();
    if (wasPlaying) this.play();
  }

  previewSelectedVoices() {
    if (!this.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      this.showToast('Voice preview is unavailable in this browser.');
      return;
    }

    this.speechSynthesis.cancel();
    const samples = [
      {
        text: 'The room fell quiet as the storm rolled over the city.',
        voice: this.narratorVoice,
        pitch: this.speechPitch
      },
      {
        text: 'I was hoping you would say that.',
        voice: this.dialogueVoice,
        pitch: this.speechPitch + 0.02
      }
    ];

    const speak = index => {
      if (index >= samples.length) return;
      const sample = samples[index];
      const utterance = new SpeechSynthesisUtterance(sample.text);
      utterance.voice = sample.voice;
      utterance.rate = this.speechRate;
      utterance.pitch = clamp(sample.pitch, 0.1, 2);
      utterance.volume = this.speechVolume;
      utterance.onend = () => setTimeout(() => speak(index + 1), 180);
      this.speechSynthesis.speak(utterance);
    };

    speak(0);
  }

  configureSleepTimer(minutes) {
    if (this.sleepTimerId) clearTimeout(this.sleepTimerId);
    this.sleepTimerId = null;

    if (!minutes) {
      this.showToast('Sleep timer is off.');
      return;
    }

    this.sleepTimerId = setTimeout(() => {
      this.pause();
      if (this.sleepTimer) this.sleepTimer.value = '0';
      this.showToast('Sleep timer finished. Playback paused.');
    }, minutes * 60 * 1000);

    this.showToast(`Sleep timer set for ${minutes} minutes.`);
  }

  initBackgroundAudio() {
    try {
      this.backgroundAudio = document.createElement('audio');
      this.backgroundAudio.loop = true;
      this.backgroundAudio.setAttribute('playsinline', '');
      this.backgroundAudio.setAttribute('webkit-playsinline', '');
      this.backgroundAudio.style.display = 'none';
      this.backgroundAudio.volume = 0.005;
      this.backgroundAudio.src = this.generateQuietToneDataURL();
      document.body.appendChild(this.backgroundAudio);
    } catch (error) {
      console.warn('Background audio unavailable:', error);
      this.backgroundAudio = null;
    }
  }

  generateQuietToneDataURL() {
    const sampleRate = 8000;
    const seconds = 1;
    const samples = sampleRate * seconds;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const write = (offset, value) => {
      [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    };

    write(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, samples * 2, true);

    for (let i = 0; i < samples; i += 1) {
      const sample = Math.sin(2 * Math.PI * 220 * (i / sampleRate)) * 80;
      view.setInt16(44 + i * 2, sample, true);
    }

    let binary = '';
    new Uint8Array(buffer).forEach(byte => {
      binary += String.fromCharCode(byte);
    });
    return `data:audio/wav;base64,${btoa(binary)}`;
  }

  startBackgroundAudio() {
    if (!this.backgroundAudio) return;
    this.backgroundAudio.play().catch(() => {});
  }

  stopBackgroundAudio() {
    if (!this.backgroundAudio) return;
    this.backgroundAudio.pause();
  }

  startIOSKeepAlive() {
    this.stopIOSKeepAlive();
    if (!isIOS || !this.speechSynthesis) return;
    this.iosKeepAliveTimer = setInterval(() => {
      if (this.isPlaying && this.speechSynthesis.paused) {
        try {
          this.speechSynthesis.resume();
        } catch {
          // Resume support varies by browser.
        }
      }
    }, 9000);
  }

  stopIOSKeepAlive() {
    if (this.iosKeepAliveTimer) clearInterval(this.iosKeepAliveTimer);
    this.iosKeepAliveTimer = null;
  }

  initMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const safeSet = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported media-session action.
      }
    };

    safeSet('play', () => this.play());
    safeSet('pause', () => this.pause());
    safeSet('seekbackward', details => this.seekBySeconds(-(details.seekOffset || 15)));
    safeSet('seekforward', details => this.seekBySeconds(details.seekOffset || 15));
    safeSet('previoustrack', () => this.seekBySeconds(-15));
    safeSet('nexttrack', () => this.seekBySeconds(15));
    safeSet('stop', () => this.pause());
  }

  updateMediaSessionMetadata() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const unit = this.units[this.currentUnitIndex];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.bookName?.textContent || 'PDF Story Reader',
        artist: unit ? `Page ${unit.page}` : 'Ready to read',
        album: 'PDF Story Reader',
        artwork: [{ src: MEDIA_SESSION_ARTWORK_URL, sizes: '96x96', type: 'image/svg+xml' }]
      });
    } catch {
      // Metadata is optional.
    }
  }

  updateMediaSessionState() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
    } catch {
      // Playback state is optional.
    }
  }

  resetReader() {
    this.pause();
    this.pdfDoc = null;
    this.file = null;
    this.fileKey = '';
    this.pageTexts = [];
    this.units = [];
    this.detectedSpeakers = [];
    this.speakerVoiceNames.clear();
    this.currentUnitIndex = 0;
    this.currentSegmentIndex = 0;
    this.viewerPage = 1;
    this.lastRenderedPage = null;

    if (this.fileInput) this.fileInput.value = '';
    this.readerSection?.classList.add('hidden');
    this.uploadSection?.classList.remove('hidden');
    this.changeBook?.classList.add('hidden');
    if (this.castCount) this.castCount.textContent = '0';
    if (this.castList) this.castList.innerHTML = '<div class="empty-cast">No named speakers detected yet.</div>';
    if (this.pdfCanvas && this.canvasContext) {
      this.canvasContext.clearRect(0, 0, this.pdfCanvas.width, this.pdfCanvas.height);
    }
    this.setUploadStatus('Choose a PDF to begin.');
  }

  showLoading(show, title = '', message = '', percent = 0) {
    if (!this.loadingOverlay) return;
    if (!show) {
      this.loadingOverlay.classList.add('hidden');
      return;
    }

    this.loadingOverlay.classList.remove('hidden');
    if (title && this.loadingTitle) this.loadingTitle.textContent = title;
    if (message && this.loadingMessage) this.loadingMessage.textContent = message;
    const safePercent = clamp(percent, 0, 100);
    if (this.loadingFill) this.loadingFill.style.width = `${safePercent}%`;
    if (this.loadingPercent) this.loadingPercent.textContent = `${safePercent}%`;
  }

  showToast(message) {
    if (!this.toast) return;
    clearTimeout(this.toastTimer);
    this.toast.textContent = message;
    this.toast.classList.remove('hidden');
    this.toastTimer = setTimeout(() => this.toast.classList.add('hidden'), 3200);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    window.pdfStoryReader = new PDFStoryReader();
  } catch (error) {
    console.error('Reader failed to start:', error);
    const status = document.getElementById('upload-status');
    if (status) status.textContent = `Reader failed to start: ${error.message || 'unknown error'}`;
  }
});
