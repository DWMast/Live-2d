const FILE_KEYS = new Set(['model', 'textures', 'physics', 'pose', 'moc', 'Moc', 'Textures', 'Physics', 'Pose', 'file', 'File']);

function encodeManifestValue(value: unknown, fileReference = false): unknown {
  if (typeof value === 'string') {
    return fileReference ? value.replace(/#/g, '%23') : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeManifestValue(item, fileReference));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        encodeManifestValue(child, FILE_KEYS.has(key)),
      ])
    );
  }
  return value;
}

/** Percent-encode URL fragments in file references without altering animation names. */
export function rewriteLive2DManifestFileRefs(source: string): string {
  if (!source.includes('#')) return source;
  try {
    return JSON.stringify(encodeManifestValue(JSON.parse(source)));
  } catch {
    return source;
  }
}
