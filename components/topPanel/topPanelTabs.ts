/** Onglets actifs du panneau Partager. */

export type TopPanelTabId =
  | 'deviceInvites'
  | 'anonymousInvites'
  | 'personalizedInvites'
  | 'proposals'
  | 'activity'
  | 'yourIdentity'
  | 'peerIdentities';

/** Niveau d’état pour le témoin lumineux */
export type TabIndicatorLevel = 'ok' | 'warning' | 'error' | 'idle' | 'future';

export const TOP_PANEL_TAB_ORDER: TopPanelTabId[] = [
  'deviceInvites',
  'anonymousInvites',
  'personalizedInvites',
  'proposals',
  'activity',
  'yourIdentity',
  'peerIdentities',
];

export const TOP_PANEL_TAB_I18N: Record<TopPanelTabId, string> = {
  deviceInvites: 'topPanel.tabDeviceInvites',
  anonymousInvites: 'topPanel.tabAnonymousInvites',
  personalizedInvites: 'topPanel.tabPersonalizedInvites',
  proposals: 'topPanel.tabProposals',
  activity: 'topPanel.tabActivity',
  yourIdentity: 'topPanel.tabYourIdentity',
  peerIdentities: 'topPanel.tabPeerIdentities',
};
