import React, { useEffect, useRef, useState } from 'react';
import { Bot, FileText, Lock, Paperclip, Send, X } from 'lucide-react';
import { chatApi } from '../../api/chatApi';

export default function ChatComposer({
  conversationId,
  members = [],
  canSend = true,
  replyTo,
  onClearReply,
  onSendMessage,
  onTypingChange,
}) {
  const [text, setText] = useState('');
  const [mentionedIds, setMentionedIds] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [mentionQuery, setMentionQuery] = useState(null);

  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    setText('');
    setMentionedIds([]);
    setAttachments([]);
    setMentionQuery(null);
    setUploadError('');
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingChange?.(false);
      }
    };
  }, [conversationId]);

  function notifyTyping() {
    if (!canSend || !conversationId) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      onTypingChange?.(true);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      onTypingChange?.(false);
    }, 2400);
  }

  function handleChange(e) {
    const val = e.target.value;
    setText(val);
    notifyTyping();

    const cursor = e.target.selectionStart || val.length;
    const beforeCursor = val.slice(0, cursor);
    const match = beforeCursor.match(/@([A-Za-z0-9_]*)$/);
    if (match) {
      setMentionQuery(match[1].toLowerCase());
    } else {
      setMentionQuery(null);
    }
  }

  const mentionCandidates =
    mentionQuery === null
      ? []
      : [
          { user_id: 0, full_name: 'copilot', role: 'AI AGENT', isAgent: true },
          ...members.map((m) => ({ ...m, isAgent: false })),
        ]
          .filter((item) => item.full_name.toLowerCase().includes(mentionQuery))
          .slice(0, 6);

  function insertMention(candidate) {
    const handle = candidate.isAgent ? 'copilot' : candidate.full_name.split(' ')[0];
    const cursor = textareaRef.current?.selectionStart || text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const replaced = before.replace(/@([A-Za-z0-9_]*)$/, `@${handle} `);
    setText(replaced + after);
    if (!candidate.isAgent && candidate.user_id) {
      setMentionedIds((prev) =>
        prev.includes(Number(candidate.user_id)) ? prev : [...prev, Number(candidate.user_id)]
      );
    }
    setMentionQuery(null);
    textareaRef.current?.focus();
  }

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !conversationId) return;
    setUploadError('');
    setUploading(true);
    try {
      for (const file of files) {
        const res = await chatApi.uploadAttachment(conversationId, file);
        if (res?.attachment) {
          setAttachments((prev) => [...prev, res.attachment]);
        }
      }
    } catch (err) {
      setUploadError(err.message || 'Attachment upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    if (!canSend || sending || uploading) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    setSending(true);
    setUploadError('');
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      onTypingChange?.(false);
    }

    try {
      const bodyToSend = trimmed || `Shared ${attachments.map((a) => a.file_name).join(', ')}`;
      await onSendMessage({
        body: bodyToSend,
        reply_to_message_id: replyTo?.message_id || null,
        mentions: mentionedIds,
        attachments,
        message_type: attachments.length > 0 && !trimmed ? 'ATTACHMENT' : 'TEXT',
      });
      setText('');
      setMentionedIds([]);
      setAttachments([]);
      setMentionQuery(null);
      onClearReply?.();
    } catch (err) {
      setUploadError(err.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  if (!canSend) {
    return (
      <div className="px-4 py-3 border-t border-hairline bg-surface-soft flex items-center justify-center gap-2 text-xs text-black/65">
        <Lock className="w-3.5 h-3.5" />
        <span>Only members with send permission can post in this group.</span>
      </div>
    );
  }

  return (
    <div className="relative border-t border-hairline bg-white px-3 sm:px-4 py-2.5">
      {/* Mention Autocomplete Popover */}
      {mentionQuery !== null && mentionCandidates.length > 0 && (
        <div className="absolute bottom-full left-4 mb-1.5 w-64 bg-white border border-hairline rounded-xl shadow-lg overflow-hidden z-20">
          {mentionCandidates.map((cand) => (
            <button
              key={`${cand.isAgent ? 'agent' : cand.user_id}`}
              type="button"
              onClick={() => insertMention(cand)}
              className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-surface-soft text-xs border-b border-hairline last:border-b-0"
            >
              <span className="font-semibold text-black flex items-center gap-1.5">
                {cand.isAgent && <Bot className="w-3.5 h-3.5" />}
                @{cand.isAgent ? 'copilot' : cand.full_name}
              </span>
              <span className="text-[10px] text-black/50">{cand.role}</span>
            </button>
          ))}
        </div>
      )}

      {/* Reply Quote Bar */}
      {replyTo && (
        <div className="mb-2 px-3 py-1.5 bg-surface-soft border-l-2 border-black rounded-r-lg flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-black">{replyTo.sender_name}</p>
            <p className="text-xs text-black/65 truncate">{replyTo.body}</p>
          </div>
          <button
            type="button"
            onClick={onClearReply}
            className="p-1 text-black/50 hover:text-black"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Pending Attachments */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <span
              key={att.attachment_id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-surface-soft border border-hairline text-xs text-black"
            >
              <FileText className="w-3 h-3" />
              <span className="max-w-[140px] truncate">{att.file_name}</span>
              <button
                type="button"
                onClick={() =>
                  setAttachments((prev) =>
                    prev.filter((x) => x.attachment_id !== att.attachment_id)
                  )
                }
                className="text-black/50 hover:text-black"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {uploadError && (
        <div className="mb-2 px-2.5 py-1.5 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {uploadError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Attach file or image"
          className="p-2 rounded-full border border-hairline bg-surface-soft hover:bg-hairline text-black/70 hover:text-black shrink-0"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Message group or @copilot..."
          className="flex-1 px-3.5 py-2 text-sm bg-surface-soft border border-hairline rounded-2xl resize-none max-h-28 focus:outline-none focus:border-black focus:bg-white"
        />

        <button
          type="submit"
          disabled={sending || uploading || (!text.trim() && attachments.length === 0)}
          className="p-2.5 rounded-full bg-black text-white hover:bg-black/85 disabled:opacity-35 shrink-0 transition-opacity"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
