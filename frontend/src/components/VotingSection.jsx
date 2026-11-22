import React, { useState } from 'react';
import {
  Check,
  X,
  Vote,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Lock,
  Users,
  AlertCircle,
  Plus,
  Sparkles,
  Minus,
} from 'lucide-react';
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
  const [submittingVote, setSubmittingVote] = useState(null);
  const [committing, setCommitting] = useState(null);
  const [creatingProposal, setCreatingProposal] = useState(false);

  const members = tripDetail?.members || [];
  const activeVoterId = voterOverride
    ? Number(voterOverride)
    : currentUser?.user_id || members[0]?.user_id || null;
  const activeMember = members.find((m) => m.user_id === activeVoterId) || {
    full_name: currentUser?.full_name || 'Logged-in User',
    role: 'Member',
  };

  const getInitials = (name) => {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getAvatarStyle = (name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('dilraj')) return 'bg-purple-100 text-purple-800 border-purple-200';
    if (n.includes('arya')) return 'bg-sky-100 text-sky-800 border-sky-200';
    if (n.includes('aarush')) return 'bg-amber-100 text-amber-800 border-amber-200';
    return 'bg-slate-100 text-slate-800 border-slate-200';
  };

  async function handleVote(proposalId, choice) {
    if (!activeVoterId) {
      notify('error', 'Please select or sign in as an active voter.');
      return;
    }
    try {
      setSubmittingVote(proposalId);
      await apiRequest(`/api/voting/proposals/${proposalId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ choice, user_id: activeVoterId }),
      });
      notify('success', `Recorded "${choice}" vote for ${activeMember?.full_name}.`);
      if (onRefresh) onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    } finally {
      setSubmittingVote(null);
    }
  }

  async function handleCommitApproval(itineraryId) {
    try {
      setCommitting(itineraryId);
      await apiRequest(`/api/voting/itineraries/${itineraryId}/approve`, { method: 'POST' });
      notify('success', `Itinerary #${itineraryId} APPROVED! PostgreSQL deferred constraint trigger 'trg_enforce_itinerary_quorum' verified.`);
      if (onRefresh) onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    } finally {
      setCommitting(null);
    }
  }

  async function handleCreateProposal(itineraryId) {
    try {
      setCreatingProposal(true);
      await apiRequest('/api/voting/proposals', {
        method: 'POST',
        body: JSON.stringify({ trip_id: activeTripId, itinerary_id: itineraryId }),
      });
      notify('success', `Opened quorum voting proposal for Itinerary #${itineraryId}.`);
      if (onRefresh) onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message, err.pgDetail);
    } finally {
      setCreatingProposal(false);
    }
  }

  // Find any itinerary without an active proposal
  const unproposedItins = (itineraries || []).filter(
    (it) => !proposals.some((p) => p.itinerary_id === it.itinerary_id)
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-hairline rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-full font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              POSTGRESQL QUORUM ENGINE
            </span>
            <span className="text-xs font-mono bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full border border-slate-200">
              ACID Trigger Verified
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 mt-2">
            Group Consensus & Quorum Approvals
          </h2>
          <p className="text-xs text-neutral-500 max-w-2xl mt-1">
            Democratic majority governance. Itineraries require trip-policy consensus before confirmation, enforced by deferred trigger <code className="text-slate-800 font-mono bg-slate-100 px-1 py-0.5 rounded">trg_enforce_itinerary_quorum</code> at database commit time.
          </p>
        </div>

        {/* Demo Voter Selector */}
        {members.length > 0 && (
          <div className="bg-surface-soft border border-hairline rounded-xl p-3 shrink-0 flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div>
              <span className="text-[10px] font-mono uppercase font-bold text-neutral-400 block">
                ACTING VOTER (DEMO SIMULATOR)
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border shadow-xs ${getAvatarStyle(
                    activeMember.full_name
                  )}`}
                >
                  {getInitials(activeMember.full_name)}
                </div>
                <span className="text-xs font-bold text-slate-900">{activeMember.full_name}</span>
                <span className="text-[10px] text-neutral-400 font-mono">({activeMember.role || 'Member'})</span>
              </div>
            </div>

            <select
              aria-label="Acting Voter"
              className="text-xs bg-white hover:bg-slate-50 border border-hairline rounded-lg px-2.5 py-1.5 font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-black cursor-pointer transition-colors shadow-2xs"
              value={voterOverride || activeVoterId || ''}
              onChange={(e) => setVoterOverride(e.target.value)}
            >
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name} ({m.role})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Quorum Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-hairline rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium">
            <Users className="w-3.5 h-3.5 text-blue-600" />
            <span>QUORUM THRESHOLD</span>
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {tripDetail?.quorum_pct || 60}% YES Majority
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Requires ≥ {Math.ceil(((members.length || 3) * (tripDetail?.quorum_pct || 60)) / 100)} of {members.length || 3} member votes to pass
          </p>
        </div>

        <div className="bg-white border border-hairline rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium">
            <Vote className="w-3.5 h-3.5 text-emerald-600" />
            <span>ACTIVE PROPOSALS</span>
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {proposals.length} Under Review
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            {proposals.filter((p) => p.quorum_met).length} proposal(s) currently meet quorum
          </p>
        </div>

        <div className="bg-white border border-hairline rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
            <span>DATABASE CONSTRAINT</span>
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            ACID Deferred Check
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5 font-mono">
            trg_enforce_itinerary_quorum
          </p>
        </div>
      </div>

      {/* Proposals Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {proposals.map((prop) => {
          const totalMembers = prop.member_count || members.length || 1;
          const quorumPct = prop.quorum_pct || tripDetail?.quorum_pct || 60;
          const approveCount = prop.approve_count ?? prop.votes?.filter((v) => v.choice === 'APPROVE').length ?? 0;
          const rejectCount = prop.votes?.filter((v) => v.choice === 'REJECT').length ?? 0;
          const requiredVotes = prop.required_votes || Math.ceil((totalMembers * quorumPct) / 100);
          const approvalPct = Math.round((approveCount / totalMembers) * 100);
          const isQuorumMet = prop.quorum_met ?? (approveCount >= requiredVotes);
          const isPassed = prop.status === 'PASSED' || prop.itinerary_status === 'APPROVED';

          // Current active voter's choice
          const myVote = (prop.votes || []).find((v) => v.user_id === activeVoterId);

          return (
            <div
              key={prop.proposal_id}
              className="bg-white border border-hairline rounded-2xl p-6 shadow-xs space-y-5 flex flex-col justify-between"
            >
              <div className="space-y-4">
                {/* Proposal Header */}
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-hairline">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                        PROPOSAL #{prop.proposal_id}
                      </span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-surface-soft text-slate-700 border border-hairline">
                        Itinerary v{prop.itinerary_version}
                      </span>
                      {prop.raised_by_name && (
                        <span className="text-xs text-neutral-400">
                          by {prop.raised_by_name}
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-1.5">
                      {prop.itinerary_summary || 'Trip Itinerary Proposal'}
                    </h3>
                  </div>

                  {isPassed ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold font-mono px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> APPROVED
                    </span>
                  ) : isQuorumMet ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold font-mono px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Check className="w-3.5 h-3.5 text-emerald-600" /> QUORUM MET
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-bold font-mono px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      <Clock className="w-3.5 h-3.5 text-amber-600" /> VOTING OPEN
                    </span>
                  )}
                </div>

                {/* Quorum Progress Bar Banner */}
                <div className="bg-surface-soft border border-hairline rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-slate-900 text-sm">
                        {approveCount} of {totalMembers} Members Approved
                      </span>
                      <span className="text-neutral-500 ml-2">({approvalPct}%)</span>
                    </div>
                    <span className="font-mono text-xs text-neutral-500">
                      Target: {quorumPct}% (≥ {requiredVotes} approvals)
                    </span>
                  </div>

                  <div className="w-full bg-slate-200/80 h-2.5 rounded-full overflow-hidden relative">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        isQuorumMet ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, approvalPct))}%` }}
                    ></div>
                    {/* Quorum Threshold Marker Line */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-slate-900 z-10"
                      style={{ left: `${Math.min(99, quorumPct)}%` }}
                      title={`Quorum threshold: ${quorumPct}%`}
                    ></div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-neutral-500">
                    <span>
                      {isQuorumMet
                        ? '✓ Democratic quorum threshold satisfied'
                        : `Need ${Math.max(0, requiredVotes - approveCount)} more YES vote(s)`}
                    </span>
                    <span className="font-mono">
                      {rejectCount > 0 && <span className="text-rose-600 mr-2">{rejectCount} NO</span>}
                      {approveCount} YES
                    </span>
                  </div>
                </div>

                {/* Member Vote Status Roster */}
                <div className="space-y-2">
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-neutral-400 block">
                    Traveler Ballots ({members.length})
                  </span>

                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                    {members.map((member) => {
                      const vote = (prop.votes || []).find((v) => v.user_id === member.user_id);
                      const isVoter = member.user_id === activeVoterId;

                      return (
                        <div
                          key={member.user_id}
                          className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-colors ${
                            isVoter
                              ? 'bg-blue-50/50 border-blue-200'
                              : 'bg-surface-soft/60 border-hairline'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border shadow-xs ${getAvatarStyle(
                                member.full_name
                              )}`}
                            >
                              {getInitials(member.full_name)}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-slate-900">{member.full_name}</span>
                                {isVoter && (
                                  <span className="text-[10px] font-mono bg-blue-100 text-blue-700 px-1.5 rounded">
                                    You
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-neutral-400 block font-mono">
                                {member.role || 'Member'}
                              </span>
                            </div>
                          </div>

                          <div>
                            {vote?.choice === 'APPROVE' && (
                              <span className="inline-flex items-center gap-1 text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <Check className="w-3 h-3 text-emerald-600" /> YES
                              </span>
                            )}
                            {vote?.choice === 'REJECT' && (
                              <span className="inline-flex items-center gap-1 text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                                <X className="w-3 h-3 text-rose-600" /> NO
                              </span>
                            )}
                            {vote?.choice === 'ABSTAIN' && (
                              <span className="inline-flex items-center gap-1 text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                                <Minus className="w-3 h-3 text-slate-500" /> ABSTAIN
                              </span>
                            )}
                            {!vote && (
                              <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500 border border-neutral-200">
                                <Clock className="w-3 h-3 text-neutral-400" /> Pending
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Action Bar: Cast Vote & Commit Approval */}
              <div className="pt-4 border-t border-hairline space-y-3">
                {/* Cast Vote Buttons for Active Voter */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-500 text-[11px]">
                      Cast vote as <strong>{activeMember.full_name}</strong>:
                    </span>
                    {myVote && (
                      <span className="text-[11px] font-mono text-neutral-500">
                        Current: <strong>{myVote.choice}</strong>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleVote(prop.proposal_id, 'APPROVE')}
                      disabled={submittingVote === prop.proposal_id || isPassed}
                      className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-xs cursor-pointer ${
                        myVote?.choice === 'APPROVE'
                          ? 'bg-emerald-700 text-white ring-2 ring-emerald-400 ring-offset-1'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <Check className="w-3.5 h-3.5" /> Approve (YES)
                    </button>

                    <button
                      onClick={() => handleVote(prop.proposal_id, 'REJECT')}
                      disabled={submittingVote === prop.proposal_id || isPassed}
                      className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-xs cursor-pointer ${
                        myVote?.choice === 'REJECT'
                          ? 'bg-rose-700 text-white ring-2 ring-rose-400 ring-offset-1'
                          : 'bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <X className="w-3.5 h-3.5" /> Reject (NO)
                    </button>

                    <button
                      onClick={() => handleVote(prop.proposal_id, 'ABSTAIN')}
                      disabled={submittingVote === prop.proposal_id || isPassed}
                      className={`py-2 px-3 rounded-xl font-medium text-xs flex items-center justify-center gap-1 active:scale-95 transition-all shadow-2xs cursor-pointer ${
                        myVote?.choice === 'ABSTAIN'
                          ? 'bg-slate-700 text-white'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                      } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <Minus className="w-3 h-3" /> Abstain
                    </button>
                  </div>
                </div>

                {/* Final PostgreSQL Trigger Commit Button */}
                <div>
                  {isPassed ? (
                    <div className="w-full py-2.5 px-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>PostgreSQL Status: APPROVED (ACID committed)</span>
                    </div>
                  ) : isQuorumMet ? (
                    <button
                      onClick={() => handleCommitApproval(prop.itinerary_id)}
                      disabled={committing === prop.itinerary_id}
                      className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-xs flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      {committing === prop.itinerary_id
                        ? 'Executing PostgreSQL Deferred Trigger...'
                        : 'Commit Final Approval (PostgreSQL Trigger)'}
                    </button>
                  ) : (
                    <button
                      disabled
                      className="w-full py-2.5 px-4 rounded-xl bg-slate-100 border border-slate-200 text-slate-400 font-semibold text-xs flex items-center justify-center gap-2 cursor-not-allowed"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Quorum Required Before Commit ({approveCount}/{requiredVotes} votes)
                    </button>
                  )}
                  <p className="text-[10px] text-neutral-400 mt-1 text-center font-mono">
                    Enforced by deferred trigger trg_enforce_itinerary_quorum
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {/* Empty State */}
        {proposals.length === 0 && (
          <div className="lg:col-span-2 bg-white border border-dashed border-hairline rounded-2xl p-12 text-center space-y-4 shadow-xs">
            <div className="w-12 h-12 rounded-full bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center mx-auto">
              <Vote className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">No Open Proposals Yet</h3>
              <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1">
                Proposals allow travelers to vote on drafted itineraries with full PostgreSQL quorum verification.
              </p>
            </div>

            {unproposedItins.length > 0 ? (
              <div className="pt-2">
                <button
                  onClick={() => handleCreateProposal(unproposedItins[0].itinerary_id)}
                  disabled={creatingProposal}
                  className="btn-primary text-xs py-2 px-5 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {creatingProposal
                    ? 'Raising Proposal...'
                    : `Raise Proposal for Itinerary #${unproposedItins[0].itinerary_id} (v${unproposedItins[0].version})`}
                </button>
              </div>
            ) : (
              <div className="pt-1 text-xs text-neutral-400 font-mono">
                Head to Trip Workspace → Synthesize Plan to generate a draft itinerary.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
