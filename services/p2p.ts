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
type IceServerLike = { urls: string | string[]; username?: string; credential?: string };

export class P2PService {
    private peer: Peer | null = null;
    private conn: DataConnection | null = null;
    private onDataReceived: P2PCallback | null = null;
    private onStatusChange: ((status: string, id?: string) => void) | null = null;
    private replayGuard = new NonceReplayGuard();
    /** Envois avant que `conn.open` soit effectif (évite INVITE_ACCEPT / SYNC perdus). */
    private pendingOutbound: Array<{ type: P2PMessageType; payload: unknown }> = [];
    private connectTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
    private lastHostId: string | null = null;
    private connectRetryCount = 0;
    private readonly maxConnectRetries = 1;

    constructor() {}

    private buildIceServers(): IceServerLike[] {
        // Keep STUN list short for faster ICE gathering.
        const servers: IceServerLike[] = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ];

        // Optional TURN (recommended for cross-network reliability).
        // Example:
        // VITE_TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349
        // VITE_TURN_USERNAME=user
        // VITE_TURN_CREDENTIAL=pass
        const env = import.meta.env as Record<string, string | undefined>;
        const turnUrlsRaw = env.VITE_TURN_URLS?.trim();
        const turnUsername = env.VITE_TURN_USERNAME?.trim();
        const turnCredential = env.VITE_TURN_CREDENTIAL?.trim();
        if (turnUrlsRaw && turnUsername && turnCredential) {
            const turnUrls = turnUrlsRaw
                .split(',')
                .map((u) => u.trim())
                .filter(Boolean);
            if (turnUrls.length > 0) {
                servers.push({
                    urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
                    username: turnUsername,
                    credential: turnCredential,
                });
            }
        }

