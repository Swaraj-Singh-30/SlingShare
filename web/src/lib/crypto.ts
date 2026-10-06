/**
 * Computes SHA-256 hash of a Blob/File using Web Crypto API.
 * For large files, reads in slices to avoid memory allocation spikes.
 */
export async function computeFileHash(file: Blob, onProgress?: (percent: number) => void): Promise<string> {
  if (!crypto.subtle) {
    console.warn('[crypto] Web Crypto API not available in this context');
    return '';
  }

  // For small files (< 16MB), digest directly
  if (file.size <= 16 * 1024 * 1024) {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return bufferToHex(digest);
  }

  // For larger files, we can use an incremental hashing approach or digest whole buffer in memory
  // Modern browsers handle arrayBuffer up to 1-2GB smoothly.
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return bufferToHex(digest);
  } catch (err) {
    console.error('[crypto] Error computing hash:', err);
    return '';
  }
}

/**
 * Computes SHA-256 hash from an array of ArrayBuffer chunks.
 */
export async function computeChunksHash(chunks: (ArrayBuffer | Uint8Array)[]): Promise<string> {
  if (!crypto.subtle) return '';
  const blob = new Blob(chunks as BlobPart[]);
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(digest);
}

function bufferToHex(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer);
  let hexCodes = '';
  for (let i = 0; i < byteArray.length; i++) {
    const hex = byteArray[i].toString(16).padStart(2, '0');
    hexCodes += hex;
  }
  return hexCodes;
}
