import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Sparkles,
  Send,
  Users,
  UserPlus,
  Trash2,
  MapPin,
  Calendar,
  Ticket,
  CheckCircle2,
  Clock,
  ArrowRight,
  Vote,
  RefreshCw,
  Plus,
  Coins,
  Bot,
  Lock,
  Compass,
  Check,
  X,
  CreditCard,
  Radio,
} from 'lucide-react';
import { apiRequest } from '../api/client';
import { openRazorpayCheckout } from '../api/payment';
import LatexText from './LatexText';

export default function TripChatHub({
  activeTripId,
  setActiveTripId,
  trips,
  tripDetail,
  allUsers,
  itineraries,
  proposals,
  slots,
  finances,
  currentUser,
  onOpenAuth,
  onRefresh,
  notify,
}) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState('plan'); // 'plan' | 'tickets' | 'budget'
  const chatScrollRef = useRef(null);

  // Member management states
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('MEMBER');
  const [newMemberCity, setNewMemberCity] = useState('Bengaluru');
  const [newMemberBudget, setNewMemberBudget] = useState(25000);
  const [memberActionLoading, setMemberActionLoading] = useState(false);

  // Load chat messages when trip changes
  const loadMessages = async () => {
    if (!activeTripId) return;
    try {
      const data = await apiRequest(`/api/chat/trip/${activeTripId}`);
      setMessages(data || []);
      setTimeout(() => {
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
      }, 50);
    } catch (err) {
      console.error('Failed to load chat messages', err);
    }
  };

  useEffect(() => {
    loadMessages();
  }, [activeTripId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Send human message and receive active agent monitoring response
  const handleSendMessage = async (e, textOverride = null) => {
    if (e) e.preventDefault();
    const textToSend = (textOverride || inputText).trim();
    if (!textToSend || !activeTripId) return;

    if (!currentUser) {
      notify('error', 'Please sign in to send messages in the trip chat.');
      if (onOpenAuth) onOpenAuth();
      return;
    }

    setSending(true);
    setInputText('');
    try {
      const newMsg = await apiRequest(`/api/chat/trip/${activeTripId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          text: textToSend,
          sender_name: currentUser.full_name,
          sender_id: currentUser.user_id,
        }),
      });

      if (newMsg?.agent_message) {
        setMessages((prev) => [...prev, newMsg, newMsg.agent_message]);
      } else if (newMsg) {
        setMessages((prev) => [...prev, newMsg]);
      }
    } catch (err) {
      notify('error', `Failed to send: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  // Add Member to Trip
  const handleAddMember = async (e) => {
    if (e) e.preventDefault();
    if (!selectedUserId || !activeTripId) return;

    setMemberActionLoading(true);
    try {
      const selectedUser = (allUsers || []).find((u) => String(u.user_id) === String(selectedUserId));
      await apiRequest(`/api/trips/${activeTripId}/members`, {
        method: 'POST',
        body: JSON.stringify({
          user_id: Number(selectedUserId),
          role: newMemberRole,
          joining_city: newMemberCity,
          budget_ceiling: Number(newMemberBudget) || 25000,
        }),
      });

      // Announce member addition in chat
      const announceText = `Traveler Added: ${selectedUser?.full_name || 'New Member'} (${newMemberCity}) joined the trip. Quorum recalculated for ${memberCount + 1} travelers.`;
      try {
        await apiRequest(`/api/chat/trip/${activeTripId}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            text: announceText,
            sender_name: 'Yatra System',
            sender_id: 0,
          }),
        });
      } catch (_) {}

      notify('success', `Added ${selectedUser?.full_name || 'traveler'} to the trip.`);
      setAddMemberOpen(false);
      setSelectedUserId('');
      if (onRefresh) onRefresh(activeTripId);
      loadMessages();
    } catch (err) {
      notify('error', `Failed to add member: ${err.message}`);
    } finally {
      setMemberActionLoading(false);
    }
  };

  // Remove Member from Trip
  const handleRemoveMember = async (userId, memberName) => {
    if (!activeTripId) return;
    if (!confirm(`Are you sure you want to remove ${memberName} from this trip?`)) return;

    try {
      await apiRequest(`/api/trips/${activeTripId}/members/${userId}`, {
        method: 'DELETE',
      });

      // Announce member removal in chat
      const announceText = `Traveler Removed: ${memberName} was removed from the trip. Quorum recalculated for ${Math.max(1, memberCount - 1)} travelers.`;
      try {
        await apiRequest(`/api/chat/trip/${activeTripId}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            text: announceText,
            sender_name: 'Yatra System',
            sender_id: 0,
          }),
        });
      } catch (_) {}

      notify('success', `Removed ${memberName} from the trip.`);
      if (onRefresh) onRefresh(activeTripId);
      loadMessages();
    } catch (err) {
      notify('error', `Failed to remove member: ${err.message}`);
    }
  };

  // Trigger AI Copilot to analyze discussion & update plan
  const handleAnalyzeChat = async () => {
    if (!activeTripId) return;
    setAnalyzing(true);
    try {
      const result = await apiRequest(`/api/chat/trip/${activeTripId}/analyze`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      if (result.messages) {
        setMessages(result.messages);
      }
      notify('success', 'Yatra Copilot analyzed the discussion and generated the plan.');
      if (onRefresh) onRefresh(activeTripId);
    } catch (err) {
      notify('error', `AI Analysis failed: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };


  // Vote on active proposal
  const handleVote = async (proposalId, choice) => {
    if (!currentUser) {
      notify('error', 'Please sign in to vote on trip proposals.');
      if (onOpenAuth) onOpenAuth();
      return;
    }
    try {
      await apiRequest(`/api/voting/proposals/${proposalId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ choice, user_id: currentUser.user_id }),
      });
      notify('success', `Recorded "${choice}" vote.`);
      if (onRefresh) onRefresh(activeTripId);
    } catch (err) {
      notify('error', err.message);
    }
  };

  const handlePayItineraryWithRazorpay = () => {
    const payAmount = totalCost || 18400;
    openRazorpayCheckout({
      amountInr: payAmount,
      title: `${tripDetail?.title || 'Trip Package'} — Full Group Booking`,
      description: `All ${memberCount} travelers included · Quorum approved`,
      customerName: currentUser?.full_name || 'Arya Wadhwa',
      customerEmail: currentUser?.email || 'arya@yatra.local',
      onSuccess: (paymentDetails) => {
        notify('success', `Payment ₹${payAmount.toLocaleString()} confirmed (${paymentDetails.payment_id}). Booking complete!`);
        setMessages((prev) => [
          ...prev,
          {
            message_id: Date.now(),
            user_id: 0,
            sender_name: 'Yatra System',
            is_ai: true,
            text: `**Payment Captured via Razorpay Gateway**\n• Payment ID: \`${paymentDetails.payment_id}\`\n• Order ID: \`${paymentDetails.order_id}\`\n• Amount: ₹${payAmount.toLocaleString()}\n• Status: \`CONFIRMED\`\n• Group split settled. All member bookings confirmed!`,
            sent_at: new Date().toISOString(),
          },
        ]);
        if (onRefresh) onRefresh(activeTripId);
      },
      onFailure: (err) => {
        notify('error', `Razorpay payment declined (${err.description || 'Decline'}). Reservation hold released.`);
      },
    });
  };

  const handleBuySlotWithRazorpay = (slot) => {
    const amount = Number(slot.price_inr || 750);
    openRazorpayCheckout({
      amountInr: amount,
      title: `${slot.poi_name} — Timed Entry`,
      description: slot.circuit,
      customerName: currentUser?.full_name || 'Arya Wadhwa',
      customerEmail: currentUser?.email || 'arya@yatra.local',
      onSuccess: async (paymentDetails) => {
        try {
          await apiRequest('/api/inventory/holds', {
            method: 'POST',
            body: JSON.stringify({ slot_id: slot.slot_id, seats: 1 }),
          });
        } catch (_) {}
        notify('success', `Ticket booked for ₹${amount.toLocaleString()} (${paymentDetails.payment_id}). Reservation confirmed!`);
        if (onRefresh) onRefresh();
      },
      onFailure: (err) => {
        notify('error', `Payment declined (${err.description || 'Decline'}). Reservation released.`);
      },
    });
  };

  // Current primary itinerary
  const primaryItin = itineraries?.[0] || null;
  const legs = primaryItin?.legs || [];
  const totalCost = legs.reduce((acc, l) => acc + Number(l.est_cost_inr || 0), 0);
  const memberCount = tripDetail?.members?.length || 1;
  const costPerPerson = Math.round(totalCost / memberCount);
  const primaryProposal = proposals?.[0] || null;

  // Quorum & voting calculations
  const quorumRequiredPct = tripDetail?.quorum_pct || primaryProposal?.quorum_pct || 60;
  const currentApprovals = primaryProposal?.approve_count ?? primaryProposal?.yes_count ?? 0;
  const totalVoters = primaryProposal?.member_count ?? primaryProposal?.total_voters ?? memberCount ?? 1;
  const currentApprovalPct = primaryProposal?.approval_pct ?? Math.round((currentApprovals / (totalVoters || 1)) * 100);
  const isQuorumMet = Boolean(primaryProposal?.quorum_met ?? (currentApprovals >= (primaryProposal?.required_votes ?? Math.ceil((totalVoters * quorumRequiredPct) / 100))));

  return (
    <div className="space-y-6">
      {/* Trip Header Banner */}
      <div className="bg-white border border-hairline rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill text-xs font-semibold uppercase tracking-wider bg-block-lime text-black border border-black/10">
                <Compass className="w-3.5 h-3.5" /> Group Trip
              </span>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-pill bg-surface-soft border border-hairline text-black/70">
                {tripDetail?.status || 'Active'}
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-black">
              {tripDetail?.title || 'Trip Discussion'}
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-xs text-black/60 pt-0.5">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-black/40" />{' '}
                {tripDetail?.travel_window
                  ? String(tripDetail.travel_window).replace(/[[\]()"]/g, '').split(',').join(' to ')
                  : 'Dec 18 - 20, 2026'}
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-black/40" /> {memberCount} Travelers
              </span>
              <span className="flex items-center gap-1.5">
                <Vote className="w-3.5 h-3.5 text-black/40" /> Quorum: {tripDetail?.quorum_pct || 60}%
              </span>
            </div>
          </div>
        </div>

        {/* Interactive Member Roster & Management */}
        <div className="pt-4 mt-4 border-t border-hairline space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="caption-mono text-black/60">
                TRAVELERS & QUORUM PARTICIPANTS ({tripDetail?.members?.length || memberCount})
              </span>
              <span className="text-xs text-black/30">·</span>
              <span className="text-xs text-black/60">
                Quorum: {Math.ceil(((tripDetail?.members?.length || memberCount) * quorumRequiredPct) / 100)} of {tripDetail?.members?.length || memberCount} required ({quorumRequiredPct}%)
              </span>
            </div>
            <button
              onClick={() => setAddMemberOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill text-xs font-semibold bg-sky-50 text-sky-900 hover:bg-sky-100 border border-sky-300 transition-colors shadow-2xs self-start sm:self-auto cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5 text-sky-700" />
              <span>Add Traveler</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(tripDetail?.members || []).map((m) => (
              <div
                key={m.user_id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-pill text-xs bg-surface-soft text-black border border-hairline font-medium hover:border-black/30 transition-all group"
              >
                <div className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold">
                  {m.full_name?.charAt(0) || 'U'}
                </div>
                <span>{m.full_name}</span>
                <span className="text-[10px] text-black/50 font-mono">
                  {m.joining_city ? `${m.joining_city} · ` : ''}₹{Number(m.budget_ceiling || 25000).toLocaleString()}
                </span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-xs bg-white text-black/70 border border-hairline">
                  {m.role?.toLowerCase()}
                </span>
                {m.role !== 'ORGANIZER' && (
                  <button
                    onClick={() => handleRemoveMember(m.user_id, m.full_name)}
                    title={`Remove ${m.full_name} from trip`}
                    className="w-4 h-4 rounded-full hover:bg-rose-100 hover:text-rose-700 text-black/30 flex items-center justify-center transition-colors ml-0.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Dual-Column Hub: Chat on Left (60%), Live Plan Snapshot on Right (40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Group Discussion Chat with AI Copilot (Editorial Frame) */}
        <div className="lg:col-span-7 bg-white border border-hairline rounded-2xl flex flex-col shadow-xs h-[740px] overflow-hidden">
          {/* Chat Header with Active Agent Monitor Indicator */}
          <div className="p-4 border-b border-hairline bg-surface-soft/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-block-lilac/60 border border-block-lilac text-black flex items-center justify-center font-bold shrink-0">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-black">Trip Group Chat</h2>
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-pill bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-mono font-medium">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-600"></span>
                    </span>
                    <span>AGENT MONITOR ACTIVE</span>
                  </div>
                </div>
                <p className="text-xs text-black/60">Collaborate with travelers · Copilot monitors discussion</p>
              </div>
            </div>

            <button
              onClick={handleAnalyzeChat}
              disabled={analyzing}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-pill text-xs font-semibold bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-300/80 active:scale-95 transition-all shadow-xs disabled:opacity-40 self-start sm:self-auto cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              <span>{analyzing ? 'Synthesizing...' : 'Synthesize Consensus'}</span>
            </button>
          </div>


          {/* Chat Message Stream (Soft surface-soft: #f7f7f5 from design system) */}
          <div ref={chatScrollRef} className="flex-1 p-4 overflow-y-auto space-y-3.5 bg-surface-soft">
            {messages.map((msg, index) => {
              const isAi = msg.is_agent;
              const isMe = currentUser && msg.sender_id === currentUser.user_id;

              if (isAi) {
                return (
                  <div
                    key={msg.id || index}
                    className="my-3 p-4 rounded-2xl bg-block-lilac/30 border border-block-lilac/70 shadow-2xs space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-purple-100 border border-purple-200 text-purple-700 flex items-center justify-center">
                          <Bot className="w-3.5 h-3.5 text-purple-700" />
                        </div>
                        <span className="text-xs font-bold text-black">Yatra Copilot</span>
                        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-pill bg-white text-black/80 font-medium border border-hairline">
                          AI Agent
                        </span>
                      </div>
                      <span className="text-[10px] text-black/40">
                        {msg.created_at
                          ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : ''}
                      </span>
                    </div>

                    {/* Formatted Text with LaTeX equations */}
                    <LatexText text={msg.text} />

                    {msg.plan_summary && (
                      <div className="bg-white rounded-xl p-3.5 border border-hairline shadow-2xs space-y-2 mt-2">
                        <div className="flex items-center justify-between text-xs border-b border-hairline pb-2">
                          <span className="font-semibold text-black flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-accent-magenta" />
                            {msg.plan_summary.destination} Itinerary (v{msg.plan_summary.version})
                          </span>
                          <span className="font-mono text-semantic-success font-bold">
                            ₹{Number(msg.plan_summary.per_person_est).toLocaleString()} / person
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] text-black/70">
                          <div>
                            <span className="text-black/40">Total Group Cost:</span> ₹{Number(msg.plan_summary.total_cost).toLocaleString()}
                          </div>
                          <div>
                            <span className="text-black/40">Scheduled Legs:</span> {msg.plan_summary.leg_count} activities
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              const getSenderMeta = (name) => {
                const n = (name || '').toLowerCase();
                if (n.includes('dilraj')) return { initials: 'DS', bg: 'bg-purple-100 text-purple-800 border-purple-200' };
                if (n.includes('arya')) return { initials: 'AW', bg: 'bg-sky-100 text-sky-800 border-sky-200' };
                if (n.includes('aarush')) return { initials: 'AL', bg: 'bg-amber-100 text-amber-800 border-amber-200' };
                return { initials: (name || 'U').slice(0, 2).toUpperCase(), bg: 'bg-slate-100 text-slate-800 border-slate-200' };
              };
              const sender = getSenderMeta(msg.sender_name);

              return (
                <div key={msg.id || index} className={`flex gap-2.5 ${isMe ? 'flex-row-reverse' : 'flex-row'} items-start`}>
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border shrink-0 mt-0.5 shadow-2xs ${sender.bg}`}
                    title={msg.sender_name}
                  >
                    {sender.initials}
                  </div>
                  <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[80%]`}>
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <span className="text-[11px] font-semibold text-black/75">{msg.sender_name}</span>
                      <span className="text-[10px] text-black/40">
                        {msg.created_at
                          ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : ''}
                      </span>
                    </div>
                    <div
                      className={`rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-2xs transition-all ${
                        isMe
                          ? 'bg-slate-900 text-white rounded-tr-xs font-normal shadow-xs'
                          : 'bg-white border border-hairline text-slate-900 rounded-tl-xs'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Discussion Prompt Chips for Active Monitoring */}
          {currentUser && (
            <div className="px-3 pt-2 pb-1.5 bg-white border-t border-hairline/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-[11px]">
              <span className="caption-mono text-[10px] text-black/40 font-bold shrink-0 mr-1">DISCUSS:</span>
              {[
                { label: 'Check Budget Target', prompt: "What is our per-person budget target, and are we within limits?" },
                { label: 'Suggest Best Dates', prompt: "Suggest optimal dates and flight timings for our trip." },
                { label: 'Check Heritage Tickets', prompt: "Check ASI heritage monument entry tickets and slot availability." },
                { label: 'Quorum Split Math', prompt: "@copilot compute the fair double-entry split and quorum consensus." },
                { label: 'Reserve Sunset Batch', prompt: "Let's secure the Virupaksha sunset timed batch for all travelers." },
              ].map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleSendMessage(null, chip.prompt)}
                  className="whitespace-nowrap px-3 py-1 rounded-pill bg-surface-soft hover:bg-hairline hover:text-black border border-hairline text-black/70 text-xs transition-colors cursor-pointer shrink-0 font-medium"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          {/* Chat Input Bar or Authentication Lock */}
          {currentUser ? (
            <form onSubmit={handleSendMessage} className="p-3 border-t border-hairline bg-white flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ask a question, propose places, or discuss budget (Copilot is monitoring)..."
                className="flex-1 bg-surface-soft border border-hairline rounded-pill px-4 py-2.5 text-xs text-black focus:outline-none focus:ring-1 focus:ring-black transition-all"
              />
              <button
                type="submit"
                disabled={sending || !inputText.trim()}
                className="w-9 h-9 rounded-full bg-slate-900 hover:bg-black text-white flex items-center justify-center shrink-0 disabled:opacity-40 active:scale-95 transition-all shadow-xs cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <div className="p-4 border-t border-hairline bg-white flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-sky-50 border border-sky-200 text-sky-700 flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-black block">Sign in required to chat</span>
                  <span className="text-[11px] text-black/50">Log in to collaborate on destination ideas and budget targets</span>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenAuth}
                className="inline-flex items-center justify-center gap-1.5 bg-sky-100 hover:bg-sky-200 text-sky-900 border border-sky-300 font-semibold rounded-pill text-xs py-2 px-5 whitespace-nowrap active:scale-95 transition-all shadow-xs"
              >
                Sign in to Chat
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Live Plan & Budget Snapshot (Reacts to Chat) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Segmented View Switcher */}
          <div className="bg-surface-soft border border-hairline rounded-2xl p-1.5 flex gap-1 shadow-2xs">
            <button
              onClick={() => setActiveTab('plan')}
              className={`flex-1 py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all duration-200 ease-out active:scale-95 ${
                activeTab === 'plan' ? 'bg-white text-black font-semibold shadow-xs border border-hairline scale-[1.01]' : 'text-black/60 hover:text-black hover:bg-white/40 border border-transparent'
              }`}
            >
              <Calendar className={`w-3.5 h-3.5 transition-colors duration-200 ${activeTab === 'plan' ? 'text-blue-600' : 'text-black/40'}`} /> Plan & Schedule
            </button>
            <button
              onClick={() => setActiveTab('tickets')}
              className={`flex-1 py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all duration-200 ease-out active:scale-95 ${
                activeTab === 'tickets' ? 'bg-white text-black font-semibold shadow-xs border border-hairline scale-[1.01]' : 'text-black/60 hover:text-black hover:bg-white/40 border border-transparent'
              }`}
            >
              <Ticket className={`w-3.5 h-3.5 transition-colors duration-200 ${activeTab === 'tickets' ? 'text-amber-600' : 'text-black/40'}`} /> Tickets
            </button>
            <button
              onClick={() => setActiveTab('budget')}
              className={`flex-1 py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all duration-200 ease-out active:scale-95 ${
                activeTab === 'budget' ? 'bg-white text-black font-semibold shadow-xs border border-hairline scale-[1.01]' : 'text-black/60 hover:text-black hover:bg-white/40 border border-transparent'
              }`}
            >
              <Coins className={`w-3.5 h-3.5 transition-colors duration-200 ${activeTab === 'budget' ? 'text-emerald-600' : 'text-black/40'}`} /> Budget & Split
            </button>
          </div>

          <div key={activeTab} className="animate-tab-shift">
            {/* TAB 1: Plan & Schedule */}
          {activeTab === 'plan' && (
            <div className="bg-white border border-hairline rounded-2xl p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-hairline">
                <div>
                  <h3 className="text-sm font-bold text-black">Generated Itinerary</h3>
                  <p className="text-xs text-black/50">
                    {primaryItin ? `Version #${primaryItin.version} (${primaryItin.status})` : 'No plan drafted yet'}
                  </p>
                </div>
                {primaryProposal && (
                  <span className="text-xs px-2.5 py-1 rounded-pill font-mono bg-block-cream font-medium text-black border border-black/10">
                    Quorum: {primaryProposal.approval_pct}%
                  </span>
                )}
              </div>

              {/* Total Cost Highlight Card */}
              <div className="p-4 rounded-xl bg-surface-soft border border-hairline flex items-center justify-between">
                <div>
                  <span className="caption-mono block text-black/50">ESTIMATED PER-PERSON</span>
                  <span className="text-2xl font-bold font-mono text-black">₹{costPerPerson.toLocaleString()}</span>
                </div>
                <div className="text-right">
                  <span className="caption-mono block text-black/50">TOTAL GROUP COST</span>
                  <span className="text-sm font-bold font-mono text-black/70">₹{totalCost.toLocaleString()}</span>
                </div>
              </div>

              {/* Legs Timeline */}
              <div className="space-y-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-black/40 block">
                  Scheduled Places & Legs ({legs.length})
                </span>

                {legs.length === 0 ? (
                  <div className="text-center py-8 text-xs text-black/40 border border-dashed border-hairline rounded-xl">
                    No scheduled legs yet. Click <strong>Synthesize Plan</strong> in the chat to auto-generate!
                  </div>
                ) : (
                  legs.map((leg) => (
                    <div key={leg.leg_id} className="rounded-xl bg-surface-soft p-3 border border-hairline space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-pill bg-white text-black/70 border border-hairline font-semibold">
                            {leg.kind}
                          </span>
                          <h4 className="text-xs font-bold text-black pt-1">{leg.title}</h4>
                        </div>
                        <span className="font-mono text-xs font-semibold text-black">
                          ₹{Number(leg.est_cost_inr).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-black/50 pt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-black/40" />
                          {leg.span_start
                            ? new Date(leg.span_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : ''}{' '}
                          –{' '}
                          {leg.span_end
                            ? new Date(leg.span_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3 text-black/40" /> {leg.participants?.length || memberCount} Travelers
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Quorum Approval Call-to-Action */}
              {primaryProposal && (
                <div className="pt-3 border-t border-hairline space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-black">Group Approval Progress</span>
                    <span className="font-mono font-bold text-black">
                      {currentApprovals} of {totalVoters} votes ({currentApprovalPct}%) · {quorumRequiredPct}% required
                    </span>
                  </div>
                  <div className="w-full bg-surface-soft h-2 rounded-full overflow-hidden border border-hairline">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        isQuorumMet ? 'bg-semantic-success' : 'bg-amber-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, currentApprovalPct))}%` }}
                    ></div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleVote(primaryProposal.proposal_id, 'APPROVE')}
                      className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-xs"
                    >
                      <Check className="w-3.5 h-3.5" /> Approve Proposal
                    </button>
                    <button
                      onClick={() => handleVote(primaryProposal.proposal_id, 'REJECT')}
                      className="py-2 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-semibold text-xs active:scale-95 transition-all flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                  <button
                    onClick={handlePayItineraryWithRazorpay}
                    className="w-full mt-2.5 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-sm cursor-pointer"
                  >
                    <CreditCard className="w-3.5 h-3.5" /> Pay Package with Razorpay (₹{(totalCost || 18400).toLocaleString()})
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Tickets & Capacity */}
          {activeTab === 'tickets' && (
            <div className="bg-white border border-hairline rounded-2xl p-5 space-y-4 shadow-xs">
              <div>
                <h3 className="text-sm font-bold text-black">Verified Heritage Tickets</h3>
                <p className="text-xs text-black/50">Regulated capacity tickets from official site operators</p>
              </div>

              <div className="space-y-2.5 max-h-[560px] overflow-y-auto pr-1">
                {(slots || []).map((slot) => {
                  const seatsLeft = slot.seats_remaining ?? slot.capacity_total - slot.seats_taken;
                  const isLow = seatsLeft <= 5;
                  return (
                    <div key={slot.slot_id} className="rounded-xl bg-surface-soft p-3.5 border border-hairline space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] font-mono uppercase text-black/50 block">{slot.city}</span>
                          <h4 className="text-xs font-bold text-black">{slot.poi_name}</h4>
                          <p className="text-[11px] text-black/70">{slot.circuit}</p>
                        </div>
                        <div className="text-right">
                          <span className="font-mono text-sm font-bold text-black">
                            ₹{Number(slot.price_inr).toLocaleString()}
                          </span>
                          <span className="text-[10px] text-black/40 block">per ticket</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1 border-t border-hairline">
                        <span
                          className={`inline-flex items-center gap-1 font-mono text-[11px] ${
                            isLow ? 'text-rose-600 font-bold' : 'text-semantic-success font-medium'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${isLow ? 'bg-rose-500 animate-ping' : 'bg-semantic-success'}`}
                          ></span>
                          {seatsLeft} / {slot.capacity_total} seats remaining
                        </span>
                        <span className="text-[10px] text-black/40">
                          {slot.window_start
                            ? new Date(slot.window_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : ''}
                        </span>
                      </div>
                      <button
                        onClick={() => handleBuySlotWithRazorpay(slot)}
                        className="w-full mt-2 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer active:scale-95"
                      >
                        <CreditCard className="w-3.5 h-3.5" /> Buy Ticket with Razorpay (₹{Number(slot.price_inr).toLocaleString()})
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: Budget & Split */}
          {activeTab === 'budget' && (
            <div className="bg-white border border-hairline rounded-2xl p-5 space-y-4 shadow-xs">
              <div>
                <h3 className="text-sm font-bold text-black">Group Budget & Fair Splitting</h3>
                <p className="text-xs text-black/50">Fair double-entry balance and settlement ledger</p>
              </div>

              {/* Member Ceiling comparison */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-black/40 block">
                  Member Budget Ceilings
                </span>
                {(tripDetail?.members || []).map((m) => (
                  <div key={m.user_id} className="rounded-xl bg-surface-soft p-3 border border-hairline flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-black block">{m.full_name}</span>
                      <span className="text-[11px] text-black/50">Joining from {m.joining_city}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-xs font-bold text-black">
                        ₹{Number(m.budget_ceiling).toLocaleString()}
                      </span>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-pill inline-block mt-0.5 border ${
                          costPerPerson <= m.budget_ceiling
                            ? 'bg-block-mint text-emerald-950 border-emerald-300'
                            : 'bg-block-pink text-rose-950 border-rose-300'
                        }`}
                      >
                        {costPerPerson <= m.budget_ceiling ? 'Within Ceiling' : 'Exceeds Ceiling'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Settlements & Balances */}
              {finances?.settlements?.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-hairline">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-black/40 block">
                    Settlements (Who Owes Whom)
                  </span>
                  {finances.settlements.map((s, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl bg-block-cream/60 border border-block-cream p-2.5 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-1.5 text-black">
                        <span className="font-semibold">{s.from_name}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-black/40" />
                        <span className="font-semibold">{s.to_name}</span>
                      </div>
                      <span className="font-mono font-bold text-black">₹{Number(s.amount_inr).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Add Traveler to Trip Modal */}
      {addMemberOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-hairline shadow-2xl p-6 relative">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-hairline">
              <div>
                <span className="eyebrow-mono text-black/50 block">TRIP ROSTER MANAGEMENT</span>
                <h3 className="text-base font-bold text-black tracking-tight mt-0.5">
                  Add Traveler to Trip
                </h3>
              </div>
              <button
                onClick={() => setAddMemberOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-soft hover:bg-hairline flex items-center justify-center text-black/60 hover:text-black transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddMember} className="space-y-4">
              <div>
                <label className="caption-mono block mb-1">Select Registered Traveler</label>
                <select
                  required
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="field-input text-xs"
                >
                  <option value="">-- Choose a registered user --</option>
                  {(allUsers || [])
                    .filter((u) => !(tripDetail?.members || []).some((m) => m.user_id === u.user_id))
                    .map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.full_name} ({u.email}) · {u.home_city || 'India'}
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-black/40 mt-1">
                  Only travelers not currently in this trip are shown.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="caption-mono block mb-1">Departure / Joining City</label>
                  <input
                    type="text"
                    required
                    value={newMemberCity}
                    onChange={(e) => setNewMemberCity(e.target.value)}
                    placeholder="e.g. Bengaluru"
                    className="field-input text-xs"
                  />
                </div>
                <div>
                  <label className="caption-mono block mb-1">Budget Ceiling (INR)</label>
                  <input
                    type="number"
                    required
                    min="1000"
                    step="500"
                    value={newMemberBudget}
                    onChange={(e) => setNewMemberBudget(Number(e.target.value))}
                    className="field-input text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="caption-mono block mb-1">Role in Group</label>
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value)}
                  className="field-input text-xs"
                >
                  <option value="MEMBER">Member (Voting & Split Participant)</option>
                  <option value="ORGANIZER">Co-Organizer</option>
                </select>
              </div>

              <div className="flex gap-2 pt-2 border-t border-hairline">
                <button
                  type="button"
                  onClick={() => setAddMemberOpen(false)}
                  className="btn-secondary flex-1 text-xs py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={memberActionLoading || !selectedUserId}
                  className="btn-primary flex-1 text-xs py-2 font-semibold"
                >
                  {memberActionLoading ? 'Adding...' : 'Add Traveler'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
