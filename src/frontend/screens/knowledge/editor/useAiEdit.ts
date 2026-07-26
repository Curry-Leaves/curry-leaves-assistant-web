/**
 * useAiEdit — the note-editor's AI engine. One hook drives all three entry points
 * (selection enhance, cursor insert, whole-note improve): given a scope + an
 * instruction, it streams a rewrite from the `note-editor` agent and hands back a
 * candidate for review.
 *
 * Streams over the shared WebSocket (chat.start with ephemeral:true → subChat run
 * frames), NOT the /chat SSE endpoint AiTextSpace uses — this app has no such HTTP
 * route; chat is fully WS here (see api/ws.py, agents/chat_runs.py). Frames arrive as
 * {type:'token', text}, {type:'done'}, {type:'error', error}.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { chatApi } from '../../../api/chat';
import { subChat } from '../../../api/socket';

export type AiScope = 'selection' | 'insert' | 'whole';

export const NOTE_EDITOR_SURFACE = 'knowledge-editor';
export const NOTE_EDITOR_AGENT = 'note-editor';

export interface AiRunArgs {
  scope: AiScope;
  instruction: string;
  /** The text the model rewrites: the selection, or the whole body. Empty for `insert`. */
  sourceText: string;
  /** Full note body, sent as context so scoped edits fit their surroundings. */
  noteContext: string;
}

export interface AiRunResult {
  candidate: string;
  scope: AiScope;
}

interface UseAiEdit {
  streaming: boolean;
  preview: string;
  error: string | null;
  agentId: string;
  hasAgent: boolean;
  /** Resolves with the finished candidate, or null if cancelled / errored. */
  run: (args: AiRunArgs) => Promise<AiRunResult | null>;
  cancel: () => void;
  clearError: () => void;
  setError: (msg: string) => void;
}

// LLMs sometimes wrap the whole reply in a ```md fence despite instructions; peel it.
function stripFenceWrap(s: string): string {
  const m = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(s.trim());
  return m ? m[1] : s;
}

function buildMessage({ scope, instruction, sourceText, noteContext }: AiRunArgs): string {
  const instr = instruction.trim();
  if (scope === 'insert') {
    return `<instruction>\n${instr}\n</instruction>\n<note_context>\n${noteContext}\n</note_context>\n<task>\nWrite new markdown to insert at the cursor. Output only the markdown to insert.\n</task>`;
  }
  if (scope === 'selection') {
    // The model gets the WHOLE note and returns the WHOLE note, with the selection named as the
    // part to change. It used to return only the replacement prose, which we then had to splice
    // back into the markdown source — but the user selects *rendered* text, so finding the
    // matching source span meant reconstructing a rendered→source mapping. That guesswork broke
    // on headings, list markers and links ("Could not locate the original text to replace").
    // Returning the full document removes the mapping entirely; the diff review then shows
    // exactly what changed, so an over-eager rewrite is caught before it lands.
    return [
      '<instruction>', instr, '</instruction>',
      '<selected_text>', sourceText, '</selected_text>',
      '<note>', noteContext, '</note>',
      '<task>',
      'The user selected the text in <selected_text> and asked for the change in <instruction>.',
      'Apply that change to THAT part of the note only.',
      '',
      'Return the ENTIRE note with the change applied. Keep everything else — wording, headings,',
      'links, formatting, blank lines — byte-for-byte identical. Output only the note markdown,',
      'with no commentary and no code fence around it.',
      '</task>',
    ].join('\n');
  }
  // whole
  return `<instruction>\n${instr}\n</instruction>\n<text>\n${sourceText}\n</text>`;
}

export function useAiEdit(): UseAiEdit {
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string>(NOTE_EDITOR_AGENT);
  const [hasAgent, setHasAgent] = useState(true);

  const runIdRef = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // Pick the note-editor agent if present; otherwise fall back to any agent
  // enabled for our surface so the feature degrades instead of dying.
  useEffect(() => {
    api.listAgents()
      .then((list) => {
        const enabled = list.filter((a) => a.enabled !== false);
        const exact = enabled.find((a) => a.id === NOTE_EDITOR_AGENT);
        if (exact) { setAgentId(exact.id); setHasAgent(true); return; }
        const onSurface = enabled.find((a) => (a.surfaces || []).includes(NOTE_EDITOR_SURFACE));
        if (onSurface) { setAgentId(onSurface.id); setHasAgent(true); return; }
        setHasAgent(false);
      })
      .catch(() => { /* offline — keep the default id and hope the run works */ });
  }, []);

  const teardown = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    runIdRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    const rid = runIdRef.current;
    if (rid) chatApi.stopChat(rid).catch(() => {});
    teardown();
    setStreaming(false);
    setPreview('');
  }, [teardown]);

  const run = useCallback(async (args: AiRunArgs): Promise<AiRunResult | null> => {
    setError(null);
    setPreview('');
    setStreaming(true);

    let full = '';
    try {
      const { runId } = await chatApi.startChat({
        agentId,
        message: buildMessage(args),
        ephemeral: true,
      });
      runIdRef.current = runId;

      const candidate = await new Promise<string>((resolve, reject) => {
        const unsub = subChat(runId, (ev) => {
          const frame = ev as { type?: string; text?: string; error?: string };
          if (frame.type === 'token') {
            full += frame.text ?? '';
            setPreview(full);
          } else if (frame.type === 'error') {
            reject(new Error(frame.error || 'agent error'));
          } else if (frame.type === 'done') {
            resolve(full);
          } else if (frame.type === 'gone') {
            reject(new Error('The run ended unexpectedly.'));
          }
        });
        unsubRef.current = unsub;
      });

      teardown();
      setStreaming(false);
      const cleaned = stripFenceWrap(candidate.trim());
      return { candidate: cleaned, scope: args.scope };
    } catch (err) {
      teardown();
      setStreaming(false);
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [agentId, teardown]);

  // Stop any in-flight run if the editor unmounts.
  useEffect(() => () => cancel(), [cancel]);

  return {
    streaming, preview, error, agentId, hasAgent,
    run, cancel,
    clearError: () => setError(null),
    setError: (msg: string) => setError(msg),
  };
}
