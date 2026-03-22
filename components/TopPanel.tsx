import React, { useState, useEffect, useMemo } from 'react';
import { Save, Network, Copy, Check, WifiOff } from 'lucide-react';
import { P2PStatus, P2PMode } from '../types';
import { ActivityLogEvent } from '../services/p2pDomain';
import { useI18n } from '../i18n';

interface P2PVisibilitySettings {
  exposeIdentity: boolean;
  exposeDates: boolean;
  exposePlaces: boolean;
  exposeNotes: boolean;
  allowDocuments: boolean;
  allowDownload: boolean;
  allowProposal: boolean;
  allowDirectEdit: boolean;
}

interface TopPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  databaseName?: string;
  onDownload: () => void;
  onDownloadBundle: () => void;
  hasData: boolean;
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
  }>;
  visibilitySettings: P2PVisibilitySettings;
  livingCandidates: Array<{ id: string; label: string }>;
  invites: Array<{
    inviteId: string;
    individualId: string;
    individualName: string;
    role: 'viewer' | 'contributor' | 'editor';
    expiresAt?: string;
    status: 'active' | 'revoked';
    personalizedDefault: boolean;
  }>;
  pendingProposalsCount: number;
  syncStatusText?: string | null;
  initialCompareStatusText?: string | null;
  buildLabel?: string;
  onChangeVisibilitySettings: (next: P2PVisibilitySettings) => void;
  onCreateInvite: (individualId: string, role: 'viewer' | 'contributor' | 'editor', expiresAt?: string) => void;
  onRevokeInvite: (inviteId: string) => void;
  onReviewProposal: (proposalId: string) => void;
}

const TopPanel: React.FC<TopPanelProps> = ({ 
  isOpen, 
  onToggle, 
  databaseName,
  onDownload, 
  onDownloadBundle,
  hasData,
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
  activityEvents,
  proposals,
  visibilitySettings,
  livingCandidates,
  invites,
  pendingProposalsCount,
  syncStatusText,
  initialCompareStatusText,
  buildLabel,
  onChangeVisibilitySettings,
  onCreateInvite,
  onRevokeInvite,
  onReviewProposal,
}) => {
  const { t } = useI18n();
  const [targetHostId, setTargetHostId] = useState('');
  const [copied, setCopied] = useState(false);
  const [newInviteIndividualId, setNewInviteIndividualId] = useState('');
  const [newInviteRole, setNewInviteRole] = useState<'viewer' | 'contributor' | 'editor'>('viewer');
  const [newInviteExpiresAt, setNewInviteExpiresAt] = useState('');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showActivityDetails, setShowActivityDetails] = useState(false);
  const [proposalPage, setProposalPage] = useState(0);
  const PROPOSALS_PAGE_SIZE = 30;

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
    const counts = { view: 0, download: 0, proposal: 0 };
    for (const event of activityEvents) {
      if (event.eventType.includes('view')) counts.view += 1;
      if (event.eventType.includes('download')) counts.download += 1;
      if (event.eventType.includes('proposal')) counts.proposal += 1;
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
  const formatInviteRole = (role: 'viewer' | 'contributor' | 'editor') => {
    if (role === 'viewer') return t('topPanel.roleViewer');
    if (role === 'contributor') return t('topPanel.roleContributor');
    return t('topPanel.roleEditor');
  };
  const showShareAction = p2pMode === 'host';
  // Allow actions when remote state is unknown; handlers perform final checks.
  const canStartShare = showShareAction && localHasData && remoteHasData !== true;
  const canStartCompare = localHasData && remoteHasData !== false;

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
          <div className="w-full max-w-5xl mx-auto">
          <div className="flex items-center gap-2 w-full flex-wrap">
          
          {/* Save Section */}
          <div className={`flex items-center gap-2 rounded px-2 py-1 border ${isDarkMode ? 'bg-neutral-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
            <Save className={`w-3.5 h-3.5 shrink-0 ${subTextClass}`} />
            {!hasData ? (
              <span className={`text-[10px] ${subTextClass}`}>{t('topPanel.noData')}</span>
            ) : (
              <>
                <span className={`text-[10px] font-bold ${textClass} truncate max-w-[120px]`}>
                  {databaseName || t('topPanel.unknown')}
                </span>
                <button 
                  onClick={onDownload}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded font-bold text-[10px] transition-colors shadow-sm shrink-0 ${btnAction}`}
                >
                  <Save className="w-3 h-3" /> GED
                </button>
                <button
                  onClick={onDownloadBundle}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded font-bold text-[10px] transition-colors shadow-sm shrink-0 ${btnAction}`}
                >
                  {t('sidebar.labels.importBundle')}
                </button>
              </>
            )}
          </div>

          {/* P2P Network Section */}
          <div className={`flex items-center gap-2 rounded px-2 py-1 border ${isDarkMode ? 'bg-neutral-900/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
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

        {p2pStatus !== 'disconnected' && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
          <section className={`md:col-span-3 rounded-xl border p-4 ${cardClass}`}>
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

          <section className={`md:col-span-2 rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3">{t('topPanel.activity')}</h3>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <StatCard label={t('topPanel.views')} value={activitySummary.view} isDarkMode={isDarkMode} />
              <StatCard label={t('topPanel.downloads')} value={activitySummary.download} isDarkMode={isDarkMode} />
              <StatCard label={t('topPanel.proposals')} value={activitySummary.proposal} isDarkMode={isDarkMode} />
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

          <section className={`rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3">{t('topPanel.accessControls')}</h3>
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
          </section>

          <section className={`md:col-span-3 rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-2">{t('topPanel.connectionProfiles')}</h3>
            <p className={`text-xs mb-3 ${subTextClass}`}>
              {t('topPanel.connectionProfilesHint')}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
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
                onChange={(e) => setNewInviteRole(e.target.value as 'viewer' | 'contributor' | 'editor')}
                className={`text-sm rounded border px-2 py-1 ${inputBg}`}
              >
                <option value="viewer">{t('topPanel.roleViewer')}</option>
                <option value="contributor">{t('topPanel.roleContributor')}</option>
                <option value="editor">{t('topPanel.roleEditor')}</option>
              </select>
              <input
                type="date"
                value={newInviteExpiresAt}
                onChange={(e) => setNewInviteExpiresAt(e.target.value)}
                className={`text-sm rounded border px-2 py-1 ${inputBg}`}
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
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {invites.length === 0 ? (
                <p className={`text-sm ${subTextClass}`}>{t('topPanel.noInvites')}</p>
              ) : (
                invites.map((invite) => (
                  <div key={invite.inviteId} className={`rounded border p-2 text-xs flex items-center justify-between gap-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                    <div>
                      <div className="font-semibold">{invite.individualName} ({formatInviteRole(invite.role)})</div>
                      <div className={subTextClass}>
                        {invite.personalizedDefault ? t('topPanel.defaultInvite') : t('topPanel.manualInvite')} | {t('topPanel.status')}: {invite.status}
                        {invite.expiresAt ? ` | ${t('topPanel.expires')}: ${new Date(invite.expiresAt).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    {invite.status === 'active' && (
                      <button
                        onClick={() => onRevokeInvite(invite.inviteId)}
                        className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-rose-800 hover:bg-rose-700' : 'bg-rose-600 text-white hover:bg-rose-500'}`}
                      >
                        {t('topPanel.revoke')}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
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