import { useEffect } from 'react';
import { useStore } from '@/store';
import i18n from '@/i18n';

async function gracefulRestart(): Promise<void> {
  const api = window.electronAPI;
  if (!api) return;

  const { default: AutomationEngine } = await import('@/engine/AutomationEngine');
  await AutomationEngine.getInstance().stop();

  const { flushSessionNow } = await import('@/services/automation-session');
  flushSessionNow();

  api.quitAndInstall();
}

export function useAutoUpdate() {
  const addToast = useStore((s) => s.addToast);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    let stopSubscription: (() => void) | null = null;

    const cleanupAvailable = api.onUpdateAvailable(() => {
      addToast(i18n.t('updates.availableDownloading', { defaultValue: 'Update available - downloading...' }), 'info');
    });

    const cleanupDownloaded = api.onUpdateDownloaded(() => {
      const { automationStatus } = useStore.getState();

      if (automationStatus === 'playing' || automationStatus === 'waitingAtPause') {
        // Automation is active — defer restart until it stops
        addToast(
          i18n.t('updates.waitingForAutomation', { defaultValue: 'Update ready. Will restart when automation stops.' }),
          'info',
        );

        stopSubscription = useStore.subscribe((state, prev) => {
          if (
            prev.automationStatus !== 'stopped' &&
            state.automationStatus === 'stopped'
          ) {
            stopSubscription?.();
            stopSubscription = null;
            void gracefulRestart();
          }
        });
      } else {
        // Automation is not active — offer immediate restart
        addToast(
          i18n.t('updates.downloadedRestart', { defaultValue: 'Update downloaded. Restart to apply.' }),
          'success',
          {
            label: i18n.t('updates.restart', { defaultValue: 'Restart' }),
            onClick: () => void gracefulRestart(),
          },
        );
      }
    });

    return () => {
      cleanupAvailable();
      cleanupDownloaded();
      stopSubscription?.();
    };
  }, [addToast]);
}
