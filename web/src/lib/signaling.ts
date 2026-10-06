import type { SignalingMessage, PeerInfo, IceServerConfig } from './types';

export interface SignalingEvents {
  onSessionCreated?: (sessionId: string, peerId: string, iceServers: IceServerConfig[]) => void;
  onSessionJoined?: (sessionId: string, peerId: string, peers: PeerInfo[], iceServers: IceServerConfig[]) => void;
  onPeerJoined?: (peerId: string, deviceName: string, deviceType: string) => void;
  onPeerLeft?: (peerId: string) => void;
  onOffer?: (peerId: string, sdp: RTCSessionDescriptionInit) => void;
  onAnswer?: (peerId: string, sdp: RTCSessionDescriptionInit) => void;
  onIceCandidate?: (peerId: string, candidate: RTCIceCandidateInit) => void;
  onError?: (error: string) => void;
  onStateChange?: (connected: boolean) => void;
}

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private events: SignalingEvents;
  private isExplicitlyClosed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;

  constructor(events: SignalingEvents = {}, customWsUrl?: string) {
    this.events = events;
    if (customWsUrl) {
      this.url = customWsUrl;
    } else if (typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // In local dev with Astro (4321) and Go backend (8080), can target port 8080 or current host
      const host = window.location.port === '4321' ? `${window.location.hostname}:8080` : window.location.host;
      this.url = `${protocol}//${host}/ws`;
    } else {
      this.url = 'ws://localhost:8080/ws';
    }
  }

  public connect(): Promise<void> {
    this.isExplicitlyClosed = false;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.events.onStateChange?.(true);
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (err) => {
          console.warn('[signaling] WebSocket error:', err);
          this.events.onError?.('Signaling server connection error');
          reject(err);
        };

        this.ws.onclose = () => {
          this.events.onStateChange?.(false);
          if (!this.isExplicitlyClosed) {
            this.scheduleReconnect();
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts > 8) return;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      if (!this.isExplicitlyClosed) {
        this.connect().catch(() => {});
      }
    }, delay);
  }

  private send(msg: SignalingMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[signaling] Cannot send message, WebSocket not open:', msg.type);
    }
  }

  public createSession(deviceName: string, deviceType: string): void {
    this.send({
      type: 'create-session',
      deviceName,
      deviceType,
    });
  }

  public joinSession(sessionId: string, deviceName: string, deviceType: string): void {
    this.send({
      type: 'join-session',
      sessionId: sessionId.trim().toUpperCase(),
      deviceName,
      deviceType,
    });
  }

  public leaveSession(): void {
    this.send({
      type: 'leave-session',
    });
  }

  public sendOffer(targetId: string, sdp: RTCSessionDescriptionInit): void {
    this.send({
      type: 'offer',
      targetId,
      data: sdp,
    });
  }

  public sendAnswer(targetId: string, sdp: RTCSessionDescriptionInit): void {
    this.send({
      type: 'answer',
      targetId,
      data: sdp,
    });
  }

  public sendIceCandidate(targetId: string, candidate: RTCIceCandidateInit): void {
    this.send({
      type: 'ice-candidate',
      targetId,
      data: candidate,
    });
  }

  private handleMessage(dataStr: string): void {
    try {
      const msg: SignalingMessage = JSON.parse(dataStr);

      switch (msg.type) {
        case 'session-created':
          if (msg.sessionId && msg.peerId) {
            this.events.onSessionCreated?.(msg.sessionId, msg.peerId, msg.iceServers || []);
          }
          break;

        case 'session-joined':
          if (msg.sessionId && msg.peerId) {
            this.events.onSessionJoined?.(msg.sessionId, msg.peerId, msg.peers || [], msg.iceServers || []);
          }
          break;

        case 'peer-joined':
          if (msg.peerId) {
            this.events.onPeerJoined?.(msg.peerId, msg.deviceName || 'Device', msg.deviceType || 'desktop');
          }
          break;

        case 'peer-left':
          if (msg.peerId) {
            this.events.onPeerLeft?.(msg.peerId);
          }
          break;

        case 'offer':
          if (msg.peerId && msg.data) {
            this.events.onOffer?.(msg.peerId, msg.data);
          }
          break;

        case 'answer':
          if (msg.peerId && msg.data) {
            this.events.onAnswer?.(msg.peerId, msg.data);
          }
          break;

        case 'ice-candidate':
          if (msg.peerId && msg.data) {
            this.events.onIceCandidate?.(msg.peerId, msg.data);
          }
          break;

        case 'error':
          this.events.onError?.(msg.error || 'Unknown server error');
          break;
      }
    } catch (err) {
      console.error('[signaling] Error parsing message:', err);
    }
  }
}
