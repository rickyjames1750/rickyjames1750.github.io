const DEADZONE = 0.08;
const ZERO = () => ({throttle:0, steer:0, brake:0, x:0, y:0});

/**
 * x/y are normalized stick coordinates: right/down are positive.
 * Horizontal steering adds moderate forward motion for one-finger driving. A downward
 * pull past .15 explicitly selects reverse, so diagonals never require a second finger.
 */
export function joystickInput(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return ZERO();
  const length = Math.hypot(x, y);
  if (length <= DEADZONE) return ZERO();
  const scale = length > 1 ? 1 / length : 1;
  x *= scale;y *= scale;
  const throttle = y > 0.15 ? -y : Math.max(0, -y, Math.abs(x) * 0.45);
  return {throttle, steer:-x || 0, brake:0, x, y};
}

/** Bind a single captured pointer. Knob transform is relative to its CSS-centered origin. */
export function bindJoystick(element, {onStart = () => {}, onChange = () => {}} = {}) {
  if (!element) throw new Error('A joystick element is required.');
  const knob = element.querySelector('.joystick-knob');
  const doc = element.ownerDocument || document, win = doc.defaultView || window;
  const previousTouchAction = element.style.touchAction;
  let pointerId = null, destroyed = false;
  element.style.touchAction = 'none';
  function paint(input, radius, active) {
    if (knob) knob.style.transform = `translate(${input.x * radius}px, ${input.y * radius}px)`;
    element.dataset.active = String(active);
  }
  function update(event) {
    const bounds = element.getBoundingClientRect(), radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.36);
    const input = joystickInput((event.clientX - bounds.left - bounds.width / 2) / radius, (event.clientY - bounds.top - bounds.height / 2) / radius);
    paint(input, radius, true);onChange({...input, active:true});
  }
  function reset() {
    if (destroyed) return;
    const captured = pointerId;pointerId = null;
    if (captured !== null) {try {element.releasePointerCapture?.(captured);} catch {}}
    const input = ZERO();paint(input, 0, false);onChange({...input, active:false});
  }
  function pointerDown(event) {
    if (destroyed || pointerId !== null || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();pointerId = event.pointerId;
    try {element.setPointerCapture?.(pointerId);} catch {}
    onStart();update(event);
  }
  function pointerMove(event) {
    if (destroyed || event.pointerId !== pointerId) return;
    event.preventDefault();update(event);
  }
  function pointerEnd(event) {if (event.pointerId === pointerId) reset();}
  function visibility() {if (doc.hidden) reset();}
  element.addEventListener('pointerdown', pointerDown, {passive:false});
  element.addEventListener('pointermove', pointerMove, {passive:false});
  element.addEventListener('pointerup', pointerEnd);
  element.addEventListener('pointercancel', pointerEnd);
  element.addEventListener('lostpointercapture', pointerEnd);
  // Global releases also cover browsers that reject capture after a layout change.
  win.addEventListener('pointerup', pointerEnd);
  win.addEventListener('pointercancel', pointerEnd);
  win.addEventListener('blur', reset);
  doc.addEventListener('visibilitychange', visibility);
  paint(ZERO(), 0, false);
  return {
    reset,
    destroy() {
      if (destroyed) return;
      reset();destroyed = true;element.style.touchAction = previousTouchAction;
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('pointermove', pointerMove);
      element.removeEventListener('pointerup', pointerEnd);
      element.removeEventListener('pointercancel', pointerEnd);
      element.removeEventListener('lostpointercapture', pointerEnd);
      win.removeEventListener('pointerup', pointerEnd);
      win.removeEventListener('pointercancel', pointerEnd);
      win.removeEventListener('blur', reset);
      doc.removeEventListener('visibilitychange', visibility);
    },
  };
}
