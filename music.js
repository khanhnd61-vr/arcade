// Background music for the Play section: a small jukebox of tracks shared by
// the dungeon and the games. Nothing is fetched until a track is switched on,
// so the page never downloads music for people who never ask for it. The
// jukebox in the dungeon lobby (dungeon.js) picks tracks through the
// window.arcadeMusic API below; the control in the bottom-left corner plays
// and pauses the current one. The volume, the chosen track and whether to
// loop it or play them all in turn are remembered in this browser; whether
// the music is on is not. Playback carries on while the tab is in the background.
(() => {
  const root = document.querySelector('[data-music]');
  if (!root) return;

  // Files live in the folder named on the root element.
  const TRACKS = [
    { file: 'a-lonely-cherry-tree.mp3', title: 'A Lonely Cherry Tree' },
    { file: 'no-destination.mp3', title: 'No Destination' },
    { file: 'no-muscle-no-problem.mp3', title: 'No Muscle, No Problem' },
    { file: 'no-worries.mp3', title: 'No Worries' },
  ];
  const VOLUME_KEY = 'play-volume';
  const TRACK_KEY = 'play-track';
  const MODE_KEY = 'play-mode';
  const folder = root.dataset.music;
  const btn = root.querySelector('[data-toggle]');
  const label = root.querySelector('[data-label]');
  const slider = root.querySelector('[data-volume]');
  const audio = new Audio();
  audio.preload = 'none';

  const load = (key, fallback) => {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  };
  const save = (key, value) => {
    try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ }
  };

  let index = Math.min(TRACKS.length - 1, Math.max(0, Number(load(TRACK_KEY, 0)) || 0));
  let mode = load(MODE_KEY, 'one') === 'all' ? 'all' : 'one'; // one: loop this track; all: play them in turn
  let loadedIndex = -1; // the track the audio element holds
  const listeners = new Set();

  const notify = () => listeners.forEach((cb) => cb(api));
  const show = () => {
    const on = !audio.paused;
    root.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    label.textContent = on ? TRACKS[index].title : 'Music off';
    btn.title = on ? `Playing ${TRACKS[index].title}` : `Play ${TRACKS[index].title}`;
  };
  const refresh = () => {
    show();
    notify();
  };

  const play = (i = index) => {
    if (i !== loadedIndex) {
      audio.src = `${folder}/${TRACKS[i].file}`;
      loadedIndex = i;
    }
    index = i;
    save(TRACK_KEY, i);
    audio.loop = mode === 'one';
    // Show "on" at once while the track buffers; drop back if the browser refuses.
    root.classList.add('is-on');
    label.textContent = TRACKS[i].title;
    audio.play().catch(refresh);
    refresh();
  };
  const stop = () => audio.pause();
  const setVolume = (v) => {
    audio.volume = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    slider.value = Math.round(audio.volume * 100);
    save(VOLUME_KEY, audio.volume);
    notify();
  };
  const setMode = (m) => {
    mode = m === 'all' ? 'all' : 'one';
    save(MODE_KEY, mode);
    audio.loop = mode === 'one';
    notify();
  };

  const api = {
    tracks: TRACKS,
    get index() { return index; },
    get mode() { return mode; },
    get playing() { return !audio.paused; },
    get volume() { return audio.volume; },
    setVolume,
    play,
    stop,
    toggle: () => (audio.paused ? play() : stop()),
    setMode,
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  window.arcadeMusic = api;

  audio.volume = (() => {
    const v = Number(load(VOLUME_KEY, 0.5));
    return Number.isFinite(v) && v > 0 ? Math.min(1, v) : 0.5;
  })();
  slider.value = Math.round(audio.volume * 100);
  show();

  btn.addEventListener('click', api.toggle);
  slider.addEventListener('input', () => setVolume(slider.value / 100));
  audio.addEventListener('play', refresh);
  audio.addEventListener('pause', refresh);
  // In "all" mode the next track follows; in "one" mode the element loops and never ends.
  audio.addEventListener('ended', () => {
    if (mode === 'all') play((index + 1) % TRACKS.length);
  });
})();
