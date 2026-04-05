/** Onglets du panneau Partager (guide pédagogique en premier). */

export type TopPanelTabId =
  | 'guide'
  | 'network'
  | 'session'
  | 'invitations'
  | 'proposals'
  | 'privacy'
  | 'activity'
  | 'wot';

/** Niveau d’état pour le témoin lumineux */
export type TabIndicatorLevel = 'ok' | 'warning' | 'error' | 'idle' | 'future';

export const TOP_PANEL_TAB_ORDER: TopPanelTabId[] = [
  'guide',
  'network',
  'session',
  'invitations',
  'proposals',
  'privacy',
  'activity',
  'wot',
];

export const TOP_PANEL_TAB_I18N: Record<TopPanelTabId, string> = {
  guide: 'topPanel.tabGuide',
  network: 'topPanel.tabNetwork',
  session: 'topPanel.tabSession',
  invitations: 'topPanel.tabInvitations',
  proposals: 'topPanel.tabProposals',
  privacy: 'topPanel.tabPrivacy',
  activity: 'topPanel.tabActivity',
  wot: 'topPanel.tabWot',
};
