/** Constantes sync P2P (chunks, timeouts, normalisation). */

export const SYNC_CHUNK_SIZE = 12_000;
export const SYNC_CHUNK_SEND_DELAY_MS = 8;
export const SYNC_CHUNK_RECEIVE_TIMEOUT_MS = 45000;
export const DOCUMENT_SYNC_CHUNK_SIZE = 48_000;
export const BUNDLE_SYNC_CHUNK_SIZE = 56_000;
export const NORMALIZED_SNAPSHOT_CHUNK_SIZE = 20_000;
export const NORMALIZATION_ALGO_VERSION = 'g2norm-v1';
export const INITIAL_DIFF_BATCH_LIMIT = 300;
export const INITIAL_DIFF_MAX_RETRY = 1;
export const INITIAL_DIFF_REQUEST_TIMEOUT_MS = 12000;
