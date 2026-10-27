// A local compositor: live WebGL frames, live DOM-backed labels, and a cached DOM interface.
// This records the site viewport, not the operating-system screen or browser chrome.
const FORMATS = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
export function recordingSize(canvas, viewportWidth, viewportHeight) {
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(2, Math.max(1, canvas.width / Math.max(1, bounds.width)));
  return {width:Math.max(1, Math.round(viewportWidth * scale)), height:Math.max(1, Math.round(viewportHeight * scale)), scale};
}
export function selectRecordingType(Recorder) {
  return FORMATS.find(type => Recorder.isTypeSupported(type)) || null;
}

/**
 * overlayRenderer is optional and follows html2canvas's (element, options) contract.
 * It permits alternative DOM snapshot engines and deterministic lifecycle verification.
 * onReady receives a local blob URL retained until the next result or dispose().
 */
export async function createViewRecorder({canvas, root = document.querySelector('#app'), getAudioStream, onReady, onError, overlayRenderer} = {}) {
  if (!canvas || !root) throw new Error('A scene canvas and portfolio root are required to record the viewport.');
  let active = null, disposed = false, lastURL = null, renderOverlay = overlayRenderer, overlayImport;
  const doc = root.ownerDocument || document, win = doc.defaultView || window;
  const clock = () => win.performance?.now?.() ?? Date.now();
  const report = error => {try {onError?.(error instanceof Error ? error : new Error(String(error)));} catch {}};
  async function loadOverlay() {
    if (!renderOverlay) {
      overlayImport ||= import('html2canvas').then(module => module.default);
      renderOverlay = await overlayImport;
    }
    return renderOverlay;
  }
  function captureOptions(session) {
    const width = win.innerWidth, height = win.innerHeight;
    return {
      backgroundColor:null, scale:session.scale, width, height,
      x:win.scrollX || 0, y:win.scrollY || 0, scrollX:win.scrollX || 0, scrollY:win.scrollY || 0,
      windowWidth:width, windowHeight:height, logging:false, useCORS:true, allowTaint:false,
      ignoreElements(element) {
        if (element === canvas) return true;
        if (element.matches?.('#scene,#labels,canvas,video,.grain,[data-recorder-ignore],#recording-preview,#recording-dialog,#recording-result')) return true;
        return element.tagName === 'DIALOG' && Boolean(element.querySelector?.('video'));
      },
      onclone(clonedDocument) {
        // Transparent UI lets the live scene show through. This changes the clone only.
        for (const selector of ['html','body','#app','#explore']) {
          const element = clonedDocument.querySelector(selector);
          if (element) {element.style.backgroundColor = 'transparent';element.style.backgroundImage = 'none';}
        }
        const speed = clonedDocument.querySelector('#speed');
        if (speed) speed.style.visibility = 'hidden'; // Preserve its layout; draw the live value ourselves.
        const knob = clonedDocument.querySelector('.joystick-knob');
        if (knob) knob.style.visibility = 'hidden'; // Stick position is composited from live DOM bounds.
        const intro = clonedDocument.querySelector('.intro'), hud = clonedDocument.querySelector('#drive-hud');
        const driving = clonedDocument.body?.classList?.contains('driving');
        if (intro && driving) intro.style.opacity = '0';
        if (hud) hud.style.opacity = driving && clonedDocument.body?.dataset?.cinematic !== 'true' ? '1' : '0';
      },
    };
  }
  function query(selector) {return root.querySelector?.(selector) || doc.querySelector?.(selector);}
  function uiSignature() {
    const detail = query('#detail'), video = query('#video-dialog'), prompt = query('#prompt'), toast = query('#toast'), record = query('#record');
    return JSON.stringify([
      win.innerWidth, win.innerHeight, doc.body?.className || '', doc.body?.dataset?.travel || '', doc.body?.dataset?.cinematic || '',query('#cinema-caption')?.textContent || '',
      Boolean(detail?.open), detail?.open ? query('#detail-body')?.textContent : '', Boolean(video?.open),
      query('#visited')?.textContent || '', query('#sound')?.textContent || '', record?.textContent || '', Boolean(record?.disabled),
      Boolean(prompt?.hidden), query('#near-name')?.textContent || '', Boolean(toast?.hidden), toast?.hidden ? '' : toast?.textContent,
      query('#classic')?.hidden, query('#sound-guide')?.hidden, query('#brake')?.dataset?.active || '',
    ]);
  }
  function refreshLiveElements(session) {
    session.liveLabels = [...(root.querySelectorAll?.('#labels .map-label, #labels .landmark-label') || [])];
    session.labelContainer = query('#labels');session.speed = query('#speed');session.hud = query('#drive-hud');
    session.header = query('header');session.dock = query('.route-dock');session.joystick = query('#joystick');session.knob = session.joystick?.querySelector('.joystick-knob') || query('.joystick-knob');
  }
  function textOnCanvas(context, element, origin) {
    const bounds = element.getBoundingClientRect();if (!bounds.width || !bounds.height) return;const style = win.getComputedStyle(element);
    const ownText = [...(element.childNodes || [])].filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim();
    const text = ownText || (element.children?.length ? '' : element.textContent?.trim()) || '';
    if (!text) return;
    context.font = style.font || `${style.fontWeight || '400'} ${style.fontSize || '9px'} ${style.fontFamily || 'sans-serif'}`;
    context.fillStyle = style.color || '#dae9e2';context.textBaseline = 'top';context.textAlign = 'left';
    if ('letterSpacing' in context) context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : (style.letterSpacing || '0px');
    context.fillText(style.textTransform === 'uppercase' ? text.toUpperCase() : text, bounds.left - origin.left, bounds.top - origin.top);
  }
  function labelSprite(session, element, bounds) {
    const key = `${element.className}|${element.textContent}|${bounds.width.toFixed(1)}|${bounds.height.toFixed(1)}|${element.matches?.(':hover')}`;
    const cached = session.liveSprites.get(element);
    if (cached?.key === key) return cached;
    const style = win.getComputedStyle(element), map = element.classList.contains('map-label');
    const tail = map ? (parseFloat(win.getComputedStyle(element, '::after').height) || 21) : 0;
    const image = doc.createElement('canvas');image.width = Math.max(1,Math.ceil(bounds.width * session.scale));image.height = Math.max(1,Math.ceil((bounds.height + tail + 2) * session.scale));
    const context = image.getContext('2d');context.scale(session.scale,session.scale);
    if (map) {
      context.fillStyle = style.backgroundColor || '#112d3be6';context.strokeStyle = style.borderTopColor || '#b6d8d351';context.lineWidth = 1;
      context.beginPath();context.roundRect(.5,.5,bounds.width - 1,bounds.height - 1,parseFloat(style.borderTopLeftRadius) || 5);context.fill();context.stroke();
      context.beginPath();context.strokeStyle = '#a4d6c266';context.moveTo(bounds.width / 2,bounds.height);context.lineTo(bounds.width / 2,bounds.height + tail);context.stroke();
      for (const child of element.children) {textOnCanvas(context,child,bounds);for (const nested of child.children || []) textOnCanvas(context,nested,bounds);}
    } else textOnCanvas(context,element,bounds);
    const sprite = {key,image,height:bounds.height + tail + 2,opacity:parseFloat(style.opacity) || 1};
    session.liveSprites.set(element,sprite);return sprite;
  }
  function liveLabels(session, context, width, height) {
    if (!session.liveLabels?.length || !win.getComputedStyle) return;
    const top = session.header?.getBoundingClientRect().bottom || 0, bottom = session.dock?.getBoundingClientRect().top || height;
    const opacity = session.labelContainer ? Number(win.getComputedStyle(session.labelContainer).opacity) : 1;
    context.save();context.beginPath();context.rect(0,Math.max(0,top),width,Math.max(0,Math.min(height,bottom) - Math.max(0,top)));context.clip();
    for (const element of session.liveLabels) {
      if (element.hidden) continue;
      const bounds = element.getBoundingClientRect();if (!bounds.width || !bounds.height || bounds.right < 0 || bounds.left > width || bounds.bottom < top || bounds.top > bottom) continue;
      const sprite = labelSprite(session,element,bounds);context.globalAlpha = opacity * sprite.opacity;
      context.drawImage(sprite.image,bounds.left,bounds.top,bounds.width,sprite.height);
    }
    context.restore();
  }
  function liveSpeed(session, context) {
    const element = session.speed;if (!element || !win.getComputedStyle || query('#detail')?.open || query('#video-dialog')?.open || !doc.body?.classList?.contains('driving') || doc.body?.dataset?.travel === 'train' || doc.body?.dataset?.cinematic === 'true') return;
    const bounds = element.getBoundingClientRect();if (!bounds.width || !bounds.height) return;
    textOnCanvas(context,element,{left:0,top:0});
  }
  function liveJoystick(session, context) {
    const element = session.joystick, knob = session.knob;
    if (!element || !knob || !win.getComputedStyle || element.hidden || knob.hidden || !doc.body?.classList?.contains('driving') || doc.body?.classList?.contains('classic-mode') || doc.body?.dataset?.cinematic === 'true' || query('#detail')?.open || query('#video-dialog')?.open) return;
    const baseStyle = win.getComputedStyle(element), style = win.getComputedStyle(knob);
    if (baseStyle.display === 'none' || baseStyle.visibility === 'hidden' || style.display === 'none' || style.visibility === 'hidden' || Number(baseStyle.opacity) === 0 || Number(style.opacity) === 0) return;
    // getBoundingClientRect includes the pointer-driven transform; no expensive DOM snapshot is needed.
    const bounds = knob.getBoundingClientRect();if (!bounds.width || !bounds.height) return;
    const x = bounds.left + bounds.width / 2, y = bounds.top + bounds.height / 2;
    context.save();context.globalAlpha = Number.isFinite(Number(style.opacity)) ? Number(style.opacity) : 1;
    context.fillStyle = style.backgroundColor || '#d7edda';context.strokeStyle = style.borderTopColor || '#f2f7e8';context.lineWidth = parseFloat(style.borderTopWidth) || 1;
    context.shadowColor = 'rgba(0,15,24,.35)';context.shadowBlur = 10;context.shadowOffsetY = 3;
    context.beginPath();context.ellipse(x,y,bounds.width / 2,bounds.height / 2,0,0,Math.PI * 2);context.fill();context.shadowBlur = 0;context.shadowOffsetY = 0;context.stroke();
    context.font = style.font || `${style.fontWeight || '400'} ${style.fontSize || '22px'} ${style.fontFamily || 'sans-serif'}`;
    context.fillStyle = style.color || '#234c3e';context.textAlign = 'center';context.textBaseline = 'middle';
    context.fillText(knob.textContent?.trim() || '↑',x,y);context.restore();
  }
  async function snapshot(session, signature = uiSignature()) {
    if (session.overlayBusy || session.finished || session.cancelled || disposed) return;
    session.overlayBusy = true;session.requestedSignature = signature;refreshLiveElements(session);
    const options = captureOptions(session);
    const work = (async () => {
      try {
        const render = await loadOverlay(), image = await render(root, options);
        if (!image?.width || !image?.height) throw new Error('The snapshot did not contain a valid interface image.');
        if (!session.finished && !session.cancelled && !disposed) {
          session.overlay = {image, width:options.width, height:options.height};session.uiIncluded = true;
        }
      } catch (error) {
        if (!session.overlayWarned && !session.finished && !session.cancelled) {
          session.overlayWarned = true;
          report(new Error(`The interface snapshot is unavailable; the live scene will still record. ${error.message || error}`));
        }
      } finally {session.overlayBusy = false;}
    })();
    // Fonts, unsupported CSS, or a suspended document must not block the record control forever.
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        session.snapshotTimers.delete(timer);
        if (!session.overlayWarned && !session.overlay && !session.finished && !session.cancelled) {
          session.overlayWarned = true;report(new Error('The interface snapshot is taking longer than expected. The live scene will record while it finishes.'));
        }
        resolve();
      }, 1400);
      session.snapshotTimers.set(timer, resolve);
      work.then(() => {clearTimeout(timer);session.snapshotTimers.delete(timer);resolve();});
    });
  }
  function draw(session) {
    const context = session.context, output = session.output;
    const width = Math.max(1, win.innerWidth), height = Math.max(1, win.innerHeight);
    const fit = Math.min(output.width / width, output.height / height);
    const x = (output.width - width * fit) / 2, y = (output.height - height * fit) / 2;
    context.fillStyle = '#101e2c';context.fillRect(0, 0, output.width, output.height);
    const bounds = canvas.getBoundingClientRect();
    context.drawImage(canvas, x + bounds.left * fit, y + bounds.top * fit, bounds.width * fit, bounds.height * fit);
    context.save();context.translate(x,y);context.scale(fit,fit);liveLabels(session,context,width,height);context.restore();
    if (session.overlay) context.drawImage(session.overlay.image, x, y, width * fit, height * fit);
    context.save();context.translate(x,y);context.scale(fit,fit);liveSpeed(session,context);liveJoystick(session,context);context.restore();
    session.frames++;
  }
  function cleanup(session) {
    clearTimeout(session.stopTimer);clearInterval(session.overlayTimer);win.cancelAnimationFrame(session.raf);
    for (const [timer, resolve] of session.snapshotTimers) {clearTimeout(timer);resolve();}session.snapshotTimers.clear();
    session.stream?.getTracks().forEach(track => track.stop());
  }
  function finish(session) {
    if (session.finished) return;
    session.finished = true;cleanup(session);
    if (active === session) active = null;
    if (disposed || session.cancelled || session.failed) {session.resolve(null);return;}
    if (!session.chunks.length) {report(new Error('No video frames were captured. Please try recording again.'));session.resolve(null);return;}
    const blob = new Blob(session.chunks, {type:session.type});
    const url = URL.createObjectURL(blob);
    if (lastURL) URL.revokeObjectURL(lastURL);lastURL = url;
    const extension = session.type.includes('mp4') ? 'mp4' : 'webm';
    const rawName = session.filename || `ricky-sparks-bayward-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const fileName = `${rawName.replace(/\.(webm|mp4)$/i, '')}.${extension}`;
    const result = {
      blob, url, width:session.output.width, height:session.output.height,
      duration:Math.max(0, (clock() - session.startedAt) / 1000), hasAudio:session.hasAudio,
      fileName, uiIncluded:session.uiIncluded, uiRefreshMs:500, uiRefreshMode:'on-change', liveLabels:true, liveJoystick:true, targetFrameRate:30, frames:session.frames,
    };
    try {onReady?.(result);} catch (error) {report(error);}
    session.resolve(result);
  }
  async function start({duration = 30, filename} = {}) {
    if (disposed) throw new Error('This viewport recorder has been disposed.');
    if (active) return false;
    const Recorder = win.MediaRecorder;
    if (!Recorder || !canvas.captureStream) throw new Error('Viewport video recording is unavailable in this browser.');
    const type = selectRecordingType(Recorder);
    if (!type) throw new Error('This browser has no supported video recording format.');
    const size = recordingSize(canvas, win.innerWidth, win.innerHeight), output = doc.createElement('canvas');
    output.width = size.width;output.height = size.height;
    const context = output.getContext('2d', {alpha:false});
    if (!context || !output.captureStream) throw new Error('The browser could not create a viewport recording surface.');
    const session = {
      ...size, output, context, type, filename, chunks:[], overlay:null, overlayBusy:false, overlayWarned:false,
      snapshotTimers:new Map(), liveSprites:new WeakMap(), liveLabels:[], uiIncluded:false, hasAudio:false, frames:0, finished:false, cancelled:false, failed:false,
    };
    session.completion = new Promise(resolve => {session.resolve = resolve;});active = session;
    try {
      await snapshot(session);
      if (session.cancelled || disposed) {finish(session);return false;}
      draw(session);session.stream = output.captureStream(30);
      if (getAudioStream) {
        try {
          const audio = await getAudioStream();
          if (audio) for (const track of audio.getAudioTracks()) {
            if (track.readyState !== 'ended') {session.stream.addTrack(track.clone());session.hasAudio = true;}
          }
        } catch (error) {report(new Error(`Audio could not be included; video will continue. ${error.message || error}`));}
      }
      if (session.cancelled || disposed) {finish(session);return false;}
      const recorder = new Recorder(session.stream, {mimeType:type, videoBitsPerSecond:6000000});session.recorder = recorder;
      recorder.ondataavailable = event => {if (event.data?.size) session.chunks.push(event.data);};
      recorder.onstop = () => finish(session);
      recorder.onerror = event => {
        session.failed = true;report(event.error || new Error('The browser could not finish viewport recording.'));
        if (recorder.state !== 'inactive') recorder.stop();else finish(session);
      };
      session.startedAt = clock();
      function compose(time) {
        if (session.finished || session.cancelled || disposed) return;
        try {draw(session);} catch (error) {session.failed = true;report(error);stop();return;}
        session.raf = win.requestAnimationFrame(compose);
      }
      recorder.start(1000);session.raf = win.requestAnimationFrame(compose);
      session.overlayTimer = setInterval(() => {const signature = uiSignature();if (signature !== session.requestedSignature) snapshot(session,signature);}, 500);
      session.stopTimer = setTimeout(() => {if (recorder.state !== 'inactive') recorder.stop();}, Math.max(1, Math.min(300, Number(duration) || 30)) * 1000);
      return true;
    } catch (error) {
      session.failed = true;finish(session);throw error;
    }
  }
  function stop() {
    const session = active;
    if (!session) return Promise.resolve(null);
    if (!session.recorder) {session.cancelled = true;finish(session);return session.completion;}
    clearTimeout(session.stopTimer);
    if (session.recorder.state !== 'inactive') session.recorder.stop();
    return session.completion;
  }
  return {
    start, stop,
    recording: () => Boolean(active && !active.finished),
    dispose() {
      disposed = true;
      if (active) {active.cancelled = true;if (active.recorder?.state !== 'inactive' && active.recorder) active.recorder.stop();else finish(active);}
      if (lastURL) {URL.revokeObjectURL(lastURL);lastURL = null;}
    },
  };
}