        return servers;
    }

    public init(onStatus: (status: string, id?: string) => void, onData: P2PCallback) {
        this.onStatusChange = onStatus;
        this.onDataReceived = onData;

        /* Ne pas destroy/recréer le Peer à chaque init : le jeton d’invitation embarque le `sessionId`
         * (Peer ID hôte). Un nouveau Peer = nouvel ID = lien invalide, connexion impossible, sync vide. */
        if (this.peer) {
            /* Réaligner l’UI : sinon `initP2PWithMode` laisse `connecting` indéfiniment. */
            if (this.conn && this.conn.open) {
                this.onStatusChange?.('connected', this.peer.id);
            } else if (this.conn && !this.conn.open) {
                this.onStatusChange?.('connecting');
            } else if (this.peer.id) {
                this.onStatusChange?.('ready', this.peer.id);
            } else {
                this.onStatusChange?.('connecting');
            }
            return;
        }

        // Create Peer with a random ID
        // Note: In production, you might want to use your own PeerServer
        this.peer = new Peer({
            debug: 2,
            secure: true,
            host: '0.peerjs.com',
            port: 443,
            config: {
                iceServers: this.buildIceServers(),
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
        this.lastHostId = sanitizedHostId;
        this.connectRetryCount = 0;
        if (this.conn) {
            this.conn.close();
            this.conn = null;
        }
        this.onStatusChange?.('connecting');
        this.openConnection(sanitizedHostId);
    }

    public sendData(type: 'SYNC_GEDCOM', payload: GedcomData) {
        this.sendMessage(type, payload);
    }

    public sendMessage(type: P2PMessageType, payload: unknown) {
        if (!this.conn || !this.conn.open) {
            this.pendingOutbound.push({ type, payload });
            if (import.meta.env.DEV) {
                console.warn('[P2P] sendMessage mis en file (connexion pas prête):', type, this.pendingOutbound.length);
            }
            return;
        }
        this.sendMessageNow(type, payload);
    }

    private handleConnection(conn: DataConnection) {
        this.conn = conn;

        this.conn.on('open', () => {
            if (this.conn !== conn) return;
            console.log('Connected to peer!');
            this.clearConnectTimeout();
            this.connectRetryCount = 0;
            this.flushPendingOutbound();
            this.onStatusChange?.('connected');
        });

        this.conn.on('data', (data: any) => {
            console.log('Received data:', data);
            const decoded = this.decodeIncomingData(data);
            if (!decoded) return;
            if (this.onDataReceived) this.onDataReceived(decoded);
        });

        this.conn.on('close', () => {
            if (this.conn !== conn) return;
            console.log('Connection closed');
            this.clearConnectTimeout();
            this.onStatusChange?.('ready', this.peer?.id || '');
            this.conn = null;
        });

        this.conn.on('error', (err) => {
             if (this.conn !== conn) return;
             console.error("Connection Error", err);
             this.clearConnectTimeout();
             this.onStatusChange?.('error');
        });
    }

    /** PeerJS : identifiant du pair connecté (hôte ou invité). */
    public getRemotePeerId(): string | null {
        return this.conn?.peer ?? null;
    }

    /** Ferme le canal données sans détruire le Peer (ex. hôte qui révoque : message puis coupure). */
    public closeConnection() {
        this.clearConnectTimeout();
        this.pendingOutbound = [];
        if (this.conn) {
            this.conn.close();
            this.conn = null;
        }
    }

    public destroy() {
        this.clearConnectTimeout();
        this.pendingOutbound = [];
        if (this.conn) this.conn.close();
        if (this.peer) this.peer.destroy();
        this.peer = null;
        this.conn = null;
    }

    private flushPendingOutbound() {
        if (!this.conn || !this.conn.open) return;
        while (this.pendingOutbound.length > 0) {
            const item = this.pendingOutbound.shift();
            if (!item) break;
            this.sendMessageNow(item.type, item.payload);
        }
    }

    private sendMessageNow(type: P2PMessageType, payload: unknown) {
        if (!this.conn || !this.conn.open) return;
        const envelope = createEnvelope(type, payload, {
            senderPeerId: this.peer?.id,
        });
        this.conn.send(envelope);
    }

    private startConnectTimeout(timeoutMs = 15000) {
        this.clearConnectTimeout();
        this.connectTimeoutHandle = setTimeout(() => {
            if (this.conn && !this.conn.open) {
                console.warn('P2P connect timeout reached');
                const previousConn = this.conn;
                this.conn = null;
                previousConn.close();

                if (this.lastHostId && this.peer && this.connectRetryCount < this.maxConnectRetries) {
                    this.connectRetryCount += 1;
                    this.onStatusChange?.('connecting');
                    this.openConnection(this.lastHostId);
                    return;
                }

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

    private openConnection(hostId: string) {
        if (!this.peer) return;
        const conn = this.peer.connect(hostId, { reliable: true });
        this.startConnectTimeout();
        this.handleConnection(conn);
    }

    private decodeIncomingData(data: any): { type: string; payload: unknown; senderPeerId?: string } | null {
        // Backward compatibility with old format: { type, payload }
        if (data && typeof data === 'object' && !('protocolVersion' in data) && 'type' in data && 'payload' in data) {
            const legacy = data as { type: string; payload: unknown; senderPeerId?: string };
            return { type: legacy.type, payload: legacy.payload, senderPeerId: legacy.senderPeerId };
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
            return { type: envelope.type, payload: envelope.payload, senderPeerId: envelope.senderPeerId };
        }

        const senderKey = envelope.senderPeerId || 'anonymous';
        if (!this.replayGuard.registerOrReject(senderKey, envelope.nonce, envelope.ttlMs)) {
            this.sendAck(envelope.messageId, 'error', 'NONCE_REPLAYED');
            return null;
        }

        this.sendAck(envelope.messageId, 'ok');
        return { type: envelope.type, payload: envelope.payload, senderPeerId: envelope.senderPeerId };
    }

    private sendAck(ackMessageId: string, status: 'ok' | 'error', errorCode?: P2PErrorCode) {
        if (!this.conn || !this.conn.open) return;
        const ackPayload: AckPayload = {
            ackMessageId,
            status,
            errorCode,
        };
        this.sendMessageNow('ACK', ackPayload);
    }
}

export const p2pService = new P2PService();