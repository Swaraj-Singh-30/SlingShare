import type { IceServerConfig, ConnectionState, ConnectionType, DataChannelMessage, TextTransferPayload } from './types';
import { BUFFER_LOW_THRESHOLD } from './chunker';

export interface WebRTCEvents {
  onConnectionStateChange?: (state: ConnectionState, type: ConnectionType) => void;
  onDataChannelStateChange?: (isOpen: boolean) => void;
  onMessageReceived?: (msg: DataChannelMessage) => void;
  onBinaryChunkReceived?: (data: ArrayBuffer) => void;
  onSendOffer?: (targetId: string, sdp: RTCSessionDescriptionInit) => void;
  onSendAnswer?: (targetId: string, sdp: RTCSessionDescriptionInit) => void;
  onSendIceCandidate?: (targetId: string, candidate: RTCIceCandidateInit) => void;
}

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private iceServers: RTCIceServer[];
  private targetPeerId: string = '';
  private events: WebRTCEvents;
  private queuedIceCandidates: RTCIceCandidateInit[] = [];
  private statsInterval: any = null;
  private connectionType: ConnectionType = 'unknown';

  constructor(iceServers: IceServerConfig[] = [], events: WebRTCEvents = {}) {
    this.events = events;
    this.iceServers = this.normalizeIceServers(iceServers);
  }

  private normalizeIceServers(configs: IceServerConfig[]): RTCIceServer[] {
    if (!configs || configs.length === 0) {
      return [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      ];
    }
    return configs.map((c) => ({
      urls: c.urls,
      username: c.username,
      credential: c.credential,
    }));
  }

  public setIceServers(configs: IceServerConfig[]): void {
    this.iceServers = this.normalizeIceServers(configs);
  }

  private createPeerConnection(): RTCPeerConnection {
    if (this.pc) {
      this.pc.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 2,
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && this.targetPeerId) {
        this.events.onSendIceCandidate?.(this.targetPeerId, event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      this.handleConnectionStateChange();
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        console.warn('[webrtc] ICE connection failed, attempting ICE restart...');
        this.restartIce();
      }
      this.handleConnectionStateChange();
    };

    pc.ondatachannel = (event) => {
      console.log('[webrtc] Remote DataChannel received:', event.channel.label);
      this.setupDataChannel(event.channel);
    };

    this.pc = pc;
    this.startStatsMonitoring();
    return pc;
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

    const notifyOpen = () => {
      console.log('[webrtc] DataChannel is open and ready (readyState: open)');
      this.events.onDataChannelStateChange?.(true);
      this.checkConnectionType();
    };

    this.dataChannel.onopen = notifyOpen;
    this.dataChannel.addEventListener('open', notifyOpen);

    // If channel is already open when passed into setupDataChannel
    if (this.dataChannel.readyState === 'open') {
      notifyOpen();
    }

    this.dataChannel.onclose = () => {
      console.log('[webrtc] DataChannel closed');
      this.events.onDataChannelStateChange?.(false);
    };

    this.dataChannel.onerror = (err) => {
      console.error('[webrtc] DataChannel error:', err);
    };

    this.dataChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data);
          this.events.onMessageReceived?.(parsed);
        } catch (e) {
          console.warn('[webrtc] Non-JSON text message, passing as raw text:', event.data);
          this.events.onMessageReceived?.({
            type: 'text',
            id: 'raw_' + Date.now(),
            text: event.data,
            timestamp: Date.now(),
            senderName: '',
          });
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.events.onBinaryChunkReceived?.(event.data);
      } else if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => {
          this.events.onBinaryChunkReceived?.(buf);
        });
      }
    };
  }

  public async initiateConnection(targetId: string): Promise<void> {
    this.targetPeerId = targetId;
    const pc = this.createPeerConnection();

    // Initiator creates the DataChannel
    const dc = pc.createDataChannel('slingshare-transfer', {
      ordered: true,
    });
    this.setupDataChannel(dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.events.onSendOffer?.(targetId, pc.localDescription!);
  }

  public async handleOffer(senderId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    this.targetPeerId = senderId;
    const pc = this.createPeerConnection();

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.processQueuedCandidates();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.events.onSendAnswer?.(senderId, pc.localDescription!);
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.processQueuedCandidates();
  }

  public async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) {
      this.queuedIceCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[webrtc] Error adding ICE candidate:', err);
    }
  }

  private async processQueuedCandidates(): Promise<void> {
    if (!this.pc) return;
    while (this.queuedIceCandidates.length > 0) {
      const candidate = this.queuedIceCandidates.shift();
      if (candidate) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('[webrtc] Error adding queued ICE candidate:', err);
        }
      }
    }
  }

  public async restartIce(): Promise<void> {
    if (!this.pc || !this.targetPeerId) return;
    try {
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      this.events.onSendOffer?.(this.targetPeerId, this.pc.localDescription!);
    } catch (err) {
      console.error('[webrtc] ICE restart failed:', err);
    }
  }

  private handleConnectionStateChange(): void {
    if (!this.pc) return;
    const rawState = this.pc.connectionState || this.pc.iceConnectionState;

    let mappedState: ConnectionState = 'disconnected';
    if (rawState === 'connected') {
      mappedState = 'connected';
      this.checkConnectionType();
    } else if (rawState === 'connecting' || rawState === 'checking') {
      mappedState = 'connecting';
    } else if (rawState === 'failed') {
      mappedState = 'failed';
    } else if (rawState === 'disconnected') {
      mappedState = 'reconnecting';
    }

    this.events.onConnectionStateChange?.(mappedState, this.connectionType);
  }

  public async checkConnectionType(): Promise<ConnectionType> {
    if (!this.pc) return 'unknown';

    try {
      const stats = await this.pc.getStats();
      let type: ConnectionType = 'unknown';

      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated)) {
          const localCandidate = stats.get(report.localCandidateId);
          const remoteCandidate = stats.get(report.remoteCandidateId);

          if (localCandidate?.candidateType === 'relay' || remoteCandidate?.candidateType === 'relay') {
            type = 'relayed';
          } else if (localCandidate || remoteCandidate) {
            type = 'direct';
          }
        }
      });

      if (type !== 'unknown') {
        this.connectionType = type;
        this.events.onConnectionStateChange?.(
          this.pc.connectionState === 'connected' ? 'connected' : 'connecting',
          this.connectionType
        );
      }
      return type;
    } catch (e) {
      return 'unknown';
    }
  }

  private startStatsMonitoring(): void {
    if (this.statsInterval) clearInterval(this.statsInterval);
    this.statsInterval = setInterval(() => {
      if (this.pc && this.pc.connectionState === 'connected') {
        this.checkConnectionType();
      }
    }, 5000);
  }

  public getDataChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  public isChannelOpen(): boolean {
    return this.dataChannel !== null && this.dataChannel.readyState === 'open';
  }

  public isConnected(): boolean {
    return this.isChannelOpen();
  }

  public sendTextMessage(text: string, senderName: string = ''): boolean {
    const payload: TextTransferPayload = {
      type: 'text',
      id: 'txt_' + Math.random().toString(36).substring(2, 9),
      text,
      timestamp: Date.now(),
      senderName,
    };
    return this.sendJson(payload);
  }

  public sendJson(msg: DataChannelMessage): boolean {
    if (!this.isChannelOpen()) return false;
    try {
      this.dataChannel!.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      console.error('[webrtc] Error sending JSON message:', err);
      return false;
    }
  }

  public sendBinaryChunk(buffer: ArrayBuffer): boolean {
    if (!this.isChannelOpen()) return false;
    try {
      this.dataChannel!.send(buffer);
      return true;
    } catch (err) {
      console.error('[webrtc] Error sending binary chunk:', err);
      return false;
    }
  }

  public close(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch (e) {}
      this.dataChannel = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch (e) {}
      this.pc = null;
    }
    this.targetPeerId = '';
    this.connectionType = 'unknown';
    this.events.onConnectionStateChange?.('disconnected', 'unknown');
  }
}
