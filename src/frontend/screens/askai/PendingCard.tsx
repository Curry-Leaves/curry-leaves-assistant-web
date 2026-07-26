import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import type { PendingReq } from './model';

// ─── approval / ask prompt card (mid-run, blocks until answered) ──────────────
export function PendingCard({ req, onRespond }: {
  req: PendingReq; onRespond: (body: { approved?: boolean; answer?: string; scope?: 'once' | 'session' | 'always' }) => void;
}) {
  const [text, setText] = useState('');
  const argStr = req.args && Object.keys(req.args as object).length ? JSON.stringify(req.args, null, 2) : '';
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full rounded-[14px] border border-accent/40 bg-accent-soft/15 px-4 py-3">
        {req.kind === 'approve' ? (
          <>
            <div className="flex items-center gap-2 text-[13px] text-ink mb-1.5">
              <span className="text-accent"><Icon name="zap" size={14} /></span>
              Allow <span className="font-mono text-[12.5px] bg-bg border border-border rounded px-1.5 py-0.5">{req.tool}</span> to run?
              {req.risk && <span className="font-mono text-[10px] text-ink3 uppercase">{req.risk}</span>}
            </div>
            {argStr && (
              <pre className="px-2.5 py-2 rounded-[7px] bg-bg border border-border font-mono text-[10.5px] text-ink2 overflow-x-auto whitespace-pre-wrap break-all max-h-[160px] overflow-y-auto mb-2">{argStr}</pre>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onRespond({ approved: true, scope: 'once' })}
                className="px-3 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] font-550 hover:bg-accent-dark">Allow</button>
              <button type="button" onClick={() => onRespond({ approved: true, scope: 'session' })}
                className="px-3 py-1.5 rounded-[8px] border border-border bg-card text-ink2 text-[12px] hover:border-ink3">Allow for this chat</button>
              <button type="button" onClick={() => onRespond({ approved: true, scope: 'always' })}
                className="px-3 py-1.5 rounded-[8px] border border-border bg-card text-ink2 text-[12px] hover:border-ink3">Always allow</button>
              <button type="button" onClick={() => onRespond({ approved: false })}
                className="px-3 py-1.5 rounded-[8px] border border-border bg-card text-ink2 text-[12px] hover:text-rec hover:border-rec">Deny</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-2 text-[13.5px] text-ink mb-2">
              <span className="text-accent mt-0.5"><Icon name="chat" size={14} /></span>
              <span>{req.question}</span>
            </div>
            {req.options && req.options.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {req.options.map((o) => (
                  <button key={o} type="button" onClick={() => onRespond({ answer: o })}
                    className="px-2.5 py-1 rounded-full border border-border bg-card text-ink2 text-[12px] hover:border-accent hover:text-accent">{o}</button>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input value={text} onChange={(e) => setText(e.target.value)} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) onRespond({ answer: text.trim() }); }}
                placeholder="Type an answer…" className="flex-1 bg-bg border border-border rounded-[8px] px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent" />
              <button type="button" onClick={() => text.trim() && onRespond({ answer: text.trim() })} disabled={!text.trim()}
                className="px-3 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] font-550 disabled:opacity-40">Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
