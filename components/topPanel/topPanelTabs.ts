/** Onglets du panneau Partager (évolutif : WoT, monnaie). */

export type TopPanelTabId =
  | 'network'
  | 'session'
  | 'invitations'
  | 'proposals'
  | 'privacy'
  | 'activity'
  | 'wot'
  | 'money';

/** Niveau d’état pour le témoin lumineux */
export type TabIndicatorLevel = 'ok' | 'warning' | 'error' | 'idle' | 'future';

export const TOP_PANEL_TAB_ORDER: TopPanelTabId[] = [
  'network',
  'session',
  'invitations',
  'proposals',
  'privacy',
  'activity',
  'wot',
  'money',
];

export const TOP_PANEL_TAB_I18N: Record<TopPanelTabId, string> = {
  network: 'topPanel.tabNetwork',
  session: 'topPanel.tabSession',
  invitations: 'topPanel.tabInvitations',
  proposals: 'topPanel.tabProposals',
  privacy: 'topPanel.tabPrivacy',
  activity: 'topPanel.tabActivity',
  wot: 'topPanel.tabWot',
  money: 'topPanel.tabMoney',
};
