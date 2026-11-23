import React, { useState } from 'react';
import { Check, Vote, X } from 'lucide-react';
import { apiRequest } from '../api/client';

export default function VotingSection({
  activeTripId,
  tripDetail,
  proposals = [],
  itineraries = [],
  currentUser,
  onRefresh,
  notify,
}) {
  const [voterOverride, setVoterOverride] = useState('');

  async function handleVote(proposalId, choice) {
    try {
      await apiRequest(`/api/voting/proposals/${proposalId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ choice, user_id: voterOverride ? Number(voterOverride) : null }),
      });
      notify('success', `Recorded "${choice}" vote.`);
      if (onRefresh) onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  async function handleCommitApproval(itineraryId) {
    try {
      await apiRequest(`/api/voting/itineraries/${itineraryId}/approve`, { method: 'POST' });
      notify('success', `Itinerary #${itineraryId} APPROVED! Deferred quorum trigger satisfied.`);
      if (onRefresh) onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    }
  }

  return (
    <div className="color-block bg-block-cream space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow-mono">GROUP CONSENSUS & QUORUM APPROVALS</span>
          <h2 className="display-lg mt-1">Approve itineraries with fair group agreement.</h2>
        </div>
        {tripDetail?.members?.length > 0 && (
          <div className="bg-canvas border border-hairline rounded-md p-2.5 min-w-[220px]">
            <label className="caption-mono block mb-1">ACTING VOTER</label>
            <select
              aria-label="Acting Voter"
              className="field-input py-1.5 text-sm"
              value={voterOverride}
              onChange={(e) => setVoterOverride(e.target.value)}
            >
              <option value="">Logged-in User</option>
              {tripDetail.members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {proposals.map((prop) => (
          <div key={prop.proposal_id} className="editorial-card space-y-4">
            <div className="flex justify-between items-start gap-2">
              <div>
                <span className="caption-mono">
                  PROPOSAL #{prop.proposal_id} · ITINERARY v{prop.itinerary_version}
                </span>
                <h3 className="text-lg font-bold mt-0.5">{prop.itinerary_summary}</h3>
              </div>
              <span className="caption-mono px-2.5 py-1 rounded-pill bg-surface-soft border border-hairline">
                {prop.itinerary_status}
              </span>
            </div>

            <div className="rounded-md bg-surface-soft p-3.5 flex items-center justify-between">
              <div className="font-bold text-lg">
                {prop.approve_count} / {prop.required_votes} approvals ({prop.quorum_pct}%)
              </div>
              {prop.quorum_met ? (
                <span className="inline-flex items-center gap-1 text-sm font-medium text-semantic-success">
                  <Check className="w-4 h-4" /> Ready
                </span>
              ) : (
                <span className="caption-mono">NOT MET</span>
              )}
            </div>

            <div className="space-y-1">
              {(prop.votes || []).map((v) => (
                <div key={v.user_id} className="flex justify-between text-sm py-1 border-b border-hairline-soft">
                  <span>{v.full_name}</span>
                  <span className="caption-mono">{v.choice}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleVote(prop.proposal_id, 'APPROVE')}
                className="btn-success text-sm py-2 px-4"
              >
                <Vote className="w-4 h-4" /> Approve
              </button>
              <button
                onClick={() => handleVote(prop.proposal_id, 'REJECT')}
                className="bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-semibold rounded-pill text-sm py-2 px-4 transition-all active:scale-[0.98]"
              >
                Reject
              </button>
              <button
                onClick={() => handleCommitApproval(prop.itinerary_id)}
                className="btn-secondary text-sm py-2 px-4 ml-auto border-primary"
              >
                Commit Approval
              </button>
            </div>
          </div>
        ))}

        {proposals.length === 0 && (
          <div className="col-span-full editorial-card p-10 text-center text-ink/50 text-sm">
            No active proposals yet. Open a proposal from Trip Workspace to initiate voting.
          </div>
        )}
      </div>
    </div>
  );
}
