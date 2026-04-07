export async function openExternal(url: string): Promise<void> {
  if (window.electronAPI?.openExternal) {
    await window.electronAPI.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
