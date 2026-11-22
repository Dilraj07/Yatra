import React from 'react';
import katex from 'katex';

/**
 * LatexText renders text with embedded LaTeX formulas ($...$ for inline, $$...$$ for block).
 * It also parses markdown bold (**text**) and line breaks cleanly.
 */
export default function LatexText({ text, className = '' }) {
  if (!text) return null;

  // Match $$...$$ (block math) or $...$ (inline math)
  const mathRegex = /(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g;

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = mathRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }

    const raw = match[0];
    if (raw.startsWith('$$') && raw.endsWith('$$')) {
      parts.push({
        type: 'block-math',
        content: raw.slice(2, -2).trim(),
      });
    } else if (raw.startsWith('$') && raw.endsWith('$')) {
      parts.push({
        type: 'inline-math',
        content: raw.slice(1, -1).trim(),
      });
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  const renderTextSegment = (str, keyPrefix) => {
    const boldRegex = /(\*\*.*?\*\*)/g;
    const subParts = str.split(boldRegex);

    return subParts.map((sub, i) => {
      if (sub.startsWith('**') && sub.endsWith('**')) {
        return (
          <strong key={`${keyPrefix}-${i}`} className="font-semibold text-black">
            {sub.slice(2, -2)}
          </strong>
        );
      }
      return <span key={`${keyPrefix}-${i}`}>{sub}</span>;
    });
  };

  return (
    <div className={`latex-container text-xs leading-relaxed text-black/90 ${className}`}>
      {parts.map((p, idx) => {
        if (p.type === 'block-math') {
          let html = '';
          try {
            html = katex.renderToString(p.content, {
              displayMode: true,
              throwOnError: false,
            });
          } catch (err) {
            html = `<span class="text-rose-600 font-mono">${p.content}</span>`;
          }
          return (
            <div
              key={idx}
              className="my-2 py-2 px-3 bg-white border border-hairline rounded-xl overflow-x-auto text-center"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        if (p.type === 'inline-math') {
          let html = '';
          try {
            html = katex.renderToString(p.content, {
              displayMode: false,
              throwOnError: false,
            });
          } catch (err) {
            html = `<span class="text-rose-600 font-mono">${p.content}</span>`;
          }
          return (
            <span
              key={idx}
              className="inline-block px-1 align-baseline"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }

        const lines = p.content.split('\n');
        return (
          <div key={idx} className="whitespace-pre-wrap">
            {lines.map((line, lIdx) => (
              <React.Fragment key={lIdx}>
                {renderTextSegment(line, `p-${idx}-${lIdx}`)}
                {lIdx < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </div>
        );
      })}
    </div>
  );
}
