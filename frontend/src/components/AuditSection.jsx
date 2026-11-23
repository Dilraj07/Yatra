import React, { useState } from 'react';
import { Database, FileJson, Bot, Layers, ShieldCheck, Activity, Search, RefreshCw } from 'lucide-react';

export default function AuditSection({ auditRows = [], nosqlDocs = {} }) {
  const [subTab, setSubTab] = useState('pg');
  const [filterText, setFilterText] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);

  const filteredAuditRows = auditRows.filter((r) => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    return (
      (r.table_name || '').toLowerCase().includes(q) ||
      (r.operation || '').toLowerCase().includes(q) ||
      (r.partition_name || '').toLowerCase().includes(q) ||
      String(r.row_pk || '').toLowerCase().includes(q)
    );
  });

  const getOpBadge = (op) => {
    switch (op) {
      case 'INSERT':
        return 'bg-emerald-50 text-emerald-800 border-emerald-300';
      case 'UPDATE':
        return 'bg-amber-50 text-amber-800 border-amber-300';
      case 'DELETE':
        return 'bg-rose-50 text-rose-800 border-rose-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-hairline rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="eyebrow-mono text-black/60">SYSTEM OBSERVABILITY</span>
          <h2 className="display-lg mt-1 text-black">System Activity & Event Logs</h2>
          <p className="text-xs text-neutral-500 max-w-2xl mt-1">
            Real-time audit log tracking system events, booking state transitions, and partner integrations.
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-hairline rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium">
            <Database className="w-3.5 h-3.5 text-blue-600" />
            <span>TRANSACTION AUDIT LOGS</span>
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            Active Event Log
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Partitioned event stream by timestamp
          </p>
        </div>

        <div className="bg-white border border-hairline rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium">
            <Activity className="w-3.5 h-3.5 text-emerald-600" />
            <span>RECORDED EVENTS</span>
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {auditRows.length} Logged Events
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Automated before/after state captures
          </p>
        </div>

        <div className="bg-white border border-hairline rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-2 text-neutral-400 text-xs font-medium">
            <FileJson className="w-3.5 h-3.5 text-purple-600" />
            <span>PARTNER INTEGRATION LOGS</span>
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1">
            {nosqlDocs?.supplier_snapshots?.length || 0} External Snapshots
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Partner booking & external event logs
          </p>
        </div>
      </div>

      {/* Sub-Tabs View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="bg-surface-soft border border-hairline rounded-2xl p-1.5 flex gap-1 shadow-2xs">
          <button
            onClick={() => setSubTab('pg')}
            className={`py-2 px-4 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all ${
              subTab === 'pg'
                ? 'bg-white text-slate-900 shadow-xs border border-hairline font-bold'
                : 'text-neutral-500 hover:text-slate-900'
            }`}
          >
            <Database className="w-3.5 h-3.5 text-blue-600" /> Transaction Audit ({auditRows.length})
          </button>
          <button
            onClick={() => setSubTab('snapshots')}
            className={`py-2 px-4 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all ${
              subTab === 'snapshots'
                ? 'bg-white text-slate-900 shadow-xs border border-hairline font-bold'
                : 'text-neutral-500 hover:text-slate-900'
            }`}
          >
            <FileJson className="w-3.5 h-3.5 text-purple-600" /> Partner API Logs ({nosqlDocs?.supplier_snapshots?.length || 0})
          </button>
          <button
            onClick={() => setSubTab('llm')}
            className={`py-2 px-4 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all ${
              subTab === 'llm'
                ? 'bg-white text-slate-900 shadow-xs border border-hairline font-bold'
                : 'text-neutral-500 hover:text-slate-900'
            }`}
          >
            <Bot className="w-3.5 h-3.5 text-emerald-600" /> AI Assistant Activity ({nosqlDocs?.llm_conversations?.length || 0})
          </button>
        </div>

        {subTab === 'pg' && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Filter by table, op, or PK..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="bg-white border border-hairline rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-black w-64 shadow-2xs"
            />
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="bg-white border border-hairline rounded-2xl p-6 shadow-xs">
        {/* TAB 1: PostgreSQL Partitioned Audit Table */}
        {subTab === 'pg' && (
          <div className="overflow-x-auto space-y-3">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-hairline text-neutral-400 text-[11px] font-bold">
                  <th className="py-2.5 pr-4">PARTITION TABLE</th>
                  <th className="py-2.5 pr-4">TARGET TABLE</th>
                  <th className="py-2.5 pr-4">OPERATION</th>
                  <th className="py-2.5 pr-4">ROW PK</th>
                  <th className="py-2.5 pr-4">TIMESTAMP</th>
                  <th className="py-2.5">MUTATION IMAGE (STATE SNAPSHOT)</th>
                </tr>
              </thead>
              <tbody>
                {filteredAuditRows.map((r, idx) => (
                  <tr
                    key={`${r.audit_id || idx}-${r.changed_at}`}
                    className="border-b border-hairline/60 hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-2.5 pr-4 font-semibold text-slate-800">{r.partition_name}</td>
                    <td className="py-2.5 pr-4 font-bold text-slate-900">{r.table_name}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`px-2 py-0.5 rounded font-bold border text-[10px] ${getOpBadge(r.operation)}`}>
                        {r.operation}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-700">#{r.row_pk}</td>
                    <td className="py-2.5 pr-4 text-neutral-400 text-[11px]">
                      {r.changed_at ? new Date(r.changed_at).toLocaleTimeString() : 'Recent'}
                    </td>
                    <td className="py-2.5 max-w-md">
                      <div className="bg-surface-soft px-2.5 py-1 rounded border border-hairline/70 text-[11px] text-slate-700 truncate font-mono">
                        {JSON.stringify(r.after_img || r.before_img)}
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredAuditRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-xs text-neutral-400">
                      No audit rows matching filter. Execute an action to record mutations.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: Supplier Snapshots */}
        {subTab === 'snapshots' && (
          <div className="space-y-4">
            <div className="text-xs text-neutral-500">
              Event logs from external travel partners (payments, airlines, hotels) captured during bookings.
            </div>
            <div className="space-y-3 font-mono text-xs">
              {(nosqlDocs?.supplier_snapshots || []).map((d) => (
                <div key={d._id} className="p-4 bg-surface-soft rounded-xl border border-hairline space-y-2">
                  <div className="flex items-center justify-between text-xs font-sans pb-1 border-b border-hairline">
                    <span className="font-bold text-slate-900">{d.provider?.toUpperCase()} · {d.action}</span>
                    <span className="text-[11px] text-neutral-400 font-mono">{d.captured_at}</span>
                  </div>
                  <pre className="overflow-x-auto text-[11px] text-slate-800 leading-relaxed">
                    {JSON.stringify(d, null, 2)}
                  </pre>
                </div>
              ))}
              {(!nosqlDocs?.supplier_snapshots || nosqlDocs.supplier_snapshots.length === 0) && (
                <div className="p-8 text-center text-xs text-neutral-400 border border-dashed border-hairline rounded-xl">
                  Run a Booking Saga in the Saga tab to populate supplier snapshots.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: LLM Traces */}
        {subTab === 'llm' && (
          <div className="space-y-4">
            <div className="text-xs text-neutral-500">
              Captured conversation context, extracted trip intents, and itinerary planning steps.
            </div>
            <div className="space-y-3 font-mono text-xs">
              {(nosqlDocs?.llm_conversations || []).map((d) => (
                <div key={d._id} className="p-4 bg-surface-soft rounded-xl border border-hairline space-y-2">
                  <div className="flex items-center justify-between text-xs font-sans pb-1 border-b border-hairline">
                    <span className="font-bold text-slate-900">ENGINE: {d.engine}</span>
                    <span className="text-[11px] text-neutral-400 font-mono">{d.captured_at}</span>
                  </div>
                  <pre className="overflow-x-auto text-[11px] text-slate-800 leading-relaxed">
                    {JSON.stringify(d, null, 2)}
                  </pre>
                </div>
              ))}
              {(!nosqlDocs?.llm_conversations || nosqlDocs.llm_conversations.length === 0) && (
                <div className="p-8 text-center text-xs text-neutral-400 border border-dashed border-hairline rounded-xl">
                  Click "Synthesize Plan" in Trip Workspace to populate LLM reasoning traces.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
