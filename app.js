const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const SETTINGS_KEY = 'pdf-story-reader-v2-settings';
const POSITION_KEY_PREFIX = 'pdf-story-reader-v2-position:';
const MEDIA_SESSION_ARTWORK_URL = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Crect%20width%3D%22100%22%20height%3D%22100%22%20rx%3D%2222%22%20fill%3D%22%238b7cff%22%2F%3E%3Ctext%20x%3D%2250%22%20y%3D%2261%22%20text-anchor%3D%22middle%22%20font-size%3D%2236%22%20font-family%3D%22Arial%22%20font-weight%3D%22700%22%20fill%3D%22white%22%3ESR%3C%2Ftext%3E%3C%2Fsvg%3E';
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function normalizeSpaces(text) {
  return text.replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/([“"'])\s+/g, '$1').replace(/\s+([”"'])/g, '$1').trim();
}
function wordCount(text) {
  const match = text.trim().match(/\b[\p{L}\p{N}’'-]+\b/gu);
  return match ? match.length : 0;
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
    this.speechSynthesis = window.speechSynthesis;
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
    this.initPdfJs();
    this.cacheElements();
    this.applySavedSettings();
    this.initVoices();
    this.initBackgroundAudio();
    this.initMediaSession();
    this.bindEvents();
  }

  initPdfJs() {
    if (typeof pdfjsLib !== 'undefined') pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN;
  }

  cacheElements() {
    const ids = [
      'upload-section', 'reader-section', 'drop-zone', 'choose-file-btn', 'file-input', 'change-book',
      'book-name', 'book-pages', 'book-words', 'book-time', 'jump-viewer-to-audio', 'read-viewed-page',
      'follow-narration', 'pdf-canvas', 'page-render-status', 'prev-page', 'next-page', 'page-number', 'page-count',
      'page-zoom', 'page-zoom-value', 'current-location', 'speaker-chip', 'text-display', 'current-text',
      'progress-bar', 'progress-fill', 'progress-thumb', 'progress-label', 'remaining-time', 'rewind-btn',
      'play-pause-btn', 'play-icon', 'forward-btn', 'speed-control', 'speed-value', 'pitch-control', 'pitch-value',
      'volume-control', 'volume-value', 'font-size-control', 'font-size-value', 'sleep-timer', 'voice-select',
      'dialogue-voice-select', 'smart-voices', 'prefer-natural-voices', 'preview-voices', 'cast-list', 'cast-count',
      'loading-overlay', 'loading-title', 'loading-message', 'loading-fill', 'loading-percent', 'toast'
    ];
    ids.forEach(id => { this[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });
    this.canvasContext = this.pdfCanvas.getContext('2d', { alpha: false });
  }

  loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
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
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
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
    this.speedControl.value = this.speechRate;
    this.pitchControl.value = this.speechPitch;
    this.volumeControl.value = this.speechVolume;
    this.smartVoices.checked = this.smartVoices;
    this.preferNaturalVoices.checked = this.preferNaturalVoices;
    this.followNarration.checked = this.followNarration;
    this.pageZoom.value = this.pageZoom;
    this.fontSizeControl.value = this.readerFontSize;
    this.updateSettingLabels();
  }

  updateSettingLabels() {
    this.speedValue.textContent = `${this.speechRate.toFixed(2)}×`;
    this.pitchValue.textContent = this.speechPitch.toFixed(2);
    this.volumeValue.textContent = `${Math.round(this.speechVolume * 100)}%`;
    this.fontSizeValue.textContent = `${this.readerFontSize}px`;
    this.pageZoomValue.textContent = `${this.pageZoom}%`;
    document.documentElement.style.setProperty('--reader-font-size', `${this.readerFontSize}px`);
  }

  bindEvents() {
    const openPicker = event => { event?.stopPropagation(); this.fileInput.click(); };
    this.chooseFileBtn.addEventListener('click', openPicker);
    this.dropZone.addEventListener('click', openPicker);
    this.dropZone.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPicker(event); }
    });
    this.fileInput.addEventListener('change', event => this.processFile(event.target.files?.[0]));
    ['dragenter', 'dragover'].forEach(type => this.dropZone.addEventListener(type, event => { event.preventDefault(); this.dropZone.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(type => this.dropZone.addEventListener(type, event => { event.preventDefault(); this.dropZone.classList.remove('dragover'); }));
    this.dropZone.addEventListener('drop', event => this.processFile(event.dataTransfer?.files?.[0]));
    document.addEventListener('dragover', event => event.preventDefault());
    document.addEventListener('drop', event => event.preventDefault());

    this.changeBook.addEventListener('click', () => this.resetReader());
    this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
    this.rewindBtn.addEventListener('click', () => this.seekBySeconds(-15));
    this.forwardBtn.addEventListener('click', () => this.seekBySeconds(15));
    this.prevPage.addEventListener('click', () => this.browsePage(this.viewerPage - 1));
    this.nextPage.addEventListener('click', () => this.browsePage(this.viewerPage + 1));
    this.pageNumber.addEventListener('change', () => this.browsePage(Number(this.pageNumber.value)));
    this.pageNumber.addEventListener('keydown', event => { if (event.key === 'Enter') this.browsePage(Number(this.pageNumber.value)); });
    this.pageZoom.addEventListener('input', () => {
      this.pageZoom = Number(this.pageZoom.value); this.updateSettingLabels(); this.saveSettings(); this.renderPage(this.viewerPage, true);
    });
    this.followNarration.addEventListener('change', () => {
      this.followNarration = this.followNarration.checked;
      this.saveSettings();
      if (this.followNarration && this.units.length) { this.viewerPage = this.units[this.currentUnitIndex].page; this.renderPage(this.viewerPage, true); }
    });
    this.jumpViewerToAudio.addEventListener('click', () => {
      if (!this.units.length) return;
      this.followNarration = true; this.followNarration.checked = true; this.viewerPage = this.units[this.currentUnitIndex].page; this.renderPage(this.viewerPage, true); this.saveSettings();
    });
    this.readViewedPage.addEventListener('click', () => this.jumpAudioToPage(this.viewerPage));

    this.speedControl.addEventListener('input', () => {
      this.speechRate = Number(this.speedControl.value); this.updateSettingLabels(); this.saveSettings(); if (this.isPlaying) this.restartCurrentSegment(); this.updateProgressMeta();
    });
    this.pitchControl.addEventListener('input', () => {
      this.speechPitch = Number(this.pitchControl.value); this.updateSettingLabels(); this.saveSettings(); if (this.isPlaying) this.restartCurrentSegment();
    });
    this.volumeControl.addEventListener('input', () => {
      this.speechVolume = Number(this.volumeControl.value); this.updateSettingLabels(); this.saveSettings(); if (this.isPlaying) this.restartCurrentSegment();
    });
    this.fontSizeControl.addEventListener('input', () => {
      this.readerFontSize = Number(this.fontSizeControl.value); this.updateSettingLabels(); this.saveSettings();
    });
    this.smartVoices.addEventListener('change', () => {
      this.smartVoices = this.smartVoices.checked; this.saveSettings(); if (this.isPlaying) this.restartCurrentSegment();
    });
    this.preferNaturalVoices.addEventListener('change', () => {
      this.preferNaturalVoices = this.preferNaturalVoices.checked; this.saveSettings(); this.populateVoiceSelects(true); this.renderCastList(); if (this.isPlaying) this.restartCurrentSegment();
    });
    this.voiceSelect.addEventListener('change', () => {
      this.narratorVoice = this.voices.find(v => v.name === this.voiceSelect.value) || this.narratorVoice; this.saveSettings(); if (this.isPlaying) this.restartCurrentSegment();
    });
    this.dialogueVoiceSelect.addEventListener('change', () => {
      this.dialogueVoice = this.voices.find(v => v.name === this.dialogueVoiceSelect.value) || this.dialogueVoice; this.saveSettings(); if (this.isPlaying) this.restartCurrentSegment();
    });
    this.previewVoices.addEventListener('click', () => this.previewSelectedVoices());
    this.sleepTimer.addEventListener('change', () => this.configureSleepTimer(Number(this.sleepTimer.value)));
    this.progressBar.addEventListener('pointerdown', event => this.seekFromProgressEvent(event));
    this.progressBar.addEventListener('keydown', event => {
      if (!this.units.length) return;
      if (event.key === 'ArrowLeft') this.seekBySeconds(-15);
      if (event.key === 'ArrowRight') this.seekBySeconds(15);
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.isPlaying) this.updateDisplay(); });
  }

  initVoices() {
    const refresh = () => {
      const voices = this.speechSynthesis.getVoices();
      if (!voices.length) return;
      this.voices = voices; this.populateVoiceSelects(false); this.renderCastList();
    };
    refresh();
    if ('onvoiceschanged' in this.speechSynthesis) this.speechSynthesis.onvoiceschanged = refresh;
    let attempts = 0;
    const timer = setInterval(() => { attempts += 1; refresh(); if (this.voices.length || attempts > 20) clearInterval(timer); }, 250);
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
    const sorter = (a, b) => this.preferNaturalVoices ? this.voiceScore(b) - this.voiceScore(a) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name);
    return [...english.sort(sorter), ...others.sort(sorter)];
  }

  populateVoiceSelects(preserveCurrent = true) {
    if (!this.voices.length) return;
    const sorted = this.getSortedVoices();
    const previousNarrator = preserveCurrent ? (this.narratorVoice?.name || this.settings.narratorVoiceName) : this.settings.narratorVoiceName;
    const previousDialogue = preserveCurrent ? (this.dialogueVoice?.name || this.settings.dialogueVoiceName) : this.settings.dialogueVoiceName;
    const fill = select => {
      select.innerHTML = '';
      sorted.forEach(voice => {
        const option = document.createElement('option');
        const quality = this.voiceScore(voice) >= 70 ? ' • natural' : '';
        option.value = voice.name; option.textContent = `${voice.name} (${voice.lang})${quality}`; select.appendChild(option);
      });
    };
    fill(this.voiceSelect); fill(this.dialogueVoiceSelect);
    const narrator = sorted.find(v => v.name === previousNarrator) || sorted[0];
    const dialogue = sorted.find(v => v.name === previousDialogue) || sorted.find(v => v.name !== narrator?.name) || sorted[0];
    this.narratorVoice = narrator || null; this.dialogueVoice = dialogue || narrator || null;
    if (this.narratorVoice) this.voiceSelect.value = this.narratorVoice.name;
    if (this.dialogueVoice) this.dialogueVoiceSelect.value = this.dialogueVoice.name;
  }

  async processFile(file) {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) { this.showToast('That file is not a PDF.'); return; }
    if (file.size > 100 * 1024 * 1024) { this.showToast('This reader currently caps PDFs at 100 MB.'); return; }
    await this.loadPDF(file);
  }

  async loadPDF(file) {
    this.showLoading(true, 'Opening your book', 'Reading the PDF and building narration…', 3);
    try {
      this.initPdfJs();
      if (typeof pdfjsLib === 'undefined') throw new Error('PDF.js did not load. Refresh and try again.');
      this.pause(false);
      this.file = file;
      this.fileKey = `${file.name}|${file.size}|${file.lastModified}`;
      const arrayBuffer = await file.arrayBuffer();
      this.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      this.pageCount.textContent = `/ ${this.pdfDoc.numPages}`;
      this.pageNumber.max = String(this.pdfDoc.numPages);
      this.bookName.textContent = file.name.replace(/\.pdf$/i, '');
      this.bookPages.textContent = `${this.pdfDoc.numPages.toLocaleString()} pages`;
      await this.extractBook();
      if (!this.units.length) throw new Error('I could not find readable text in this PDF. It may be scanned images instead of selectable text.');
      this.detectedSpeakers = this.collectDetectedSpeakers();
      this.assignDefaultCharacterVoices();
      this.renderCastList();
      this.updateBookStats();
      this.restoreBookPosition();
      this.viewerPage = this.units[this.currentUnitIndex]?.page || 1;
      this.followNarration = true; this.followNarration.checked = true;
      this.uploadSection.classList.add('hidden');
      this.readerSection.classList.remove('hidden');
      this.changeBook.classList.remove('hidden');
      await this.renderPage(this.viewerPage, true);
      this.updateDisplay();
      this.updateMediaSessionMetadata();
      this.showToast('Book ready. Smart cast is active.');
    } catch (error) {
      console.error(error); this.showToast(error.message || 'Could not open that PDF.');
    } finally { this.showLoading(false); }
  }

  async extractBook() {
    this.pageTexts = []; this.units = [];
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
    this.showLoading(true, 'Casting voices', 'Finding dialogue and likely speakers…', 90);
    await new Promise(resolve => setTimeout(resolve, 50));
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
    return result.replace(/-\n(?=[a-z])/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  buildUnitsForPage(pageText, page, context) {
    if (!pageText.trim()) return;
    const paragraphs = pageText.split(/\n\s*\n|\n(?=\s{0,4}[A-Z“"])/).map(normalizeSpaces).filter(Boolean);
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
      } catch { /* use regex fallback */ }
    }
    return (text.match(/[^.!?]+(?:[.!?]+[”"\']?|$)/g) || [text]).map(part => part.trim()).filter(Boolean);
  }

  buildPerformanceSegments(text, context) {
    const quotePattern = /([“"][^”"]{1,1200}[”"]|«[^»]{1,1200}»)/g;
    const segments = [];
    let lastIndex = 0;
    let match;
    while ((match = quotePattern.exec(text)) !== null) {
      if (match.index > lastIndex) segments.push({ type: 'narration', text: text.slice(lastIndex, match.index), speaker: null });
      const before = text.slice(Math.max(0, match.index - 180), match.index);
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 180);
      const speaker = this.detectSpeaker(`${before} ${after}`) || this.inferDialogueSpeaker(context);
      if (speaker) this.rememberSpeaker(context, speaker);
      segments.push({ type: 'dialogue', text: match[0], speaker: speaker || null });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) segments.push({ type: 'narration', text: text.slice(lastIndex), speaker: null });
    if (!segments.length) segments.push({ type: 'narration', text, speaker: null });
    return segments.map(segment => ({ ...segment, text: normalizeSpaces(segment.text) })).filter(segment => segment.text);
  }

  detectSpeaker(contextText) {
    const verbs = 'said|asked|replied|answered|whispered|shouted|murmured|muttered|called|cried|added|continued|exclaimed|snapped|laughed|yelled|breathed|remarked|responded|insisted';
    const properName = '([A-Z][a-z]{1,24}(?:\\s+[A-Z][a-z]{1,24})?)';
    const patterns = [new RegExp(`${properName}\\s+(?:${verbs})\\b`, 'g'), new RegExp(`\\b(?:${verbs})\\s+${properName}`, 'g')];
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
      if (segment.type === 'dialogue' && segment.speaker) counts.set(segment.speaker, (counts.get(segment.speaker) || 0) + 1);
    }));
    return Array.from(counts.entries()).filter(([, count]) => count >= 1).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([name, count]) => ({ name, count }));
  }

  assignDefaultCharacterVoices() {
    if (!this.voices.length) return;
    const candidates = this.getSortedVoices().filter(voice => voice.name !== this.narratorVoice?.name);
    this.detectedSpeakers.forEach((speaker, index) => {
      if (!this.speakerVoiceNames.has(speaker.name) && candidates.length) this.speakerVoiceNames.set(speaker.name, candidates[index % candidates.length].name);
    });
  }

  renderCastList() {
    if (!this.castList) return;
    this.castCount.textContent = String(this.detectedSpeakers.length);
    if (!this.detectedSpeakers.length) { this.castList.innerHTML = '<div class="empty-cast">No named speakers detected yet.</div>'; return; }
    const voices = this.getSortedVoices();
    this.castList.innerHTML = '';
    this.detectedSpeakers.forEach(({ name, count }) => {
      const row = document.createElement('div'); row.className = 'cast-row';
      const nameWrap = document.createElement('div'); nameWrap.className = 'cast-name'; nameWrap.title = `${name} • ${count} detected line${count === 1 ? '' : 's'}`; nameWrap.textContent = name;
      const select = document.createElement('select'); select.setAttribute('aria-label', `Voice for ${name}`);
      const current = this.speakerVoiceNames.get(name) || '';
      voices.forEach(voice => { const option = document.createElement('option'); option.value = voice.name; option.textContent = voice.name; select.appendChild(option); });
      if (current && voices.some(v => v.name === current)) select.value = current;
      select.addEventListener('change', () => { this.speakerVoiceNames.set(name, select.value); if (this.isPlaying) this.restartCurrentSegment(); });
      row.append(nameWrap, select); this.castList.appendChild(row);
    });
  }

  updateBookStats() {
    const words = this.units.reduce((sum, unit) => sum + unit.words, 0);
    const minutes = Math.max(1, Math.round(words / 155));
    this.bookWords.textContent = `${words.toLocaleString()} words`;
    this.bookTime.textContent = `~${this.formatMinutes(minutes)}`;
  }

  formatMinutes(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60); const mins = minutes % 60;
    return mins ? `${hours} hr ${mins} min` : `${hours} hr`;
  }

  restoreBookPosition() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POSITION_KEY_PREFIX + this.fileKey) || 'null'); } catch { saved = null; }
    this.currentUnitIndex = clamp(Number(saved?.unitIndex) || 0, 0, Math.max(0, this.units.length - 1));
    this.currentSegmentIndex = 0;
  }

  saveBookPosition() {
    if (!this.fileKey || !this.units.length) return;
    localStorage.setItem(POSITION_KEY_PREFIX + this.fileKey, JSON.stringify({ unitIndex: this.currentUnitIndex, updatedAt: Date.now() }));
  }

  async renderPage(pageNumber, force = false) {
    if (!this.pdfDoc) return;
    const page = clamp(Math.round(pageNumber), 1, this.pdfDoc.numPages);
    if (!force && page === this.lastRenderedPage) return;
    this.viewerPage = page; this.pageNumber.value = String(page); this.pageRenderStatus.classList.remove('hidden');
    try {
      if (this.renderTask) { try { this.renderTask.cancel(); } catch { /* no-op */ } }
      const pdfPage = await this.pdfDoc.getPage(page);
      const cssScale = this.pageZoom / 100;
      const baseViewport = pdfPage.getViewport({ scale: cssScale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const renderViewport = pdfPage.getViewport({ scale: cssScale * pixelRatio });
      this.pdfCanvas.width = Math.floor(renderViewport.width); this.pdfCanvas.height = Math.floor(renderViewport.height);
      this.pdfCanvas.style.width = `${Math.floor(baseViewport.width)}px`; this.pdfCanvas.style.height = `${Math.floor(baseViewport.height)}px`;
      this.renderTask = pdfPage.render({ canvasContext: this.canvasContext, viewport: renderViewport });
      await this.renderTask.promise; this.lastRenderedPage = page;
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') console.error('Page render failed:', error);
    } finally { this.pageRenderStatus.classList.add('hidden'); }
  }

  browsePage(page) {
    if (!this.pdfDoc) return;
    this.followNarration = false; this.followNarration.checked = false; this.saveSettings();
    this.renderPage(clamp(page, 1, this.pdfDoc.numPages), true);
  }

  jumpAudioToPage(page) {
    if (!this.units.length) return;
    const index = this.units.findIndex(unit => unit.page >= page);
    if (index < 0) return;
    const wasPlaying = this.isPlaying;
    this.pause(false);
    this.currentUnitIndex = index; this.currentSegmentIndex = 0; this.followNarration = true; this.followNarration.checked = true; this.viewerPage = this.units[index].page;
    this.updateDisplay(); this.renderPage(this.viewerPage, true); this.saveBookPosition();
    if (wasPlaying) this.play();
  }

  updateDisplay() {
    if (!this.units.length) return;
    const unit = this.units[this.currentUnitIndex];
    this.currentLocation.textContent = `Page ${unit.page}`;
    const active = unit.segments[this.currentSegmentIndex];
    this.speakerChip.textContent = active?.type === 'dialogue' ? (active.speaker || 'Dialogue') : 'Narrator';
    this.currentText.innerHTML = unit.segments.map((segment, index) => {
      const classes = ['speech-segment', segment.type === 'dialogue' ? 'dialogue' : '', index === this.currentSegmentIndex && this.isPlaying ? 'active' : ''].filter(Boolean).join(' ');
      const label = segment.type === 'dialogue' && segment.speaker ? `<span class="speaker-label">${escapeHtml(segment.speaker)}</span>` : '';
      return `<span class="${classes}" data-segment="${index}">${label}${escapeHtml(segment.text)}</span>${index < unit.segments.length - 1 ? ' ' : ''}`;
    }).join('');
    if (this.followNarration && this.viewerPage !== unit.page) { this.viewerPage = unit.page; this.renderPage(unit.page); }
    this.updateProgressMeta(); this.saveBookPosition(); this.updateMediaSessionMetadata();
  }

  updateProgressMeta() {
    if (!this.units.length) return;
    const progress = ((this.currentUnitIndex + this.currentSegmentIndex / Math.max(1, this.units[this.currentUnitIndex].segments.length)) / this.units.length) * 100;
    const safeProgress = clamp(progress, 0, 100);
    this.progressFill.style.width = `${safeProgress}%`; this.progressThumb.style.left = `${safeProgress}%`; this.progressLabel.textContent = `${Math.round(safeProgress)}%`; this.progressBar.setAttribute('aria-valuenow', String(Math.round(safeProgress)));
    const remainingWords = this.units.slice(this.currentUnitIndex).reduce((sum, unit) => sum + unit.words, 0);
    const minutes = Math.max(0, Math.ceil(remainingWords / (155 * this.speechRate)));
    this.remainingTime.textContent = minutes ? `~${this.formatMinutes(minutes)} left` : 'Finishing…';
  }

  togglePlayPause() { if (this.isPlaying) this.pause(); else this.play(); }

  play() {
    if (!this.units.length || !('speechSynthesis' in window)) { this.showToast('Speech synthesis is not available in this browser.'); return; }
    this.isPlaying = true; this.sessionToken += 1; this.playIcon.textContent = 'Ⅱ'; this.playPauseBtn.setAttribute('aria-label', 'Pause');
    this.startBackgroundAudio(); this.startIOSKeepAlive(); this.updateDisplay(); this.speakCurrentSegment(this.sessionToken); this.updateMediaSessionState();
  }

  pause(stopBackground = true) {
    this.isPlaying = false; this.sessionToken += 1; this.speechSynthesis.cancel(); this.playIcon.textContent = '▶'; this.playPauseBtn.setAttribute('aria-label', 'Play'); this.stopIOSKeepAlive();
    if (stopBackground) this.stopBackgroundAudio();
    this.updateDisplay(); this.updateMediaSessionState();
  }

  restartCurrentSegment() {
    if (!this.isPlaying) return;
    this.sessionToken += 1; this.speechSynthesis.cancel();
    const token = this.sessionToken;
    setTimeout(() => this.speakCurrentSegment(token), isIOS ? 80 : 35);
  }

  speakCurrentSegment(token) {
    if (!this.isPlaying || token !== this.sessionToken) return;
    if (this.currentUnitIndex >= this.units.length) { this.finishPlayback(); return; }
    const unit = this.units[this.currentUnitIndex];
    if (this.currentSegmentIndex >= unit.segments.length) {
      this.currentUnitIndex += 1; this.currentSegmentIndex = 0;
      if (this.currentUnitIndex >= this.units.length) { this.finishPlayback(); return; }
      this.updateDisplay(); setTimeout(() => this.speakCurrentSegment(token), 170); return;
    }
    const segment = unit.segments[this.currentSegmentIndex];
    this.updateDisplay();
    const textChunks = this.splitForSpeech(segment.text, isIOS ? 340 : 620);
    this.speakChunkSequence(textChunks, segment, 0, token);
  }

  splitForSpeech(text, maxChars) {
    if (text.length <= maxChars) return [text];
    const parts = this.segmentSentences(text); const chunks = []; let current = '';
    parts.forEach(part => {
      if (current && `${current} ${part}`.length > maxChars) { chunks.push(current); current = part; }
      else current += `${current ? ' ' : ''}${part}`;
    });
    if (current) chunks.push(current);
    return chunks.length ? chunks : [text.slice(0, maxChars), text.slice(maxChars)];
  }

  speakChunkSequence(chunks, segment, chunkIndex, token) {
    if (!this.isPlaying || token !== this.sessionToken) return;
    if (chunkIndex >= chunks.length) {
      this.currentSegmentIndex += 1;
      setTimeout(() => this.speakCurrentSegment(token), segment.type === 'dialogue' ? 115 : 85);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
    utterance.rate = this.speechRate;
    utterance.pitch = clamp(this.speechPitch + (segment.type === 'dialogue' ? 0.02 : 0), 0.1, 2);
    utterance.volume = this.speechVolume;
    utterance.voice = this.getVoiceForSegment(segment);
    utterance.onend = () => { if (this.isPlaying && token === this.sessionToken) this.speakChunkSequence(chunks, segment, chunkIndex + 1, token); };
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
    this.isPlaying = false; this.playIcon.textContent = '▶'; this.stopIOSKeepAlive(); this.stopBackgroundAudio(); this.updateMediaSessionState(); this.showToast('End of book.');
  }

  seekBySeconds(seconds) {
    if (!this.units.length) return;
    const targetWords = Math.max(20, Math.round(Math.abs(seconds) * (155 * this.speechRate) / 60));
    const direction = Math.sign(seconds) || 1;
    let index = this.currentUnitIndex; let traversed = 0;
    while (traversed < targetWords) {
      const next = index + direction;
      if (next < 0 || next >= this.units.length) break;
      index = next; traversed += this.units[index].words;
    }
    const wasPlaying = this.isPlaying;
    this.pause(false); this.currentUnitIndex = index; this.currentSegmentIndex = 0; this.updateDisplay();
    if (wasPlaying) this.play();
  }

  seekFromProgressEvent(event) {
    if (!this.units.length) return;
    const rect = this.progressBar.getBoundingClientRect();
    const percent = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const index = clamp(Math.floor(percent * this.units.length), 0, this.units.length - 1);
    const wasPlaying = this.isPlaying;
    this.pause(false); this.currentUnitIndex = index; this.currentSegmentIndex = 0; this.updateDisplay();
    if (wasPlaying) this.play();
  }

  previewSelectedVoices() {
    this.speechSynthesis.cancel();
    const samples = [
      { text: 'The room fell quiet as the storm rolled over the city.', voice: this.narratorVoice, pitch: this.speechPitch },
      { text: 'I was hoping you would say that.', voice: this.dialogueVoice, pitch: this.speechPitch + 0.02 }
    ];
    const speak = index => {
      if (index >= samples.length) return;
      const sample = samples[index];
      const utterance = new SpeechSynthesisUtterance(sample.text);
      utterance.voice = sample.voice; utterance.rate = this.speechRate; utterance.pitch = clamp(sample.pitch, 0.1, 2); utterance.volume = this.speechVolume;
      utterance.onend = () => setTimeout(() => speak(index + 1), 180);
      this.speechSynthesis.speak(utterance);
    };
    speak(0);
  }

  configureSleepTimer(minutes) {
    if (this.sleepTimerId) clearTimeout(this.sleepTimerId);
    this.sleepTimerId = null;
    if (!minutes) { this.showToast('Sleep timer is off.'); return; }
    this.sleepTimerId = setTimeout(() => { this.pause(); this.sleepTimer.value = '0'; this.showToast('Sleep timer finished. Playback paused.'); }, minutes * 60 * 1000);
    this.showToast(`Sleep timer set for ${minutes} minutes.`);
  }

  initBackgroundAudio() {
    this.backgroundAudio = document.createElement('audio');
    this.backgroundAudio.loop = true;
    this.backgroundAudio.setAttribute('playsinline', '');
    this.backgroundAudio.setAttribute('webkit-playsinline', '');
    this.backgroundAudio.style.display = 'none';
    this.backgroundAudio.volume = 0.005;
    this.backgroundAudio.src = this.generateQuietToneDataURL();
    document.body.appendChild(this.backgroundAudio);
  }

  generateQuietToneDataURL() {
    const sampleRate = 8000; const seconds = 1; const samples = sampleRate * seconds;
    const buffer = new ArrayBuffer(44 + samples * 2); const view = new DataView(buffer);
    const write = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i += 1) { const sample = Math.sin(2 * Math.PI * 220 * (i / sampleRate)) * 80; view.setInt16(44 + i * 2, sample, true); }
    let binary = '';
    new Uint8Array(buffer).forEach(byte => { binary += String.fromCharCode(byte); });
    return `data:audio/wav;base64,${btoa(binary)}`;
  }

  startBackgroundAudio() { if (this.backgroundAudio) this.backgroundAudio.play().catch(() => {}); }
  stopBackgroundAudio() { if (this.backgroundAudio) this.backgroundAudio.pause(); }
  startIOSKeepAlive() {
    this.stopIOSKeepAlive();
    if (!isIOS) return;
    this.iosKeepAliveTimer = setInterval(() => { if (this.isPlaying && this.speechSynthesis.paused) this.speechSynthesis.resume(); }, 9000);
  }
  stopIOSKeepAlive() { if (this.iosKeepAliveTimer) clearInterval(this.iosKeepAliveTimer); this.iosKeepAliveTimer = null; }

  initMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const safeSet = (action, handler) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported */ } };
    safeSet('play', () => this.play()); safeSet('pause', () => this.pause()); safeSet('seekbackward', details => this.seekBySeconds(-(details.seekOffset || 15)));
    safeSet('seekforward', details => this.seekBySeconds(details.seekOffset || 15)); safeSet('previoustrack', () => this.seekBySeconds(-15)); safeSet('nexttrack', () => this.seekBySeconds(15)); safeSet('stop', () => this.pause());
  }

  updateMediaSessionMetadata() {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const unit = this.units[this.currentUnitIndex];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.bookName?.textContent || 'PDF Story Reader', artist: unit ? `Page ${unit.page}` : 'Ready to read', album: 'PDF Story Reader', artwork: [{ src: MEDIA_SESSION_ARTWORK_URL, sizes: '96x96', type: 'image/svg+xml' }]
      });
    } catch { /* optional */ }
  }

  updateMediaSessionState() { if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused'; } catch { /* optional */ } } }

  resetReader() {
    this.pause();
    this.pdfDoc = null; this.file = null; this.fileKey = ''; this.pageTexts = []; this.units = []; this.detectedSpeakers = []; this.speakerVoiceNames.clear();
    this.currentUnitIndex = 0; this.currentSegmentIndex = 0; this.viewerPage = 1; this.lastRenderedPage = null; this.fileInput.value = '';
    this.readerSection.classList.add('hidden'); this.uploadSection.classList.remove('hidden'); this.changeBook.classList.add('hidden');
    this.castCount.textContent = '0'; this.castList.innerHTML = '<div class="empty-cast">No named speakers detected yet.</div>';
    this.canvasContext.clearRect(0, 0, this.pdfCanvas.width, this.pdfCanvas.height);
  }

  showLoading(show, title = '', message = '', percent = 0) {
    if (!show) { this.loadingOverlay.classList.add('hidden'); return; }
    this.loadingOverlay.classList.remove('hidden');
    if (title) this.loadingTitle.textContent = title;
    if (message) this.loadingMessage.textContent = message;
    const safePercent = clamp(percent, 0, 100);
    this.loadingFill.style.width = `${safePercent}%`; this.loadingPercent.textContent = `${safePercent}%`;
  }

  showToast(message) {
    clearTimeout(this.toastTimer); this.toast.textContent = message; this.toast.classList.remove('hidden');
    this.toastTimer = setTimeout(() => this.toast.classList.add('hidden'), 3200);
  }
}

document.addEventListener('DOMContentLoaded', () => { new PDFStoryReader(); });
