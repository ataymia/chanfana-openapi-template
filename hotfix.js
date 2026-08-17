(() => {
  if (typeof PDFStoryReader === 'undefined') return;
  const F = PDFStoryReader.prototype;
  const on = (el, evt, fn, opt) => el?.addEventListener?.(evt, fn, opt);
  const pdfSources = [
    ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'],
    ['https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js','https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js']
  ];
  const loadScript = (src) => new Promise((resolve,reject) => {
    const old = [...document.scripts].find(s => s.src === src);
    if (old && typeof pdfjsLib !== 'undefined') return resolve();
    const s = old || document.createElement('script');
    const timer = setTimeout(() => reject(new Error('PDF support took too long to load.')), 12000);
    s.addEventListener('load', () => { clearTimeout(timer); resolve(); }, {once:true});
    s.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not load PDF support.')); }, {once:true});
    if (!old) { s.src = src; s.async = true; s.crossOrigin = 'anonymous'; document.head.appendChild(s); }
  });

  F.cacheElements = function() {
    const ids = ['upload-section','reader-section','drop-zone','choose-file-btn','file-input','upload-status','change-book','book-name','book-pages','book-words','book-time','jump-viewer-to-audio','read-viewed-page','pdf-canvas','page-render-status','prev-page','next-page','page-number','page-count','page-zoom-value','current-location','speaker-chip','text-display','current-text','progress-bar','progress-fill','progress-thumb','progress-label','remaining-time','rewind-btn','play-pause-btn','play-icon','forward-btn','speed-control','speed-value','pitch-control','pitch-value','volume-control','volume-value','font-size-control','font-size-value','sleep-timer','voice-select','dialogue-voice-select','preview-voices','cast-list','cast-count','loading-overlay','loading-title','loading-message','loading-fill','loading-percent','toast'];
    ids.forEach(id => this[id.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = document.getElementById(id));
    this.followNarrationCheckbox = document.getElementById('follow-narration');
    this.pageZoomControl = document.getElementById('page-zoom');
    this.smartVoicesCheckbox = document.getElementById('smart-voices');
    this.preferNaturalVoicesCheckbox = document.getElementById('prefer-natural-voices');
    this.canvasContext = this.pdfCanvas?.getContext?.('2d',{alpha:false}) || null;
  };

  F.applySavedSettings = function() {
    this.speechRate = Number(this.settings?.speechRate) || 1;
    this.speechPitch = Number(this.settings?.speechPitch) || 1;
    this.speechVolume = Number(this.settings?.speechVolume) || 1;
    this.smartVoices = this.settings?.smartVoices !== false;
    this.preferNaturalVoices = this.settings?.preferNaturalVoices !== false;
    this.followNarration = this.settings?.followNarration !== false;
    this.pageZoom = Number(this.settings?.pageZoom) || 110;
    this.readerFontSize = Number(this.settings?.readerFontSize) || 21;
    if(this.speedControl)this.speedControl.value=this.speechRate;
    if(this.pitchControl)this.pitchControl.value=this.speechPitch;
    if(this.volumeControl)this.volumeControl.value=this.speechVolume;
    if(this.smartVoicesCheckbox)this.smartVoicesCheckbox.checked=this.smartVoices;
    if(this.preferNaturalVoicesCheckbox)this.preferNaturalVoicesCheckbox.checked=this.preferNaturalVoices;
    if(this.followNarrationCheckbox)this.followNarrationCheckbox.checked=this.followNarration;
    if(this.pageZoomControl)this.pageZoomControl.value=this.pageZoom;
    if(this.fontSizeControl)this.fontSizeControl.value=this.readerFontSize;
    this.updateSettingLabels();
  };

  F.initVoices = function() {
    if (!this.speechSynthesis?.getVoices) {
      this.voices = [];
      [this.voiceSelect,this.dialogueVoiceSelect,this.previewVoices].forEach(x => { if(x)x.disabled=true; });
      return;
    }
    const refresh = () => { try { const v=this.speechSynthesis.getVoices()||[]; if(v.length){this.voices=v;this.populateVoiceSelects(false);this.renderCastList();} } catch(e){console.warn(e);} };
    refresh();
    if ('onvoiceschanged' in this.speechSynthesis) this.speechSynthesis.onvoiceschanged = refresh;
    let n=0; const t=setInterval(()=>{refresh();if(this.voices.length||++n>20)clearInterval(t);},250);
  };

  F.setUploadStatus = function(msg){ if(this.uploadStatus)this.uploadStatus.textContent=msg; };
  F.handleLoadError = function(err){ console.error(err); let m=err?.message||'Could not open that PDF.'; if(err?.name==='PasswordException')m='This PDF is password-protected.'; this.setUploadStatus(m); this.showToast(m); };

  F.ensurePdfJs = async function(){
    if(typeof pdfjsLib!=='undefined')return pdfjsLib;
    let last;
    for(const [lib,worker] of pdfSources){
      try{ this.setUploadStatus('Loading PDF support…'); await loadScript(lib); if(typeof pdfjsLib!=='undefined'){pdfjsLib.GlobalWorkerOptions.workerSrc=worker;return pdfjsLib;} }
      catch(e){ last=e; }
    }
    throw last||new Error('PDF support could not load.');
  };

  F.bindEvents = function(){
    if(!this.fileInput)return;
    const pick=()=>{try{this.fileInput.showPicker?this.fileInput.showPicker():this.fileInput.click();}catch{this.fileInput.click();}};
    on(this.dropZone,'click',e=>{if(e.target?.closest?.('#choose-file-btn')||e.target===this.fileInput)return;pick();});
    on(this.dropZone,'keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});
    on(this.fileInput,'change',e=>{const input=e.currentTarget,file=input?.files?.[0];if(!file)return this.setUploadStatus('No file selected.');this.setUploadStatus(`Selected ${file.name}. Opening…`);input.value='';Promise.resolve(this.processFile(file)).catch(x=>this.handleLoadError(x));});
    ['dragenter','dragover'].forEach(t=>on(this.dropZone,t,e=>{e.preventDefault();e.stopPropagation();this.dropZone.classList.add('dragover');}));
    ['dragleave','drop'].forEach(t=>on(this.dropZone,t,e=>{e.preventDefault();e.stopPropagation();this.dropZone.classList.remove('dragover');}));
    on(this.dropZone,'drop',e=>{const f=e.dataTransfer?.files?.[0];if(f)this.processFile(f);});
    document.addEventListener('dragover',e=>e.preventDefault()); document.addEventListener('drop',e=>e.preventDefault());
    on(this.changeBook,'click',()=>this.resetReader()); on(this.playPauseBtn,'click',()=>this.togglePlayPause()); on(this.rewindBtn,'click',()=>this.seekBySeconds(-15)); on(this.forwardBtn,'click',()=>this.seekBySeconds(15));
    const browse=p=>{if(!this.pdfDoc)return;this.followNarration=false;if(this.followNarrationCheckbox)this.followNarrationCheckbox.checked=false;this.saveSettings();this.renderPage(clamp(p,1,this.pdfDoc.numPages),true);};
    on(this.prevPage,'click',()=>browse(this.viewerPage-1)); on(this.nextPage,'click',()=>browse(this.viewerPage+1)); on(this.pageNumber,'change',()=>browse(Number(this.pageNumber.value))); on(this.pageNumber,'keydown',e=>{if(e.key==='Enter')browse(Number(this.pageNumber.value));});
    on(this.pageZoomControl,'input',()=>{this.pageZoom=Number(this.pageZoomControl.value);this.updateSettingLabels();this.saveSettings();this.renderPage(this.viewerPage,true);});
    on(this.followNarrationCheckbox,'change',()=>{this.followNarration=this.followNarrationCheckbox.checked;this.saveSettings();if(this.followNarration&&this.units.length){this.viewerPage=this.units[this.currentUnitIndex].page;this.renderPage(this.viewerPage,true);}});
    on(this.jumpViewerToAudio,'click',()=>{if(!this.units.length)return;this.followNarration=true;if(this.followNarrationCheckbox)this.followNarrationCheckbox.checked=true;this.viewerPage=this.units[this.currentUnitIndex].page;this.renderPage(this.viewerPage,true);this.saveSettings();});
    on(this.readViewedPage,'click',()=>{this.jumpAudioToPage(this.viewerPage);if(this.followNarrationCheckbox)this.followNarrationCheckbox.checked=true;});
    on(this.speedControl,'input',()=>{this.speechRate=Number(this.speedControl.value);this.updateSettingLabels();this.saveSettings();if(this.isPlaying)this.restartCurrentSegment();this.updateProgressMeta();});
    on(this.pitchControl,'input',()=>{this.speechPitch=Number(this.pitchControl.value);this.updateSettingLabels();this.saveSettings();if(this.isPlaying)this.restartCurrentSegment();});
    on(this.volumeControl,'input',()=>{this.speechVolume=Number(this.volumeControl.value);this.updateSettingLabels();this.saveSettings();if(this.isPlaying)this.restartCurrentSegment();});
    on(this.fontSizeControl,'input',()=>{this.readerFontSize=Number(this.fontSizeControl.value);this.updateSettingLabels();this.saveSettings();});
    on(this.smartVoicesCheckbox,'change',()=>{this.smartVoices=this.smartVoicesCheckbox.checked;this.saveSettings();if(this.isPlaying)this.restartCurrentSegment();});
    on(this.preferNaturalVoicesCheckbox,'change',()=>{this.preferNaturalVoices=this.preferNaturalVoicesCheckbox.checked;this.saveSettings();this.populateVoiceSelects(true);this.renderCastList();if(this.isPlaying)this.restartCurrentSegment();});
    on(this.voiceSelect,'change',()=>{this.narratorVoice=this.voices.find(v=>v.name===this.voiceSelect.value)||this.narratorVoice;this.saveSettings();if(this.isPlaying)this.restartCurrentSegment();});
    on(this.dialogueVoiceSelect,'change',()=>{this.dialogueVoice=this.voices.find(v=>v.name===this.dialogueVoiceSelect.value)||this.dialogueVoice;this.saveSettings();if(this.isPlaying)this.restartCurrentSegment();});
    on(this.previewVoices,'click',()=>this.previewSelectedVoices()); on(this.sleepTimer,'change',()=>this.configureSleepTimer(Number(this.sleepTimer.value))); on(this.progressBar,'pointerdown',e=>this.seekFromProgressEvent(e));
    on(this.progressBar,'keydown',e=>{if(e.key==='ArrowLeft')this.seekBySeconds(-15);if(e.key==='ArrowRight')this.seekBySeconds(15);});
  };

  F.processFile = async function(file){
    if(!file)return; const name=String(file.name||'book.pdf'); const ok=file.type==='application/pdf'||name.toLowerCase().endsWith('.pdf');
    if(!ok){this.setUploadStatus('That file is not a PDF.');return this.showToast('Please choose a PDF file.');}
    if(file.size>100*1024*1024){this.setUploadStatus('That PDF is larger than 100 MB.');return this.showToast('This reader supports PDFs up to 100 MB.');}
    await this.loadPDF(file);
  };

  F.loadPDF = async function(file){
    this.showLoading(true,'Opening your book',`Preparing ${file.name}…`,2); this.setUploadStatus(`Opening ${file.name}…`);
    try{
      const pdf=await this.ensurePdfJs(); this.pause(false); this.file=file; this.fileKey=`${file.name}|${file.size}|${file.lastModified}`;
      this.showLoading(true,'Opening your book','Reading the PDF file…',4);
      this.pdfDoc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
      if(this.pageCount)this.pageCount.textContent=`/ ${this.pdfDoc.numPages}`; if(this.pageNumber)this.pageNumber.max=String(this.pdfDoc.numPages); if(this.bookName)this.bookName.textContent=file.name.replace(/\.pdf$/i,''); if(this.bookPages)this.bookPages.textContent=`${this.pdfDoc.numPages.toLocaleString()} pages`;
      await this.extractBook(); this.detectedSpeakers=this.collectDetectedSpeakers(); this.assignDefaultCharacterVoices(); this.renderCastList(); this.updateBookStats(); this.restoreBookPosition(); this.viewerPage=this.units[this.currentUnitIndex]?.page||1; this.followNarration=true; if(this.followNarrationCheckbox)this.followNarrationCheckbox.checked=true;
      this.uploadSection?.classList.add('hidden'); this.readerSection?.classList.remove('hidden'); this.changeBook?.classList.remove('hidden'); await this.renderPage(this.viewerPage,true);
      if(this.units.length){this.updateDisplay();this.setUploadStatus('Book ready.');this.showToast('Book ready. Press Play.');}
      else{if(this.currentLocation)this.currentLocation.textContent=`Page ${this.viewerPage}`;if(this.currentText)this.currentText.textContent='This PDF opened, but it does not contain selectable text to narrate. It may be a scanned-image PDF.';this.setUploadStatus('PDF opened, but no selectable text was found.');this.showToast('PDF opened. No selectable text was found for narration.');}
      this.updateMediaSessionMetadata();
    }catch(e){this.handleLoadError(e);}finally{this.showLoading(false);}
  };

  const oldPause=F.pause; F.pause=function(stopBackground=true){if(!this.speechSynthesis){this.isPlaying=false;this.sessionToken=(this.sessionToken||0)+1;if(this.playIcon)this.playIcon.textContent='▶';if(stopBackground)this.stopBackgroundAudio?.();this.updateMediaSessionState?.();return;}return oldPause.call(this,stopBackground);};
  const oldPlay=F.play; F.play=function(){if(!this.units.length)return this.showToast('This PDF has no readable text to narrate.');if(!this.speechSynthesis||typeof SpeechSynthesisUtterance==='undefined')return this.showToast('Narration is unavailable here. Open the site in Safari or Chrome.');return oldPlay.call(this);};
  const oldPreview=F.previewSelectedVoices; F.previewSelectedVoices=function(){if(!this.speechSynthesis||typeof SpeechSynthesisUtterance==='undefined')return this.showToast('Voice preview is unavailable in this browser.');return oldPreview.call(this);};
  const oldReset=F.resetReader; F.resetReader=function(){oldReset.call(this);this.setUploadStatus('Choose a PDF to begin.');};
})();
