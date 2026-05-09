import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Network,
  WifiOff,
  Eye,
  EyeOff,
} from 'lucide-react';
import { P2PStatus, P2PMode, IdentityIntroductionContext } from '../types';
import { ActivityLogEvent } from '../services/p2pDomain';
import { useI18n } from '../i18n';
import { type TopPanelTabId, type TabIndicatorLevel } from './topPanel/topPanelTabs';
import { TopPanelTabList } from './topPanel/TopPanelTabList';
import type { InviteExchangeScope, P2PVisibilitySettings } from '../app/p2pAppTypes';
import { defaultInviteExchangeScope } from '../services/inviteExchangeManifest';
import { InviteExchangeScopeForm } from './InviteExchangeScopeForm';
import type { InviteLinkKind } from '../app/inviteLinkKind';
import type { CertificationKind, PeerRelationStatus, WotNodeAnnouncementV1 } from '../app/identityTrust/types';
import { InviteQrCode } from './InviteQrCode';

/** Résultats max quand l’utilisateur tape une recherche (liste potentiellement énorme). */
const MAX_INVITE_MEMBER_SEARCH_RESULTS = 500;
/** Sans recherche : afficher tout l’arbre jusqu’à ce plafond pour éviter de masquer des fiches (bug « pas dans la liste »). */
const MAX_INVITE_MEMBER_UNFILTERED = 8000;

