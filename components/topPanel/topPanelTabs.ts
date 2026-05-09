/** Onglets actifs du panneau Partager. */

export type TopPanelTabId =
  | 'yourIdentity'
  | 'p2pPairShare'
  | 'peerIdentities'
  | 'deviceInvites'
  | 'anonymousInvites'
  | 'personalizedInvites'
  | 'proposals'
  | 'activity'
  | 'versionG2';

/** Niveau d’état pour le témoin lumineux */
export type TabIndicatorLevel = 'ok' | 'warning' | 'error' | 'idle' | 'future';

/** Ordre historique / référence ; la barre du panneau utilise des sous-menus (voir `TopPanelTabList`). */
export const TOP_PANEL_TAB_ORDER: TopPanelTabId[] = [
  'yourIdentity',
  'p2pPairShare',
  'peerIdentities',
  'deviceInvites',
  'anonymousInvites',
  'personalizedInvites',
  'proposals',
  'activity',
  'versionG2',
];

export const TOP_PANEL_TAB_I18N: Record<TopPanelTabId, string> = {
  yourIdentity: 'topPanel.tabYourIdentity',
  p2pPairShare: 'topPanel.tabP2pPairShare',
  peerIdentities: 'topPanel.tabPeerIdentities',
  deviceInvites: 'topPanel.tabDeviceInvites',
  anonymousInvites: 'topPanel.tabAnonymousInvites',
  personalizedInvites: 'topPanel.tabPersonalizedInvites',
  proposals: 'topPanel.tabProposals',
  activity: 'topPanel.tabActivity',
  versionG2: 'topPanel.tabVersionG2',
};
