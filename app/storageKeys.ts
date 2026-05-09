/** Clés localStorage / persistance locale (préfixes g2:). */

export const SELF_IDENTITY_STORAGE_KEY = 'g2:selfIdentityPublic:v1';
export const SELF_IDENTITY_PRIVATE_STORAGE_KEY = 'g2:selfIdentityPrivateJwk:v1';
export const INVITE_SECRET_STORAGE_KEY = 'g2:p2pInviteSecret:v1';
/** Ids d’invitations révoquées localement (lien mort même après rechargement, même signature HMAC). */
export const INVITE_REVOKED_IDS_STORAGE_KEY = 'g2:p2pRevokedInviteIds:v1';
export const AUTOSAVE_SETTINGS_KEY = 'g2:autoSaveEnabled:v1';
export const P2P_TRANSFER_MODE_KEY = 'g2:p2pTransferMode:v1';
export const P2P_BUNDLE_CONTENT_MODE_KEY = 'g2:p2pBundleContentMode:v1';

/** Confiance pairs (certifications directionnelles + type v1). */
export const PEER_TRUST_STORAGE_KEY = 'g2:peerTrust:v2';
/** Relation généalogique perçue avec chaque pair (parenté connue / non apparenté). */
export const PEER_RELATIONS_STORAGE_KEY = 'g2:peerRelations:v1';
/** Annonce WoT node locale (TTL, racine ancêtres). */
export const WOT_NODE_ANNOUNCEMENT_STORAGE_KEY = 'g2:wotNodeAnnouncement:v1';
