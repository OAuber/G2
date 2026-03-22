import { SelfIdentityPublic } from '../types';

export interface EncryptedPrivateKeyPayload {
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltB64: string;
  cipher: 'AES-GCM-256';
  ivB64: string;
  privateKeyCiphertextB64: string;
}

export interface IdentityBackupPayload {
  version: '1.0';
  createdAt: string;
  app: 'g2';
  type: 'self-identity-backup';
  identity: SelfIdentityPublic;
  crypto: EncryptedPrivateKeyPayload;
}

const PBKDF2_ITERATIONS = 210_000;

export async function generateIdentityKeyMaterial(): Promise<{
  devicePublicKeyJwk: JsonWebKey;
  devicePrivateKeyJwk: JsonWebKey;
  deviceKeyId: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify']
  );

  const devicePublicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const devicePrivateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const deviceKeyId = await computeDeviceKeyId(devicePublicKeyJwk);

  return { devicePublicKeyJwk, devicePrivateKeyJwk, deviceKeyId };
}

export async function buildEncryptedIdentityBackup(
  identity: SelfIdentityPublic,
  privateKeyJwk: JsonWebKey,
  password: string
): Promise<IdentityBackupPayload> {
  const cryptoPayload = await encryptPrivateKeyJwk(privateKeyJwk, password);
  return {
    version: '1.0',
    createdAt: new Date().toISOString(),
    app: 'g2',
    type: 'self-identity-backup',
    identity,
    crypto: cryptoPayload,
  };
}

export async function decryptIdentityBackupPrivateKey(
  payload: IdentityBackupPayload,
  password: string
): Promise<JsonWebKey> {
  return decryptPrivateKeyJwk(payload.crypto, password);
}

export function isIdentityBackupPayload(value: unknown): value is IdentityBackupPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.type === 'self-identity-backup' && typeof v.identity === 'object' && typeof v.crypto === 'object';
}

async function computeDeviceKeyId(publicJwk: JsonWebKey): Promise<string> {
  const canonical = canonicalizeJwk(publicJwk);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = bytesToHex(new Uint8Array(digest)).slice(0, 24);
  return `g2k-${hex}`;
}

async function encryptPrivateKeyJwk(privateKeyJwk: JsonWebKey, password: string): Promise<EncryptedPrivateKeyPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(privateKeyJwk));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    saltB64: bytesToBase64(salt),
    cipher: 'AES-GCM-256',
    ivB64: bytesToBase64(iv),
    privateKeyCiphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptPrivateKeyJwk(payload: EncryptedPrivateKeyPayload, password: string): Promise<JsonWebKey> {
  const salt = base64ToBytes(payload.saltB64);
  const iv = base64ToBytes(payload.ivB64);
  const ciphertext = base64ToBytes(payload.privateKeyCiphertextB64);
  const key = await deriveAesKey(password, salt, payload.iterations || PBKDF2_ITERATIONS);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(decrypted))) as JsonWebKey;
}

async function deriveAesKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function canonicalizeJwk(jwk: JsonWebKey): string {
  const ordered = Object.keys(jwk)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (jwk as Record<string, unknown>)[key];
      return acc;
    }, {});
  return JSON.stringify(ordered);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
