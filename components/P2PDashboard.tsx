import React, { useMemo, useState } from 'react';
import { ActivityLogEvent } from '../services/p2pDomain';

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
            <h2 className="text-lg font-bold uppercase tracking-wide">P2P Dashboard</h2>
            <p className={`text-xs ${mutedClass}`}>
              Status: <span className="font-semibold">{p2pStatus}</span> {peerId ? `| Peer ID: ${peerId}` : ''}
            </p>
          </div>
          <button onClick={onClose} className={`px-3 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-200 hover:bg-slate-300'}`}>
            Close
          </button>
        </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
            <section className={`md:col-span-3 rounded-xl border p-4 ${cardClass}`}>
              <h3 className="text-sm font-bold uppercase tracking-wide mb-3">
                Proposals {proposals.length > 0 ? `(${proposals.length})` : ''}
              </h3>
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {proposals.length === 0 ? (
                  <p className={`text-sm ${mutedClass}`}>No proposals yet.</p>
                ) : (
                  proposals.map((proposal) => (
                    <div key={proposal.proposalId} className={`rounded border p-2 text-xs ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                      <div className="font-semibold">
                        {proposal.individualLabel} ({proposal.individualId})
                      </div>
                      <div className={mutedClass}>
                        From: {proposal.authorPeerId} | Status: {proposal.status} | At: {new Date(proposal.proposedAt).toLocaleString()}
                      </div>
                      <div className="mt-1">
                        <span className={`${mutedClass}`}>Changes: </span>
                        {Object.keys(proposal.changeSet || {}).join(', ') || 'none'}
                      </div>
                      {proposal.status === 'pending' && (
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => onDecideProposal(proposal.proposalId, 'accepted')}
                            className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-emerald-800 hover:bg-emerald-700' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => onDecideProposal(proposal.proposalId, 'rejected')}
                            className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-rose-800 hover:bg-rose-700' : 'bg-rose-600 text-white hover:bg-rose-500'}`}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

          <section className={`md:col-span-2 rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3">Activity</h3>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <StatCard label="Views" value={activitySummary.view} isDarkMode={isDarkMode} />
              <StatCard label="Downloads" value={activitySummary.download} isDarkMode={isDarkMode} />
              <StatCard label="Proposals" value={activitySummary.proposal} isDarkMode={isDarkMode} />
            </div>

            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {activityEvents.length === 0 ? (
                <p className={`text-sm ${mutedClass}`}>No activity yet.</p>
              ) : (
                activityEvents
                  .slice()
                  .reverse()
                  .map((event) => (
                    <div key={event.eventId} className={`rounded border p-2 text-xs ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                      <div className="font-semibold">{event.eventType}</div>
                      <div className={mutedClass}>
                        Actor: {event.actorPeerId} | Target: {event.targetType}:{event.targetId}
                      </div>
                      <div className={mutedClass}>{new Date(event.timestamp).toLocaleString()}</div>
                    </div>
                  ))
              )}
            </div>
          </section>

          <section className={`rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3">Access Controls</h3>
            <div className="space-y-2 text-sm">
              <ToggleRow
                label="Expose identity"
                checked={visibilitySettings.exposeIdentity}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeIdentity: checked })}
              />
              <ToggleRow
                label="Expose dates"
                checked={visibilitySettings.exposeDates}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeDates: checked })}
              />
              <ToggleRow
                label="Expose places"
                checked={visibilitySettings.exposePlaces}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposePlaces: checked })}
              />
              <ToggleRow
                label="Expose notes"
                checked={visibilitySettings.exposeNotes}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, exposeNotes: checked })}
              />
              <ToggleRow
                label="Allow download"
                checked={visibilitySettings.allowDownload}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDownload: checked })}
              />
              <ToggleRow
                label="Allow proposals"
                checked={visibilitySettings.allowProposal}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowProposal: checked })}
              />
              <ToggleRow
                label="Allow direct edits"
                checked={visibilitySettings.allowDirectEdit}
                onChange={(checked) => onChangeVisibilitySettings({ ...visibilitySettings, allowDirectEdit: checked })}
              />
            </div>
          </section>

            <section className={`md:col-span-3 rounded-xl border p-4 ${cardClass}`}>
            <h3 className="text-sm font-bold uppercase tracking-wide mb-3">Invitations</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
              <select
                value={newInviteIndividualId}
                onChange={(e) => setNewInviteIndividualId(e.target.value)}
                className={`text-sm rounded border px-2 py-1 ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'}`}
              >
                <option value="">Select living member</option>
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
                <option value="viewer">viewer</option>
                <option value="contributor">contributor</option>
                <option value="editor">editor</option>
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
                Create invite
              </button>
            </div>

            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {invites.length === 0 ? (
                <p className={`text-sm ${mutedClass}`}>No invites yet.</p>
              ) : (
                invites.map((invite) => (
                  <div key={invite.inviteId} className={`rounded border p-2 text-xs flex items-center justify-between gap-2 ${isDarkMode ? 'border-slate-700 bg-slate-900/40' : 'border-slate-200 bg-white'}`}>
                    <div>
                      <div className="font-semibold">
                        {invite.individualName} ({invite.role})
                      </div>
                      <div className={mutedClass}>
                        {invite.personalizedDefault ? 'Default living-member invite' : 'Manual invite'} | Status: {invite.status}
                        {invite.expiresAt ? ` | Expires: ${new Date(invite.expiresAt).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    {invite.status === 'active' && (
                      <button
                        onClick={() => onRevokeInvite(invite.inviteId)}
                        className={`px-2 py-1 rounded text-xs font-semibold ${isDarkMode ? 'bg-rose-800 hover:bg-rose-700' : 'bg-rose-600 text-white hover:bg-rose-500'}`}
                      >
                        Revoke
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
