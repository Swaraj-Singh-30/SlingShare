import type {
  FileTransferState,
  FileMetadataPayload,
  FileCancelPayload,
  FileResumeRequestPayload,
  DataChannelMessage,
} from './types';
import { CHUNK_SIZE, packChunk, unpackChunk, waitForBufferDrain } from './chunker';
import { computeFileHash, computeChunksHash } from './crypto';
import type { WebRTCManager } from './webrtc';

export interface TransferEvents {
  onTransferProgress?: (state: FileTransferState) => void;
  onTransferComplete?: (state: FileTransferState) => void;
  onTransferFailed?: (state: FileTransferState, error: string) => void;
  onTransferCancelled?: (transferId: string) => void;
}

interface InProgressReceive {
  state: FileTransferState;
  chunks: (Uint8Array | null)[];
  receivedCount: number;
  lastProgressUpdate: number;
  lastTransferredBytes: number;
}

interface InProgressSend {
  state: FileTransferState;
  file: File;
  cancelled: boolean;
  paused: boolean;
  lastAckedChunk: number;
}

export class TransferManager {
  private webrtc: WebRTCManager;
  private events: TransferEvents;
  private sends: Map<string, InProgressSend> = new Map();
  private receives: Map<string, InProgressReceive> = new Map();

  constructor(webrtc: WebRTCManager, events: TransferEvents = {}) {
    this.webrtc = webrtc;
    this.events = events;
  }

  public generateTransferId(): string {
    return 't_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36).substring(4, 8);
  }

  public async sendFile(file: File): Promise<string> {
    const transferId = this.generateTransferId();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;

    const state: FileTransferState = {
      id: transferId,
      direction: 'sending',
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      totalChunks,
      chunkSize: CHUNK_SIZE,
      transferredBytes: 0,
      progressPercent: 0,
      speedBytesPerSec: 0,
      status: 'hashing',
      startTime: Date.now(),
    };

    const inProgressSend: InProgressSend = {
      state,
      file,
      cancelled: false,
      paused: false,
      lastAckedChunk: -1,
    };

    this.sends.set(transferId, inProgressSend);
    this.events.onTransferProgress?.({ ...state });

    // 1. Calculate SHA-256 hash
    let sha256 = '';
    try {
      sha256 = await computeFileHash(file);
      state.sha256Expected = sha256;
    } catch (e) {
      console.warn('[transfer] Could not compute hash prior to send:', e);
    }

    if (inProgressSend.cancelled) return transferId;

    // 2. Send metadata message
    const meta: FileMetadataPayload = {
      type: 'file-start',
      transferId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      totalChunks,
      chunkSize: CHUNK_SIZE,
      sha256,
    };

    this.webrtc.sendJson(meta);

    // 3. Begin streaming chunks with backpressure
    state.status = 'sending';
    state.startTime = Date.now();
    this.events.onTransferProgress?.({ ...state });

    this.streamFileChunks(transferId, 0);
    return transferId;
  }

  private async streamFileChunks(transferId: string, startChunkIndex: number): Promise<void> {
    const send = this.sends.get(transferId);
    if (!send) return;

    const { file, state } = send;
    const channel = this.webrtc.getDataChannel();
    if (!channel) {
      this.failTransfer(state, 'DataChannel is not available');
      return;
    }

    let lastProgressTime = Date.now();
    let bytesSentInInterval = 0;

    for (let i = startChunkIndex; i < state.totalChunks; i++) {
      if (send.cancelled) {
        state.status = 'cancelled';
        this.events.onTransferCancelled?.(transferId);
        return;
      }

      if (send.paused) {
        // Paused for reconnection / resume
        return;
      }

      // Read chunk slice
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const sliceBlob = file.slice(start, end);
      const arrayBuf = await sliceBlob.arrayBuffer();
      const chunkBytes = new Uint8Array(arrayBuf);

      // Backpressure: wait if channel buffer exceeds threshold
      await waitForBufferDrain(channel);

      // Pack and send
      const packed = packChunk(transferId, i, state.totalChunks, chunkBytes);
      const sent = this.webrtc.sendBinaryChunk(packed);
      if (!sent) {
        this.failTransfer(state, 'Failed to send data chunk over WebRTC');
        return;
      }

      state.transferredBytes = end;
      state.progressPercent = Math.min(100, Math.round((end / file.size) * 100));
      bytesSentInInterval += chunkBytes.byteLength;

      const now = Date.now();
      const elapsed = now - lastProgressTime;
      if (elapsed >= 150 || i === state.totalChunks - 1) {
        state.speedBytesPerSec = Math.round((bytesSentInInterval / elapsed) * 1000);
        lastProgressTime = now;
        bytesSentInInterval = 0;
        this.events.onTransferProgress?.({ ...state });
      }
    }

    state.status = 'completed';
    state.progressPercent = 100;
    state.speedBytesPerSec = 0;
    this.events.onTransferComplete?.({ ...state });
  }

  public handleIncomingMessage(msg: DataChannelMessage): void {
    switch (msg.type) {
      case 'file-start':
        this.handleFileStart(msg);
        break;

      case 'file-cancel':
        this.handleFileCancel(msg);
        break;

      case 'file-resume-request':
        this.handleResumeRequest(msg);
        break;
    }
  }

