/** Shown when preload/renderer expect schedule IPC but the running Electron main process was not rebuilt. */
export const REBUILD_SCHEDULE_IPC_HINT =
  'Stop the desktop app, run npm run build:electron, then start again (e.g. npm run electron:dev) so the main process registers schedule handlers.';
