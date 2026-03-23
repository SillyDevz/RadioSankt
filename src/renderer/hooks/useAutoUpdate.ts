import { useEffect } from 'react';
import { useStore } from '@/store';

export function useAutoUpdate() {
  const addToast = useStore((s) => s.addToast);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    const cleanupAvailable = api.onUpdateAvailable(() => {
      addToast('Update available — downloading...', 'info');
    });

    const cleanupDownloaded = api.onUpdateDownloaded(() => {
      addToast('Update downloaded. Restart to apply.', 'success', {
        label: 'Restart',
        onClick: () => api.quitAndInstall(),
      });
    });

    api.checkForUpdates();

    return () => {
      cleanupAvailable();
      cleanupDownloaded();
    };
  }, [addToast]);
}
