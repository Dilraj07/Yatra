import React from 'react';
import { ShieldAlert, CheckCircle2, X } from 'lucide-react';

export default function ConstraintBanner({ feedback, onClose }) {
  if (!feedback) return null;
  const isError = feedback.type === 'error';

  return (
    <div
      className={`fixed bottom-5 right-5 z-50 max-w-lg rounded-lg border p-4 ${
        isError ? 'bg-canvas border-primary text-ink' : 'bg-block-mint border-ink/20 text-ink'
      }`}
    >
      <div className="flex items-start gap-3">
        {isError ? (
          <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-ink" />
        ) : (
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-semantic-success" />
        )}
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between gap-4">
            <span className="caption-mono font-bold">
              {isError ? 'VALIDATION NOTICE' : 'SUCCESS'}
            </span>
            <button onClick={onClose} aria-label="Close" className="p-1 rounded-full hover:bg-surface-soft">
              <X className="w-4 h-4" />
            </button>
          </div>
          {feedback.pgDetail?.error_code && (
            <span className="caption-mono inline-block bg-black text-white px-2 py-0.5 rounded-xs text-[10px]">
              REF: {feedback.pgDetail.error_code}
            </span>
          )}
          <p className="text-sm leading-snug">{feedback.message}</p>
        </div>
      </div>
    </div>
  );
}
