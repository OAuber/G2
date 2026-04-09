import React, { useState, useEffect, useMemo } from 'react';
import {
  Network,
  Copy,
  Check,
  WifiOff,
  BookOpen,
  Link2,
  RefreshCw,
  Send,
  ListChecks,
  Shield,
  BarChart3,
  Fingerprint,
  Smartphone,
  UserPlus,
  Users,
  Share2,
} from 'lucide-react';
import { P2PStatus, P2PMode, IdentityIntroductionContext } from '../types';
import { ActivityLogEvent } from '../services/p2pDomain';
import { useI18n } from '../i18n';
import { TOP_PANEL_TAB_I18N, type TopPanelTabId, type TabIndicatorLevel } from './topPanel/topPanelTabs';
import { TopPanelTabList } from './topPanel/TopPanelTabList';
import type { P2PVisibilitySettings } from '../app/p2pAppTypes';
import type { InviteLinkKind } from '../app/inviteLinkKind';
import { InviteQrCode } from './InviteQrCode';

interface TopPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  isDarkMode: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  // P2P Props
  p2pStatus: P2PStatus;
  p2pMode: P2PMode;
  localHasData: boolean;
  remoteHasData: boolean | null;
  peerId: string | null;
  onInitP2P: () => void;
  onConnectP2P: (hostId: string) => void;
  onStartShare: () => void;
  onStartCompare: () => void;
  transferMode: 'progressive' | 'bundle';
  onChangeTransferMode: (mode: 'progressive' | 'bundle') => void;
  bundleContentMode: 'gedcom-only' | 'gedcom-and-documents';
  onChangeBundleContentMode: (mode: 'gedcom-only' | 'gedcom-and-documents') => void;
  activityEvents: ActivityLogEvent[];
  proposals: Array<{
    proposalId: string;
    individualId: string;
    individualLabel: string;
    authorPeerId: string;
    proposedAt: string;
    operation: 'update_individual' | 'create_individual' | 'delete_individual';
    changeSet: Record<string, unknown>;
    status: 'pending' | 'accepted' | 'rejected';
    decidedAt?: string;
    source?: 'live' | 'initial_compare';
    initialSyncBatchId?: string;
    matchConfidence?: 'high' | 'medium' | 'low';
    matchScore?: number;
    retryAfterReject?: boolean;
    proposalKind?: 'records' | 'documents';
  }>;
  visibilitySettings: P2PVisibilitySettings;
  livingCandidates: Array<{ id: string; label: string }>;
  invites: Array<{
    inviteId: string;
    individualId: string;
    individualName: string;
    role: 'viewer' | 'contributor' | 'editor' | 'comparator';
    expiresAt?: string;
    status: 'active' | 'accepted' | 'revoked' | 'expired';
    personalizedDefault: boolean;
    inviteLink?: string;
    inviteIntent?: 'standard' | 'own_device';
    linkKind?: InviteLinkKind;
  }>;
  /** Partage/comparaison : session issue d’une invitation nominative (type 2). */
  shareCompareAllowed?: boolean;
  /** Lien visite libre anonyme (1.2), sans individu ciblé. `expiresAt` = ISO optionnel. */
  onCreateEphemeralInvite?: (expiresAt?: string) => void;
  pendingInviteToken?: string | null;
  pendingProposalsCount: number;
  syncStatusText?: string | null;
  initialCompareStatusText?: string | null;
  buildLabel?: string;
  onChangeVisibilitySettings: (next: P2PVisibilitySettings) => void;
  onCreateInvite: (individualId: string, role: 'viewer' | 'contributor' | 'editor' | 'comparator', expiresAt?: string) => void;
  /** Auto-invitation : même individu identifié → second appareil (ex. mobile). */
  onCreateOwnDeviceInvite?: (role: 'viewer' | 'contributor' | 'editor', expiresAt?: string) => void;
  selfIndividualId?: string | null;
  trustedOwnDevicePeerId?: string | null;
  ownDevicePendingCount?: number;
  onOwnDeviceAcceptAll?: () => void;
  onOwnDeviceRejectAllAndRevoke?: () => void;
  onRevokeInvite: (inviteId: string) => void;
  onAcceptInvite: (inviteId: string) => void;
  onReviewProposal: (proposalId: string) => void;
  /** WoT / identité — résumé et lien vers le panneau détails. */
  isIdentityClaimed?: boolean;
  identityIntroduction?: IdentityIntroductionContext;
  onOpenIdentityPanel?: () => void;
  /** Raccourci après invite : invité pas encore identifié. */
  showCompleteIdentityHint?: boolean;
  /** Comparaison : message supplémentaire (ex. inviter le pair à charger son GEDCOM). */
  compareSessionExtraHint?: string | null;
}

