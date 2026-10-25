import type { AudioEngine } from './engine';

/**
 * The player's controls for sound (docs/audio.md): key M mutes (Shift+M is the perf readout), a toggle and a volume
 * slider in the help line at the bottom, a chip in the top bar, and a small "sound on" note the first time sound
 * starts. The keys and elements are bound here; the engine holds the state and keeps it in localStorage.
 */
export interface KeyTarget { addEventListener(t: 'keydown', f: (e: any) => void): void }

/** M toggles the mute. Not while typing, not with Ctrl, Cmd, Alt or Shift (Shift+M is the perf readout), not on key repeat. */
export function bindMuteKey(win: KeyTarget, eng: AudioEngine, onToggle: (muted: boolean) => void) {
  win.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
    const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    onToggle(eng.toggleMute());
  });
}

/**
 * Shift+S toggles the audio readout (readout.ts). Not while typing, not with Ctrl, Cmd or Alt, not on key repeat. S alone pans the camera back
 * (WASD), so this listens in the capture phase and stops the press there: the camera does not creep while the key is down.
 */
export function bindReadoutKey(win: { addEventListener(t: 'keydown', f: (e: any) => void, capture?: boolean): void }, toggle: () => void) {
  win.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyS' || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.stopPropagation();
    if (!e.repeat) toggle();
  }, true);
}

export interface ControlEls {
  /** the "sound" checkbox (checked = sound on) */
  toggle: HTMLInputElement | null;
  /** the 0..100 slider */
  slider: HTMLInputElement | null;
  /** the top-bar chip */
  chip: HTMLElement | null;
  /** where the first-time note goes */
  mount: HTMLElement | null;
}

export function bindControls(eng: AudioEngine, els: ControlEls) {
  const sync = () => {
    if (els.toggle) els.toggle.checked = !eng.muted;
    if (els.slider) { els.slider.value = String(Math.round(eng.volume * 100)); els.slider.disabled = eng.muted; }
    if (els.chip) { els.chip.classList.toggle('on', !eng.muted); els.chip.textContent = eng.muted ? 'sound off' : 'sound'; }
  };
  els.toggle?.addEventListener('change', () => eng.setMuted(!els.toggle!.checked));
  els.slider?.addEventListener('input', () => eng.setVolume(Number(els.slider!.value) / 100));
  els.chip?.addEventListener('click', () => eng.toggleMute());
  eng.onChange(sync);
  sync();

  // the first-time note: shown when sound first starts, until dismissed or ten seconds
  if (!eng.chipSeen && els.mount) {
    eng.whenReady(() => {
      if (eng.chipSeen || eng.muted || !els.mount) return;
      const note = document.createElement('div');
      note.id = 'soundNote'; note.className = 'toast info'; note.style.animation = 'none'; note.style.pointerEvents = 'auto';
      note.innerHTML = 'Sound on · <b>M</b> mutes · volume at the bottom left <button type="button" title="Dismiss" aria-label="Dismiss">✕</button>';
      const done = () => { note.remove(); eng.markChipSeen(); };
      note.querySelector('button')!.addEventListener('click', done);
      els.mount.appendChild(note);
      setTimeout(done, 10000);
    });
  }
}
