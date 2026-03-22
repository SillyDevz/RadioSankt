import { useEffect } from 'react';
import { useStore } from '@/store';
import AutomationEngine from '@/engine/AutomationEngine';

function matchesShortcut(e: KeyboardEvent, key: string, modifiers: string[]): boolean {
  const eventKey = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (eventKey !== key) return false;

  const needsMeta = modifiers.includes('Meta');
  const needsCtrl = modifiers.includes('Ctrl');
  const needsAlt = modifiers.includes('Alt');
  const needsShift = modifiers.includes('Shift');

  // Accept either Meta or Ctrl for Meta modifier (cross-platform)
  const metaOrCtrl = e.metaKey || e.ctrlKey;
  if (needsMeta && !metaOrCtrl) return false;
  if (!needsMeta && !needsCtrl && (e.metaKey || e.ctrlKey)) return false;
  if (needsCtrl && !e.ctrlKey) return false;
  if (needsAlt !== e.altKey) return false;
  if (needsShift !== e.shiftKey) return false;

  return true;
}

export function useKeyboardShortcuts() {
  const shortcuts = useStore((s) => s.shortcuts);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const find = (id: string) => shortcuts.find((s) => s.id === id);

      const playPause = find('play-pause');
      if (playPause && matchesShortcut(e, playPause.key, playPause.modifiers)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('radio-sankt:toggle-play'));
        return;
      }

      const stop = find('stop');
      if (stop && matchesShortcut(e, stop.key, stop.modifiers)) {
        e.preventDefault();
        const engine = AutomationEngine.getInstance();
        engine.stop();
        return;
      }

      const cont = find('continue');
      if (cont && matchesShortcut(e, cont.key, cont.modifiers)) {
        e.preventDefault();
        const engine = AutomationEngine.getInstance();
        engine.resume();
        return;
      }

      const search = find('search');
      if (search && matchesShortcut(e, search.key, search.modifiers)) {
        e.preventDefault();
        useStore.getState().setSpotifySearchOpen(true);
        return;
      }

      const live = find('live');
      if (live && matchesShortcut(e, live.key, live.modifiers)) {
        e.preventDefault();
        // Dispatch custom event so LivePage can handle the toggle logic
        window.dispatchEvent(new CustomEvent('radio-sankt:toggle-live'));
        return;
      }

      const help = find('help');
      if (help && matchesShortcut(e, help.key, help.modifiers)) {
        e.preventDefault();
        const state = useStore.getState();
        state.setHelpPanelOpen(!state.helpPanelOpen);
        return;
      }

      // Legacy shortcuts for transport (Shift+P, Shift+N)
      if (e.shiftKey && e.key === 'P') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('radio-sankt:previous-track'));
      }

      if (e.shiftKey && e.key === 'N') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('radio-sankt:next-track'));
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}
