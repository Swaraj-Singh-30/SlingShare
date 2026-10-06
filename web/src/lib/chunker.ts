export const CHUNK_SIZE = 64 * 1024; // 64 KB
export const BUFFER_HIGH_WATERMARK = 1024 * 1024; // 1 MB
export const BUFFER_LOW_THRESHOLD = 256 * 1024; // 256 KB
export const HEADER_SIZE = 24; // 16 bytes transferId + 4 bytes chunkIndex + 4 bytes totalChunks

/**
 * Packs a binary chunk with a 24-byte binary header:
 * - 16 bytes: transferId (ASCII, zero-padded)
 * - 4 bytes uint32: chunkIndex
 * - 4 bytes uint32: totalChunks
 */
export function packChunk(
  transferId: string,
  chunkIndex: number,
  totalChunks: number,
  data: Uint8Array
): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_SIZE + data.byteLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Write 16-byte transferId
  const idEncoder = new TextEncoder();
  const idBytes = idEncoder.encode(transferId.slice(0, 16));
  bytes.set(idBytes, 0);

  // Write chunkIndex and totalChunks
  view.setUint32(16, chunkIndex, false); // big-endian
  view.setUint32(20, totalChunks, false);

  // Write payload
  bytes.set(data, HEADER_SIZE);

  return buffer;
}

/**
 * Unpacks a binary chunk received from DataChannel:
 */
export function unpackChunk(buffer: ArrayBuffer): {
  transferId: string;
  chunkIndex: number;
  totalChunks: number;
  data: Uint8Array;
} | null {
  if (buffer.byteLength < HEADER_SIZE) {
    return null;
  }

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Read transferId (trim trailing null bytes)
  const idSlice = bytes.subarray(0, 16);
  let idLength = 16;
  while (idLength > 0 && idSlice[idLength - 1] === 0) {
    idLength--;
  }
  const transferId = new TextDecoder().decode(idSlice.subarray(0, idLength));

  const chunkIndex = view.getUint32(16, false);
  const totalChunks = view.getUint32(20, false);
  const data = bytes.subarray(HEADER_SIZE);

  return {
    transferId,
    chunkIndex,
    totalChunks,
    data,
  };
}

/**
 * Backpressure helper: waits if dataChannel.bufferedAmount is too high.
 */
export function waitForBufferDrain(dataChannel: RTCDataChannel): Promise<void> {
  if (dataChannel.bufferedAmount <= BUFFER_HIGH_WATERMARK) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onBufferedAmountLow = () => {
      dataChannel.removeEventListener('bufferedamountlow', onBufferedAmountLow);
      resolve();
    };
    dataChannel.addEventListener('bufferedamountlow', onBufferedAmountLow);

    // Timeout safety fallback in case event doesn't fire
    setTimeout(() => {
      dataChannel.removeEventListener('bufferedamountlow', onBufferedAmountLow);
      resolve();
    }, 500);
  });
}
