/**
 * Cross-platform basename for UI display (Windows paths use `\`, Unix uses `/`).
 * Not a full `path.basename` replacement — just enough for showing file names.
 */
export function basename(filePath: string): string {
  if (!filePath) return '';
  const parts = filePath.split(/[\\/]+/);
  return parts[parts.length - 1] ?? filePath;
}

/** Strip the extension from a file name (or path). */
export function stripExtension(name: string): string {
  return basename(name).replace(/\.[^.]+$/, '');
}
