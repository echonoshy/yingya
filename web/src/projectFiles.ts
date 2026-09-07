/** Resolve only files inside the active project; never turn arbitrary disk paths into URLs. */
export function projectFilePath(href: string, projectId: string): string | null {
  let path: string;
  try { path = decodeURIComponent(href); } catch { return null; }
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return null;
  const apiPrefix = `/api/agent-projects/${projectId}/files/`;
  const diskMarker = `/video-projects/${projectId}/`;
  if (path.startsWith(apiPrefix)) path = path.slice(apiPrefix.length);
  else if (path.startsWith('/') && path.includes(diskMarker)) path = path.slice(path.indexOf(diskMarker) + diskMarker.length);
  else if (path.startsWith('/')) return null;
  else path = path.replace(/^\.\//, '');
  if (!path || path.startsWith('#') || /[\\\u0000-\u001f?#]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return path;
}
export function filePreviewKind(path: string) {
  if (/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(path)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/i.test(path)) return 'video';
  if (/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(path)) return 'audio';
  if (/\.(md|markdown|mdown)$/i.test(path)) return 'markdown';
  if (/\.(txt|json|jsonl|csv|log|yaml|yml|css|js|ts|html|xml)$/i.test(path)) return 'text';
  return 'download';
}
