import React, { useMemo, useState } from 'react';
import { ActivityLogEvent } from '../services/p2pDomain';
import { useI18n } from '../i18n';

interface P2PVisibilitySettings {
  exposeIdentity: boolean;
  exposeDates: boolean;
  exposePlaces: boolean;
  exposeNotes: boolean;
  allowDownload: boolean;
  allowProposal: boolean;
  allowDirectEdit: boolean;
}

interface P2PDashboardProps {
  isOpen: boolean;
  isDarkMode: boolean;
  p2pStatus: string;
  peerId: string | null;
  activityEvents: ActivityLogEvent[];
  proposals: Array<{
    proposalId: string;
    individualId: string;
    individualLabel: string;
    authorPeerId: string;
    proposedAt: string;
    changeSet: Record<string, unknown>;
    status: 'pending' | 'accepted' | 'rejected';
    decidedAt?: string;
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
  onClose: () => void;
  onChangeVisibilitySettings: (next: P2PVisibilitySettings) => void;
  onCreateInvite: (individualId: string, role: 'viewer' | 'contributor' | 'editor', expiresAt?: string) => void;
  onRevokeInvite: (inviteId: string) => void;
  onDecideProposal: (proposalId: string, decision: 'accepted' | 'rejected') => void;
}

const P2PDashboard: React.FC<P2PDashboardProps> = ({
  isOpen,
  isDarkMode,
  p2pStatus,
  peerId,
  activityEvents,
  proposals,
  visibilitySettings,
  livingCandidates,
  invites,
  onClose,
  onChangeVisibilitySettings,
  onCreateInvite,
  onRevokeInvite,
  onDecideProposal,
}) => {
  const { t } = useI18n();
  const [newInviteIndividualId, setNewInviteIndividualId] = useState('');
  const [newInviteRole, setNewInviteRole] = useState<'viewer' | 'contributor' | 'editor'>('viewer');
  const [newInviteExpiresAt, setNewInviteExpiresAt] = useState('');

  const panelClass = isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900';
  const mutedClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const cardClass = isDarkMode ? 'bg-slate-800/60 border-slate-700' : 'bg-slate-50 border-slate-200';

  const activitySummary = useMemo(() => {
    const counts = { view: 0, download: 0, proposal: 0 };
    for (const event of activityEvents) {
      if (event.eventType.includes('view')) counts.view += 1;
      if (event.eventType.includes('download')) counts.download += 1;
      if (event.eventType.includes('proposal')) counts.proposal += 1;
    }
    return counts;
  }, [activityEvents]);

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 z-[120] ${isDarkMode ? 'bg-black/95 text-white' : 'bg-sky-50/95 text-black'} backdrop-blur-sm`}>
      <div className="h-full overflow-y-auto px-6 py-8 md:px-10">
        <div className={`max-w-5xl mx-auto rounded-2xl border shadow-2xl ${panelClass}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-inherit">
          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide">{t('p2pDashboard.title')}</h2>
            <p className={`text-xs ${mutedClass}`}>
              {t('p2pDashboard.status')}: <span className="font-semibold">{p2pStatus}</span> {peerId ? `| ${t('p2pDashboard.peerId')}: ${peerId}` : ''}
            </p>
          </div>
          <button onClick={onClose} className={`px-3 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-200 hover:bg-slate-300'}`}>
            {t('p2pDashboard.close')}
          </button>
        </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
            <section className={`md:col-span-3 rounded-xl border p-4 ${cardClass}`}>
              <h3 className="text-sm font-bold uppercase tracking-wide mb-3">
                {t('topPanel.proposals')} {proposals.length > 0 ? `(${proposals.length})` : ''}
              </h3>
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {proposals.length === 0 ? (
                  <p className={`text-sm ${mutedClass}`}>{t('topPanel.noProposals')}</p>
                ) : (
                  proposals.map((proposal) => (
                    <div key={proposal.proposalId} className={`rounded border p-2 text-xs ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                      <div className="font-semibold">
                        {proposal.individualLabel} ({proposal.individualId})
                      </div>
                      <div className={mutedClass}>
                        {t('p2pDashboard.from')}: {proposal.authorPeerId} | {t('p2pDashboard.status')}: {proposal.status} | {t('p2pDashboard.at')}: {new Date(proposal.proposedAt).toLocaleString()}
                      </div>
                      <div className="mt-1">
                        <span className={`${mutedClass}`}>{t('p2pDashboard.changes')}: </span>
                        {Object.keys(proposal.changeSet || {}).join(', ') || t('p2pDashboard.none')}
                      </div>
                      {proposal.status === 'pending' && (
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => onDecideProposal(proposal.proposalId, 'accepted')}
                            className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-emerald-800 hover:bg-emerald-700' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                          >
                            {t('p2pDashboard.accept')}
                          </button>
                          <button
                            onClick={() => onDecideProposal(proposal.proposalId, 'rejected')}
                            className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-rose-800 hover:bg-rose-700' : 'bg-rose-600 text-white hover:bg-rose-500'}`}
                          >
                            {t('p2pDashboard.reject')}
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

            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {activityEvents.length === 0 ? (
                <p className={`text-sm ${mutedClass}`}>{t('topPanel.noActivity')}</p>
              ) : (
                activityEvents
                  .slice()
                  .reverse()
                  .map((event) => (
                    <div key={event.eventId} className={`rounded border p-2 text-xs ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                      <div className="font-semibold">{event.eventType}</div>
                      <div className={mutedClass}>
                        {t('topPanel.actor')}: {event.actorPeerId} | {t('topPanel.target')}: {event.targetType}:{event.targetId}
                      </div>
                      <div className={mutedClass}>{new Date(event.timestamp).toLocaleString()}</div>
                    </div>
                  ))
              )}
            </div>
          </section>

          <section className={`rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3">{t('topPanel.accessControls')}</h3>
            <div className="space-y-2 text-sm">
              <ToggleRow
                label={t('topPanel.exposeIdentity')}
                checked={visibilitySettings.exposeIdentity}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeIdentity: checked })}
              />
              <ToggleRow
                label={t('topPanel.exposeDates')}
                checked={visibilitySettings.exposeDates}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeDates: checked })}
              />
              <ToggleRow
                label={t('topPanel.exposePlaces')}
                checked={visibilitySettings.exposePlaces}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposePlaces: checked })}
              />
              <ToggleRow
                label={t('topPanel.exposeNotes')}
                checked={visibilitySettings.exposeNotes}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeNotes: checked })}
              />
              <ToggleRow
                label={t('topPanel.allowDownload')}
                checked={visibilitySettings.allowDownload}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDownload: checked })}
              />
              <ToggleRow
                label={t('topPanel.allowProposals')}
                checked={visibilitySettings.allowProposal}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowProposal: checked })}
              />
              <ToggleRow
                label={t('topPanel.allowDirectEdits')}
                checked={visibilitySettings.allowDirectEdit}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDirectEdit: checked })}
              />
            </div>
          </section>

            <section className={`md:col-span-3 rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3">{t('topPanel.connectionProfiles')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
              <select
                value={newInviteIndividualId}
                onChange={(e) => setNewInviteIndividualId(e.target.value)}
                className={`text-sm rounded border px-2 py-1 ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}
              >
                <option value="">{t('topPanel.selectLivingMember')}</option>
                {livingCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
              <select
                value={newInviteRole}
                onChange={(e) => setNewInviteRole(e.target.value as 'viewer' | 'contributor' | 'editor')}
                className={`text-sm rounded border px-2 py-1 ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}
              >
                <option value="viewer">{t('topPanel.roleViewer')}</option>
                <option value="contributor">{t('topPanel.roleContributor')}</option>
                <option value="editor">{t('topPanel.roleEditor')}</option>
              </select>
              <input
                type="date"
                value={newInviteExpiresAt}
                onChange={(e) => setNewInviteExpiresAt(e.target.value)}
                className={`text-sm rounded border px-2 py-1 ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}
              />
              <button
                onClick={() => {
                  if (!newInviteIndividualId) return;
                  onCreateInvite(
                    newInviteIndividualId,
                    newInviteRole,
                    newInviteExpiresAt ? new Date(newInviteExpiresAt).toISOString() : undefined
                  );
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
                <p className={`text-sm ${mutedClass}`}>{t('topPanel.noInvites')}</p>
              ) : (
                invites.map((invite) => (
                  <div key={invite.inviteId} className={`rounded border p-2 text-xs flex items-center justify-between gap-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                    <div>
                      <div className="font-semibold">
                        {invite.individualName} ({invite.role === 'viewer' ? t('topPanel.roleViewer') : invite.role === 'contributor' ? t('topPanel.roleContributor') : t('topPanel.roleEditor')})
                      </div>
                      <div className={mutedClass}>
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

export default P2PDashboard;
