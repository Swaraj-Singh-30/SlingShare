export interface IceServerConfig {
  urls: string[] | string;
  username?: string;
  credential?: string;
}

export interface PeerInfo {
  id: string;
  deviceName: string;
  deviceType: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
export type ConnectionType = 'direct' | 'relayed' | 'unknown';

export interface SignalingMessage {
  type: 'create-session' | 'join-session' | 'leave-session' | 'session-created' | 'session-joined' | 'peer-joined' | 'peer-left' | 'offer' | 'answer' | 'ice-candidate' | 'error';
  sessionId?: string;
  peerId?: string;
  targetId?: string;
  deviceName?: string;
  deviceType?: string;
  data?: any;
  peers?: PeerInfo[];
  iceServers?: IceServerConfig[];
  error?: string;
}

// DataChannel message types
export interface TextTransferPayload {
  type: 'text';
  id: string;
  text: string;
  timestamp: number;
  senderName: string;
}

export interface FileMetadataPayload {
  type: 'file-start';
  transferId: string;
  name: string;
  size: number;
  mimeType: string;
  totalChunks: number;
  chunkSize: number;
  sha256?: string;
}

export interface FileChunkAckPayload {
  type: 'file-ack';
  transferId: string;
  chunkIndex: number;
}

export interface FileCancelPayload {
  type: 'file-cancel';
  transferId: string;
  reason?: string;
}

export interface FileResumeRequestPayload {
  type: 'file-resume-request';
  transferId: string;
  lastReceivedChunk: number;
}

export interface PingPayload {
  type: 'ping';
  timestamp: number;
}

export interface PongPayload {
  type: 'pong';
  timestamp: number;
}

export type DataChannelMessage =
  | TextTransferPayload
  | FileMetadataPayload
  | FileChunkAckPayload
  | FileCancelPayload
  | FileResumeRequestPayload
  | PingPayload
  | PongPayload;

export interface FileTransferState {
  id: string;
  direction: 'sending' | 'receiving';
  fileName: string;
  fileSize: number;
  mimeType: string;
  totalChunks: number;
  chunkSize: number;
  transferredBytes: number;
  progressPercent: number;
  speedBytesPerSec: number;
  status: 'hashing' | 'sending' | 'receiving' | 'verifying' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  blob?: Blob;
  downloadUrl?: string;
  sha256Expected?: string;
  sha256Actual?: string;
  startTime: number;
}