/** Sélection d’un membre pour invitation : recherche + liste (meilleure ergonomie qu’un menu natif très long). */
const InviteLivingMemberCombobox: React.FC<{
  value: string;
  onChange: (id: string) => void;
  candidates: Array<{ id: string; label: string; lifeSpanLine?: string }>;
  placeholder: string;
  inputBg: string;
  textClass: string;
  subTextClass: string;
}> = ({ value, onChange, candidates, placeholder, inputBg, textClass, subTextClass }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedLabel = useMemo(() => {
    if (!value) return '';
    return candidates.find((c) => c.id === value)?.label ?? value;
  }, [value, candidates]);
  const { filtered, listTruncated } = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (q) {
      const matched = candidates.filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          (c.lifeSpanLine && c.lifeSpanLine.toLowerCase().includes(q)),
      );
      return {
        filtered: matched.slice(0, MAX_INVITE_MEMBER_SEARCH_RESULTS),
        listTruncated: matched.length > MAX_INVITE_MEMBER_SEARCH_RESULTS,
      };
    }
    if (candidates.length <= MAX_INVITE_MEMBER_UNFILTERED) {
      return { filtered: candidates, listTruncated: false };
    }
    return {
      filtered: candidates.slice(0, MAX_INVITE_MEMBER_UNFILTERED),
      listTruncated: true,
    };
  }, [candidates, query]);

  const pickEmpty = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onChange('');
      setOpen(false);
      setQuery('');
    },
    [onChange],
  );
  const pickOne = useCallback(
    (id: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      onChange(id);
      setOpen(false);
      setQuery('');
    },
    [onChange],
  );

  return (
    <div className="relative min-w-0">
      <input
        type="text"
        className={`w-full rounded border px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500/40 ${inputBg}`}
        placeholder={placeholder}
        value={open ? query : value ? selectedLabel : ''}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 160);
        }}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label={placeholder}
      />
      {open && (
        <div
          className={`absolute z-[110] left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded border shadow-lg ${inputBg}`}
          role="listbox"
        >
          <div
            className={`px-2 py-1.5 text-xs cursor-pointer hover:bg-blue-500/20 ${subTextClass}`}
            onMouseDown={pickEmpty}
          >
            {placeholder}
          </div>
          {filtered.map((c) => (
            <div
              key={c.id}
              role="option"
              className={`px-2 py-1.5 text-xs cursor-pointer hover:bg-blue-500/20 ${textClass} ${
                c.id === value ? 'bg-blue-500/25 font-semibold' : ''
              }`}
              onMouseDown={pickOne(c.id)}
            >
              <span className="break-words">{c.label}</span>
              {c.lifeSpanLine ? (
                <span className={`block text-[10px] opacity-70 ${subTextClass}`}>{c.lifeSpanLine}</span>
              ) : null}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className={`px-2 py-1.5 text-xs italic ${subTextClass}`}>{t('details.noMatch')}</div>
          )}
          {listTruncated && (
            <div className={`px-2 py-1.5 text-[10px] border-t border-amber-500/35 ${subTextClass}`}>
              {t('topPanel.inviteMemberListTruncated')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface TopPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  isDarkMode: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  // P2P Props
  p2pStatus: P2PStatus;
  p2pMode: P2PMode;
  peerId: string | null;
  onInitP2P: () => void;
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
  livingCandidates: Array<{ id: string; label: string; lifeSpanLine?: string }>;
  /** Toutes les fiches du GEDCOM local — racine du périmètre d’échange (hôte). */
  exchangeRootCandidates?: Array<{ id: string; label: string; lifeSpanLine?: string }>;
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
    exchangeScope?: InviteExchangeScope;
  }>;
  /** Lien visite libre anonyme (1.2), sans individu ciblé. `expiresAt` = ISO optionnel. */
  onCreateEphemeralInvite?: (expiresAt?: string) => void;
  pendingInviteToken?: string | null;
  pendingProposalsCount: number;
  onChangeVisibilitySettings: (next: P2PVisibilitySettings) => void;
  onCreateInvite: (
    individualId: string,
    role: 'viewer' | 'contributor' | 'editor' | 'comparator',
    expiresAt?: string,
    options?: { exchangeScope?: InviteExchangeScope },
  ) => void;
  /** Auto-invitation : même individu identifié → second appareil (ex. mobile). */
  onCreateOwnDeviceInvite?: (
    role: 'viewer' | 'contributor' | 'editor',
    expiresAt?: string,
    options?: { exchangeScope?: InviteExchangeScope },
  ) => void;
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
  /** Libellé de la fiche revendiquée (nom + prénom ou id si hors GEDCOM). */
  claimedIndividualLabel?: string | null;
  /** Xref GEDCOM à afficher pour cet arbre (invité nominatif : fiche cible chez l’hôte, pas le xref du fichier local). */
  claimedIndividualWireId?: string | null;
  /** Xref du fichier local si différent de `claimedIndividualWireId` (désambiguïsation). */
  claimedIndividualLocalWireDisambiguation?: string | null;
  /** Le fichier ouvert contient le même xref mais une autre personne que le libellé enregistré avec l’identité. */
  claimedWireOpenFileCollisionName?: string | null;
  identityIntroduction?: IdentityIntroductionContext;
  onOpenIdentityPanel?: () => void;
  onExportIdentityBackup?: (password: string) => void | Promise<void>;
  onImportIdentityBackup?: (file: File, password: string) => void | Promise<void>;
  /** Exécuté après confirmation dans ce panneau (pas de `window.confirm` côté parent). */
  onRenounceIdentity?: () => void;
  /** Idem : reset local après confirmation dans ce panneau. */
  onProvisionalResetAllLocalData?: () => void;
  /** Raccourci après invite : invité pas encore identifié. */
  showCompleteIdentityHint?: boolean;
  /** Comparaison : message supplémentaire (ex. inviter le pair à charger son GEDCOM). */
  compareSessionExtraHint?: string | null;
  /** Hôte : périmètre d’échange (formulaire) — état piloté par `App` pour l’aligner avec la liste comparaison. */
  inviterExchangeScopeDraft?: InviteExchangeScope;
  onInviterExchangeScopeDraftChange?: (scope: InviteExchangeScope) => void;
  /** Pilotage externe optionnel de l’onglet actif (redirections depuis Fiche). */
  activeTabOverride?: TopPanelTabId | null;
  onActiveTabChange?: (tab: TopPanelTabId | null) => void;
  peerIdentityRows?: Array<{
    peerId: string;
    label: string;
    claimedAt?: string;
    certifiedByMe?: boolean;
    certifiedByPeer?: boolean;
    certificationKindByMe?: CertificationKind;
    relationStatus?: PeerRelationStatus;
  }>;
  onTogglePeerCertifiedByMe?: (peerId: string, next: boolean) => void;
  onSetPeerCertificationKind?: (peerId: string, kind: CertificationKind) => void;
  axisStatusSummary?: {
    sessionKey: string;
    identityKey: string;
    trustSummary: string;
    nodeKey: string;
  };
  wotNodePanel?: {
    runtimeLabelKey: string;
    eligibilityReasonKey: string;
    requiredCount: number;
    directedCertTotal: number;
    personhoodMajority: boolean;
    expiresAt?: string;
    revokedAt?: string;
    active: boolean;
    rootId: string;
    ttlHours: number;
    maxGenUp: number;
    rootCandidates: Array<{ id: string; label: string }>;
    onRootChange: (id: string) => void;
    onTtlHoursChange: (hours: number) => void;
    onMaxGenUpChange: (n: number) => void;
    onActivate: () => void;
    onRevoke: () => void;
    /** Hôte ou invité : chacun peut publier son périmètre WoT local si identité + GEDCOM. */
    allowLocalWotNodeControls: boolean;
    remoteAnn: WotNodeAnnouncementV1 | null;
  };
}

const TopPanel: React.FC<TopPanelProps> = ({ 
  isOpen, 
  onToggle, 
  isDarkMode,
  onMouseEnter, 
  onMouseLeave,
  p2pStatus,
  p2pMode,
  peerId,
  onInitP2P,
  activityEvents,
  proposals,
  visibilitySettings,
  livingCandidates,
  exchangeRootCandidates = [],
  invites,
  pendingInviteToken,
  pendingProposalsCount,
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
  claimedIndividualLabel = null,
  claimedIndividualWireId = null,
  claimedIndividualLocalWireDisambiguation = null,
  claimedWireOpenFileCollisionName = null,
  identityIntroduction,
  onOpenIdentityPanel,
  onExportIdentityBackup,
  onImportIdentityBackup,
  onRenounceIdentity,
  onProvisionalResetAllLocalData,
  showCompleteIdentityHint = false,
  onCreateEphemeralInvite,
  compareSessionExtraHint = null,
  inviterExchangeScopeDraft,
  onInviterExchangeScopeDraftChange,
  activeTabOverride,
  onActiveTabChange,
  peerIdentityRows = [],
  onTogglePeerCertifiedByMe,
  onSetPeerCertificationKind,
  axisStatusSummary,
  wotNodePanel,
}) => {
  const { t } = useI18n();
  const [newInviteIndividualId, setNewInviteIndividualId] = useState('');
  const [newInviteRole, setNewInviteRole] = useState<'viewer' | 'contributor' | 'editor' | 'comparator'>('viewer');
  const [newInviteExpiresAt, setNewInviteExpiresAt] = useState('');
  const [internalInviteExchangeScope, setInternalInviteExchangeScope] = useState<InviteExchangeScope>(() =>
    defaultInviteExchangeScope(),
  );
  const inviteExchangeScope =
    inviterExchangeScopeDraft != null && onInviterExchangeScopeDraftChange != null
      ? inviterExchangeScopeDraft
      : internalInviteExchangeScope;
  const setInviteExchangeScope =
    inviterExchangeScopeDraft != null && onInviterExchangeScopeDraftChange != null
      ? onInviterExchangeScopeDraftChange
      : setInternalInviteExchangeScope;
  const [ephemeralInviteExpiresAt, setEphemeralInviteExpiresAt] = useState('');
  const [ownDeviceTtlPreset, setOwnDeviceTtlPreset] = useState<'none' | '365' | '730' | '1825' | 'custom'>('none');
  const [ownDeviceExpiresCustom, setOwnDeviceExpiresCustom] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showActivityDetails, setShowActivityDetails] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [proposalPage, setProposalPage] = useState(0);
  const PROPOSALS_PAGE_SIZE = 30;
  const [activeTab, setActiveTab] = useState<TopPanelTabId | null>(null);
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [identityBackupFile, setIdentityBackupFile] = useState<File | null>(null);
  const [showExportPassword, setShowExportPassword] = useState(false);
  const [showImportPassword, setShowImportPassword] = useState(false);
  useEffect(() => {
    if (activeTabOverride === undefined) return;
    setActiveTab(activeTabOverride);
  }, [activeTabOverride]);

  const [renounceInlineConfirm, setRenounceInlineConfirm] = useState(false);
  const [provisionalResetInlineConfirm, setProvisionalResetInlineConfirm] = useState(false);
  useEffect(() => {
    setRenounceInlineConfirm(false);
    setProvisionalResetInlineConfirm(false);
  }, [activeTab]);

  const inviteExpiringSoon = useMemo(() => {
    const week = 7 * 24 * 60 * 60 * 1000;
    return invites.some((inv) => {
      if (inv.status !== 'active' || !inv.expiresAt) return false;
      const exp = Date.parse(inv.expiresAt);
      return exp - Date.now() < week && exp > Date.now();
    });
  }, [invites]);

  const ownDeviceInvites = useMemo(
    () => invites.filter((invite) => invite.inviteIntent === 'own_device'),
    [invites],
  );
  const anonymousInvites = useMemo(
    () => invites.filter((invite) => invite.linkKind === 'ephemeral_free'),
    [invites],
  );
  const personalizedInvites = useMemo(
    () =>
      invites.filter(
        (invite) => invite.inviteIntent !== 'own_device' && invite.linkKind !== 'ephemeral_free',
      ),
    [invites],
  );

  const tabIndicators = useMemo((): Record<TopPanelTabId, TabIndicatorLevel> => {
    let deviceInvitesLevel: TabIndicatorLevel = ownDeviceInvites.length > 0 ? 'ok' : 'idle';
    if (ownDevicePendingCount > 0) deviceInvitesLevel = 'warning';
    if (!isOnline) deviceInvitesLevel = 'error';

    let anonymousInvitesLevel: TabIndicatorLevel = anonymousInvites.length > 0 ? 'ok' : 'idle';
    if (inviteExpiringSoon) anonymousInvitesLevel = 'warning';

    let personalizedInvitesLevel: TabIndicatorLevel = personalizedInvites.length > 0 ? 'ok' : 'idle';
    if (pendingInviteToken) personalizedInvitesLevel = 'warning';

    const proposalsTab: TabIndicatorLevel =
      pendingProposalsCount > 0 ? 'error' : proposals.length > 0 ? 'ok' : 'idle';

    const activity: TabIndicatorLevel = activityEvents.length > 0 ? 'ok' : 'idle';

    return {
      deviceInvites: deviceInvitesLevel,
      anonymousInvites: anonymousInvitesLevel,
      personalizedInvites: personalizedInvitesLevel,
      proposals: proposalsTab,
      activity,
      yourIdentity: isIdentityClaimed ? 'ok' : 'warning',
      p2pPairShare: 'idle',
      peerIdentities: peerIdentityRows.length > 0 ? 'ok' : 'idle',
    };
  }, [
    isOnline,
    ownDeviceInvites.length,
    anonymousInvites.length,
    personalizedInvites.length,
    pendingInviteToken,
    isIdentityClaimed,
    ownDevicePendingCount,
    inviteExpiringSoon,
    pendingProposalsCount,
    proposals.length,
    activityEvents.length,
    peerIdentityRows.length,
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
  const innerCardBg = isDarkMode ? 'bg-slate-900/40 border-slate-600' : 'bg-white border-slate-200';
  const identityBackupBtnClass = isDarkMode
    ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
    : 'bg-emerald-600 text-white hover:bg-emerald-500';
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
  const formatP2pStatusLabel = (status: P2PStatus): string => {
    const key = `topPanel.p2pStatus_${status}`;
    const translated = t(key);
    return translated === key ? status : translated;
  };
  const copyInviteLink = async (inviteId: string, link?: string) => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopiedInviteId(inviteId);
    window.setTimeout(() => setCopiedInviteId((current) => (current === inviteId ? null : current)), 1800);
  };
  const isInviteMode = p2pMode === 'client' || !!pendingInviteToken;

  const sessionContextKey = useMemo(() => {
    if (pendingInviteToken) return 'invitee' as const;
    if (p2pMode === 'client') return 'guest' as const;
    if (p2pMode === 'host') return 'host' as const;
    if (trustedOwnDevicePeerId) return 'ownDevice' as const;
    return 'solo' as const;
  }, [pendingInviteToken, p2pMode, trustedOwnDevicePeerId]);
  const contextKey =
    activeTab === 'deviceInvites' ||
    activeTab === 'anonymousInvites' ||
    activeTab === 'personalizedInvites'
      ? activeTab
      : sessionContextKey;
  const canRestartConnection = isOnline && p2pStatus !== 'connected';

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
  useEffect(() => {
    setProposalPage((prev) => Math.min(prev, proposalsPageCount - 1));
  }, [proposalsPageCount]);

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] pointer-events-none">
      <div className="overflow-hidden" style={{ maxHeight: isOpen ? 'calc(100vh - 120px)' : '0px', transition: 'max-height 300ms ease' }}>
        <div 
          className={`pointer-events-auto ${bgClass} backdrop-blur-md border-b px-3 py-1.5 shadow-xl max-h-[calc(100vh-120px)] overflow-y-auto`}
          style={{ touchAction: 'pan-y' }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <div className="w-full max-w-5xl mx-auto min-w-0 flex flex-col gap-2">
            <TopPanelTabList
              activeTab={activeTab}
              onSelectTab={(tab) => {
                setActiveTab(tab);
                onActiveTabChange?.(tab);
              }}
              tabIndicators={tabIndicators}
              isDarkMode={isDarkMode}
              indicatorDotClass={indicatorDotClass}
            />

            <div
              className={`rounded-lg border px-3 py-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <Network
                    className={`w-3.5 h-3.5 shrink-0 ${!isOnline ? 'text-rose-500' : p2pStatus === 'connected' ? 'text-emerald-500' : 'text-amber-500'}`}
                  />
                  <span className={`font-medium ${textClass}`}>{t('topPanel.connectionState')}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded shrink-0 ${isDarkMode ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'}`}
                  >
                    {!isOnline ? t('topPanel.offline') : formatP2pStatusLabel(p2pStatus)}
                  </span>
                  {peerId && (
                    <span className={`font-mono text-[10px] truncate max-w-[min(100%,12rem)] ${subTextClass}`}>
                      {peerId}
                    </span>
                  )}
                </div>
                {canRestartConnection && (
                  <button
                    type="button"
                    onClick={onInitP2P}
                    className={`px-2 py-1 rounded text-[11px] font-semibold shrink-0 ${btnAction}`}
                  >
                    {t('topPanel.restartConnection')}
                  </button>
                )}
              </div>
              {!isOnline && (
                <div className={`mt-1 flex items-center gap-1 text-[10px] ${subTextClass}`}>
                  <WifiOff className="w-3 h-3" /> {t('topPanel.localMode')}
                </div>
              )}
            </div>

            {activeTab &&
              activeTab !== 'yourIdentity' &&
              activeTab !== 'p2pPairShare' &&
              activeTab !== 'peerIdentities' && (
              <div
                className={`rounded-lg border px-3 py-2 ${cardClass}`}
                role="status"
                aria-live="polite"
              >
                <p className={`text-xs leading-relaxed whitespace-pre-line ${textClass}`}>
                  {t(`topPanel.contextMessage_${contextKey}`)}
                </p>
                {compareSessionExtraHint && (
                  <p
                    className={`text-[11px] mt-2 leading-relaxed border-t pt-2 ${isDarkMode ? 'border-slate-700 text-amber-200/95' : 'border-amber-200 text-amber-900'}`}
                  >
                    {compareSessionExtraHint}
                  </p>
                )}
              </div>
            )}

            {isInviteMode && showCompleteIdentityHint && onOpenIdentityPanel && (
              <div
                className={`rounded-lg border p-3 ${
                  isDarkMode ? 'border-amber-600/50 bg-amber-950/40' : 'border-amber-300 bg-amber-50'
                }`}
              >
                <p className={`text-xs font-semibold ${isDarkMode ? 'text-amber-100' : 'text-amber-900'}`}>
                  {t('topPanel.completeIdentityTitle')}
                </p>
                <p className={`text-[11px] mt-1 ${subTextClass}`}>{t('topPanel.completeIdentityBody')}</p>
                <button
                  type="button"
                  onClick={() => {
                    onOpenIdentityPanel();
                    setActiveTab('yourIdentity');
                    onActiveTabChange?.('yourIdentity');
                  }}
                  className={`mt-2 text-[11px] px-3 py-1.5 rounded font-bold ${
                    isDarkMode ? 'bg-emerald-700 hover:bg-emerald-600 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  {t('topPanel.completeIdentityCta')}
                </button>
              </div>
            )}

            <div
              className="min-h-0"
            >
        {activeTab === 'deviceInvites' && (
          <section className={`rounded-lg border p-3 space-y-2 ${cardClass}`}>
            {!selfIndividualId && !isInviteMode && (
              <p className={`text-[11px] ${subTextClass}`}>{t('topPanel.deviceInviteNeedsIdentity')}</p>
            )}
            {!isInviteMode && (
              <p className={`text-[11px] leading-relaxed whitespace-pre-line ${subTextClass}`}>
                {t('topPanel.ownDeviceResilienceSummary')}
              </p>
            )}
            {!isInviteMode && trustedOwnDevicePeerId && (onOwnDeviceAcceptAll || onOwnDeviceRejectAllAndRevoke) && (
              <div className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 ${isDarkMode ? 'border-slate-700 bg-slate-900/30' : 'border-slate-200 bg-white'}`}>
                <span className={`text-[11px] ${textClass}`}>
                  {t('topPanel.ownDeviceSessionBadge').replace('{{count}}', String(ownDevicePendingCount))}
                </span>
                {onOwnDeviceAcceptAll && (
                  <button
                    type="button"
                    onClick={() => onOwnDeviceAcceptAll()}
                    disabled={ownDevicePendingCount === 0}
                    className={`px-2 py-1 rounded text-[11px] font-semibold disabled:opacity-40 ${btnAction}`}
                  >
                    {t('topPanel.ownDeviceAcceptAll')}
                  </button>
                )}
                {onOwnDeviceRejectAllAndRevoke && (
                  <button
                    type="button"
                    onClick={() => onOwnDeviceRejectAllAndRevoke()}
                    className={`px-2 py-1 rounded text-[11px] font-semibold ${isDarkMode ? 'bg-rose-900 hover:bg-rose-800 text-white' : 'bg-rose-600 hover:bg-rose-500 text-white'}`}
                  >
                    {t('topPanel.ownDeviceRejectAndRevoke')}
                  </button>
                )}
              </div>
            )}
            {!isInviteMode && onCreateOwnDeviceInvite && selfIndividualId && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                <select
                  value={ownDeviceTtlPreset}
                  onChange={(e) => setOwnDeviceTtlPreset(e.target.value as 'none' | '365' | '730' | '1825' | 'custom')}
                  className={`text-xs rounded border px-2 py-1 ${inputBg}`}
                >
                  <option value="none">{t('topPanel.ownDeviceTtlNone')}</option>
                  <option value="365">{t('topPanel.ownDeviceTtl1y')}</option>
                  <option value="730">{t('topPanel.ownDeviceTtl2y')}</option>
                  <option value="1825">{t('topPanel.ownDeviceTtl5y')}</option>
                  <option value="custom">{t('topPanel.ownDeviceTtlCustom')}</option>
                </select>
                {ownDeviceTtlPreset === 'custom' ? (
                  <input
                    type="date"
                    value={ownDeviceExpiresCustom}
                    onChange={(e) => setOwnDeviceExpiresCustom(e.target.value)}
                    className={`text-xs rounded border px-2 py-1 ${inputBg}`}
                  />
                ) : (
                  <div />
                )}
                <button
                  type="button"
                  onClick={() => {
                    onCreateOwnDeviceInvite('editor', computeOwnDeviceExpiresAt(), {
                      exchangeScope: inviteExchangeScope,
                    });
                  }}
                  className={`text-xs rounded px-2 py-1.5 font-semibold ${btnAction}`}
                >
                  {t('topPanel.createOwnDeviceInvite')}
                </button>
              </div>
            )}
            <InviteListCompact
              invites={ownDeviceInvites}
              isDarkMode={isDarkMode}
              isInviteMode={isInviteMode}
              copiedInviteId={copiedInviteId}
              formatInviteRole={formatInviteRole}
              onCopyInviteLink={copyInviteLink}
              onRevokeInvite={onRevokeInvite}
              onAcceptInvite={onAcceptInvite}
              t={t}
            />
          </section>
        )}

        {activeTab === 'anonymousInvites' && (
          <section className={`rounded-lg border p-3 space-y-2 ${cardClass}`}>
            <div className={`rounded border p-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/25' : 'border-slate-200 bg-white'}`}>
              <h4 className={`text-[11px] font-semibold mb-1 ${textClass}`}>{t('topPanel.visibilityDefaultProfileTitle')}</h4>
              <div className="space-y-1 text-xs">
                <ToggleRow textClass={textClass} inputFirst label={t('topPanel.exposeIdentity')} checked={visibilitySettings.exposeIdentity} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeIdentity: checked })} />
                <ToggleRow textClass={textClass} inputFirst label={t('topPanel.exposeDates')} checked={visibilitySettings.exposeDates} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeDates: checked })} />
                <ToggleRow textClass={textClass} inputFirst label={t('topPanel.exposePlaces')} checked={visibilitySettings.exposePlaces} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposePlaces: checked })} />
                <ToggleRow textClass={textClass} inputFirst label={t('topPanel.exposeNotes')} checked={visibilitySettings.exposeNotes} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeNotes: checked })} />
                <ToggleRow textClass={textClass} inputFirst label={t('topPanel.allowDocumentsSync')} checked={visibilitySettings.allowDocuments} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDocuments: checked })} />
                <ToggleRow textClass={textClass} inputFirst label={t('topPanel.allowDownload')} checked={visibilitySettings.allowDownload} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDownload: checked })} />
                <ToggleRow textClass={textClass} inputFirst label={t('topPanel.allowProposals')} checked={visibilitySettings.allowProposal} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowProposal: checked })} />
                <ToggleRow textClass={textClass} inputFirst label={t('topPanel.allowDirectEdits')} checked={visibilitySettings.allowDirectEdit} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDirectEdit: checked })} />
              </div>
            </div>
            {!isInviteMode && onCreateEphemeralInvite && (
              <>
                <p className={`text-[11px] leading-relaxed ${subTextClass}`}>
                  {t('topPanel.anonymousInviteExpirationIntro')}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                <input
                  type="datetime-local"
                  value={ephemeralInviteExpiresAt}
                  onChange={(e) => setEphemeralInviteExpiresAt(e.target.value)}
                  className={`text-xs rounded border px-2 py-1 ${inputBg}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    const iso = ephemeralInviteExpiresAt
                      ? new Date(ephemeralInviteExpiresAt).toISOString()
                      : undefined;
                    onCreateEphemeralInvite(iso);
                  }}
                  className={`text-xs rounded px-2 py-1.5 font-semibold ${btnAction}`}
                >
                  {t('topPanel.createEphemeralInvite')}
                </button>
              </div>
              </>
            )}
            <InviteListCompact
              invites={anonymousInvites}
              isDarkMode={isDarkMode}
              isInviteMode={isInviteMode}
              copiedInviteId={copiedInviteId}
              formatInviteRole={formatInviteRole}
              onCopyInviteLink={copyInviteLink}
              onRevokeInvite={onRevokeInvite}
              onAcceptInvite={onAcceptInvite}
              t={t}
            />
          </section>
        )}

        {activeTab === 'personalizedInvites' && (
          <section className={`rounded-lg border p-3 space-y-2 ${cardClass}`}>
            {!isInviteMode && (
              <>
                <div className={`rounded border p-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/25' : 'border-slate-200 bg-white'}`}>
                  <h4 className={`text-[11px] font-semibold mb-1 ${textClass}`}>{t('topPanel.visibilityDefaultProfileTitle')}</h4>
                  <div className="space-y-1 text-xs">
                    <ToggleRow textClass={textClass} inputFirst label={t('topPanel.exposeIdentity')} checked={visibilitySettings.exposeIdentity} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeIdentity: checked })} />
                    <ToggleRow textClass={textClass} inputFirst label={t('topPanel.exposeDates')} checked={visibilitySettings.exposeDates} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeDates: checked })} />
                    <ToggleRow textClass={textClass} inputFirst label={t('topPanel.exposePlaces')} checked={visibilitySettings.exposePlaces} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposePlaces: checked })} />
                    <ToggleRow textClass={textClass} inputFirst label={t('topPanel.exposeNotes')} checked={visibilitySettings.exposeNotes} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeNotes: checked })} />
                    <ToggleRow textClass={textClass} inputFirst label={t('topPanel.allowDocumentsSync')} checked={visibilitySettings.allowDocuments} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDocuments: checked })} />
                    <ToggleRow textClass={textClass} inputFirst label={t('topPanel.allowDownload')} checked={visibilitySettings.allowDownload} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDownload: checked })} />
                    <ToggleRow textClass={textClass} inputFirst label={t('topPanel.allowProposals')} checked={visibilitySettings.allowProposal} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowProposal: checked })} />
                    <ToggleRow textClass={textClass} inputFirst label={t('topPanel.allowDirectEdits')} checked={visibilitySettings.allowDirectEdit} onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDirectEdit: checked })} />
                  </div>
                </div>
                <p className={`text-[11px] leading-relaxed ${subTextClass}`}>
                  {t('topPanel.personalizedInviteFormIntro')}
                </p>
                <p className={`text-[10px] ${subTextClass}`}>{t('topPanel.inviteMemberSearchHint')}</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <InviteLivingMemberCombobox
                    value={newInviteIndividualId}
                    onChange={setNewInviteIndividualId}
                    candidates={livingCandidates}
                    placeholder={t('topPanel.selectLivingMember')}
                    inputBg={inputBg}
                    textClass={textClass}
                    subTextClass={subTextClass}
                  />
                  <select
                    value={newInviteRole}
                    onChange={(e) => setNewInviteRole(e.target.value as 'viewer' | 'contributor' | 'editor' | 'comparator')}
                    className={`text-xs rounded border px-2 py-1 ${inputBg}`}
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
                    className={`text-xs rounded border px-2 py-1 ${inputBg}`}
                  />
                  <div />
                </div>
                {newInviteRole === 'comparator' && (
                  <div className={`rounded border p-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/25' : 'border-slate-200 bg-white'}`}>
                    <InviteExchangeScopeForm
                      value={inviteExchangeScope}
                      onChange={setInviteExchangeScope}
                      isDarkMode={isDarkMode}
                      rootCandidates={exchangeRootCandidates}
                    />
                  </div>
                )}
                <button
                  onClick={() => {
                    if (!newInviteIndividualId) return;
                    onCreateInvite(
                      newInviteIndividualId,
                      newInviteRole,
                      newInviteExpiresAt ? new Date(newInviteExpiresAt).toISOString() : undefined,
                      { exchangeScope: inviteExchangeScope },
                    );
                    setNewInviteIndividualId('');
                    setNewInviteRole('viewer');
                    setNewInviteExpiresAt('');
                  }}
                  className={`text-xs rounded px-2 py-1.5 font-semibold ${btnAction}`}
                >
                  {t('topPanel.createInvite')}
                </button>
              </>
            )}
            <InviteListCompact
              invites={personalizedInvites}
              isDarkMode={isDarkMode}
              isInviteMode={isInviteMode}
              copiedInviteId={copiedInviteId}
              formatInviteRole={formatInviteRole}
              onCopyInviteLink={copyInviteLink}
              onRevokeInvite={onRevokeInvite}
              onAcceptInvite={onAcceptInvite}
              t={t}
            />
            {pendingInviteToken && (
              <p className={`text-[11px] ${subTextClass}`}>{t('topPanel.pendingInviteToken')}</p>
            )}
          </section>
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



        {activeTab === 'yourIdentity' && (
          <div className={`rounded-xl border p-4 space-y-3 ${cardClass}`}>
            <h3 className={`text-sm font-bold uppercase tracking-wide ${textClass}`}>{t('topPanel.tabYourIdentity')}</h3>
            <p className={`text-xs leading-relaxed ${subTextClass}`}>{t('topPanel.identityGlobalHint')}</p>
            <div className={`text-xs space-y-1 rounded-lg border p-2 ${innerCardBg}`}>
              <div className="flex justify-between gap-2">
                <span className={subTextClass}>{t('topPanel.wotIdentityStatus')}</span>
                <span className={`font-semibold ${isIdentityClaimed ? 'text-emerald-500' : 'text-amber-500'}`}>
                  {isIdentityClaimed ? t('topPanel.wotIdentityClaimed') : t('topPanel.wotIdentityNone')}
                </span>
              </div>
              {isIdentityClaimed &&
                (claimedIndividualLabel || claimedIndividualWireId || selfIndividualId) && (
                  <div className={`mt-2 pt-2 border-t ${isDarkMode ? 'border-slate-600' : 'border-slate-200'}`}>
                    <div className={`text-[10px] uppercase tracking-wide ${subTextClass}`}>
                      {t('topPanel.wotClaimedIndividual')}
                    </div>
                    <div className={`font-semibold ${textClass} mt-0.5`}>
                      {claimedIndividualLabel || t('topPanel.wotClaimedIndividualUnknown')}
                    </div>
                    {(claimedIndividualWireId ?? selfIndividualId) ? (
                      <div className={`font-mono text-[10px] mt-1 break-all ${subTextClass}`}>
                        {t('topPanel.wotClaimedWireIdentity')}: {claimedIndividualWireId ?? selfIndividualId}
                      </div>
                    ) : null}
                    {claimedWireOpenFileCollisionName ? (
                      <div
                        className={`text-[10px] mt-1.5 leading-snug ${isDarkMode ? 'text-amber-200/90' : 'text-amber-900'}`}
                      >
                        {t('topPanel.wotClaimedWireOtherPersonInOpenFile').replace(
                          '{{name}}',
                          claimedWireOpenFileCollisionName,
                        )}
                      </div>
                    ) : null}
                    {claimedIndividualLocalWireDisambiguation ? (
                      <div
                        className={`text-[10px] mt-1.5 leading-snug ${isDarkMode ? 'text-amber-200/90' : 'text-amber-900'}`}
                      >
                        {t('topPanel.wotClaimedLocalWireDisambiguation').replace(
                          '{{id}}',
                          claimedIndividualLocalWireDisambiguation,
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
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
            {!isIdentityClaimed && onOpenIdentityPanel && (
              <div
                className={`rounded-lg border p-3 space-y-2 ${isDarkMode ? 'border-slate-600 bg-slate-900/30' : 'border-slate-200 bg-white'}`}
              >
                <p className={`text-[11px] leading-relaxed ${subTextClass}`}>{t('topPanel.claimIdentityTopHint')}</p>
                <button
                  type="button"
                  onClick={() => {
                    onOpenIdentityPanel();
                    onActiveTabChange?.('yourIdentity');
                  }}
                  className={`text-xs px-3 py-2 rounded font-bold w-full sm:w-auto ${identityBackupBtnClass}`}
                >
                  {t('topPanel.claimIdentityTopCta')}
                </button>
              </div>
            )}
            {(onExportIdentityBackup || onImportIdentityBackup) && (
              <div className={`rounded-lg border p-2.5 space-y-2 ${innerCardBg}`}>
                <div className={`text-xs font-bold uppercase tracking-wider ${textClass}`}>{t('details.identityBackup')}</div>
                {isIdentityClaimed && onExportIdentityBackup && (
                  <>
                    <div className="relative">
                      <input
                        type={showExportPassword ? 'text' : 'password'}
                        value={exportPassword}
                        onChange={(e) => setExportPassword(e.target.value)}
                        placeholder={t('details.exportPasswordPlaceholder')}
                        autoComplete="new-password"
                        className={`w-full rounded px-2 py-1 pr-9 text-sm border outline-none ${inputBg}`}
                      />
                      <button
                        type="button"
                        className={`absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md ${isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                        onClick={() => setShowExportPassword((v) => !v)}
                        aria-label={showExportPassword ? t('details.hidePassword') : t('details.showPassword')}
                        title={showExportPassword ? t('details.hidePassword') : t('details.showPassword')}
                      >
                        {showExportPassword ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`w-full py-2 rounded text-xs font-bold ${identityBackupBtnClass}`}
                      onClick={() => void onExportIdentityBackup(exportPassword)}
                    >
                      {t('details.exportBackup')}
                    </button>
                  </>
                )}
                {onImportIdentityBackup && (
                  <>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className={`w-full rounded px-2 py-1 text-sm border outline-none ${inputBg}`}
                      onChange={(e) => setIdentityBackupFile(e.target.files?.[0] || null)}
                    />
                    <div className="relative">
                      <input
                        type={showImportPassword ? 'text' : 'password'}
                        value={importPassword}
                        onChange={(e) => setImportPassword(e.target.value)}
                        placeholder={t('details.importPasswordPlaceholder')}
                        autoComplete="new-password"
                        className={`w-full rounded px-2 py-1 pr-9 text-sm border outline-none ${inputBg}`}
                      />
                      <button
                        type="button"
                        className={`absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md ${isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
                        onClick={() => setShowImportPassword((v) => !v)}
                        aria-label={showImportPassword ? t('details.hidePassword') : t('details.showPassword')}
                        title={showImportPassword ? t('details.hidePassword') : t('details.showPassword')}
                      >
                        {showImportPassword ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={!identityBackupFile}
                      className={`w-full py-2 rounded text-xs font-bold ${identityBackupBtnClass} disabled:opacity-50`}
                      onClick={() => identityBackupFile && void onImportIdentityBackup(identityBackupFile, importPassword)}
                    >
                      {t('details.importBackup')}
                    </button>
                  </>
                )}
              </div>
            )}
            {isIdentityClaimed && onRenounceIdentity && (
              <div className="rounded-lg border border-rose-500/60 bg-rose-500/10 p-3 space-y-2">
                <div className={`text-xs font-bold uppercase tracking-wider text-rose-500`}>{t('details.dangerZone')}</div>
                <p className="text-xs text-rose-400">{t('details.renounceWarning')}</p>
                {renounceInlineConfirm ? (
                  <>
                    <p className={`text-[11px] leading-relaxed whitespace-pre-line ${subTextClass}`}>
                      {t('app.confirm.renounceIdentity')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`touch-manipulation flex-1 min-w-[6rem] rounded border py-2 text-[11px] font-bold ${
                          isDarkMode
                            ? 'border-rose-400/50 text-rose-100 hover:bg-rose-500/15'
                            : 'border-rose-400 text-rose-900 hover:bg-rose-100'
                        }`}
                        onClick={() => setRenounceInlineConfirm(false)}
                      >
                        {t('details.cancel')}
                      </button>
                      <button
                        type="button"
                        className="touch-manipulation flex-1 min-w-[6rem] rounded bg-rose-600 py-2 text-[11px] font-bold text-white hover:bg-rose-500"
                        onClick={() => {
                          onRenounceIdentity();
                          setRenounceInlineConfirm(false);
                        }}
                      >
                        {t('details.yes')}
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="touch-manipulation w-full rounded bg-rose-600 py-2 text-xs font-bold text-white hover:bg-rose-500"
                    onClick={() => setRenounceInlineConfirm(true)}
                  >
                    {t('details.renounceIdentity')}
                  </button>
                )}
              </div>
            )}
            {onProvisionalResetAllLocalData && (
              <div
                className={`mt-2 rounded-lg border p-3 space-y-2 ${isDarkMode ? 'border-rose-900/60 bg-rose-950/30' : 'border-rose-200 bg-rose-50'}`}
              >
                <div className={`text-[11px] font-semibold ${isDarkMode ? 'text-rose-100' : 'text-rose-900'}`}>
                  {t('topPanel.provisionalResetTitle')}
                </div>
                <p className={`text-[10px] leading-relaxed ${subTextClass}`}>{t('topPanel.provisionalResetBody')}</p>
                {provisionalResetInlineConfirm ? (
                  <>
                    <p className={`text-[11px] leading-relaxed whitespace-pre-line ${subTextClass}`}>
                      {t('app.confirm.provisionalResetAllData')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`touch-manipulation flex-1 min-w-[6rem] rounded border py-2 text-[11px] font-bold ${
                          isDarkMode
                            ? 'border-rose-400/50 text-rose-100 hover:bg-rose-500/15'
                            : 'border-rose-400 text-rose-900 hover:bg-rose-100'
                        }`}
                        onClick={() => setProvisionalResetInlineConfirm(false)}
                      >
                        {t('details.cancel')}
                      </button>
                      <button
                        type="button"
                        className={`touch-manipulation flex-1 min-w-[6rem] rounded py-2 text-[11px] font-bold text-white ${
                          isDarkMode ? 'bg-rose-800 hover:bg-rose-700' : 'bg-rose-600 hover:bg-rose-500'
                        }`}
                        onClick={() => onProvisionalResetAllLocalData()}
                      >
                        {t('details.yes')}
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setProvisionalResetInlineConfirm(true)}
                    className={`touch-manipulation text-[11px] px-3 py-1.5 rounded font-bold ${
                      isDarkMode ? 'bg-rose-800 hover:bg-rose-700 text-white' : 'bg-rose-600 hover:bg-rose-500 text-white'
                    }`}
                  >
                    {t('topPanel.provisionalResetButton')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab === 'p2pPairShare' && (
          <div className={`rounded-xl border p-4 space-y-3 ${cardClass}`}>
            <h3 className={`text-sm font-bold uppercase tracking-wide ${textClass}`}>{t('topPanel.tabP2pPairShare')}</h3>
            <h4 className={`text-xs font-bold uppercase tracking-wide ${textClass}`}>{t('topPanel.wotHeading')}</h4>
            <p className={`text-xs leading-relaxed ${subTextClass}`}>{t('topPanel.wotIntro')}</p>
            {axisStatusSummary && (
              <div className={`text-[11px] space-y-1 rounded-lg border p-2 ${innerCardBg}`}>
                <div className="flex justify-between gap-2">
                  <span className={subTextClass}>{t('topPanel.axisSession')}</span>
                  <span className={`font-medium ${textClass}`}>{t(axisStatusSummary.sessionKey)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className={subTextClass}>{t('topPanel.axisIdentity')}</span>
                  <span className={`font-medium ${textClass}`}>{t(axisStatusSummary.identityKey)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className={subTextClass}>{t('topPanel.axisTrust')}</span>
                  <span className={`font-medium ${textClass} text-right`}>{axisStatusSummary.trustSummary}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className={subTextClass}>{t('topPanel.axisNode')}</span>
                  <span className={`font-medium ${textClass}`}>{t(axisStatusSummary.nodeKey)}</span>
                </div>
              </div>
            )}
            <p className={`text-xs leading-relaxed mt-1 ${subTextClass}`}>{t('topPanel.wotSymmetricTrust')}</p>
            <p className={`text-xs leading-relaxed ${subTextClass}`}>{t('topPanel.wotAncestorsSharing')}</p>
            {wotNodePanel && (
              <div
                className={`text-xs space-y-2 rounded-lg border p-3 ${isDarkMode ? 'border-violet-900/60 bg-violet-950/25' : 'border-violet-200 bg-violet-50/90'}`}
              >
                <div className={`font-bold uppercase tracking-wide text-[11px] ${textClass}`}>
                  {t('topPanel.wotNodeSectionTitle')}
                </div>
                <div className={`${subTextClass} text-[11px]`}>
                  {t(wotNodePanel.runtimeLabelKey)}
                </div>
                <div className={`${subTextClass} text-[11px]`}>
                  {t('topPanel.wotNodeEligibilityLine')
                    .replace('{{reason}}', t(`topPanel.wotNodeReason_${wotNodePanel.eligibilityReasonKey}`))
                    .replace('{{have}}', String(wotNodePanel.directedCertTotal))
                    .replace('{{need}}', String(wotNodePanel.requiredCount))}
                </div>
                {wotNodePanel.personhoodMajority && (
                  <div className={`text-[10px] ${isDarkMode ? 'text-amber-200/90' : 'text-amber-900'}`}>
                    {t('topPanel.wotNodePersonhoodMajorityHint')}
                  </div>
                )}
                {wotNodePanel.allowLocalWotNodeControls && (
                  <div className="space-y-2">
                    <label className={`block text-[11px] ${subTextClass}`}>{t('topPanel.wotNodeRoot')}</label>
                    <select
                      className={`w-full rounded border px-2 py-1 text-xs ${inputBg}`}
                      value={wotNodePanel.rootId}
                      onChange={(e) => wotNodePanel.onRootChange(e.target.value)}
                    >
                      <option value="">{t('topPanel.wotNodeRootPlaceholder')}</option>
                      {wotNodePanel.rootCandidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <div className="flex flex-wrap gap-2 items-center">
                      <label className={`text-[11px] ${subTextClass}`}>{t('topPanel.wotNodeTtlHours')}</label>
                      <input
                        type="number"
                        min={1}
                        className={`w-24 rounded border px-2 py-1 text-xs ${inputBg}`}
                        value={wotNodePanel.ttlHours}
                        onChange={(e) => wotNodePanel.onTtlHoursChange(Number(e.target.value) || 1)}
                      />
                      <label className={`text-[11px] ${subTextClass}`}>{t('topPanel.wotNodeMaxGenUp')}</label>
                      <input
                        type="number"
                        min={0}
                        className={`w-20 rounded border px-2 py-1 text-xs ${inputBg}`}
                        value={wotNodePanel.maxGenUp}
                        onChange={(e) => wotNodePanel.onMaxGenUpChange(Number(e.target.value) || 0)}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!isIdentityClaimed || wotNodePanel.active}
                        onClick={() => wotNodePanel.onActivate()}
                        className={`px-3 py-1.5 rounded text-[11px] font-semibold disabled:opacity-40 ${
                          isDarkMode ? 'bg-violet-700 hover:bg-violet-600 text-white' : 'bg-violet-600 text-white hover:bg-violet-500'
                        }`}
                      >
                        {t('topPanel.wotNodeActivate')}
                      </button>
                      <button
                        type="button"
                        disabled={!wotNodePanel.active}
                        onClick={() => wotNodePanel.onRevoke()}
                        className={`px-3 py-1.5 rounded text-[11px] font-semibold disabled:opacity-40 ${btnAction}`}
                      >
                        {t('topPanel.wotNodeRevoke')}
                      </button>
                    </div>
                  </div>
                )}
                {wotNodePanel.expiresAt && wotNodePanel.active && (
                  <div className={`text-[10px] ${subTextClass}`}>
                    {t('topPanel.wotNodeExpires')}: {new Date(wotNodePanel.expiresAt).toLocaleString()}
                  </div>
                )}
                {wotNodePanel.remoteAnn?.active && Date.parse(wotNodePanel.remoteAnn.expiresAt) > Date.now() && (
                  <div className={`text-[10px] ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                    {t('topPanel.wotNodeRemoteActive').replace(
                      '{{root}}',
                      wotNodePanel.remoteAnn.rootIndividualId,
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab === 'peerIdentities' && (
          <div className={`rounded-xl border p-4 space-y-3 ${cardClass}`}>
            <h3 className={`text-sm font-bold uppercase tracking-wide ${textClass}`}>{t('topPanel.peerIdentityHeading')}</h3>
            {peerIdentityRows.length === 0 ? (
              <p className={`text-xs ${subTextClass}`}>{t('topPanel.peerIdentityEmpty')}</p>
            ) : (
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {peerIdentityRows.map((row) => (
                  <div
                    key={row.peerId}
                    className={`rounded border px-2 py-2 text-xs ${isDarkMode ? 'border-slate-700 bg-slate-900/35' : 'border-slate-200 bg-white'}`}
                  >
                    <div className={`font-semibold ${textClass}`}>{row.label}</div>
                    {row.label !== row.peerId ? (
                      <div className={`${subTextClass} text-[11px] font-mono break-all`}>{row.peerId}</div>
                    ) : null}
                    {row.claimedAt && (
                      <div className={`${subTextClass} text-[11px]`}>
                        {t('topPanel.peerIdentityClaimedAt')}: {new Date(row.claimedAt).toLocaleString()}
                      </div>
                    )}
                    {row.relationStatus && (
                      <div className={`${subTextClass} text-[10px]`}>
                        {t('topPanel.peerRelationLabel')}: {t(`topPanel.peerRelation_${row.relationStatus}`)}
                      </div>
                    )}
                    {onSetPeerCertificationKind && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <label className={`text-[10px] ${subTextClass}`}>{t('topPanel.peerCertKind')}</label>
                        <select
                          className={`rounded border px-1 py-0.5 text-[10px] ${inputBg}`}
                          value={row.certificationKindByMe ?? 'personhoodCertification'}
                          onChange={(e) =>
                            onSetPeerCertificationKind(row.peerId, e.target.value as CertificationKind)
                          }
                        >
                          <option value="personhoodCertification">{t('topPanel.peerCertKindPersonhood')}</option>
                          <option value="relationshipCertification">{t('topPanel.peerCertKindRelationship')}</option>
                        </select>
                      </div>
                    )}
                    {onTogglePeerCertifiedByMe && (
                      <button
                        type="button"
                        onClick={() => onTogglePeerCertifiedByMe(row.peerId, !row.certifiedByMe)}
                        className={`mt-2 px-2 py-1 rounded text-[11px] font-semibold ${
                          row.certifiedByMe
                            ? isDarkMode
                              ? 'bg-emerald-800 text-emerald-100'
                              : 'bg-emerald-600 text-white'
                            : isDarkMode
                              ? 'bg-slate-700 text-slate-100'
                              : 'bg-slate-200 text-slate-800'
                        }`}
                      >
                        {row.certifiedByMe ? t('topPanel.peerIdentityCertified') : t('topPanel.peerIdentityCertify')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
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

const InviteListCompact: React.FC<{
  invites: TopPanelProps['invites'];
  isDarkMode: boolean;
  isInviteMode: boolean;
  copiedInviteId: string | null;
  formatInviteRole: (role: 'viewer' | 'contributor' | 'editor' | 'comparator') => string;
  onCopyInviteLink: (inviteId: string, link?: string) => void;
  onRevokeInvite: (inviteId: string) => void;
  onAcceptInvite: (inviteId: string) => void;
  t: (key: string) => string;
}> = ({
  invites,
  isDarkMode,
  isInviteMode,
  copiedInviteId,
  formatInviteRole,
  onCopyInviteLink,
  onRevokeInvite,
  onAcceptInvite,
  t,
}) => {
  if (invites.length === 0) {
    return <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{t('topPanel.noInvites')}</p>;
  }
  return (
    <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
      {invites.map((invite) => {
        const isExpired = invite.status === 'expired';
        const isRevoked = invite.status === 'revoked';
        const canHostRevoke =
          (invite.status === 'active' || invite.status === 'accepted') &&
          !isInviteMode &&
          !isExpired &&
          !isRevoked;
        return (
          <div
            key={invite.inviteId}
            className={`rounded border p-2 text-xs ${isDarkMode ? 'border-slate-700 bg-slate-900/35' : 'border-slate-200 bg-white'}`}
          >
            <div className={`font-semibold ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>
              {invite.linkKind === 'ephemeral_free'
                ? t('topPanel.ephemeralInviteLabel')
                : t('topPanel.inviteNamedFor')
                    .replace('{{name}}', invite.individualName || '—')
                    .replace('{{role}}', formatInviteRole(invite.role))}
            </div>
            <div className={`${isDarkMode ? 'text-slate-400' : 'text-slate-500'} text-[11px]`}>
              {t('topPanel.status')}: {invite.status}
              {invite.expiresAt ? ` | ${t('topPanel.expires')}: ${new Date(invite.expiresAt).toLocaleDateString()}` : ''}
            </div>
            <div className="mt-1 flex flex-wrap gap-1 items-start">
              {invite.inviteLink && !isInviteMode && (
                <>
                  <InviteQrCode
                    url={invite.inviteLink}
                    isDarkMode={isDarkMode}
                    size={52}
                    className="shrink-0"
                    enlargeOnClick
                    enlargeAriaLabel={t('topPanel.qrEnlargeAria')}
                  />
                  <button
                    type="button"
                    onClick={() => onCopyInviteLink(invite.inviteId, invite.inviteLink)}
                    className={`px-2 py-1 rounded text-[11px] font-semibold ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-100' : 'bg-slate-200 hover:bg-slate-300 text-slate-800'}`}
                  >
                    {copiedInviteId === invite.inviteId ? t('topPanel.inviteCopied') : t('topPanel.copyInviteLink')}
                  </button>
                </>
              )}
              {canHostRevoke && (
                <button
                  onClick={() => onRevokeInvite(invite.inviteId)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold ${isDarkMode ? 'bg-rose-900 hover:bg-rose-800 text-white' : 'bg-rose-600 hover:bg-rose-500 text-white'}`}
                >
                  {t('topPanel.revoke')}
                </button>
              )}
              {invite.status === 'active' && isInviteMode && (
                <button
                  onClick={() => onAcceptInvite(invite.inviteId)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold ${isDarkMode ? 'bg-emerald-800 hover:bg-emerald-700 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
                >
                  {t('topPanel.acceptInvite')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: number; isDarkMode: boolean }> = ({ label, value, isDarkMode }) => (
  <div className={`rounded-lg border px-3 py-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
    <div className="text-[11px] opacity-70 uppercase">{label}</div>
    <div className="text-xl font-bold">{value}</div>
  </div>
);

const ToggleRow: React.FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  inputFirst?: boolean;
  textClass?: string;
}> = ({ label, checked, onChange, inputFirst = false, textClass = '' }) => (
  <label className={`flex items-center gap-2 ${inputFirst ? '' : 'justify-between'}`}>
    {inputFirst ? (
      <>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={textClass}>{label}</span>
      </>
    ) : (
      <>
        <span className={textClass}>{label}</span>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </>
    )}
  </label>
);

export default TopPanel;