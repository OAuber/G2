import Peer, { DataConnection } from 'peerjs';
import { GedcomData } from '../types';

export type P2PCallback = (data: any) => void;

export class P2PService {
    private peer: Peer | null = null;
    private conn: DataConnection | null = null;
    private onDataReceived: P2PCallback | null = null;
    private onStatusChange: ((status: string, id?: string) => void) | null = null;

    constructor() {}

    public init(onStatus: (status: string, id?: string) => void, onData: P2PCallback) {
        this.onStatusChange = onStatus;
        this.onDataReceived = onData;

        // Create Peer with a random ID
        // Note: In production, you might want to use your own PeerServer
        this.peer = new Peer({
            debug: 2
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
            this.onStatusChange?.('error');
        });
    }

    public connect(hostId: string) {
        if (!this.peer) return;
        this.onStatusChange?.('connecting');
        const conn = this.peer.connect(hostId);
        this.handleConnection(conn);
    }

    public sendData(type: 'SYNC_GEDCOM', payload: GedcomData) {
        if (this.conn && this.conn.open) {
            this.conn.send({ type, payload });
        }
    }

    private handleConnection(conn: DataConnection) {
        this.conn = conn;

        this.conn.on('open', () => {
            console.log('Connected to peer!');
            this.onStatusChange?.('connected');
        });

        this.conn.on('data', (data: any) => {
            console.log('Received data:', data);
            if (this.onDataReceived) {
                this.onDataReceived(data);
            }
        });

        this.conn.on('close', () => {
            console.log('Connection closed');
            this.onStatusChange?.('ready', this.peer?.id || '');
            this.conn = null;
        });

        this.conn.on('error', (err) => {
             console.error("Connection Error", err);
             this.onStatusChange?.('error');
        });
    }

    public destroy() {
        if (this.conn) this.conn.close();
        if (this.peer) this.peer.destroy();
        this.peer = null;
        this.conn = null;
    }
}

export const p2pService = new P2PService();