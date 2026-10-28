const TURN_DURATION = 660;
const REDUCED_DURATION = 130;

/**
 * Small single-flight timeline shared by the reader and its tests. A renderer
 * owns its visual resources; the timeline owns completion and cancellation.
 */
export function createPageTurnController({
  render,
  reducedMotion = false,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let current = null;
  let destroyed = false;

  function settle(record, completed) {
    if (current !== record || record.settled) return;
    record.settled = true;
    clearTimer(record.midpointTimer);
    clearTimer(record.endTimer);
    current = null;
    // Resource failures must never leave navigation awaiting an unsettled turn.
    try { record.visual?.cancel?.(); } catch { completed = false; }
    try { record.visual?.cleanup?.(); } catch { completed = false; }
    if (completed) {
      try {
        if (!record.midpointCalled) {
          record.midpointCalled = true;
          record.options.onMidpoint?.();
        }
        record.options.onComplete?.();
      } catch {
        completed = false;
      }
    }
    record.resolve(completed);
  }

  return {
    turn(options = {}) {
      if (destroyed) return Promise.resolve(false);
      if (current) return current.promise;
      const reduced = Boolean(typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion);
      const duration = reduced ? REDUCED_DURATION : TURN_DURATION;
      const record = { options, midpointCalled: false, settled: false };
      record.promise = new Promise(resolve => { record.resolve = resolve; });
      current = record;
      try {
        record.visual = render({ ...options, duration, reducedMotion: reduced });
        record.midpointTimer = setTimer(() => {
          if (current !== record) return;
          record.midpointCalled = true;
          try { options.onMidpoint?.(); } catch { settle(record, false); }
        }, duration * .52);
        // Also completes browsers without WAAPI and bounds a stalled animation.
        record.endTimer = setTimer(() => settle(record, true), duration + 60);
        if (record.visual?.finished) {
          Promise.resolve(record.visual.finished).then(
            () => settle(record, true),
            () => settle(record, false),
          );
        }
      } catch {
        settle(record, false);
      }
      return record.promise;
    },
    cancel() { if (current) settle(current, false); },
    destroy() { destroyed = true; if (current) settle(current, false); },
    get isTurning() { return current !== null; },
  };
}

/** Keep the paper below the fixed reader chrome and to the left of its rail. */
export function pageTurnFrame(dialogRect, scrollerRect, railRect) {
  const left = Math.max(0, scrollerRect.left - dialogRect.left);
  const top = Math.max(0, scrollerRect.top - dialogRect.top);
  let width = scrollerRect.width;
  if (railRect && railRect.width > 0 && railRect.left < scrollerRect.right) {
    width = Math.min(width, railRect.left - scrollerRect.left - 7);
  }
  return { left, top, width: Math.max(1, width), height: Math.max(1, scrollerRect.height) };
}

function createNode(doc, className, text) {
  const element = doc.createElement('div');
  element.className = className;
  if (text) element.textContent = text;
  return element;
}

function makePaperCopy(scroller, doc, view) {
  const copy = scroller.cloneNode(true);
  for (const element of [copy, ...copy.querySelectorAll('[id]')]) {
    if (element.id) element.setAttribute('data-page-turn-source', element.id);
    element.removeAttribute('id');
  }
  copy.classList.add('page-turn-copy');
  copy.setAttribute('aria-hidden', 'true');
  copy.removeAttribute('tabindex');
  copy.removeAttribute('role');
  copy.inert = true;
  for (const control of copy.querySelectorAll('a, button, input, select, textarea, [tabindex]')) {
    control.setAttribute('tabindex', '-1');
    if ('disabled' in control) control.disabled = true;
  }
  const computed = view?.getComputedStyle(scroller);
  Object.assign(copy.style, {
    position: 'absolute', inset: '0 auto auto 0', margin: '0',
    width: `${scroller.clientWidth}px`,
    height: `${Math.max(scroller.scrollHeight, scroller.clientHeight)}px`,
    padding: computed?.padding || '28px 62px 36px 42px',
    boxSizing: 'border-box', overflow: 'visible', visibility: 'visible',
    transform: `translate3d(0, ${-scroller.scrollTop}px, 0)`,
    transition: 'none', animation: 'none',
  });
  return copy;
}

function animatePaper(stage, sheet, shade, curl, duration, reducedMotion) {
  const animations = [];
  if (typeof sheet.animate !== 'function') {
    stage.classList.add('page-turn-fallback');
    return { cancel() {}, finished: null };
  }
  const timing = { duration, fill: 'both', easing: 'cubic-bezier(.32,.02,.26,1)' };
  try {
    if (reducedMotion) {
      animations.push(sheet.animate([{ opacity: 1 }, { opacity: 0 }], timing));
    } else {
      animations.push(sheet.animate([
        { transform: 'rotateY(0deg) translateZ(0px)', offset: 0 },
        { transform: 'rotateY(-17deg) translateZ(8px)', offset: .2 },
        { transform: 'rotateY(-84deg) translateZ(13px)', offset: .6 },
        { transform: 'rotateY(-174deg) translateZ(0px)', offset: 1 },
      ], timing));
      animations.push(shade.animate([
        { opacity: 0, transform: 'scaleX(1)', offset: 0 },
        { opacity: .24, transform: 'scaleX(.62)', offset: .48 },
        { opacity: 0, transform: 'scaleX(.12)', offset: 1 },
      ], timing));
      animations.push(curl.animate([
        { opacity: 0, width: '12px', offset: 0 },
        { opacity: 1, width: '40px', offset: .4 },
        { opacity: .35, width: '14px', offset: 1 },
      ], timing));
    }
    return {
      finished: Promise.all(animations.map(animation => animation.finished)),
      cancel() { for (const animation of animations) animation.cancel(); },
    };
  } catch {
    for (const animation of animations) {
      animation.finished?.catch?.(() => {});
      animation.cancel();
    }
    stage.classList.add('page-turn-fallback');
    return { cancel() {}, finished: null };
  }
}

/**
 * Animate the currently visible resume page as live DOM, without duplicating
 * IDs or moving the persistent section selector, reading rail, and buttons.
 * `turn()` resolves false when cancelled, so callers can skip pending travel.
 */
export function bindPageTurn({ dialog, scroller, reducedMotion = false }) {
  if (!dialog || !scroller) throw new TypeError('A reader dialog and scroller are required.');
  const doc = dialog.ownerDocument;
  const view = doc.defaultView;
  const removers = [];
  const controller = createPageTurnController({
    reducedMotion,
    render({ nextLabel, nextCity, duration, reducedMotion: reduced }) {
      const rail = dialog.querySelector('.detail-scroll-rail');
      const frame = pageTurnFrame(dialog.getBoundingClientRect(), scroller.getBoundingClientRect(), rail?.getBoundingClientRect());
      const stage = createNode(doc, 'page-turn-stage');
      stage.setAttribute('aria-hidden', 'true');
      stage.dataset.reducedMotion = String(reduced);
      stage.style.setProperty('--page-turn-duration', `${duration}ms`);
      Object.assign(stage.style, {
        left: `${frame.left}px`, top: `${frame.top}px`,
        width: `${frame.width}px`, height: `${frame.height}px`,
      });

      const under = createNode(doc, 'page-turn-under');
      under.append(createNode(doc, 'page-turn-kicker', 'THE JOURNEY CONTINUES'));
      under.append(createNode(doc, 'page-turn-next-title', nextLabel || 'The next chapter'));
      if (nextCity) under.append(createNode(doc, 'page-turn-next-city', nextCity));
      under.append(createNode(doc, 'page-turn-route-mark', '→'));
      const shade = createNode(doc, 'page-turn-shadow');
      const sheet = createNode(doc, 'page-turn-sheet');
      const front = createNode(doc, 'page-turn-front');
      const back = createNode(doc, 'page-turn-back');
      const curl = createNode(doc, 'page-turn-curl');
      front.append(makePaperCopy(scroller, doc, view), curl);
      back.append(createNode(doc, 'page-turn-back-mark', 'BAYWARD / FIELD NOTES'));
      sheet.append(front, back);
      stage.append(under, shade, sheet);

      const controls = [...dialog.querySelectorAll('#next, #detail-more, #detail-progress')]
        .map(element => ({ element, disabled: element.disabled }));
      const previous = {
        visibility: scroller.style.visibility,
        inert: scroller.inert,
        busy: scroller.getAttribute('aria-busy'),
      };
      dialog.append(stage);
      dialog.classList.add('is-page-turning');
      scroller.style.visibility = 'hidden';
      scroller.inert = true;
      scroller.setAttribute('aria-busy', 'true');
      for (const { element } of controls) element.disabled = true;
      const animation = animatePaper(stage, sheet, shade, curl, duration, reduced);
      return {
        ...animation,
        cleanup() {
          stage.remove();
          dialog.classList.remove('is-page-turning');
          scroller.style.visibility = previous.visibility;
          scroller.inert = previous.inert;
          if (previous.busy === null) scroller.removeAttribute('aria-busy');
          else scroller.setAttribute('aria-busy', previous.busy);
          for (const { element, disabled } of controls) element.disabled = disabled;
        },
      };
    },
  });

  function listen(target, type, handler, options) {
    target?.addEventListener(type, handler, options);
    removers.push(() => target?.removeEventListener(type, handler, options));
  }
  const cancel = () => controller.cancel();
  listen(dialog, 'close', cancel);
  listen(dialog, 'cancel', cancel);
  listen(dialog, 'keydown', event => { if (event.key === 'Escape') cancel(); });
  listen(dialog, 'change', event => { if (event.target.id === 'detail-section') cancel(); }, true);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) cancel(); });
  listen(view, 'resize', cancel);
  const observer = view?.MutationObserver ? new view.MutationObserver(() => {
    if (!dialog.open) cancel();
  }) : null;
  observer?.observe(dialog, { attributes: true, attributeFilter: ['open'] });

  return {
    turn(options) {
      if (!dialog.open || doc.hidden) return Promise.resolve(false);
      return controller.turn(options);
    },
    cancel,
    destroy() {
      controller.destroy();
      observer?.disconnect();
      for (const remove of removers) remove();
    },
    get isTurning() { return controller.isTurning; },
  };
}
