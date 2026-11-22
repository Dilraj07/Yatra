import React, { useState } from 'react';
import { Database, FileJson } from 'lucide-react';

export default function AuditSection({ auditRows, nosqlDocs }) {
  const [subTab, setSubTab] = useState('pg');

  return (
    <div className="color-block bg-block-pink space-y-6">
      <div>
        <span className="eyebrow-mono">STEP 7 · PARTITIONED AUDIT LOG & MONGODB</span>
        <h2 className="display-lg mt-1">Inspect relational triggers and NoSQL snapshots.</h2>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setSubTab('pg')} className={subTab === 'pg' ? 'btn-primary text-xs py-2 px-4' : 'btn-secondary text-xs py-2 px-4'}>
          <Database className="w-3.5 h-3.5" /> PostgreSQL Audit ({auditRows.length})
        </button>
        <button onClick={() => setSubTab('snapshots')} className={subTab === 'snapshots' ? 'btn-primary text-xs py-2 px-4' : 'btn-secondary text-xs py-2 px-4'}>
          <FileJson className="w-3.5 h-3.5" /> Supplier Snapshots ({nosqlDocs?.supplier_snapshots?.length || 0})
        </button>
        <button onClick={() => setSubTab('llm')} className={subTab === 'llm' ? 'btn-primary text-xs py-2 px-4' : 'btn-secondary text-xs py-2 px-4'}>
          <FileJson className="w-3.5 h-3.5" /> LLM Traces ({nosqlDocs?.llm_conversations?.length || 0})
        </button>
      </div>

      <div className="editorial-card overflow-x-auto">
        {subTab === 'pg' && (
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-hairline">
                <th className="py-2 pr-4">PARTITION</th>
                <th className="py-2 pr-4">TABLE</th>
                <th className="py-2 pr-4">OP</th>
                <th className="py-2 pr-4">PK</th>
                <th className="py-2">IMAGE</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.slice(0, 12).map((r) => (
                <tr key={`${r.audit_id}-${r.changed_at}`} className="border-b border-hairline-soft">
                  <td className="py-2 pr-4">{r.partition_name}</td>
                  <td className="py-2 pr-4">{r.table_name}</td>
                  <td className="py-2 pr-4 font-bold">{r.operation}</td>
                  <td className="py-2 pr-4">#{r.row_pk}</td>
                  <td className="py-2 max-w-md truncate">{JSON.stringify(r.after_img || r.before_img)}</td>
                </tr>
              ))}
              {auditRows.length === 0 && <tr><td colSpan={5} className="py-3">No audit entries yet.</td></tr>}
            </tbody>
          </table>
        )}
        {subTab === 'snapshots' && (
          <div className="space-y-3 font-mono text-xs">
            {(nosqlDocs?.supplier_snapshots || []).map((d) => <pre key={d._id} className="p-3 bg-surface-soft rounded-md overflow-x-auto">{JSON.stringify(d, null, 2)}</pre>)}
            {(!nosqlDocs?.supplier_snapshots || nosqlDocs.supplier_snapshots.length === 0) && <p>Run a Booking Saga to populate snapshots.</p>}
          </div>
        )}
        {subTab === 'llm' && (
          <div className="space-y-3 font-mono text-xs">
            {(nosqlDocs?.llm_conversations || []).map((d) => <pre key={d._id} className="p-3 bg-surface-soft rounded-md overflow-x-auto">{JSON.stringify(d, null, 2)}</pre>)}
            {(!nosqlDocs?.llm_conversations || nosqlDocs.llm_conversations.length === 0) && <p>Run the AI Planner to populate LLM logs.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
