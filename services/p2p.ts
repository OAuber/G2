import Peer, { DataConnection } from 'peerjs';
import { GedcomData } from '../types';
import {
    AckPayload,
    createEnvelope,
    isEnvelope,
    NonceReplayGuard,
    P2PEnvelope,
    P2PErrorCode,
    P2PMessageType,
    validateEnvelope,
} from './p2pProtocol';

export type P2PCallback = (data: any) => void;

export class P2PService {
    private peer: Peer | null = null;
    private conn: DataConnection | null = null;
    private onDataReceived: P2PCallback | null = null;
    private onStatusChange: ((status: string, id?: string) => void) | null = null;
    private replayGuard = new NonceReplayGuard();
    private connectTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

    constructor() {}

    public init(onStatus: (status: string, id?: string) => void, onData: P2PCallback) {
        this.onStatusChange = onStatus;
        this.onDataReceived = onData;

        // Create Peer with a random ID
        // Note: In production, you might want to use your own PeerServer
        this.peer = new Peer({
            debug: 2,
            secure: true,
            host: '0.peerjs.com',
            port: 443,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' },
                ],
            },
        });

        this.peer.on('open', (id) => {
            console.log('My peer ID is: ' + id);
            this.onStatusChange?.('ready', id);
        });

        this.peer.on('connection', (conn) => {
            console.log('Incoming connection...');
            this.handleConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('Peer error:', err);
            this.clearConnectTimeout();
            this.onStatusChange?.('error');
        });
    }

    public connect(hostId: string) {
        if (!this.peer) return;
        const sanitizedHostId = hostId.trim();
        if (!sanitizedHostId) {
            this.onStatusChange?.('error');
            return;
        }
        if (this.conn) {
            this.conn.close();
            this.conn = null;
        }
        this.onStatusChange?.('connecting');
        const conn = this.peer.connect(sanitizedHostId);
        this.startConnectTimeout();
        this.handleConnection(conn);
    }

    public sendData(type: 'SYNC_GEDCOM', payload: GedcomData) {
        this.sendMessage(type, payload);
    }

    public sendMessage(type: P2PMessageType, payload: unknown) {
        if (!this.conn || !this.conn.open) return;
        const envelope = createEnvelope(type, payload, {
            senderPeerId: this.peer?.id,
        });
        this.conn.send(envelope);
    }

    private handleConnection(conn: DataConnection) {
        this.conn = conn;

        this.conn.on('open', () => {
            console.log('Connected to peer!');
            this.clearConnectTimeout();
            this.onStatusChange?.('connected');
        });

        this.conn.on('data', (data: any) => {
            console.log('Received data:', data);
            const decoded = this.decodeIncomingData(data);
            if (!decoded) return;
            if (this.onDataReceived) this.onDataReceived(decoded);
        });

        this.conn.on('close', () => {
            console.log('Connection closed');
            this.clearConnectTimeout();
            this.onStatusChange?.('ready', this.peer?.id || '');
            this.conn = null;
        });

        this.conn.on('error', (err) => {
             console.error("Connection Error", err);
             this.clearConnectTimeout();
             this.onStatusChange?.('error');
        });
    }

    public destroy() {
        this.clearConnectTimeout();
        if (this.conn) this.conn.close();
        if (this.peer) this.peer.destroy();
        this.peer = null;
        this.conn = null;
    }

    private startConnectTimeout(timeoutMs = 15000) {
        this.clearConnectTimeout();
        this.connectTimeoutHandle = setTimeout(() => {
            if (this.conn && !this.conn.open) {
                console.warn('P2P connect timeout reached');
                this.conn.close();
                this.conn = null;
                this.onStatusChange?.('error');
            }
        }, timeoutMs);
    }

    private clearConnectTimeout() {
        if (this.connectTimeoutHandle) {
            clearTimeout(this.connectTimeoutHandle);
            this.connectTimeoutHandle = null;
        }
    }

    private decodeIncomingData(data: any): { type: string; payload: unknown } | null {
        // Backward compatibility with old format: { type, payload }
        if (data && typeof data === 'object' && !('protocolVersion' in data) && 'type' in data && 'payload' in data) {
            return { type: data.type, payload: data.payload };
        }

        if (!isEnvelope(data)) {
            this.sendAck('unknown', 'error', 'MALFORMED_MESSAGE');
            return null;
        }

        const envelope: P2PEnvelope = data;
        const valid = validateEnvelope(envelope);
        if (!valid.ok) {
            this.sendAck(envelope.messageId, 'error', valid.errorCode);
            return null;
        }

        // Do not ACK ACKs to avoid endless acknowledgement loops.
        if (envelope.type === 'ACK') {
            return { type: envelope.type, payload: envelope.payload };
        }

        const senderKey = envelope.senderPeerId || 'anonymous';
        if (!this.replayGuard.registerOrReject(senderKey, envelope.nonce, envelope.ttlMs)) {
            this.sendAck(envelope.messageId, 'error', 'NONCE_REPLAYED');
            return null;
        }

        this.sendAck(envelope.messageId, 'ok');
        return { type: envelope.type, payload: envelope.payload };
    }

    private sendAck(ackMessageId: string, status: 'ok' | 'error', errorCode?: P2PErrorCode) {
        if (!this.conn || !this.conn.open) return;
        const ackPayload: AckPayload = {
            ackMessageId,
            status,
            errorCode,
        };
        const envelope = createEnvelope('ACK', ackPayload, {
            senderPeerId: this.peer?.id,
        });
        this.conn.send(envelope);
    }
}

export const p2pService = new P2PService();