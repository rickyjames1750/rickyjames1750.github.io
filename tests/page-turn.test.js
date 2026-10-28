import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageTurnController, pageTurnFrame } from '../src/page-turn.js';

function timeline(reducedMotion = false) {
  const timers = new Map();
  let nextId = 0;
  let resolveAnimation;
  let rejectAnimation;
  const calls = { render: 0, cancel: 0, cleanup: 0, frames: [] };
  const controller = createPageTurnController({
    reducedMotion,
    setTimer(callback, time) { const id = ++nextId; timers.set(id, { callback, time }); return id; },
    clearTimer(id) { timers.delete(id); },
    render(frame) {
      calls.render++;
      calls.frames.push(frame);
      return {
        finished: new Promise((resolve, reject) => { resolveAnimation = resolve; rejectAnimation = reject; }),
        cancel() { calls.cancel++; },
        cleanup() { calls.cleanup++; },
      };
    },
  });
  return {
    controller, calls, timers,
    finish: () => resolveAnimation(),
    reject: () => rejectAnimation(new Error('Animation cancelled')),
    advance(time) {
      for (const [id, timer] of [...timers]) {
        if (timer.time <= time && timers.has(id)) { timers.delete(id); timer.callback(); }
      }
    },
  };
}

test('a repeated Next action shares one page and settles callbacks once', async () => {
  const t = timeline();
  let midpoints = 0;
  let completions = 0;
  const first = t.controller.turn({ nextLabel: 'Experience', onMidpoint: () => midpoints++, onComplete: () => completions++ });
  const repeated = t.controller.turn({ nextLabel: 'Projects' });
  assert.equal(first, repeated);
  assert.equal(t.controller.isTurning, true);
  assert.equal(t.calls.render, 1);
  assert.equal(t.calls.frames[0].nextLabel, 'Experience');
  t.advance(350);
  assert.equal(midpoints, 1);
  t.finish();
  assert.equal(await first, true);
  assert.equal(completions, 1);
  assert.equal(midpoints, 1);
  assert.equal(t.calls.cleanup, 1);
  assert.equal(t.controller.isTurning, false);
  assert.equal(t.timers.size, 0);
});

test('closing or cancelling a reader resolves false and prevents pending navigation', async () => {
  const t = timeline();
  let completed = 0;
  const pending = t.controller.turn({ onComplete: () => completed++ });
  t.controller.cancel();
  t.controller.cancel();
  assert.equal(await pending, false);
  t.finish();
  await Promise.resolve();
  assert.equal(completed, 0);
  assert.equal(t.calls.cancel, 1);
  assert.equal(t.calls.cleanup, 1);
  assert.equal(t.timers.size, 0);
  const subsequent = t.controller.turn();
  t.finish();
  assert.equal(await subsequent, true);
});

test('reduced motion uses a brief fade timeline and can respond to a live preference', async () => {
  let reduce = true;
  const t = timeline(() => reduce);
  const first = t.controller.turn();
  assert.equal(t.calls.frames[0].reducedMotion, true);
  assert.equal(t.calls.frames[0].duration, 130);
  t.finish();
  assert.equal(await first, true);
  reduce = false;
  const second = t.controller.turn();
  assert.equal(t.calls.frames[1].duration, 660);
  t.finish();
  await second;
});

test('destroying a page turn settles the current promise and stops future turns', async () => {
  const t = timeline();
  const pending = t.controller.turn();
  t.controller.destroy();
  assert.equal(await pending, false);
  assert.equal(await t.controller.turn(), false);
  assert.equal(t.calls.render, 1);
  assert.equal(t.calls.cleanup, 1);
  assert.equal(t.timers.size, 0);
});

test('an interrupted native animation releases its controls', async () => {
  const t = timeline();
  const pending = t.controller.turn();
  t.reject();
  assert.equal(await pending, false);
  assert.equal(t.controller.isTurning, false);
  assert.equal(t.calls.cleanup, 1);
});

test('a stalled or unsupported animation cannot leave Next disabled indefinitely', async () => {
  const t = timeline();
  let midway = 0;
  const pending = t.controller.turn({ onMidpoint: () => midway++ });
  t.advance(1000);
  assert.equal(await pending, true);
  assert.equal(midway, 1);
  assert.equal(t.calls.cleanup, 1);
  assert.equal(t.controller.isTurning, false);
});

test('a failed midpoint callback safely cancels without calling completion', async () => {
  const t = timeline();
  let completed = false;
  const pending = t.controller.turn({ onMidpoint() { throw new Error('Navigation interrupted'); }, onComplete() { completed = true; } });
  t.advance(350);
  assert.equal(await pending, false);
  assert.equal(completed, false);
  assert.equal(t.calls.cleanup, 1);
});

test('a renderer failure still settles the turn and releases the single-flight lock', async () => {
  let renders = 0;
  const controller = createPageTurnController({ render() { renders++; throw new Error('Reader no longer exists'); } });
  assert.equal(await controller.turn(), false);
  assert.equal(controller.isTurning, false);
  assert.equal(await controller.turn(), false);
  assert.equal(renders, 2);
});

test('a cleanup failure cannot leave a pending turn promise', async () => {
  const controller = createPageTurnController({ render: () => ({
    finished: Promise.resolve(),
    cleanup() { throw new Error('Reader detached during cleanup'); },
  }) });
  assert.equal(await controller.turn(), false);
  assert.equal(controller.isTurning, false);
});

test('the paper covers the reading viewport while preserving the fixed scroll rail', () => {
  const frame = pageTurnFrame(
    { left: 800, top: 0, width: 560, height: 900 },
    { left: 800, top: 66, right: 1360, width: 560, height: 754 },
    { left: 1322, width: 28 },
  );
  assert.deepEqual(frame, { left: 0, top: 66, width: 515, height: 754 });
});

test('a reader without a rail still turns the entire scroll region', () => {
  assert.deepEqual(pageTurnFrame(
    { left: 0, top: 0 }, { left: 0, top: 62, right: 390, width: 390, height: 620 },
  ), { left: 0, top: 62, width: 390, height: 620 });
});
