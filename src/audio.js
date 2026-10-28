// Original luminous score, spacecraft drive, and spatial Bay Area soundscape.
// Every sound is synthesized here; there are no external audio assets.
// start() may attempt autoplay; browser activation policy still determines when it is audible.
const MUTE_KEY = 'bayward.sound.muted';
const MIX_KEY = 'bayward.sound.mix.v1';
const RESUME_TIMEOUT = 180;
export function createAmbience({offlineContext, clock, manualScheduling = false} = {}) {
  let context, master, scoreBus, motor, motorHarmonic, motorLow, motorMechanical, motorGain, harmonicGain, lowGain, mechanicalGain, motorModulation, motorModulationDepth, motorFilter, roadFilter, roadGain, regenFilter, regenGain, trainGain, delay, reverb, recordDestination;
  let trainPassGain, trainPassPan, trainTraction, trainWhine, trainAirFilter, droneGain, dronePan, droneRotor, droneHarmonic, droneFlutter;
  let musicBus, effectsBus, ambienceBus;
  const sourceBuses = {}, mix = {volume: .7, music: true, ambience: true, effects: true};
  const isolated = {music: 1, motor: 1, train: 1, drone: 1, birds: 1, actions: 1};
  const targets = {motor: 0, road: 0, braking: 0, train: 0, drone: 0};
  let narrating = false;
  let requested = false, paused = false, destroyed = false, unavailable = false;
  let musicTimer, suspendTimer, chordIndex = 0, attempts = 0, nextStepTime = null, musicStep = 0, nextBirdTime = 1.5;
  let motion = 0, travelMode = 'car', lastState = '', motionTime = null, acceleration = 0, braking = 0, lastHornTime = -Infinity, lastImpactTime = -Infinity, lastBrakeTime = -Infinity, lastTransitionTime = -Infinity, lastPageTime = -Infinity, lastRaceCueTime = {}, activeRaceCues = 0, raceCueSlots = [], impactBuffer, skidBuffer, paperBuffer, activeImpacts = 0, activeTransitions = 0, brakeHeld = false;
  let environment = {trainDistance: Infinity, trainSpeed: 14, trainPan: 0, trainApproach: 0, droneDistance: Infinity, dronePan: 0, droneSpeed: 0, birdActivity: .6};
  let droneArmed = true, droneStart = -Infinity, droneUntil = -Infinity, droneRearmAt = 0, previousDroneDistance = Infinity, droneRelativeSpeed = 0;
  const sources = [], transients = new Set(), scoreNotes = new Set(), padPairs = [], listeners = new Set(), resumeTimers = new Map();
  const doc = typeof document === 'undefined' ? null : document;
  let muted = false;
  // Each new visit gets an entry-sound attempt. An explicit mute lasts for this page only.
  // Remove the old persisted value so a previous session cannot silently suppress activation.
  clearLegacyMute();
  const random = (() => {let seed = 731;return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;})();
  // D-major I–IV–V–I: open major/add9 voicings and a gently moving 100 BPM score.
  const chords = [
    [146.8324, 184.9972, 220.0000, 277.1826, 329.6276, 369.9944], // Dmaj9
    [97.9989, 195.9977, 246.9417, 293.6648, 369.9944, 440.0000], // Gmaj9
    [110.0000, 220.0000, 277.1826, 329.6276, 440.0000, 493.8833], // Aadd9
    [146.8324, 220.0000, 293.6648, 369.9944, 493.8833, 659.2551], // D6/9
  ];
  const arpVoicings = [
    [293.6648, 369.9944, 440.0000, 554.3653, 659.2551],
    [293.6648, 369.9944, 391.9954, 493.8833, 587.3295],
    [329.6276, 440.0000, 493.8833, 554.3653, 659.2551],
    [293.6648, 369.9944, 440.0000, 493.8833, 659.2551],
  ];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  restoreMix();
  const audioTime = () => offlineContext && clock ? clock() : context.currentTime;
  const proximity = (distance, range) => Number.isFinite(distance) ? Math.pow(clamp(1 - Math.max(0, distance) / range, 0, 1), 2) : 0;
  function restoreMix() {
    if (offlineContext) return;
    try {
      const saved = JSON.parse(window.localStorage?.getItem(MIX_KEY) || 'null');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
      if (Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 1) mix.volume = saved.volume;
      for (const key of ['music', 'ambience', 'effects']) if (typeof saved[key] === 'boolean') mix[key] = saved[key];
    } catch {} // Blocked storage or malformed JSON keeps the ordinary defaults.
  }
  function persistMix() {
    if (offlineContext) return;
    try {window.localStorage?.setItem(MIX_KEY, JSON.stringify(mix));} catch {}
  }
  function setMix(value = {}) {
    if (Number.isFinite(value.volume)) mix.volume = clamp(value.volume, 0, 1);
    for (const key of ['music', 'ambience', 'effects']) if (typeof value[key] === 'boolean') mix[key] = value[key];
    persistMix();applyMix();reconcile();return {...mix};
  }
  function applyMix() {
    if (!context || !musicBus) return;
    musicBus.gain.setTargetAtTime(Number(mix.music), audioTime(), .06);
    effectsBus.gain.setTargetAtTime(Number(mix.effects), audioTime(), .06);
    ambienceBus.gain.setTargetAtTime(Number(mix.ambience), audioTime(), .06);
    for (const [name, bus] of Object.entries(sourceBuses)) bus.gain.setTargetAtTime(isolated[name], audioTime(), .025);
  }
  function clearLegacyMute() {
    if (offlineContext) return;
    try {window.sessionStorage?.removeItem(MUTE_KEY);} catch {}
  }
  function isEnabled() {
    return !destroyed && requested && !muted && (offlineContext || !doc?.hidden) && (offlineContext || context?.state === 'running');
  }
  function state() {
    return {
      enabled: Boolean(isEnabled()), requested, muted,
      blocked: Boolean(requested && !muted && !destroyed && !unavailable && !doc?.hidden && context?.state !== 'running'),
      attempting: attempts > 0, contextState: context?.state || (unavailable ? 'unavailable' : 'uninitialized'),
      available: !unavailable && !destroyed, mix: {...mix},
    };
  }
  function notify() {
    const value = state(), serialized = JSON.stringify(value);
    if (serialized === lastState) return;
    lastState = serialized;
    for (const listener of listeners) {try {listener(value);} catch {}}
  }
  function reconcile() {
    if (context && master && context.state !== 'closed') {
      master.gain.setTargetAtTime(isEnabled() ? 0.5 * mix.volume * (narrating ? .22 : 1) : 0, audioTime(), isEnabled() ? 0.25 : 0.06);
    }
    notify();
  }
  function gain(value = 1) {const node = context.createGain();node.gain.value = value;return node;}
  function oscillator(frequency, type = 'sine', detune = 0) {
    const node = context.createOscillator();node.type = type;node.frequency.value = frequency;node.detune.value = detune;
    node.start();sources.push(node);return node;
  }
  function noiseBuffer(seconds, decay = false) {
    const length = Math.floor(context.sampleRate * seconds), buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (random() * 2 - 1) * (decay ? Math.pow(1 - i / length, 3.4) : 1);
    }
    return buffer;
  }
  function initialize() {
    if (context || destroyed || unavailable) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!offlineContext && !Audio) {unavailable = true;return;}
    try {context = offlineContext || new Audio();} catch {unavailable = true;return;}
    master = gain(0);
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -16;limiter.knee.value = 12;limiter.ratio.value = 5;
    master.connect(limiter).connect(context.destination);
    musicBus = gain(1);effectsBus = gain(1);ambienceBus = gain(1);
    musicBus.connect(master);effectsBus.connect(master);ambienceBus.connect(master);
    for (const name of Object.keys(isolated)) {
      sourceBuses[name] = gain(1);sourceBuses[name].connect(name === 'music' ? musicBus : ['motor','actions'].includes(name) ? effectsBus : ambienceBus);
    }
    scoreBus = gain(1.25);scoreBus.connect(sourceBuses.music);applyMix();
    if (context.createMediaStreamDestination) {
      recordDestination = context.createMediaStreamDestination();limiter.connect(recordDestination);
    }
    // The same graph survives suspended autoplay attempts and repeated gestures.
    context.addEventListener?.('statechange', reconcile);
    reverb = context.createConvolver();reverb.buffer = noiseBuffer(2.1, true);reverb.connect(gain(0.1)).connect(sourceBuses.music);
    delay = context.createDelay(2);delay.delayTime.value = 0.45;
    const feedback = gain(0.18), echoFilter = context.createBiquadFilter();
    echoFilter.type = 'lowpass';echoFilter.frequency.value = 2600;
    delay.connect(echoFilter).connect(feedback).connect(delay);echoFilter.connect(gain(0.13)).connect(sourceBuses.music);
    // Warm major harmony stays behind the plucked motif, leaving room for the vehicle.
    chords[0].forEach((hz, index) => {
      const voice = gain(index === 0 ? 0.023 : 0.013), filter = context.createBiquadFilter(), pan = context.createStereoPanner();
      filter.type = 'lowpass';filter.frequency.value = 1150 + index * 180;
      pan.pan.value = (index % 2 ? 1 : -1) * (0.25 + index * 0.08);
      const a = oscillator(hz, index === 0 ? 'triangle' : 'sine', -3), b = oscillator(hz, 'sine', 3);
      a.connect(voice);b.connect(gain(0.38)).connect(voice);padPairs.push([a,b]);
      oscillator(0.045 + index * 0.013).connect(gain(index === 0 ? 0.004 : 0.003)).connect(voice.gain);
      voice.connect(filter).connect(pan);pan.connect(scoreBus);pan.connect(reverb);
    });
    const wind = context.createBufferSource();wind.buffer = noiseBuffer(5);wind.loop = true;sources.push(wind);
    // Noise is a reusable source for brief motion cues only. No always-on breeze/hiss.
    trainGain = gain(0);const rumble = context.createBiquadFilter();rumble.type = 'lowpass';rumble.frequency.value = 230;
    wind.connect(rumble).connect(trainGain).connect(sourceBuses.motor);
    // Tire texture and a higher, airy regenerative-braking band share the original noise source.
    roadFilter = context.createBiquadFilter();roadFilter.type = 'bandpass';roadFilter.frequency.value = 600;roadFilter.Q.value = 0.45;
    roadGain = gain(0);wind.connect(roadFilter).connect(roadGain).connect(sourceBuses.motor);
    regenFilter = context.createBiquadFilter();regenFilter.type = 'bandpass';regenFilter.frequency.value = 1800;regenFilter.Q.value = 0.7;
    regenGain = gain(0);wind.connect(regenFilter).connect(regenGain).connect(sourceBuses.motor);wind.start();
    // An electric spacecraft: a beating sine pair, warm sub-body, glassy fifth,
    // and gentle frequency modulation. Smooth acceleration replaces combustion/gear shifts.
    motor = oscillator(170, 'sine', -4);motorHarmonic = oscillator(255, 'sine', 4);
    motorLow = oscillator(85, 'triangle');motorMechanical = oscillator(341, 'sine', -3);
    motorGain = gain(0);harmonicGain = gain(0);lowGain = gain(0);mechanicalGain = gain(0);
    motorFilter = context.createBiquadFilter();motorFilter.type = 'lowpass';motorFilter.frequency.value = 2400;
    motor.connect(motorGain).connect(motorFilter);motorHarmonic.connect(harmonicGain).connect(motorFilter);
    motorLow.connect(lowGain).connect(motorFilter);motorMechanical.connect(mechanicalGain).connect(motorFilter);motorFilter.connect(sourceBuses.motor);
    motorModulation = oscillator(3.2);motorModulationDepth = gain(1.5);
    motorModulation.connect(motorModulationDepth);motorModulationDepth.connect(motor.frequency);motorModulationDepth.connect(motorHarmonic.frequency);
    // A passing electric train has broad wheel/air texture and a rising traction tone.
    trainPassGain = gain(0);trainPassPan = context.createStereoPanner();trainPassGain.connect(trainPassPan).connect(sourceBuses.train);
    const passRumble = context.createBiquadFilter();passRumble.type = 'lowpass';passRumble.frequency.value = 420;
    wind.connect(passRumble).connect(gain(.1)).connect(trainPassGain);
    trainAirFilter = context.createBiquadFilter();trainAirFilter.type = 'bandpass';trainAirFilter.frequency.value = 1200;trainAirFilter.Q.value = .4;
    wind.connect(trainAirFilter).connect(gain(.025)).connect(trainPassGain);
    trainTraction = oscillator(185, 'triangle');trainWhine = oscillator(555, 'sine', 3);
    trainTraction.connect(gain(.04)).connect(trainPassGain);trainWhine.connect(gain(.01)).connect(trainPassGain);
    // Delivery drones use a soft passing tone, without the old helicopter-like flutter.
    droneGain = gain(0);dronePan = context.createStereoPanner();droneGain.connect(dronePan).connect(sourceBuses.drone);
    const rotorFilter = context.createBiquadFilter(), rotorEnvelope = gain(.035);rotorFilter.type = 'lowpass';rotorFilter.frequency.value = 1100;
    droneRotor = oscillator(220, 'sine', -4);droneHarmonic = oscillator(443, 'triangle', 4);
    droneRotor.connect(rotorFilter);droneHarmonic.connect(gain(.22)).connect(rotorFilter);rotorFilter.connect(rotorEnvelope).connect(droneGain);
    droneFlutter = oscillator(5);droneFlutter.connect(gain(.003)).connect(rotorEnvelope.gain);
    motionTime = audioTime();nextBirdTime = audioTime() + 1.5;updateMotion();
    if (!manualScheduling) musicTimer = setInterval(() => {updateMotion();scheduleScore();scheduleBirds();}, 75);
  }
  function scoreNote(frequency, time, amplitude, duration, type = 'sine', panValue = 0) {
    const note = context.createOscillator(), envelope = gain(0), pan = context.createStereoPanner();
    note.type = type;note.frequency.value = frequency;pan.pan.value = panValue;
    envelope.gain.setValueAtTime(0, time);envelope.gain.linearRampToValueAtTime(amplitude, time + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    note.connect(envelope).connect(pan);pan.connect(scoreBus);pan.connect(delay);pan.connect(reverb);
    transients.add(note);scoreNotes.add(note);
    note.onended = () => {transients.delete(note);scoreNotes.delete(note);note.disconnect();envelope.disconnect();pan.disconnect();};
    note.start(time);note.stop(time + duration + 0.05);
  }
  function scheduleScore() {
    if (!isEnabled() || !mix.music) {nextStepTime = null;return;}
    if (nextStepTime === null || nextStepTime < audioTime() - 0.3) nextStepTime = audioTime() + 0.025;
    const pattern = [0, null, 2, 4, 1, null, 3, 2];
    // Audio-clock scheduling keeps the pulse even when rendering briefly occupies the main thread.
    while (nextStepTime < audioTime() + 0.18) {
      const step = musicStep % 32;chordIndex = Math.floor(musicStep / 32) % chords.length;
      if (step === 0) padPairs.forEach((pair, index) => pair.forEach(voice => voice.frequency.setTargetAtTime(chords[chordIndex][index], nextStepTime, 0.65)));
      const degree = pattern[step % pattern.length];
      if (degree !== null) scoreNote(arpVoicings[chordIndex][degree], nextStepTime, step % 8 === 0 ? 0.027 : 0.019, 0.46, 'triangle', step % 4 < 2 ? -0.26 : 0.26);
      if (step % 2 === 0) scoreNote(73.4162, nextStepTime, 0.015, 0.13, 'sine');
      if (step % 4 === 0) scoreNote(chords[chordIndex][0], nextStepTime, 0.02, 0.28, 'triangle');
      musicStep++;nextStepTime += 0.3;
    }
  }
  function stopScore() {
    nextStepTime = null;
    for (const note of scoreNotes) {try {note.stop(audioTime() + 0.01);} catch {}}
  }
  function scheduleBirds() {
    if (!isEnabled() || !mix.ambience || paused || audioTime() < nextBirdTime) return;
    nextBirdTime = audioTime() + 9 + random() * 8;
    if (environment.birdActivity <= 0) return;
    const panValue = (random() - .5) * 1.5, pitch = 1850 + random() * 550;
    // A short paired coastal-bird call; irregular spacing keeps it from competing with the score.
    for (let i = 0; i < 2; i++) {
      const time = audioTime() + .025 + i * .19, note = context.createOscillator(), envelope = gain(0), pan = context.createStereoPanner();
      note.type = 'sine';pan.pan.value = panValue;
      note.frequency.setValueAtTime(pitch, time);note.frequency.exponentialRampToValueAtTime(pitch * (i ? 1.32 : 1.55), time + .055);note.frequency.exponentialRampToValueAtTime(pitch * .94, time + .145);
      envelope.gain.setValueAtTime(0, time);envelope.gain.linearRampToValueAtTime(.012 * environment.birdActivity, time + .015);envelope.gain.exponentialRampToValueAtTime(.0001, time + .16);
      note.connect(envelope).connect(pan);pan.connect(sourceBuses.birds);transients.add(note);
      note.onended = () => {transients.delete(note);note.disconnect();envelope.disconnect();pan.disconnect();};
      note.start(time);note.stop(time + .18);
    }
  }
  function updateMotion() {
    if (!context || !motor) return;
    const speed = Math.abs(motion), normalized = Math.min(speed / 24, 1), level = paused ? 0 : Math.sqrt(normalized);
    const load = Math.max(0, Math.min(1, acceleration / 12)), regen = paused ? 0 : Math.max(0, Math.min(1, braking)), train = travelMode === 'train';
    const hoverLevel = paused || speed < .15 ? 0 : level;
    const pitch = train ? 105 + normalized * 100 : 170 + normalized * 430 + load * 35;
    motor.frequency.setTargetAtTime(pitch, audioTime(), 0.09);
    motorHarmonic.frequency.setTargetAtTime(pitch * (train ? 1.5 : 1.498), audioTime(), 0.11);
    motorLow.frequency.setTargetAtTime(pitch * 0.5, audioTime(), 0.1);
    motorMechanical.frequency.setTargetAtTime(pitch * (train ? 2 : 2.005), audioTime(), 0.12);
    motorModulation.frequency.setTargetAtTime(2 + normalized * 3, audioTime(), .2);motorModulationDepth.gain.setTargetAtTime(.5 + normalized * 1.5 + load, audioTime(), .15);
    motorFilter.frequency.setTargetAtTime(1500 + normalized * 1400 + load * 400, audioTime(), 0.08);
    motorGain.gain.setTargetAtTime(hoverLevel * (train ? 0.008 : 0.018) * (0.85 + load * 0.15), audioTime(), 0.045);
    harmonicGain.gain.setTargetAtTime(hoverLevel * (train ? 0.004 : 0.008) * (0.85 + load * 0.15), audioTime(), 0.05);
    lowGain.gain.setTargetAtTime(hoverLevel * (train ? 0.005 : 0.012), audioTime(), 0.055);
    mechanicalGain.gain.setTargetAtTime(hoverLevel * (train ? 0.002 : 0.004), audioTime(), 0.045);
    targets.motor = hoverLevel * (train ? .019 : .042);
    scoreBus.gain.setTargetAtTime(1.25 - (!train ? level * load * 0.18 : 0), audioTime(), 0.2);
    roadFilter.frequency.setTargetAtTime(420 + normalized * 1400, audioTime(), 0.14);
    targets.road = paused || speed < .4 ? 0 : Math.pow(normalized, 1.3) * (train ? 0.008 : 0.006);
    roadGain.gain.setTargetAtTime(targets.road, audioTime(), 0.16);
    regenFilter.frequency.setTargetAtTime(1800 + regen * 2000, audioTime(), 0.08);
    targets.braking = speed < .4 ? 0 : regen * Math.min(1, speed / 6) * .012;
    regenGain.gain.setTargetAtTime(targets.braking, audioTime(), regen > 0 ? 0.05 : 0.18);
    trainGain.gain.setTargetAtTime(train ? level * 0.025 : 0, audioTime(), 0.3);
    const trainProximity = paused || train || environment.trainSpeed < .4 ? 0 : proximity(environment.trainDistance, 24) * .6;
    targets.train = trainProximity < .025 ? 0 : trainProximity;
    const doppler = 1 + clamp(environment.trainApproach, -1, 1) * .12, tractionPitch = (160 + environment.trainSpeed * 5.5) * doppler;
    trainPassGain.gain.setTargetAtTime(targets.train, audioTime(), .12);trainPassPan.pan.setTargetAtTime(environment.trainPan, audioTime(), .15);
    trainTraction.frequency.setTargetAtTime(tractionPitch, audioTime(), .18);trainWhine.frequency.setTargetAtTime(tractionPitch * 3.01, audioTime(), .18);
    trainAirFilter.frequency.setTargetAtTime(950 + environment.trainSpeed * 35, audioTime(), .2);
    const time = audioTime();
    if (environment.droneDistance > 10 && time >= droneRearmAt) droneArmed = true;
    if (paused || !mix.ambience) droneUntil = -Infinity;
    else if (droneArmed && environment.droneDistance < 8 && (environment.droneSpeed > .18 || droneRelativeSpeed > .3 || speed > 1)) {
      droneArmed = false;droneStart = time;droneUntil = time + 1.6;droneRearmAt = time + 12;
    }
    const passEnvelope = clamp((time - droneStart) / .16, 0, 1) * clamp((droneUntil - time) / .35, 0, 1);
    const droneLevel = !paused && mix.ambience ? proximity(environment.droneDistance, 8) * .35 * passEnvelope : 0;
    targets.drone = droneLevel < .015 ? 0 : droneLevel;
    droneGain.gain.setTargetAtTime(targets.drone, time, .06);dronePan.pan.setTargetAtTime(environment.dronePan, time, .15);
    droneRotor.frequency.setTargetAtTime(205 + environment.droneSpeed * 4, time, .17);droneHarmonic.frequency.setTargetAtTime(413 + environment.droneSpeed * 8, time, .17);droneFlutter.frequency.setTargetAtTime(4 + environment.droneSpeed * .15, time, .2);
  }
  // Optional environment telemetry uses world-unit distances and stereo pan [-1,1].
  // Train fades out at 24 units. Drone passes require motion within 8 units, last
  // at most 1.6s, and must leave 10 units plus a 12s cooldown before rearming.
  // trainApproach [-1,1] is inferred when omitted; birdActivity [0,1] defaults to .6.
  function setMotion(speed, mode = 'car', telemetry = {}) {
    const next = Number.isFinite(speed) ? speed : 0;
    const now = context ? audioTime() : ((typeof performance === 'undefined' ? Date.now() : performance.now()) / 1000);
    const elapsed = motionTime === null ? 0.12 : Math.max(0.04, Math.min(0.5, now - motionTime));
    const inferred = (Math.abs(next) - Math.abs(motion)) / elapsed;
    acceleration = Math.max(-24, Math.min(24, Number.isFinite(telemetry.acceleration) ? telemetry.acceleration : inferred));
    const explicitBrake = typeof telemetry.braking === 'boolean' ? Number(telemetry.braking) : telemetry.braking;
    braking = Number.isFinite(explicitBrake) ? Math.max(0, Math.min(1, explicitBrake)) : (Math.abs(motion) > 1 ? Math.max(0, Math.min(1, -acceleration / 12)) : 0);
    const distance = value => Number.isFinite(value) ? Math.max(0, value) : Infinity;
    const trainDistance = distance(telemetry.trainDistance), approach = Number.isFinite(environment.trainDistance) && Number.isFinite(trainDistance) ? (environment.trainDistance - trainDistance) / elapsed / 18 : 0;
    const droneDistance = distance(telemetry.droneDistance);
    droneRelativeSpeed = Number.isFinite(droneDistance) && Number.isFinite(previousDroneDistance) ? Math.abs(droneDistance - previousDroneDistance) / elapsed : 0;previousDroneDistance = droneDistance;
    environment = {
      trainDistance, trainSpeed: clamp(Number.isFinite(telemetry.trainSpeed) ? Math.abs(telemetry.trainSpeed) : 14, 0, 35),
      trainPan: clamp(Number.isFinite(telemetry.trainPan) ? telemetry.trainPan : 0, -1, 1), trainApproach: clamp(Number.isFinite(telemetry.trainApproach) ? telemetry.trainApproach : approach, -1, 1),
      droneDistance, dronePan: clamp(Number.isFinite(telemetry.dronePan) ? telemetry.dronePan : 0, -1, 1),
      droneSpeed: clamp(Number.isFinite(telemetry.droneSpeed) ? Math.abs(telemetry.droneSpeed) : 0, 0, 14), birdActivity: clamp(Number.isFinite(telemetry.birdActivity) ? telemetry.birdActivity : .6, 0, 1),
    };
    const brakeEdge = explicitBrake >= .5 && !brakeHeld && Math.max(Math.abs(motion), Math.abs(next)) > 1.5;
    brakeHeld = explicitBrake >= .5;
    motion = next;travelMode = mode;motionTime = now;updateMotion();
    if (brakeEdge && mode !== 'train') brake(Math.min(1, Math.max(Math.abs(next), Math.abs(next - inferred * elapsed)) / 12));
  }
  async function horn() {
    if (!mix.effects || !await attemptStart(false) || paused || audioTime() - lastHornTime < 0.22) return false;
    const time = audioTime();lastHornTime = time;
    const filter = context.createBiquadFilter();filter.type = 'lowpass';filter.frequency.value = 1700;
    const envelope = gain(0);filter.connect(envelope).connect(sourceBuses.actions);
    envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(0.075,time + 0.015);
    envelope.gain.setValueAtTime(0.075,time + 0.13);envelope.gain.exponentialRampToValueAtTime(0.0001,time + 0.34);
    const notes = travelMode === 'train' ? [220,293.6648] : [349.2282,440];
    let finished = 0;
    for (const frequency of notes) {
      const note = context.createOscillator();note.type = 'sawtooth';note.frequency.value = frequency;note.connect(filter);transients.add(note);
      note.onended = () => {transients.delete(note);note.disconnect();if (++finished === notes.length) {filter.disconnect();envelope.disconnect();}};
      note.start(time);note.stop(time + 0.36);
    }
    return true;
  }
  async function impact(intensity = 1) {
    const strength = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
    if (!strength || !mix.effects || paused || (!isEnabled() && !await attemptStart(false))) return false;
    if (activeImpacts >= 2 || audioTime() - lastImpactTime < .2) return false;
    const time = audioTime();lastImpactTime = time;
    // A cannon-like pressure crack drops into a deep powder boom. The tail is
    // finite and two simultaneous hits share the same mastered output.
    impactBuffer ||= noiseBuffer(1.05, true);activeImpacts++;
    const noise = context.createBufferSource(), note = context.createOscillator(), crack = context.createOscillator();noise.buffer = impactBuffer;
    const filter = context.createBiquadFilter(), body = gain(.98), debris = gain(.22), envelope = gain(0);
    filter.type = 'lowpass';filter.frequency.setValueAtTime(5000, time);filter.frequency.exponentialRampToValueAtTime(180, time + .8);filter.Q.value = .7;
    note.type = 'sine';note.frequency.setValueAtTime(116 + strength * 42, time);note.frequency.exponentialRampToValueAtTime(37, time + .68);
    crack.type = 'triangle';crack.frequency.setValueAtTime(370 + strength * 70, time);crack.frequency.exponentialRampToValueAtTime(76, time + .18);
    noise.connect(filter).connect(envelope);note.connect(body).connect(envelope);crack.connect(debris).connect(envelope);envelope.connect(sourceBuses.actions);
    const peak = .22 + strength * .16;
    envelope.gain.setValueAtTime(0, time);envelope.gain.linearRampToValueAtTime(peak, time + .003);
    envelope.gain.exponentialRampToValueAtTime(peak * .34, time + .16);envelope.gain.exponentialRampToValueAtTime(.0001, time + 1);
    let finished = 0;
    for (const source of [noise, note, crack]) {
      transients.add(source);source.onended = () => {
        transients.delete(source);source.disconnect();
        if (++finished === 3) {activeImpacts = Math.max(0, activeImpacts - 1);filter.disconnect();body.disconnect();debris.disconnect();envelope.disconnect();}
      };
      source.start(time);source.stop(time + 1.05);
    }
    return true;
  }
  async function brake(intensity = 1) {
    const strength = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
    if (!strength || !mix.effects || paused || (!isEnabled() && !await attemptStart(false))) return false;
    const time = audioTime();if (time - lastBrakeTime < .55) return false;lastBrakeTime = time;
    // One sharp tire squeal with a heavy suspension knock. Holding the brake
    // cannot create a perpetual hiss; every source ends within half a second.
    skidBuffer ||= noiseBuffer(.5, true);
    const noise = context.createBufferSource(), squeal = context.createOscillator(), knock = context.createOscillator();noise.buffer = skidBuffer;
    const band = context.createBiquadFilter(), envelope = gain(0), squealGain = gain(.46), knockGain = gain(.5);
    band.type = 'bandpass';band.frequency.setValueAtTime(2100, time);band.frequency.exponentialRampToValueAtTime(650, time + .4);band.Q.value = 1.6;
    squeal.type = 'triangle';squeal.frequency.setValueAtTime(970 + strength * 250, time);squeal.frequency.exponentialRampToValueAtTime(430, time + .42);
    knock.type = 'sine';knock.frequency.setValueAtTime(135, time);knock.frequency.exponentialRampToValueAtTime(43, time + .13);
    noise.connect(band).connect(envelope);squeal.connect(squealGain).connect(envelope);knock.connect(knockGain).connect(envelope);envelope.connect(sourceBuses.actions);
    envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(.12 + strength * .12,time + .008);envelope.gain.exponentialRampToValueAtTime(.0001,time + .47);
    let finished = 0;
    for (const source of [noise,squeal,knock]) {
      transients.add(source);source.onended = () => {transients.delete(source);source.disconnect();if (++finished === 3) {band.disconnect();envelope.disconnect();squealGain.disconnect();knockGain.disconnect();}};
      source.start(time);source.stop(time + .5);
    }
    return true;
  }
  async function transition(kind) {
    if (!['focus','reveal'].includes(kind) || !mix.effects || paused || (!isEnabled() && !await attemptStart(false))) return false;
    const time = audioTime();if (activeTransitions >= 2 || time - lastTransitionTime < .12) return false;lastTransitionTime = time;activeTransitions++;
    const reveal = kind === 'reveal', duration = reveal ? 1.65 : 1.45;
    const noise = context.createBufferSource(), bass = context.createOscillator(), chime = context.createOscillator();noise.buffer = noiseBuffer(duration, false);
    const filter = context.createBiquadFilter(), envelope = gain(0), windGain = gain(.3), bassGain = gain(.4), chimeGain = gain(.22), pan = context.createStereoPanner();
    filter.type = 'bandpass';filter.Q.value = .65;
    filter.frequency.setValueAtTime(reveal ? 380 : 1800,time);filter.frequency.exponentialRampToValueAtTime(reveal ? 2600 : 420,time + duration * .76);
    bass.type = 'sine';bass.frequency.setValueAtTime(reveal ? 146.8324 : 220,time);bass.frequency.exponentialRampToValueAtTime(reveal ? 293.6648 : 73.4162,time + duration * .84);
    chime.type = 'sine';chime.frequency.setValueAtTime(reveal ? 440 : 880,time);chime.frequency.exponentialRampToValueAtTime(reveal ? 659.2551 : 293.6648,time + duration * .84);
    pan.pan.setValueAtTime(reveal ? -.28 : .28,time);pan.pan.linearRampToValueAtTime(reveal ? .28 : -.28,time + duration);
    noise.connect(filter).connect(windGain).connect(envelope);bass.connect(bassGain).connect(envelope);chime.connect(chimeGain).connect(envelope);envelope.connect(pan).connect(sourceBuses.actions);
    envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(reveal ? .19 : .16,time + duration * .3);envelope.gain.exponentialRampToValueAtTime(.0001,time + duration);
    let finished = 0;
    for (const source of [noise,bass,chime]) {
      transients.add(source);source.onended = () => {transients.delete(source);source.disconnect();if (++finished === 3) {activeTransitions--;filter.disconnect();envelope.disconnect();windGain.disconnect();bassGain.disconnect();chimeGain.disconnect();pan.disconnect();}};
      source.start(time);source.stop(time + duration + .04);
    }
    return true;
  }
  async function pageTurn() {
    if (!mix.effects || paused || (!isEnabled() && !await attemptStart(false))) return false;
    const time=audioTime();if(time-lastPageTime<.24)return false;lastPageTime=time;
    // Three small rustles follow the flex, turn and settling of a paper sheet.
    paperBuffer ||= noiseBuffer(.42);
    const paper=context.createBufferSource(),high=context.createBiquadFilter(),low=context.createBiquadFilter(),envelope=gain(0),pan=context.createStereoPanner();
    paper.buffer=paperBuffer;high.type='highpass';high.frequency.value=420;low.type='lowpass';low.Q.value=.5;
    low.frequency.setValueAtTime(1800,time);low.frequency.linearRampToValueAtTime(3100,time+.13);low.frequency.linearRampToValueAtTime(1050,time+.4);
    pan.pan.setValueAtTime(-.25,time);pan.pan.linearRampToValueAtTime(.25,time+.38);
    envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(.13,time+.025);envelope.gain.linearRampToValueAtTime(.035,time+.08);
    envelope.gain.linearRampToValueAtTime(.18,time+.14);envelope.gain.linearRampToValueAtTime(.015,time+.23);envelope.gain.linearRampToValueAtTime(.065,time+.29);envelope.gain.exponentialRampToValueAtTime(.0001,time+.4);
    paper.connect(high).connect(low).connect(envelope).connect(pan).connect(sourceBuses.actions);transients.add(paper);
    paper.onended=()=>{transients.delete(paper);for(const node of [paper,high,low,envelope,pan])node.disconnect();};paper.start(time);paper.stop(time+.42);return true;
  }
  async function raceCue(type) {
    const phrases = {
      countdown:[[440,0,.22]], go:[[659.2551,0,.12],[880,.11,.35]],
      lap:[[587.3295,0,.13],[739.9888,.12,.13],[880,.24,.28]],
      finish:[[587.3295,0,.16],[739.9888,.14,.16],[880,.28,.18],[1174.659,.48,.65]],
      bump:[[110,0,.13]],
      pad:[[493.8833,0,.14],[659.2551,.08,.16],[987.7666,.18,.3]],
      robot:[[392,0,.1],[311.127,.12,.11],[440,.25,.13]],
    };
    if (!phrases[type] || !mix.effects || paused || (!isEnabled() && !await attemptStart(false))) return false;
    const time=audioTime();raceCueSlots=raceCueSlots.filter(slot=>slot.until>time);activeRaceCues=raceCueSlots.length;
    if (time-(lastRaceCueTime[type]??-Infinity)<.12 || activeRaceCues>=4) return false;lastRaceCueTime[type]=time;
    const slot={until:time+Math.max(...phrases[type].map(([,offset,duration])=>offset+duration+.025))};raceCueSlots.push(slot);activeRaceCues=raceCueSlots.length;
    let remaining=phrases[type].length;
    for (const [frequency,offset,duration] of phrases[type]) {
      const note=context.createOscillator(),envelope=gain(0),start=time+offset;
      note.type=type==='bump'||type==='robot'?'triangle':'sine';note.frequency.value=frequency;
      if(type==='pad'){note.frequency.setValueAtTime(frequency*.85,start);note.frequency.exponentialRampToValueAtTime(frequency*1.24,start+duration);}
      envelope.gain.setValueAtTime(0,start);envelope.gain.linearRampToValueAtTime(type==='go'?.15:type==='robot'?.055:.11,start+.009);envelope.gain.exponentialRampToValueAtTime(.0001,start+duration);
      note.connect(envelope).connect(sourceBuses.actions);transients.add(note);
      note.onended=()=>{transients.delete(note);note.disconnect();envelope.disconnect();if(--remaining===0){raceCueSlots=raceCueSlots.filter(value=>value!==slot);activeRaceCues=raceCueSlots.length;}};
      note.start(start);note.stop(start+duration+.025);
    }
    return true;
  }
  function attemptStart(explicit = false) {
    if (destroyed || unavailable) return Promise.resolve(false);
    if (explicit) {muted = false;clearLegacyMute();}
    if (muted) {notify();return Promise.resolve(false);}
    requested = true;clearTimeout(suspendTimer);initialize();
    if (offlineContext) {reconcile();return Promise.resolve(Boolean(isEnabled()));}
    if (!context || unavailable || doc?.hidden) {reconcile();return Promise.resolve(false);}
    if (context.state === 'running') {reconcile();return Promise.resolve(true);}
    // A blocked browser may leave resume() pending until activation. Never strand UI on that promise.
    // Calling resume again inside a later gesture is deliberate; it does not rebuild the graph.
    attempts++;notify();
    let resume;
    try {resume = Promise.resolve(context.resume());} catch {resume = Promise.reject(new Error('Audio resume failed.'));}
    return new Promise(resolve => {
      let complete = false;
      const finish = () => {
        if (complete) return;
        complete = true;clearTimeout(timer);resumeTimers.delete(timer);attempts = Math.max(0, attempts - 1);reconcile();resolve(Boolean(isEnabled()));
      };
      const timer = setTimeout(finish, RESUME_TIMEOUT);resumeTimers.set(timer, finish);
      resume.then(() => {reconcile();finish();}, finish);
    });
  }
  function mute() {
    requested = false;muted = true;clearLegacyMute();clearTimeout(suspendTimer);stopScore();reconcile();
    if (context && context.state !== 'closed') suspendTimer = setTimeout(() => {if (muted && !destroyed) context.suspend().catch(() => {});}, 300);
    return false;
  }
  function onVisibility() {
    if (!context || destroyed || offlineContext) return;
    if (doc.hidden) {
      stopScore();master.gain.cancelScheduledValues(audioTime());master.gain.setValueAtTime(0, audioTime());
      context.suspend().catch(() => {});notify();
    } else if (requested && !muted) attemptStart();
  }
  doc?.addEventListener('visibilitychange', onVisibility);
  return {
    start: () => attemptStart(false),
    enable: () => attemptStart(true),
    mute,
    toggle: () => isEnabled() ? Promise.resolve(mute()) : attemptStart(true),
    isEnabled: () => Boolean(isEnabled()), state,
    setMix, getMix: () => ({...mix}),
    diagnostics: () => ({mix: {...mix}, targets: {...targets}, droneActive: targets.drone > 0, narrating, activeImpacts, activeTransitions, activeRaceCues, isolated: {...isolated}}),
    // Deterministic offline QA uses the identical graph with an explicit audio clock.
    diagnosticTick() {if (offlineContext) {updateMotion();scheduleScore();scheduleBirds();}},
    isolateSources(names) {if (!offlineContext) return;for (const name of Object.keys(isolated)) {isolated[name] = Number(names.includes(name));sourceBuses[name].gain.cancelScheduledValues(audioTime());sourceBuses[name].gain.setValueAtTime(isolated[name], audioTime());}},
    subscribe(listener) {listeners.add(listener);listener(state());return () => listeners.delete(listener);},
    // A clone gives each recorder ownership of its tracks without ending later recordings.
    getStream(clone = true) {return clone ? (recordDestination?.stream?.clone?.() || null) : (recordDestination?.stream || null);},
    setMotion, horn, impact, brake, transition, pageTurn, raceCue,
    setPaused(value) {paused = Boolean(value);updateMotion();},
    setNarrating(value) {const next=Boolean(value);if(next!==narrating){narrating=next;reconcile();}},
    destroy() {
      destroyed = true;requested = false;clearInterval(musicTimer);clearTimeout(suspendTimer);
      for (const finish of [...resumeTimers.values()]) finish();resumeTimers.clear();
      doc?.removeEventListener('visibilitychange', onVisibility);context?.removeEventListener?.('statechange', reconcile);
      for (const source of [...sources,...transients]) {try {source.stop();} catch {}}transients.clear();
      recordDestination?.stream?.getTracks().forEach(track => track.stop());context?.close?.()?.catch(() => {});notify();listeners.clear();
    },
  };
}