  private handleFileStart(meta: FileMetadataPayload): void {
    const totalChunks = meta.totalChunks || Math.ceil(meta.size / meta.chunkSize) || 1;

    const state: FileTransferState = {
      id: meta.transferId,
      direction: 'receiving',
      fileName: meta.name,
      fileSize: meta.size,
      mimeType: meta.mimeType || 'application/octet-stream',
      totalChunks,
      chunkSize: meta.chunkSize,
      transferredBytes: 0,
      progressPercent: 0,
      speedBytesPerSec: 0,
      status: 'receiving',
      sha256Expected: meta.sha256,
      startTime: Date.now(),
    };

    const inProgressReceive: InProgressReceive = {
      state,
      chunks: new Array(totalChunks).fill(null),
      receivedCount: 0,
      lastProgressUpdate: Date.now(),
      lastTransferredBytes: 0,
    };

    this.receives.set(meta.transferId, inProgressReceive);
    this.events.onTransferProgress?.({ ...state });
  }

  public async handleBinaryChunk(buffer: ArrayBuffer): Promise<void> {
    const unpacked = unpackChunk(buffer);
    if (!unpacked) return;

    const { transferId, chunkIndex, totalChunks, data } = unpacked;
    const recv = this.receives.get(transferId);
    if (!recv) return;

    const { state, chunks } = recv;

    if (!chunks[chunkIndex]) {
      chunks[chunkIndex] = data;
      recv.receivedCount++;
      state.transferredBytes += data.byteLength;
      state.progressPercent = Math.min(100, Math.round((state.transferredBytes / state.fileSize) * 100));

      const now = Date.now();
      const elapsed = now - recv.lastProgressUpdate;
      if (elapsed >= 150) {
        const bytesDiff = state.transferredBytes - recv.lastTransferredBytes;
        state.speedBytesPerSec = Math.round((bytesDiff / elapsed) * 1000);
        recv.lastProgressUpdate = now;
        recv.lastTransferredBytes = state.transferredBytes;
        this.events.onTransferProgress?.({ ...state });
      }
    }

    // Check completion
    if (recv.receivedCount === totalChunks) {
      await this.finalizeReceivedFile(transferId, recv);
    }
  }

  private async finalizeReceivedFile(transferId: string, recv: InProgressReceive): Promise<void> {
    const { state, chunks } = recv;
    state.status = 'verifying';
    state.speedBytesPerSec = 0;
    this.events.onTransferProgress?.({ ...state });

    // Verify SHA-256 integrity
    const validChunks: Uint8Array[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i]) {
        validChunks.push(chunks[i]!);
      }
    }

    let actualHash = '';
    try {
      actualHash = await computeChunksHash(validChunks);
      state.sha256Actual = actualHash;
    } catch (e) {
      console.warn('[transfer] Could not compute hash of received chunks:', e);
    }

    if (state.sha256Expected && actualHash && state.sha256Expected !== actualHash) {
      this.failTransfer(state, 'Integrity check failed: file checksum does not match sender');
      return;
    }

    // Create Blob and Download URL
    try {
      const blob = new Blob(validChunks as BlobPart[], { type: state.mimeType });
      // Free raw chunks array to reduce memory
      recv.chunks = [];
      const downloadUrl = URL.createObjectURL(blob);
      state.blob = blob;
      state.downloadUrl = downloadUrl;
      state.status = 'completed';
      state.progressPercent = 100;

      this.events.onTransferComplete?.({ ...state });
    } catch (err: any) {
      this.failTransfer(state, `Failed to assemble file blob: ${err.message}`);
    }
  }

  public cancelTransfer(transferId: string): void {
    const send = this.sends.get(transferId);
    if (send) {
      send.cancelled = true;
      send.state.status = 'cancelled';
      this.webrtc.sendJson({ type: 'file-cancel', transferId });
      this.events.onTransferCancelled?.(transferId);
      this.sends.delete(transferId);
      return;
    }

    const recv = this.receives.get(transferId);
    if (recv) {
      recv.state.status = 'cancelled';
      this.webrtc.sendJson({ type: 'file-cancel', transferId });
      this.events.onTransferCancelled?.(transferId);
      this.receives.delete(transferId);
    }
  }

  private handleFileCancel(payload: FileCancelPayload): void {
    const { transferId } = payload;
    const send = this.sends.get(transferId);
    if (send) {
      send.cancelled = true;
      send.state.status = 'cancelled';
      this.events.onTransferCancelled?.(transferId);
      this.sends.delete(transferId);
    }

    const recv = this.receives.get(transferId);
    if (recv) {
      recv.state.status = 'cancelled';
      this.events.onTransferCancelled?.(transferId);
      this.receives.delete(transferId);
    }
  }

  private handleResumeRequest(payload: FileResumeRequestPayload): void {
    const { transferId, lastReceivedChunk } = payload;
    const send = this.sends.get(transferId);
    if (send && !send.cancelled) {
      console.log(`[transfer] Resuming transfer ${transferId} from chunk ${lastReceivedChunk + 1}`);
      send.paused = false;
      this.streamFileChunks(transferId, lastReceivedChunk + 1);
    }
  }

  public resumeInterruptedReceives(): void {
    for (const [transferId, recv] of this.receives.entries()) {
      if (recv.state.status === 'receiving' && recv.receivedCount < recv.state.totalChunks) {
        // Find highest contiguous chunk index
        let lastContiguous = -1;
        for (let i = 0; i < recv.chunks.length; i++) {
          if (recv.chunks[i]) lastContiguous = i;
          else break;
        }

        console.log(`[transfer] Requesting resume for ${transferId} at chunk ${lastContiguous}`);
        this.webrtc.sendJson({
          type: 'file-resume-request',
          transferId,
          lastReceivedChunk: lastContiguous,
        });
      }
    }
  }

  private failTransfer(state: FileTransferState, error: string): void {
    state.status = 'failed';
    state.error = error;
    this.events.onTransferFailed?.({ ...state }, error);
  }

  public cleanup(): void {
    for (const recv of this.receives.values()) {
      if (recv.state.downloadUrl) {
        URL.revokeObjectURL(recv.state.downloadUrl);
      }
    }
    this.sends.clear();
    this.receives.clear();
  }
}