const TopPanel: React.FC<TopPanelProps> = ({ 
  isOpen, 
  onToggle, 
  isDarkMode,
  onMouseEnter, 
  onMouseLeave,
  p2pStatus,
  p2pMode,
  localHasData,
  remoteHasData,
  peerId,
  onInitP2P,
  onConnectP2P,
  onStartShare,
  onStartCompare,
  transferMode,
  onChangeTransferMode,
  bundleContentMode,
  onChangeBundleContentMode,
  activityEvents,
  proposals,
  visibilitySettings,
  livingCandidates,
  invites,
  pendingInviteToken,
  pendingProposalsCount,
  syncStatusText,
  initialCompareStatusText,
  buildLabel,
  onChangeVisibilitySettings,
  onCreateInvite,
  onCreateOwnDeviceInvite,
  selfIndividualId,
  trustedOwnDevicePeerId,
  ownDevicePendingCount = 0,
  onOwnDeviceAcceptAll,
  onOwnDeviceRejectAllAndRevoke,
  onRevokeInvite,
  onAcceptInvite,
  onReviewProposal,
  isIdentityClaimed = false,
  identityIntroduction,
  onOpenIdentityPanel,
  showCompleteIdentityHint = false,
  shareCompareAllowed = true,
  onCreateEphemeralInvite,
  compareSessionExtraHint = null,
}) => {
  const { t } = useI18n();
  const [targetHostId, setTargetHostId] = useState('');
  const [copied, setCopied] = useState(false);
  const [newInviteIndividualId, setNewInviteIndividualId] = useState('');
  const [newInviteRole, setNewInviteRole] = useState<'viewer' | 'contributor' | 'editor' | 'comparator'>('viewer');
  const [newInviteExpiresAt, setNewInviteExpiresAt] = useState('');
  const [ephemeralInviteExpiresAt, setEphemeralInviteExpiresAt] = useState('');
  const [ownDeviceRole, setOwnDeviceRole] = useState<'viewer' | 'contributor' | 'editor'>('contributor');
  const [ownDeviceTtlPreset, setOwnDeviceTtlPreset] = useState<'none' | '365' | '730' | '1825' | 'custom'>('none');
  const [ownDeviceExpiresCustom, setOwnDeviceExpiresCustom] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showActivityDetails, setShowActivityDetails] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [proposalPage, setProposalPage] = useState(0);
  const PROPOSALS_PAGE_SIZE = 30;
  const [activeTab, setActiveTab] = useState<TopPanelTabId>('guide');

  const inviteExpiringSoon = useMemo(() => {
    const week = 7 * 24 * 60 * 60 * 1000;
    return invites.some((inv) => {
      if (inv.status !== 'active' || !inv.expiresAt) return false;
      const exp = Date.parse(inv.expiresAt);
      return exp - Date.now() < week && exp > Date.now();
    });
  }, [invites]);

  const tabIndicators = useMemo((): Record<TopPanelTabId, TabIndicatorLevel> => {
    let network: TabIndicatorLevel = 'idle';
    if (!isOnline) network = 'error';
    else if (p2pStatus === 'connected') network = 'ok';
    else if (p2pStatus === 'connecting') network = 'warning';
    else network = 'idle';

    let session: TabIndicatorLevel = 'idle';
    if (p2pStatus === 'connected') {
      if (syncStatusText || initialCompareStatusText) session = 'warning';
      else session = 'ok';
    }

    let invitations: TabIndicatorLevel = 'idle';
    if (invites.length > 0 || pendingInviteToken) invitations = 'ok';
    if (ownDevicePendingCount > 0 || inviteExpiringSoon) invitations = 'warning';

    const proposalsTab: TabIndicatorLevel =
      pendingProposalsCount > 0 ? 'error' : proposals.length > 0 ? 'ok' : 'idle';

    const privacy: TabIndicatorLevel = 'ok';

    const activity: TabIndicatorLevel = activityEvents.length > 0 ? 'ok' : 'idle';

    return {
      guide: 'idle',
      network,
      session,
      invitations,
      proposals: proposalsTab,
      privacy,
      activity,
      wot: isIdentityClaimed ? 'ok' : 'warning',
    };
  }, [
    isOnline,
    p2pStatus,
    syncStatusText,
    initialCompareStatusText,
    invites.length,
    pendingInviteToken,
    isIdentityClaimed,
    ownDevicePendingCount,
    inviteExpiringSoon,
    pendingProposalsCount,
    proposals.length,
    activityEvents.length,
  ]);

  const indicatorDotClass = (level: TabIndicatorLevel): string => {
    switch (level) {
      case 'ok':
        return 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]';
      case 'warning':
        return 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.55)]';
      case 'error':
        return 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.55)]';
      case 'idle':
        return isDarkMode ? 'bg-slate-600' : 'bg-slate-400';
      case 'future':
        return isDarkMode ? 'bg-slate-700 ring-1 ring-slate-500' : 'bg-slate-300 ring-1 ring-slate-400';
      default:
        return 'bg-slate-500';
    }
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleCopyId = () => {
    if (peerId) {
      navigator.clipboard.writeText(peerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  const bgClass = isDarkMode ? 'bg-black/95 border-slate-800' : 'bg-white/95 border-slate-300';
  const textClass = isDarkMode ? 'text-slate-200' : 'text-slate-700';
  const subTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  
  // Tab Style Handle
  const handleBg = isDarkMode 
    ? 'bg-black text-slate-400 border-slate-800 hover:bg-neutral-900' 
    : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50';

  const btnAction = isDarkMode
    ? 'bg-neutral-700 hover:bg-neutral-600 text-white'
    : 'bg-slate-200 hover:bg-slate-300 text-slate-800 border border-slate-300';

  const inputBg = isDarkMode
    ? 'bg-neutral-800 border-slate-700 text-white'
    : 'bg-white border-slate-300 text-slate-800';

  const cardClass = isDarkMode ? 'bg-neutral-900/50 border-slate-700' : 'bg-slate-50 border-slate-200';
  const activitySummary = useMemo(() => {
    const counts = { view: 0, download: 0, proposal: 0, merges: 0 };
    for (const event of activityEvents) {
      if (event.eventType.includes('view')) counts.view += 1;
      if (event.eventType.includes('download')) counts.download += 1;
      if (event.eventType.includes('proposal')) counts.proposal += 1;
      if (
        event.eventType.includes('merge_apply') ||
        event.eventType === 'proposal.received' ||
        event.eventType.includes('compare_peer') ||
        event.eventType.includes('compare_snapshot')
      ) {
        counts.merges += 1;
      }
    }
    return counts;
  }, [activityEvents]);

  const pagedProposals = useMemo(() => {
    const start = proposalPage * PROPOSALS_PAGE_SIZE;
    return proposals.slice(start, start + PROPOSALS_PAGE_SIZE);
  }, [proposalPage, proposals]);

  const proposalsPageCount = Math.max(1, Math.ceil(proposals.length / PROPOSALS_PAGE_SIZE));
  const formatProposalType = (op: 'update_individual' | 'create_individual' | 'delete_individual') => {
    if (op === 'update_individual') return t('topPanel.proposalUpdate');
    if (op === 'create_individual') return t('topPanel.proposalCreate');
    return t('topPanel.proposalDelete');
  };
  const formatInviteRole = (role: 'viewer' | 'contributor' | 'editor' | 'comparator') => {
    if (role === 'viewer') return t('topPanel.roleViewer');
    if (role === 'contributor') return t('topPanel.roleContributor');
    if (role === 'comparator') return t('topPanel.roleComparator');
    return t('topPanel.roleEditor');
  };
  const copyInviteLink = async (inviteId: string, link?: string) => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopiedInviteId(inviteId);
    window.setTimeout(() => setCopiedInviteId((current) => (current === inviteId ? null : current)), 1800);
  };
  const isInviteMode = p2pMode === 'client' || !!pendingInviteToken;
  const showShareAction = p2pMode === 'host';

  const sessionContextKey = useMemo(() => {
    if (pendingInviteToken) return 'invitee' as const;
    if (p2pMode === 'client') return 'guest' as const;
    if (p2pMode === 'host') return 'host' as const;
    if (trustedOwnDevicePeerId) return 'ownDevice' as const;
    return 'solo' as const;
  }, [pendingInviteToken, p2pMode, trustedOwnDevicePeerId]);

  const computeOwnDeviceExpiresAt = (): string | undefined => {
    if (ownDeviceTtlPreset === 'none') return undefined;
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    if (ownDeviceTtlPreset === '365') return new Date(now + 365 * day).toISOString();
    if (ownDeviceTtlPreset === '730') return new Date(now + 730 * day).toISOString();
    if (ownDeviceTtlPreset === '1825') return new Date(now + 1825 * day).toISOString();
    if (ownDeviceTtlPreset === 'custom' && ownDeviceExpiresCustom) {
      const d = new Date(ownDeviceExpiresCustom);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    return undefined;
  };
  // Allow actions when remote state is unknown; handlers perform final checks.
  const canStartShare = showShareAction && localHasData && remoteHasData !== true && shareCompareAllowed;
  const canStartCompare = localHasData && remoteHasData !== false && shareCompareAllowed;

  useEffect(() => {
    setProposalPage((prev) => Math.min(prev, proposalsPageCount - 1));
  }, [proposalsPageCount]);

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] pointer-events-none">
      <div
        className="overflow-hidden"
        style={{ maxHeight: isOpen ? 'calc(100vh - 120px)' : '0px', transition: 'max-height 300ms ease' }}
      >
        <div 
          className={`pointer-events-auto ${bgClass} backdrop-blur-md border-b px-3 py-1.5 shadow-xl h-[calc(100vh-120px)] overflow-y-auto`}
          style={{ touchAction: 'pan-y' }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <div className="w-full max-w-5xl mx-auto min-w-0 flex flex-col gap-2">
            <TopPanelTabList
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              tabIndicators={tabIndicators}
              isDarkMode={isDarkMode}
              indicatorDotClass={indicatorDotClass}
            />

            <div
              className={`rounded-lg border px-3 py-2 ${cardClass}`}
              role="status"
              aria-live="polite"
            >
              <span className={`font-bold uppercase tracking-wide text-[10px] ${subTextClass}`}>
                {t('topPanel.contextBadge')}
              </span>
              <p className={`text-xs mt-1 leading-relaxed ${textClass}`}>
                {t(`topPanel.contextMessage_${sessionContextKey}`)}
              </p>
              {compareSessionExtraHint && (
                <p
                  className={`text-[11px] mt-2 leading-relaxed border-t pt-2 ${isDarkMode ? 'border-slate-700 text-amber-200/95' : 'border-amber-200 text-amber-900'}`}
                >
                  {compareSessionExtraHint}
                </p>
              )}
            </div>

            <div
              className="min-h-0"
              role="tabpanel"
              id={`top-panel-${activeTab}`}
              aria-labelledby={`top-tab-${activeTab}`}
            >
          {activeTab === 'guide' && (
            <section className={`rounded-xl border p-4 space-y-4 ${cardClass}`}>
              <div className="flex items-start gap-3">
                <BookOpen className={`w-8 h-8 shrink-0 ${isDarkMode ? 'text-sky-400' : 'text-sky-600'}`} aria-hidden />
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide">{t('topPanel.guideTitle')}</h3>
                  <p className={`text-xs mt-1.5 leading-relaxed ${subTextClass}`}>{t('topPanel.guideIntro')}</p>
                  <p className={`text-[11px] mt-2 leading-relaxed ${subTextClass} opacity-95`}>
                    {t('topPanel.guideServerHint')}
                  </p>
                </div>
              </div>

              <div>
                <h4 className={`text-xs font-bold uppercase tracking-wide mb-2 ${textClass}`}>{t('topPanel.guideScenariosTitle')}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(
                    [
                      {
                        tab: 'invitations' as const,
                        Icon: Smartphone,
                        titleKey: 'guideScenarioSoloTitle',
                        descKey: 'guideScenarioSoloDesc',
                      },
                      {
                        tab: 'invitations' as const,
                        Icon: UserPlus,
                        titleKey: 'guideScenarioHostTitle',
                        descKey: 'guideScenarioHostDesc',
                      },
                      {
                        tab: 'network' as const,
                        Icon: Users,
                        titleKey: 'guideScenarioGuestTitle',
                        descKey: 'guideScenarioGuestDesc',
                      },
                      {
                        tab: 'wot' as const,
                        Icon: Share2,
                        titleKey: 'guideScenarioWotTitle',
                        descKey: 'guideScenarioWotDesc',
                      },
                    ] as const
                  ).map(({ tab, Icon, titleKey, descKey }, i) => (
                    <div
                      key={`${titleKey}-${i}`}
                      className={`rounded-lg border p-3 flex flex-col gap-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/35' : 'border-slate-200 bg-white'}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${isDarkMode ? 'text-violet-400' : 'text-violet-600'}`} aria-hidden />
                        <span className={`text-xs font-bold ${textClass}`}>{t(`topPanel.${titleKey}`)}</span>
                      </div>
                      <p className={`text-[11px] leading-snug flex-1 ${subTextClass}`}>{t(`topPanel.${descKey}`)}</p>
                      <button
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`text-[11px] px-2 py-1.5 rounded font-semibold w-full sm:w-auto self-start ${
                          isDarkMode
                            ? 'bg-violet-900/80 hover:bg-violet-800 text-violet-100 border border-violet-800'
                            : 'bg-violet-100 hover:bg-violet-200 text-violet-900 border border-violet-200'
                        }`}
                      >
                        {t('topPanel.guideOpen')} — {t(TOP_PANEL_TAB_I18N[tab])}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className={`text-xs font-bold uppercase tracking-wide mb-2 ${textClass}`}>{t('topPanel.guideSharingModesTitle')}</h4>
                <div className={`space-y-2 rounded-lg border p-3 ${isDarkMode ? 'border-slate-700 bg-slate-900/25' : 'border-slate-200 bg-white'}`}>
                  {(
                    [
                      { Icon: Link2, titleKey: 'guideModePeerTitle', descKey: 'guideModePeerDesc' },
                      { Icon: Send, titleKey: 'guideModeLinkTitle', descKey: 'guideModeLinkDesc' },
                      { Icon: Share2, titleKey: 'guideModeWotTitle', descKey: 'guideModeWotDesc' },
                    ] as const
                  ).map(({ Icon, titleKey, descKey }) => (
                    <div key={titleKey} className="flex gap-2 items-start">
                      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`} aria-hidden />
                      <div>
                        <div className={`text-xs font-semibold ${textClass}`}>{t(`topPanel.${titleKey}`)}</div>
                        <p className={`text-[11px] leading-snug mt-0.5 ${subTextClass}`}>{t(`topPanel.${descKey}`)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className={`text-xs font-bold uppercase tracking-wide mb-2 ${textClass}`}>{t('topPanel.guideQuickLinksTitle')}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(
                    [
                      { tab: 'network' as const, Icon: Link2, titleKey: 'guideUseNetworkTitle', descKey: 'guideUseNetworkDesc' },
                      { tab: 'session', Icon: RefreshCw, titleKey: 'guideUseSessionTitle', descKey: 'guideUseSessionDesc' },
                      { tab: 'invitations', Icon: Send, titleKey: 'guideUseInvitationsTitle', descKey: 'guideUseInvitationsDesc' },
                      { tab: 'proposals', Icon: ListChecks, titleKey: 'guideUseProposalsTitle', descKey: 'guideUseProposalsDesc' },
                      { tab: 'privacy', Icon: Shield, titleKey: 'guideUsePrivacyTitle', descKey: 'guideUsePrivacyDesc' },
                      { tab: 'activity', Icon: BarChart3, titleKey: 'guideUseActivityTitle', descKey: 'guideUseActivityDesc' },
                      { tab: 'wot', Icon: Fingerprint, titleKey: 'guideUseWotTitle', descKey: 'guideUseWotDesc' },
                    ] as const
                  ).map(({ tab, Icon, titleKey, descKey }) => (
                    <div
                      key={tab}
                      className={`rounded-lg border p-3 flex flex-col gap-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/35' : 'border-slate-200 bg-white'}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`} aria-hidden />
                        <span className={`text-xs font-bold ${textClass}`}>{t(`topPanel.${titleKey}`)}</span>
                      </div>
                      <p className={`text-[11px] leading-snug flex-1 ${subTextClass}`}>{t(`topPanel.${descKey}`)}</p>
                      <button
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`text-[11px] px-2 py-1.5 rounded font-semibold w-full sm:w-auto self-start ${
                          isDarkMode ? 'bg-sky-900/80 hover:bg-sky-800 text-sky-100 border border-sky-800' : 'bg-sky-100 hover:bg-sky-200 text-sky-900 border border-sky-200'
                        }`}
                      >
                        {t('topPanel.guideOpen')} — {t(TOP_PANEL_TAB_I18N[tab])}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* P2P Network Section — onglet Réseau */}
          {activeTab === 'network' && (
          <div className="space-y-2">
          <div className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 ${isDarkMode ? 'bg-neutral-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
            <Network className={`w-3.5 h-3.5 shrink-0 ${!isOnline ? 'text-red-500' : (p2pStatus === 'connected' ? 'text-green-500' : 'text-slate-500')}`} />
            
            {!isOnline ? (
              <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-500 rounded flex items-center gap-1 shrink-0">
                <WifiOff className="w-3 h-3" /> {t('topPanel.offline')}
              </span>
            ) : (
              <>
                {p2pStatus === 'disconnected' && (
                  <button onClick={onInitP2P} className={`flex items-center gap-1 px-2 py-0.5 rounded font-bold text-[10px] transition-colors shadow-sm shrink-0 ${btnAction}`}>
                    {t('topPanel.enableP2P')}
                  </button>
                )}
                {p2pStatus !== 'disconnected' && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${p2pStatus === 'connected' ? 'bg-green-500/20 text-green-500' : 'bg-yellow-500/20 text-yellow-500'}`}>
                    {p2pStatus}
                  </span>
                )}
              </>
            )}

            {isOnline && p2pStatus !== 'disconnected' && (
              <div className="flex items-center gap-1 min-w-0">
                {peerId ? (
                  <>
                    <div className="flex flex-col min-w-0">
                      <span className={`text-[9px] ${subTextClass}`}>{t('topPanel.myPeerId')}</span>
                      <input
                        readOnly
                        value={peerId}
                        className={`w-24 text-[9px] font-mono px-1 py-0.5 rounded border ${inputBg} opacity-70`}
                      />
                    </div>
                    <button onClick={handleCopyId} className={`p-0.5 rounded shrink-0 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-200'} ${textClass}`}>
                      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </>
                ) : <span className="text-[9px] opacity-50 animate-pulse">{t('topPanel.idLoading')}</span>}
                
                {p2pStatus !== 'connected' && (
                  <>
                    <div className="flex flex-col min-w-0">
                      <span className={`text-[9px] ${subTextClass}`}>{t('topPanel.yourPeerId')}</span>
                      <input
                        placeholder={t('topPanel.peerIdPlaceholder')}
                        value={targetHostId}
                        onChange={e => setTargetHostId(e.target.value)}
                        className={`w-36 text-[9px] px-1 py-0.5 rounded border ${inputBg}`}
                      />
                    </div>
                    <button 
                      onClick={() => onConnectP2P(targetHostId)}
                      disabled={!targetHostId}
                      className={`flex items-center px-2 py-0.5 rounded font-bold text-[10px] transition-colors shadow-sm shrink-0 ${btnAction} disabled:opacity-50`}
                    >
                      {t('topPanel.go')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {!isOnline && (
            <span className={`text-[9px] ${subTextClass} italic`}>{t('topPanel.localMode')}</span>
          )}
          {isOnline && (
            <p className={`text-[10px] mt-1 ${subTextClass}`}>{t('topPanel.networkPeerIdHint')}</p>
          )}
          </div>
          )}

          {activeTab === 'session' && (
          <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
          {isOnline && syncStatusText && (
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded border ${
                isDarkMode ? 'border-slate-700 bg-slate-900/60 text-cyan-300' : 'border-slate-300 bg-white text-cyan-700'
              }`}
            >
              {t('topPanel.sync')}: {syncStatusText}
            </span>
          )}
          {isOnline && initialCompareStatusText && (
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded border ${
                isDarkMode ? 'border-slate-700 bg-slate-900/60 text-violet-300' : 'border-slate-300 bg-white text-violet-700'
              }`}
            >
              {t('topPanel.compare')}: {initialCompareStatusText}
            </span>
          )}
          </div>
          <p className={`text-[10px] ${subTextClass}`}>{t('topPanel.sessionDurabilityHint')}</p>
          {!shareCompareAllowed && p2pStatus === 'connected' && (
            <p className={`text-[10px] mt-1 ${subTextClass}`}>{t('topPanel.shareCompareNamedInviteHint')}</p>
          )}

        {showCompleteIdentityHint && onOpenIdentityPanel && (
          <div
            className={`rounded-lg border p-3 mb-2 ${
              isDarkMode ? 'border-amber-600/50 bg-amber-950/40' : 'border-amber-300 bg-amber-50'
            }`}
          >
            <p className={`text-xs font-semibold ${isDarkMode ? 'text-amber-100' : 'text-amber-900'}`}>
              {t('topPanel.completeIdentityTitle')}
            </p>
            <p className={`text-[11px] mt-1 ${subTextClass}`}>{t('topPanel.completeIdentityBody')}</p>
            <button
              type="button"
              onClick={onOpenIdentityPanel}
              className={`mt-2 text-[11px] px-3 py-1.5 rounded font-bold ${
                isDarkMode ? 'bg-emerald-700 hover:bg-emerald-600 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {t('topPanel.completeIdentityCta')}
            </button>
          </div>
        )}

        {p2pStatus !== 'disconnected' && (
          <div className="mt-0 flex items-center gap-2 flex-wrap">
            {showShareAction && (
              <label className={`text-[10px] ${subTextClass} flex items-center gap-1`}>
                <span>{t('topPanel.transferModeLabel')}</span>
                <select
                  value={transferMode}
                  onChange={(e) => onChangeTransferMode(e.target.value as 'progressive' | 'bundle')}
                  className={`text-[10px] rounded border px-1 py-0.5 ${inputBg}`}
                >
                  <option value="progressive">{t('topPanel.transferModeProgressive')}</option>
                  <option value="bundle">{t('topPanel.transferModeBundle')}</option>
                </select>
              </label>
            )}
            {showShareAction && transferMode === 'bundle' && (
              <label className={`text-[10px] ${subTextClass} flex items-center gap-1`}>
                <span>{t('topPanel.bundleContentLabel')}</span>
                <select
                  value={bundleContentMode}
                  onChange={(e) => onChangeBundleContentMode(e.target.value as 'gedcom-only' | 'gedcom-and-documents')}
                  className={`text-[10px] rounded border px-1 py-0.5 ${inputBg}`}
                >
                  <option value="gedcom-only">{t('topPanel.bundleContentGedcomOnly')}</option>
                  <option value="gedcom-and-documents">{t('topPanel.bundleContentGedcomAndDocuments')}</option>
                </select>
              </label>
            )}
            {showShareAction && (
              <button
                onClick={onStartShare}
                disabled={!canStartShare}
                className={`text-[10px] px-2 py-1 rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'bg-blue-700 hover:bg-blue-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
              >
                {t('topPanel.share')}
              </button>
            )}
            <button
              onClick={onStartCompare}
              disabled={!canStartCompare}
              className={`text-[10px] px-2 py-1 rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'bg-violet-700 hover:bg-violet-600 text-white' : 'bg-violet-600 hover:bg-violet-500 text-white'}`}
            >
              {t('topPanel.compare')}
            </button>
            <button
              disabled
              className={`text-[10px] px-2 py-1 rounded font-bold opacity-50 cursor-not-allowed ${btnAction}`}
              title={t('topPanel.comingSoon')}
            >
              {t('topPanel.search')}
            </button>
            <span className={`text-[9px] ${subTextClass}`}>
              {t('topPanel.remoteGedcom')}: {remoteHasData === null ? t('topPanel.unknownShort') : remoteHasData ? t('topPanel.loaded') : t('topPanel.empty')}
            </span>
            <span className={`text-[9px] ${subTextClass}`}>
              {t('topPanel.mode')}:{p2pMode || t('topPanel.none')} {t('topPanel.local')}:{localHasData ? t('topPanel.loaded') : t('topPanel.empty')} {t('topPanel.remote')}:{remoteHasData === null ? t('topPanel.unknownShort') : remoteHasData ? t('topPanel.loaded') : t('topPanel.empty')}
            </span>
            {buildLabel && (
              <span className={`text-[9px] ${subTextClass}`}>
                {t('topPanel.build')}: {buildLabel}
              </span>
            )}
          </div>
        )}
          </div>
          )}

        {activeTab === 'proposals' && (
        <div className="grid grid-cols-1 gap-4 mt-0">
          <section className={`rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3">
              {t('topPanel.proposals')} {proposals.length > 0 ? `(${proposals.length})` : ''}
            </h3>
            {proposals.length > PROPOSALS_PAGE_SIZE && (
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-xs ${subTextClass}`}>{t('topPanel.page')} {proposalPage + 1} / {proposalsPageCount}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={proposalPage === 0}
                    onClick={() => setProposalPage((p) => Math.max(0, p - 1))}
                    className={`px-2 py-1 rounded text-xs font-semibold ${btnAction} disabled:opacity-50`}
                  >
                    {t('topPanel.prev')}
                  </button>
                  <button
                    type="button"
                    disabled={proposalPage >= proposalsPageCount - 1}
                    onClick={() => setProposalPage((p) => Math.min(proposalsPageCount - 1, p + 1))}
                    className={`px-2 py-1 rounded text-xs font-semibold ${btnAction} disabled:opacity-50`}
                  >
                    {t('topPanel.next')}
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
              {proposals.length === 0 ? (
                <p className={`text-sm ${subTextClass}`}>{t('topPanel.noProposals')}</p>
              ) : (
                pagedProposals.map((proposal) => (
                  <div key={proposal.proposalId} className={`rounded border px-2 py-1 text-xs ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{proposal.individualLabel}</div>
                        <div className={`text-[10px] ${subTextClass} flex items-center gap-1`}>
                          <span className="px-1 rounded border border-slate-500/40">{formatProposalType(proposal.operation)}</span>
                          {proposal.proposalKind === 'documents' && (
                            <span className="px-1 rounded border border-violet-500/50 text-violet-500">{t('topPanel.proposalDocuments')}</span>
                          )}
                          {proposal.source === 'initial_compare' && (
                            <span className="px-1 rounded border border-blue-500/50">{t('topPanel.initialCompare')}</span>
                          )}
                          {proposal.retryAfterReject && (
                            <span className="px-1 rounded border border-rose-500/50 text-rose-500">{t('topPanel.afterReject')}</span>
                          )}
                          <span>{new Date(proposal.proposedAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <span className={`text-[9px] px-1 py-0.5 rounded ${
                        proposal.status === 'pending'
                          ? 'bg-amber-500/20 text-amber-500'
                          : proposal.status === 'accepted'
                            ? 'bg-emerald-500/20 text-emerald-500'
                            : 'bg-rose-500/20 text-rose-500'
                      }`}>
                        {proposal.status}
                      </span>
                    </div>
                    {proposal.status === 'pending' && (
                      <div className="mt-1 flex gap-2">
                        <button
                          onClick={() => onReviewProposal(proposal.proposalId)}
                          className={`px-2 py-1 rounded text-[11px] font-semibold ${isDarkMode ? 'bg-blue-800 hover:bg-blue-700' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
                        >
                          {t('topPanel.review')}
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
        )}

        {activeTab === 'activity' && (
          <section className={`rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3">{t('topPanel.activity')}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <StatCard label={t('topPanel.views')} value={activitySummary.view} isDarkMode={isDarkMode} />
              <StatCard label={t('topPanel.downloads')} value={activitySummary.download} isDarkMode={isDarkMode} />
              <StatCard label={t('topPanel.proposals')} value={activitySummary.proposal} isDarkMode={isDarkMode} />
              <StatCard label={t('topPanel.merges')} value={activitySummary.merges} isDarkMode={isDarkMode} />
            </div>
            <div className="flex items-center justify-between mb-2">
              <p className={`text-xs ${subTextClass}`}>
                {activityEvents.length === 0
                  ? t('topPanel.noActivity')
                  : `${activityEvents.length} ${t('topPanel.eventsRecorded')}`}
              </p>
              <button
                type="button"
                onClick={() => setShowActivityDetails((prev) => !prev)}
                className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-slate-800 hover:bg-slate-700 text-slate-100' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'}`}
              >
                {showActivityDetails ? t('topPanel.hideDetails') : t('topPanel.showDetails')}
              </button>
            </div>
            {showActivityDetails && (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {activityEvents.length === 0 ? (
                  <p className={`text-sm ${subTextClass}`}>{t('topPanel.noActivity')}</p>
                ) : (
                  activityEvents.slice().reverse().map((event) => (
                    <div key={event.eventId} className={`rounded border p-2 text-xs ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                      <div className="font-semibold">{event.eventType}</div>
                      <div className={subTextClass}>
                        {t('topPanel.actor')}: {event.actorPeerId} | {t('topPanel.target')}: {event.targetType}:{event.targetId}
                      </div>
                      <div className={subTextClass}>{new Date(event.timestamp).toLocaleString()}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        )}

        {activeTab === 'privacy' && (
          <section className={`rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-2">{t('topPanel.visibilityProfilesTitle')}</h3>
            <p className={`text-xs mb-3 leading-relaxed ${subTextClass}`}>{t('topPanel.visibilityProfilesIntro')}</p>
            <h4 className={`text-xs font-bold uppercase tracking-wide mb-2 ${textClass}`}>
              {t('topPanel.visibilityDefaultProfileTitle')}
            </h4>
            <div className="space-y-2 text-sm">
              <ToggleRow label={t('topPanel.exposeIdentity')} checked={visibilitySettings.exposeIdentity} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeIdentity: checked })} />
              <ToggleRow label={t('topPanel.exposeDates')} checked={visibilitySettings.exposeDates} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeDates: checked })} />
              <ToggleRow label={t('topPanel.exposePlaces')} checked={visibilitySettings.exposePlaces} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposePlaces: checked })} />
              <ToggleRow label={t('topPanel.exposeNotes')} checked={visibilitySettings.exposeNotes} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeNotes: checked })} />
              <ToggleRow label={t('topPanel.allowDocumentsSync')} checked={visibilitySettings.allowDocuments} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDocuments: checked })} />
              <ToggleRow label={t('topPanel.allowDownload')} checked={visibilitySettings.allowDownload} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDownload: checked })} />
              <ToggleRow label={t('topPanel.allowProposals')} checked={visibilitySettings.allowProposal} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowProposal: checked })} />
              <ToggleRow label={t('topPanel.allowDirectEdits')} checked={visibilitySettings.allowDirectEdit} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDirectEdit: checked })} />
            </div>
            <p className={`text-[11px] mt-3 leading-relaxed italic ${subTextClass}`}>{t('topPanel.visibilityPerPeerNote')}</p>
          </section>
        )}

        {activeTab === 'invitations' && (
          <section className={`rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-2">{t('topPanel.connectionProfiles')}</h3>
            <p className={`text-xs mb-3 ${subTextClass}`}>
              {isInviteMode ? t('topPanel.invitedModeHint') : t('topPanel.connectionProfilesHint')}
            </p>
            <p className={`text-[11px] mb-3 ${subTextClass}`}>{t('topPanel.invitationsProfilesBridge')}</p>
            {!isInviteMode && onCreateEphemeralInvite && (
              <div className={`mb-4 rounded-lg border p-3 ${isDarkMode ? 'border-teal-900/80 bg-teal-950/25' : 'border-teal-200 bg-teal-50/80'}`}>
                <div className={`text-sm font-bold mb-1 ${isDarkMode ? 'text-teal-300' : 'text-teal-800'}`}>
                  {t('topPanel.ephemeralInviteSectionTitle')}
                </div>
                <p className={`text-[11px] mb-2 ${subTextClass}`}>{t('topPanel.ephemeralInviteSectionHint')}</p>
                <label className={`block text-[11px] mb-2 ${subTextClass}`}>
                  {t('topPanel.ephemeralInviteExpiresOptional')}
                  <input
                    type="datetime-local"
                    value={ephemeralInviteExpiresAt}
                    onChange={(e) => setEphemeralInviteExpiresAt(e.target.value)}
                    className={`mt-1 block w-full max-w-xs rounded border px-2 py-1 text-sm ${inputBg}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const iso = ephemeralInviteExpiresAt
                      ? new Date(ephemeralInviteExpiresAt).toISOString()
                      : undefined;
                    onCreateEphemeralInvite(iso);
                  }}
                  className={`text-sm rounded px-3 py-2 font-semibold ${isDarkMode ? 'bg-teal-800 hover:bg-teal-700 text-white' : 'bg-teal-600 text-white hover:bg-teal-500'}`}
                >
                  {t('topPanel.createEphemeralInvite')}
                </button>
              </div>
            )}
            {!isInviteMode && (
            <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-1">
              <select
                value={newInviteIndividualId}
                onChange={(e) => setNewInviteIndividualId(e.target.value)}
                className={`text-sm rounded border px-2 py-1 ${inputBg}`}
              >
                <option value="">{t('topPanel.selectLivingMember')}</option>
                {livingCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                ))}
              </select>
              <select
                value={newInviteRole}
                onChange={(e) =>
                  setNewInviteRole(e.target.value as 'viewer' | 'contributor' | 'editor' | 'comparator')
                }
                className={`text-sm rounded border px-2 py-1 ${inputBg}`}
              >
                <option value="viewer">{t('topPanel.roleViewer')}</option>
                <option value="contributor">{t('topPanel.roleContributor')}</option>
                <option value="editor">{t('topPanel.roleEditor')}</option>
                <option value="comparator">{t('topPanel.roleComparator')}</option>
              </select>
              <input
                type="date"
                value={newInviteExpiresAt}
                onChange={(e) => setNewInviteExpiresAt(e.target.value)}
                className={`text-sm rounded border px-2 py-1 ${inputBg}`}
                title={t('topPanel.inviteExpiryOptionalHint')}
              />
              <button
                onClick={() => {
                  if (!newInviteIndividualId) return;
                  onCreateInvite(newInviteIndividualId, newInviteRole, newInviteExpiresAt ? new Date(newInviteExpiresAt).toISOString() : undefined);
                  setNewInviteIndividualId('');
                  setNewInviteRole('viewer');
                  setNewInviteExpiresAt('');
                }}
                className={`text-sm rounded px-3 py-1.5 font-semibold ${isDarkMode ? 'bg-blue-700 hover:bg-blue-600' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
              >
                {t('topPanel.createInvite')}
              </button>
            </div>
            <p className={`text-[11px] mb-3 ${subTextClass}`}>{t('topPanel.inviteExpiryOptionalHint')}</p>
            <p className={`text-[11px] mb-3 ${subTextClass}`}>{t('topPanel.comparatorRoleHint')}</p>
            </>
            )}
            {!isInviteMode && onCreateOwnDeviceInvite && selfIndividualId && (
              <div className={`mb-4 rounded-lg border p-3 ${isDarkMode ? 'border-indigo-900/80 bg-indigo-950/30' : 'border-indigo-200 bg-indigo-50/80'}`}>
                <div className={`text-sm font-bold mb-1 ${isDarkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>{t('topPanel.ownDeviceInviteTitle')}</div>
                <p className={`text-[11px] mb-3 ${subTextClass}`}>{t('topPanel.ownDeviceInviteHint')}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
                  <label className={`flex flex-col gap-0.5 text-[11px] ${subTextClass}`}>
                    <span>{t('topPanel.ownDeviceRole')}</span>
                    <select
                      value={ownDeviceRole}
                      onChange={(e) => setOwnDeviceRole(e.target.value as 'viewer' | 'contributor' | 'editor')}
                      className={`text-sm rounded border px-2 py-1 ${inputBg}`}
                    >
                      <option value="viewer">{t('topPanel.roleViewer')}</option>
                      <option value="contributor">{t('topPanel.roleContributor')}</option>
                      <option value="editor">{t('topPanel.roleEditor')}</option>
                    </select>
                  </label>
                  <label className={`flex flex-col gap-0.5 text-[11px] md:col-span-2 ${subTextClass}`}>
                    <span>{t('topPanel.ownDeviceTtl')}</span>
                    <select
                      value={ownDeviceTtlPreset}
                      onChange={(e) => setOwnDeviceTtlPreset(e.target.value as 'none' | '365' | '730' | '1825' | 'custom')}
                      className={`text-sm rounded border px-2 py-1 ${inputBg}`}
                    >
                      <option value="none">{t('topPanel.ownDeviceTtlNone')}</option>
                      <option value="365">{t('topPanel.ownDeviceTtl1y')}</option>
                      <option value="730">{t('topPanel.ownDeviceTtl2y')}</option>
                      <option value="1825">{t('topPanel.ownDeviceTtl5y')}</option>
                      <option value="custom">{t('topPanel.ownDeviceTtlCustom')}</option>
                    </select>
                  </label>
                  {ownDeviceTtlPreset === 'custom' && (
                    <label className={`flex flex-col gap-0.5 text-[11px] ${subTextClass}`}>
                      <span>{t('topPanel.expires')}</span>
                      <input
                        type="date"
                        value={ownDeviceExpiresCustom}
                        onChange={(e) => setOwnDeviceExpiresCustom(e.target.value)}
                        className={`text-sm rounded border px-2 py-1 ${inputBg}`}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onCreateOwnDeviceInvite(ownDeviceRole, computeOwnDeviceExpiresAt());
                    }}
                    className={`text-sm rounded px-3 py-2 font-semibold lg:col-span-1 ${isDarkMode ? 'bg-indigo-700 hover:bg-indigo-600' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}
                  >
                    {t('topPanel.createOwnDeviceInvite')}
                  </button>
                </div>
              </div>
            )}
            {!isInviteMode && trustedOwnDevicePeerId && (onOwnDeviceAcceptAll || onOwnDeviceRejectAllAndRevoke) && (
              <div className={`mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${isDarkMode ? 'border-amber-900/60 bg-amber-950/20' : 'border-amber-200 bg-amber-50'}`}>
                <span className={`text-xs font-semibold ${textClass}`}>
                  {t('topPanel.ownDeviceSessionBadge').replace('{{count}}', String(ownDevicePendingCount))}
                </span>
                {onOwnDeviceAcceptAll && (
                  <button
                    type="button"
                    onClick={() => onOwnDeviceAcceptAll()}
                    disabled={ownDevicePendingCount === 0}
                    className={`px-2 py-1 rounded text-xs font-semibold disabled:opacity-40 ${isDarkMode ? 'bg-emerald-800 hover:bg-emerald-700' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                  >
                    {t('topPanel.ownDeviceAcceptAll')}
                  </button>
                )}
                {onOwnDeviceRejectAllAndRevoke && (
                  <button
                    type="button"
                    onClick={() => onOwnDeviceRejectAllAndRevoke()}
                    className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-rose-900 hover:bg-rose-800' : 'bg-rose-600 text-white hover:bg-rose-500'}`}
                  >
                    {t('topPanel.ownDeviceRejectAndRevoke')}
                  </button>
                )}
              </div>
            )}
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {invites.length === 0 ? (
                <p className={`text-sm ${subTextClass}`}>{t('topPanel.noInvites')}</p>
              ) : (
                invites.map((invite) => {
                  const isExpired = invite.status === 'expired';
                  const isRevoked = invite.status === 'revoked';
                  const canHostRevoke =
                    (invite.status === 'active' || invite.status === 'accepted') &&
                    !isInviteMode &&
                    !isExpired &&
                    !isRevoked;
                  const accentClass =
                    invite.linkKind === 'ephemeral_free'
                      ? isDarkMode
                        ? 'border-l-teal-500 bg-teal-950/25'
                        : 'border-l-teal-500 bg-teal-50/80'
                      : invite.inviteIntent === 'own_device'
                        ? isDarkMode
                          ? 'border-l-indigo-500 bg-indigo-950/20'
                          : 'border-l-indigo-500 bg-indigo-50/80'
                        : isDarkMode
                          ? 'border-l-sky-500 bg-slate-900/40'
                          : 'border-l-sky-500 bg-sky-50/80';
                  return (
                  <div
                    key={invite.inviteId}
                    className={`rounded border border-l-4 p-2 text-xs flex flex-wrap items-start justify-between gap-2 ${accentClass} ${
                      isDarkMode ? 'border-slate-700' : 'border-slate-200'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold flex flex-wrap items-center gap-1.5">
                        {invite.linkKind === 'ephemeral_free' ? (
                          <>
                            <span
                              className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${
                                isDarkMode
                                  ? 'border-teal-600 text-teal-300 bg-teal-950/50'
                                  : 'border-teal-300 text-teal-800 bg-teal-100/70'
                              }`}
                            >
                              {t('topPanel.inviteKindEphemeralBadge')}
                            </span>
                            <span>{t('topPanel.ephemeralInviteLabel')}</span>
                          </>
                        ) : (
                          <>
                            {invite.inviteIntent === 'own_device' ? (
                              <span
                                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${
                                  isDarkMode
                                    ? 'border-indigo-600 text-indigo-300 bg-indigo-950/50'
                                    : 'border-indigo-300 text-indigo-800 bg-indigo-100/70'
                                }`}
                              >
                                {t('topPanel.inviteKindOwnDeviceShort')}
                              </span>
                            ) : (
                              <span
                                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${
                                  isDarkMode
                                    ? 'border-sky-600 text-sky-300 bg-sky-950/50'
                                    : 'border-sky-300 text-sky-800 bg-sky-100/70'
                                }`}
                              >
                                {t('topPanel.inviteKindNamedShort')}
                              </span>
                            )}
                            <span>
                              {invite.individualName || '—'} ({formatInviteRole(invite.role)})
                            </span>
                          </>
                        )}
                      </div>
                      <div className={subTextClass}>
                        {invite.personalizedDefault ? t('topPanel.defaultInvite') : t('topPanel.manualInvite')}
                        {invite.inviteIntent === 'own_device' ? ` | ${t('topPanel.inviteOwnDeviceBadge')}` : ''}
                        {' '}| {t('topPanel.status')}: {invite.status}
                        {invite.expiresAt ? ` | ${t('topPanel.expires')}: ${new Date(invite.expiresAt).toLocaleDateString()}` : ''}
                      </div>
                      {invite.inviteLink && (
                        <div className={`font-mono text-[10px] truncate max-w-[320px] ${subTextClass}`}>{invite.inviteLink}</div>
                      )}
                    </div>
                    {invite.inviteLink && !isInviteMode && (
                      <InviteQrCode
                        url={invite.inviteLink}
                        isDarkMode={isDarkMode}
                        label={t('topPanel.inviteQrHint')}
                        size={88}
                        className="shrink-0"
                      />
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      {invite.inviteLink && !isInviteMode && (
                        <button
                          onClick={() => copyInviteLink(invite.inviteId, invite.inviteLink)}
                          className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-200 text-slate-800 hover:bg-slate-300'}`}
                        >
                          {copiedInviteId === invite.inviteId ? t('topPanel.inviteCopied') : t('topPanel.copyInviteLink')}
                        </button>
                      )}
                      {canHostRevoke && (
                        <button
                          onClick={() => onRevokeInvite(invite.inviteId)}
                          className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-rose-800 hover:bg-rose-700' : 'bg-rose-600 text-white hover:bg-rose-500'}`}
                        >
                          {t('topPanel.revoke')}
                        </button>
                      )}
                      {invite.status === 'active' && isInviteMode && (
                        <button
                          onClick={() => onAcceptInvite(invite.inviteId)}
                          className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                        >
                          {t('topPanel.acceptInvite')}
                        </button>
                      )}
                    </div>
                  </div>
                  );
                })
              )}
            </div>
            {pendingInviteToken && (
              <p className={`text-[11px] mt-3 ${subTextClass}`}>{t('topPanel.pendingInviteToken')}</p>
            )}
          </section>
        )}

        {activeTab === 'wot' && (
          <div className={`rounded-xl border p-4 space-y-3 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide">{t('topPanel.wotHeading')}</h3>
            <p className={`text-xs leading-relaxed ${subTextClass}`}>{t('topPanel.wotIntro')}</p>
            <p className={`text-xs leading-relaxed mt-2 ${subTextClass}`}>{t('topPanel.wotSymmetricTrust')}</p>
            <p className={`text-xs leading-relaxed mt-1 ${subTextClass}`}>{t('topPanel.wotAncestorsSharing')}</p>
            <div className={`text-xs space-y-1 rounded-lg border p-2 mt-2 ${isDarkMode ? 'border-slate-600 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
              <div className="flex justify-between gap-2">
                <span className={subTextClass}>{t('topPanel.wotIdentityStatus')}</span>
                <span className={`font-semibold ${isIdentityClaimed ? 'text-emerald-500' : 'text-amber-500'}`}>
                  {isIdentityClaimed ? t('topPanel.wotIdentityClaimed') : t('topPanel.wotIdentityNone')}
                </span>
              </div>
              {identityIntroduction?.inviterName && (
                <div className="flex justify-between gap-2">
                  <span className={subTextClass}>{t('topPanel.wotIntroductionInviter')}</span>
                  <span className={`font-medium ${textClass} text-right`}>{identityIntroduction.inviterName}</span>
                </div>
              )}
              {identityIntroduction?.inviteId && (
                <div className={`text-[10px] ${subTextClass} font-mono break-all`}>
                  {t('topPanel.wotIntroductionInvite')}: {identityIntroduction.inviteId}
                </div>
              )}
            </div>
            <p className={`text-[11px] ${subTextClass} opacity-90`}>{t('topPanel.wotFutureAttestations')}</p>
            {onOpenIdentityPanel && (
              <button
                type="button"
                onClick={onOpenIdentityPanel}
                className={`text-xs px-3 py-2 rounded font-bold w-full sm:w-auto ${
                  isDarkMode ? 'bg-emerald-800 hover:bg-emerald-700 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {t('topPanel.wotOpenIdentity')}
              </button>
            )}
          </div>
        )}

            </div>
          </div>
        </div>
      </div>

      {/* Handle */}
      <div className="flex justify-center">
        <div className={`pointer-events-auto ${handleBg} rounded-b-xl border-b border-x shadow-md flex items-center justify-center gap-2 px-3 py-1.5`}>
          <button
            onClick={onToggle}
            style={{ touchAction: 'manipulation' }}
            className="rounded px-5 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer relative"
          >
            {t('topPanel.share')}
            {pendingProposalsCount > 0 && (
              <span className="absolute -top-1 -right-2 inline-flex min-w-[16px] h-4 px-1 items-center justify-center rounded-full bg-red-600 text-white text-[9px] leading-none">
                {pendingProposalsCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number; isDarkMode: boolean }> = ({ label, value, isDarkMode }) => (
  <div className={`rounded-lg border px-3 py-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
    <div className="text-[11px] opacity-70 uppercase">{label}</div>
    <div className="text-xl font-bold">{value}</div>
  </div>
);

const ToggleRow: React.FC<{ label: string; checked: boolean; onChange: (checked: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center justify-between gap-2">
    <span>{label}</span>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
  </label>
);

export default TopPanel;