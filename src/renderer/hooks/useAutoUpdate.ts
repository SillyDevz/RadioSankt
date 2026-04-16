import { useEffect } from 'react';
import { useStore } from '@/store';
import i18n from '@/i18n';

export function useAutoUpdate() {
  const addToast = useStore((s) => s.addToast);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const cleanupAvailable = api.onUpdateAvailable(() => {
      addToast(i18n.t('updates.availableDownloading', { defaultValue: 'Update available - downloading...' }), 'info');
    });

    const cleanupDownloaded = api.onUpdateDownloaded(() => {
      addToast(i18n.t('updates.downloadedRestart', { defaultValue: 'Update downloaded. Restart to apply.' }), 'success', {
        label: i18n.t('updates.restart', { defaultValue: 'Restart' }),
        onClick: () => api.quitAndInstall(),
      });
    });

    return () => {
      cleanupAvailable();
      cleanupDownloaded();
    };
  }, [addToast]);
}
