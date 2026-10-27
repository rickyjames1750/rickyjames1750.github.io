import { createAmbience } from './audio.js';

/** Measure actual rendered samples, rather than estimating loudness from gain targets. */
export function measureAudio(buffer) {
  let squares = 0, peak = 0, clippedSamples = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const value of buffer.getChannelData(channel)) {
    squares += value * value;peak = Math.max(peak, Math.abs(value));if (Math.abs(value) >= 1) clippedSamples++;
  }
  const rms = Math.sqrt(squares / Math.max(1, buffer.length * buffer.numberOfChannels));
  return {rms, peak, rmsDBFS: rms ? +(20 * Math.log10(rms)).toFixed(2) : null, peakDBFS: peak ? +(20 * Math.log10(peak)).toFixed(2) : null, clippedSamples};
}

export function audioBufferWav(buffer) {
  const channels = buffer.numberOfChannels, bytes = buffer.length * channels * 2, view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, 'RIFF');view.setUint32(4, bytes + 36, true);text(8, 'WAVE');text(12, 'fmt ');view.setUint32(16, 16, true);view.setUint16(20, 1, true);view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);view.setUint32(28, buffer.sampleRate * channels * 2, true);view.setUint16(32, channels * 2, true);view.setUint16(34, 16, true);text(36, 'data');view.setUint32(40, bytes, true);
  const data = Array.from({length: channels}, (_, channel) => buffer.getChannelData(channel));
  for (let frame = 0; frame < buffer.length; frame++) for (let channel = 0; channel < channels; channel++) view.setInt16(44 + (frame * channels + channel) * 2, Math.round(Math.max(-1, Math.min(1, data[channel][frame])) * 32767), true);
  return new Blob([view], {type: 'audio/wav'});
}

export const DIAGNOSTIC_STEMS = ['idle-effects','music','motor','train','drone','birds','actions','focus','reveal','race','page-turn','pad','combined'];

/** Fixed event times make isolated listening and combined headroom repeatable. */
export function diagnosticCuesAt(stem,tick) {
  if (stem==='focus'||stem==='reveal') return tick===10?[['transition',stem]]:[];
  if (stem==='page-turn') return tick===10?[['pageTurn',null]]:[];
  if (stem==='pad') return tick===10?[['raceCue','pad']]:[];
  if (stem==='race') {
    const events={10:'countdown',30:'countdown',50:'countdown',70:'go',100:'lap',124:'finish'};
    return events[tick]?[['raceCue',events[tick]]]:[];
  }
  if (stem==='actions'||stem==='combined') {
    return ({5:[['transition','focus']],30:[['pageTurn',null]],40:[['transition','reveal']],92:[['raceCue','pad']],72:[['raceCue','go']],106:[['impact',.7]],128:[['raceCue','finish']]})[tick]||[];
  }
  return [];
}

/** Same production graph, deterministic telemetry and audio clock; no device playback. */
export async function renderAudioDiagnostics({duration = 8, sampleRate = 24000, onStem = () => {}} = {}) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error('This browser does not support offline audio rendering.');
  const names = ['music', 'motor', 'train', 'drone', 'birds', 'actions'];
  const results = [];
  for (const stem of DIAGNOSTIC_STEMS) {
    const context = new Offline(2, Math.round(duration * sampleRate), sampleRate);let time = 0;
    const audio = createAmbience({offlineContext: context, clock: () => time, manualScheduling: true});
    const actionOnly=['focus','reveal','race','page-turn','pad'].includes(stem);
    await audio.start();audio.isolateSources(stem === 'combined' ? names : stem === 'idle-effects' ? names.filter(name => name !== 'music') : actionOnly?['actions']:[stem]);
    for (let tick = 0; tick < duration * 20; tick++) {
      time = tick / 20;const idle = stem === 'idle-effects'||actionOnly;
      const speed = idle || time < 1 || time >= 5 ? 0 : time < 3 ? (time - 1) * 6 : time < 4 ? 12 : (5 - time) * 12;
      audio.setMotion(speed, 'car', {
        trainDistance: idle ? Infinity : 3 + Math.abs(time - 3) * 13, trainSpeed: 5, trainPan: (time - 3) / 3,
        droneDistance: idle ? Infinity : 2 + Math.abs(time - 2.5) * 8, droneSpeed: .7, dronePan: (2.5 - time) / 2,
        birdActivity: idle ? 0 : .6, braking: !idle && time >= 4 && time < 5,
      });
      for (const [method,value] of diagnosticCuesAt(stem,tick)) await audio[method](value);
      audio.diagnosticTick();
    }
    const buffer = await context.startRendering(), result = {stem, buffer, metrics: measureAudio(buffer)};
    audio.destroy();results.push(result);onStem(result);
  }
  return results;
}
