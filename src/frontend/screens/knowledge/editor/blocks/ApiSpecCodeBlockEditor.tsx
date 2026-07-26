import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from '@mdxeditor/editor';
import { useTheme } from './theme';
import { SourceTextarea } from './SourceTextarea';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ApiParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ApiResponse {
  status: number;
  body: string;
  schema?: ApiParam[];
}

export interface ApiScenario {
  name: string;
  description?: string;
  notes?: string;
  request?: string;
  requestSchema?: ApiParam[];
  responses: ApiResponse[];
}

export interface ApiEnvironment {
  name: string;
  url?: string;
}

export interface ApiAuth {
  types: string[];   // e.g. ["Bearer", "API Key"]
  scopes: string[];  // e.g. ["users:read", "orders:write"]
}

export interface ApiSpec {
  type: 'rest' | 'graphql';
  method?: string;
  path?: string;
  endpoint?: string;
  domain?: string;
  environments: ApiEnvironment[];
  auth: ApiAuth | null;
  description?: string;
  query?: string;
  pathParams: ApiParam[];
  queryParams: ApiParam[];
  headers: ApiParam[];
  scenarios: ApiScenario[];
}

// ── Parser ────────────────────────────────────────────────────────────────────

const parseTopValue = (line: string): [string, string] | null => {
  const m = line.match(/^([a-zA-Z][a-zA-Z_-]*)\s*:\s*(.*)$/);
  if (!m) return null;
  return [m[1].toLowerCase(), m[2].trim()];
};

const parseParamLine = (line: string): ApiParam | null => {
  // Split on any whitespace — field names never contain spaces; description words
  // are re-joined so single-space or multi-space separators both work.
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const [name, type = 'string', req = 'optional', ...rest] = parts;
  return {
    name,
    type,
    required: /^(req|required|yes|true|y)$/i.test(req),
    description: rest.join(' ').trim(),
  };
};

const TOP_KEYS = new Set([
  'type', 'method', 'path', 'endpoint', 'domain',
  'env', 'environment', 'auth', 'authentication',
  'scopes', 'scope',
  'description', 'desc',
]);

export function parseApiSpec(code: string): ApiSpec | null {
  if (!code.trim()) return null;
  const spec: ApiSpec = {
    type: 'rest',
    environments: [], auth: null,
    pathParams: [], queryParams: [], headers: [], scenarios: [],
  };

  const lines = code.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  // ── Phase 1: top metadata (until first '#' line) ──
  while (i < lines.length) {
    const line = lines[i];
    if (/^#\s/.test(line) || /^##\s/.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }

    // First line may also be the implicit "METHOD path"
    if (i === 0 && !line.includes(':')) {
      const m = line.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)(?:\s+"([^"]*)")?\s*$/i);
      if (m) {
        spec.method = m[1].toUpperCase();
        spec.path   = m[2];
        if (m[3]) spec.description = m[3];
        i++; continue;
      }
    }

    const kv = parseTopValue(line);
    if (kv && TOP_KEYS.has(kv[0])) {
      const [key, val] = kv;
      if      (key === 'type')        spec.type    = (val.toLowerCase() as 'rest' | 'graphql');
      else if (key === 'method')     spec.method  = val.toUpperCase();
      else if (key === 'path')       spec.path    = val;
      else if (key === 'endpoint')   spec.endpoint = val;
      else if (key === 'domain')     spec.domain  = val;
      else if (key === 'env' || key === 'environment') {
        // "env: production https://api.example.com" — first token is name, rest is URL
        const [envName, ...rest] = val.split(/\s+/);
        const envUrl = rest.join('').trim() || undefined;
        spec.environments.push({ name: envName, url: envUrl });
      }
      else if (key === 'auth' || key === 'authentication') {
        // "auth: Bearer OAuth2" — pipe or space separated list of types
        const types = val.split(/[|,\s]+/).map(s => s.trim()).filter(Boolean);
        spec.auth = { types, scopes: spec.auth?.scopes ?? [] };
      }
      else if (key === 'scopes' || key === 'scope') {
        // "scopes: users:read orders:write" — space or comma separated
        const scopes = val.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
        spec.auth = { types: spec.auth?.types ?? [], scopes };
      }
      else if (key === 'description' || key === 'desc') spec.description = val;
    } else if (!spec.description) {
      spec.description = trimmed;
    }
    i++;
  }

  // ── Phase 2: sections ──
  let currentBucket: 'pathParams' | 'queryParams' | 'headers' | null = null;
  let currentScenario: ApiScenario | null = null;
  let scenarioMarkerSeen = false;     // tracks whether any > marker has been seen in current scenario
  let codeMode: {
    target: 'query' | 'request' | 'requestSchema' | 'response' | 'responseSchema';
    status?: number;
    buf: string[];
    // response-only: blank line after content separates body from trailing notes
    bodyDone?: boolean;
    notesBuf?: string[];
  } | null = null;

  const parseSchemaLines = (buf: string[]): ApiParam[] => {
    const result: ApiParam[] = [];
    const parentStack: string[] = [];
    for (const line of buf) {
      if (!line.trim()) continue;
      const leadingSpaces = line.match(/^( *)/)?.[1].length ?? 0;
      const depth = Math.floor(leadingSpaces / 2);
      const p = parseParamLine(line.trim());
      if (!p) continue;
      if (p.name.includes('.')) {
        // already dot-notation — use as-is
        result.push(p);
        continue;
      }
      parentStack.length = depth;              // trim to current depth
      const fullName = depth > 0
        ? [...parentStack, p.name].join('.')
        : p.name;
      parentStack[depth] = p.name;
      result.push({ ...p, name: fullName });
    }
    return result;
  };

  const findOrCreateResponse = (sc: ApiScenario, status: number): ApiResponse => {
    let r = sc.responses.find(x => x.status === status);
    if (!r) { r = { status, body: '' }; sc.responses.push(r); }
    return r;
  };

  const flushCode = () => {
    if (!codeMode) return;
    const text = codeMode.buf.join('\n').replace(/^\s*\n+|\n+\s*$/g, '');
    if (codeMode.target === 'query') {
      spec.query = text;
    } else if (currentScenario) {
      if (codeMode.target === 'request') {
        currentScenario.request = text;
      } else if (codeMode.target === 'requestSchema') {
        currentScenario.requestSchema = parseSchemaLines(codeMode.buf);
      } else if (codeMode.target === 'response') {
        const r = findOrCreateResponse(currentScenario, codeMode.status ?? 200);
        r.body = text;
        if (codeMode.notesBuf?.length) {
          const n = codeMode.notesBuf.join(' ');
          currentScenario.notes = currentScenario.notes ? `${currentScenario.notes} ${n}` : n;
        }
      } else if (codeMode.target === 'responseSchema') {
        findOrCreateResponse(currentScenario, codeMode.status ?? 200).schema =
          parseSchemaLines(codeMode.buf);
      }
    }
    codeMode = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    const h1 = !h2 ? line.match(/^#\s+(.+?)\s*$/) : null;

    if (h2) {
      flushCode();
      currentScenario = { name: h2[1].trim(), responses: [] };
      currentBucket = null;
      scenarioMarkerSeen = false;
      spec.scenarios.push(currentScenario);
      i++; continue;
    }

    if (h1) {
      flushCode();
      const sec = h1[1].trim().toLowerCase();
      currentBucket = null;

      if (sec.startsWith('path'))         currentBucket = 'pathParams';
      else if (sec.startsWith('header'))  currentBucket = 'headers';
      else if (sec.startsWith('query')) {
        if (spec.type === 'graphql' && (sec === 'query' || sec.startsWith('query ') === false)) {
          codeMode = { target: 'query', buf: [] };
        } else {
          currentBucket = 'queryParams';
        }
      }
      else if (sec.startsWith('scenario')) {
        currentScenario = null;
      }
      else if (sec.startsWith('description')) {
        // multi-line description body — accumulate plain text until next section
        // (no special handling; ignored for now)
      }
      i++; continue;
    }

    // Scenario sub-markers: > request [schema], > response NNN [schema]
    if (currentScenario) {
      const reqM = line.match(/^>\s*request(?:\s+(schema))?\s*$/i);
      const resM = line.match(/^>\s*response\s+(\d+)(?:\s+(schema))?\s*$/i);
      if (reqM) {
        flushCode();
        scenarioMarkerSeen = true;
        codeMode = { target: reqM[1] ? 'requestSchema' : 'request', buf: [] };
        i++; continue;
      }
      if (resM) {
        flushCode();
        scenarioMarkerSeen = true;
        const status = parseInt(resM[1], 10);
        codeMode = { target: resM[2] ? 'responseSchema' : 'response', status, buf: [] };
        i++; continue;
      }
    }

    if (codeMode) {
      if (codeMode.target === 'response') {
        const hasContent = codeMode.buf.some(l => l.trim());
        if (!line.trim() && hasContent) {
          // blank line after body content → body is done, notes may follow
          codeMode.bodyDone = true;
        } else if (codeMode.bodyDone && line.trim()) {
          (codeMode.notesBuf = codeMode.notesBuf ?? []).push(line.trim());
        } else if (!codeMode.bodyDone) {
          codeMode.buf.push(line);
        }
      } else {
        codeMode.buf.push(line);
      }
      i++; continue;
    }

    if (currentBucket) {
      if (line.trim()) {
        const p = parseParamLine(line);
        if (p) spec[currentBucket].push(p);
      }
      i++; continue;
    }

    // Free-text before first > marker → scenario description
    if (currentScenario && !scenarioMarkerSeen && line.trim()) {
      const txt = line.trim();
      currentScenario.description =
        currentScenario.description ? `${currentScenario.description} ${txt}` : txt;
    }
    i++;
  }
  flushCode();
  return spec;
}

// ── Visual primitives ─────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, { bg: string; fg: string }> = {
  GET:     { bg: 'oklch(0.62 0.13 240)', fg: '#fff' },
  POST:    { bg: 'oklch(0.62 0.14 150)', fg: '#fff' },
  PUT:     { bg: 'oklch(0.65 0.14 65)',  fg: '#fff' },
  PATCH:   { bg: 'oklch(0.60 0.14 295)', fg: '#fff' },
  DELETE:  { bg: 'oklch(0.55 0.20 25)',  fg: '#fff' },
  HEAD:    { bg: 'oklch(0.55 0.05 270)', fg: '#fff' },
  OPTIONS: { bg: 'oklch(0.55 0.05 270)', fg: '#fff' },
};

function MethodChip({ method }: { method: string }) {
  const m = method.toUpperCase();
  const c = METHOD_COLORS[m] ?? { bg: 'oklch(0.55 0.04 270)', fg: '#fff' };
  return (
    <span style={{
      background: c.bg, color: c.fg,
      padding: '1px 6px', borderRadius: 3,
      fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
      fontWeight: 700, letterSpacing: 0.5,
      lineHeight: 1.6,
    }}>{m}</span>
  );
}

const statusColor = (status: number): string => {
  if (status < 300) return 'oklch(0.60 0.14 150)';
  if (status < 400) return 'oklch(0.60 0.12 240)';
  if (status < 500) return 'oklch(0.65 0.15 65)';
  return 'oklch(0.55 0.20 25)';
};

const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
};

function StatusBadge({ status }: { status: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: statusColor(status), color: '#fff',
      padding: '0px 5px', borderRadius: 3,
      fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
      fontWeight: 700, letterSpacing: 0.3, lineHeight: 1.7,
    }}>
      <span>{status}</span>
      {STATUS_TEXT[status] && (
        <span style={{ opacity: 0.85, fontWeight: 400 }}>{STATUS_TEXT[status]}</span>
      )}
    </span>
  );
}

const ENV_COLORS: Record<string, { bg: string; fg: string }> = {
  production: { bg: 'oklch(0.55 0.20 25)',  fg: '#fff' },
  prod:       { bg: 'oklch(0.55 0.20 25)',  fg: '#fff' },
  staging:    { bg: 'oklch(0.65 0.15 65)',  fg: '#fff' },
  stage:      { bg: 'oklch(0.65 0.15 65)',  fg: '#fff' },
  development:{ bg: 'oklch(0.60 0.14 150)', fg: '#fff' },
  dev:        { bg: 'oklch(0.60 0.14 150)', fg: '#fff' },
  local:      { bg: 'oklch(0.60 0.12 240)', fg: '#fff' },
  localhost:  { bg: 'oklch(0.60 0.12 240)', fg: '#fff' },
  test:       { bg: 'oklch(0.58 0.14 295)', fg: '#fff' },
  qa:         { bg: 'oklch(0.58 0.14 295)', fg: '#fff' },
};

function EnvList({ envs, t }: { envs: ApiEnvironment[]; t: ReturnType<typeof useTheme> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {envs.map((env, i) => {
        const c = ENV_COLORS[env.name.toLowerCase()] ?? { bg: t.bgSunken, fg: t.ink };
        const useDot = !ENV_COLORS[env.name.toLowerCase()];
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '1px 7px', borderRadius: 3,
              background: useDot ? t.bgSunken : c.bg,
              border: useDot ? `0.5px solid ${t.hair}` : 'none',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              fontWeight: 700, color: useDot ? t.ink : c.fg,
              letterSpacing: 0.3,
            }}>
              {!useDot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.5)', display: 'inline-block', flexShrink: 0 }} />}
              {env.name}
            </span>
            {env.url && (
              <code style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                color: t.inkSoft,
              }}>{env.url}</code>
            )}
          </div>
        );
      })}
    </div>
  );
}

const AUTH_COLORS: Record<string, { bg: string; fg: string }> = {
  bearer:  { bg: 'oklch(0.60 0.12 240)', fg: '#fff' },
  jwt:     { bg: 'oklch(0.60 0.12 240)', fg: '#fff' },
  oauth2:  { bg: 'oklch(0.58 0.14 295)', fg: '#fff' },
  oauth:   { bg: 'oklch(0.58 0.14 295)', fg: '#fff' },
  apikey:  { bg: 'oklch(0.60 0.14 150)', fg: '#fff' },
  'api key':{ bg: 'oklch(0.60 0.14 150)', fg: '#fff' },
  basic:   { bg: 'oklch(0.65 0.15 65)',  fg: '#fff' },
  none:    { bg: 'oklch(0.55 0.04 270)', fg: '#fff' },
};

function AuthBlock({ auth, t }: { auth: ApiAuth; t: ReturnType<typeof useTheme> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {auth.types.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {auth.types.map((type, i) => {
            const c = AUTH_COLORS[type.toLowerCase()] ?? { bg: t.bgSunken, fg: t.ink };
            const isDefault = !AUTH_COLORS[type.toLowerCase()];
            return (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '1px 7px', borderRadius: 3,
                background: isDefault ? t.bgSunken : c.bg,
                border: isDefault ? `0.5px solid ${t.hair}` : 'none',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                fontWeight: 700, color: isDefault ? t.ink : c.fg,
                letterSpacing: 0.3,
              }}>{type}</span>
            );
          })}
        </div>
      )}
      {auth.scopes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
            color: t.faint, marginRight: 2,
          }}>scopes</span>
          {auth.scopes.map((scope, i) => (
            <span key={i} style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              color: t.inkSoft, background: t.bgSunken,
              border: `0.5px solid ${t.hairSoft}`,
              padding: '0 6px', borderRadius: 3,
              lineHeight: 1.6,
            }}>{scope}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ParamList({ params, t }: { params: ApiParam[]; t: ReturnType<typeof useTheme> }) {
  if (!params.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {params.map((p, i) => (
        <div key={i}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <code style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
              color: t.ink, fontWeight: 600,
            }}>{p.name}</code>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
              color: t.inkSoft, background: t.bgSunken,
              border: `0.5px solid ${t.hairSoft}`,
              padding: '0 5px', borderRadius: 3,
            }}>{p.type}</span>
            {p.required
              ? <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 9.5, fontWeight: 600,
                  color: 'oklch(0.55 0.20 25)', textTransform: 'uppercase', letterSpacing: 0.4,
                }}>required</span>
              : <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 9.5, color: t.faint,
                  textTransform: 'uppercase', letterSpacing: 0.4,
                }}>optional</span>}
          </div>
          {p.description && (
            <div style={{
              marginTop: 2,
              fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: t.inkSoft,
              lineHeight: 1.45,
            }}>{p.description}</div>
          )}
        </div>
      ))}
    </div>
  );
}

const indentGraphQL = (src: string): string => {
  // Light pretty-print: re-indent based on { } depth, preserving the user's tokens.
  const trimmed = src.trim();
  if (!trimmed) return trimmed;
  const tokens = trimmed.replace(/\s+/g, ' ').split(/(\{|\}|,)/).map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  let depth = 0;
  const pad = () => '  '.repeat(depth);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '{') {
      out.push(out.length ? ` ${tok}` : tok);
      depth++; out.push(`\n${pad()}`);
    } else if (tok === '}') {
      depth = Math.max(0, depth - 1);
      out.push(`\n${pad()}${tok}`);
      if (tokens[i + 1] && tokens[i + 1] !== '}' && tokens[i + 1] !== ',') out.push(`\n${pad()}`);
    } else if (tok === ',') {
      out.push(`,\n${pad()}`);
    } else {
      out.push(tok);
    }
  }
  return out.join('').replace(/\n\s*\n/g, '\n').trim();
};

function CodeBlock({ code, language, t, defaultOpen = true, fill = false }: {
  code: string;
  language?: string;
  t: ReturnType<typeof useTheme>;
  defaultOpen?: boolean;
  fill?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const formatted = useMemo(() => {
    const trimmed = code.trim();
    if (!trimmed) return '';
    if (language === 'json') {
      try { return JSON.stringify(JSON.parse(trimmed), null, 2); }
      catch { return trimmed; }
    }
    if (language === 'graphql') {
      try { return indentGraphQL(trimmed); }
      catch { return trimmed; }
    }
    return trimmed;
  }, [code, language]);

  if (!formatted) return null;

  const lines = formatted.split('\n');
  const gutterW = `${Math.max(2, String(lines.length).length)}ch`;

  return (
    <div style={{
      border: `0.5px solid ${t.hair}`, borderRadius: 6, overflow: 'hidden',
      background: t.bgSunken,
      ...(fill ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } : {}),
    }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '2px 8px',
          background: t.bgRaised,
          borderBottom: open ? `0.5px solid ${t.hair}` : 'none',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 8, color: t.muted, width: 8, display: 'inline-block' }}>
          {open ? '▼' : '▶'}
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
          color: t.faint, fontWeight: 600, letterSpacing: 0.4,
        }}>{language ?? 'code'}</span>
        <span style={{ flex: 1 }} />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
          color: t.faint, fontWeight: 500,
        }}>{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
      </button>
      {open && (
        <div style={{
          overflow: 'auto',
          maxHeight: fill ? 480 : 360,
          background: t.bgSunken,
          ...(fill ? { flex: 1, minHeight: 0 } : {}),
        }}>
          <div style={{
            display: 'inline-grid',
            gridTemplateColumns: `${gutterW} 1fr`,
            minWidth: '100%',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11.5, lineHeight: 1.55,
          }}>
            {lines.map((line, i) => (
              <Fragment key={i}>
                <span style={{
                  padding: '0 8px 0 10px',
                  color: t.faint, fontSize: 10.5,
                  textAlign: 'right', userSelect: 'none',
                  borderRight: `0.5px solid ${t.hairSoft}`,
                  whiteSpace: 'nowrap',
                  background: t.bgSunken,
                }}>{i + 1}</span>
                <span style={{
                  padding: '0 12px',
                  whiteSpace: 'pre',
                  color: t.inkSoft,
                }}>{line || ' '}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SchemaGrid({ params, t }: { params: ApiParam[]; t: ReturnType<typeof useTheme> }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto auto auto 1fr',
      background: t.bgSunken,
    }}>
      {params.map((p, i) => {
        const lastDot = p.name.lastIndexOf('.');
        const prefix  = lastDot >= 0 ? p.name.slice(0, lastDot + 1) : '';
        const leaf    = lastDot >= 0 ? p.name.slice(lastDot + 1)    : p.name;
        const rowBg   = i % 2 === 0 ? 'transparent' : `color-mix(in oklch, ${t.hairSoft} 30%, transparent)`;
        const cellBase: React.CSSProperties = {
          padding: '5px 10px',
          background: rowBg,
          borderBottom: `0.5px solid ${t.hairSoft}`,
        };
        return (
          <Fragment key={i}>
            {/* Field name */}
            <div style={{ ...cellBase, paddingRight: 6 }}>
              <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>
                {prefix && <span style={{ color: t.faint }}>{prefix}</span>}
                <span style={{ color: t.ink, fontWeight: 600 }}>{leaf}</span>
              </code>
            </div>
            {/* Type */}
            <div style={{ ...cellBase, paddingLeft: 4, paddingRight: 8 }}>
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
                color: t.inkSoft, background: t.bgRaised,
                border: `0.5px solid ${t.hairSoft}`, padding: '0 5px', borderRadius: 3,
              }}>{p.type}</span>
            </div>
            {/* Required / optional */}
            <div style={{ ...cellBase, paddingLeft: 4, paddingRight: 8, whiteSpace: 'nowrap' }}>
              {p.required
                ? <span style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 9.5, fontWeight: 600,
                    color: 'oklch(0.55 0.20 25)', textTransform: 'uppercase', letterSpacing: 0.4,
                  }}>req</span>
                : <span style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 9.5,
                    color: t.faint, textTransform: 'uppercase', letterSpacing: 0.4,
                  }}>opt</span>}
            </div>
            {/* Description */}
            <div style={{ ...cellBase, color: t.inkSoft, fontFamily: 'Inter, sans-serif', fontSize: 11.5 }}>
              {p.description}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function SchemaBlock({ params, t }: { params: ApiParam[]; t: ReturnType<typeof useTheme> }) {
  const [open, setOpen] = useState(true);
  if (!params.length) return null;
  return (
    <div style={{
      border: `0.5px solid ${t.hair}`, borderRadius: 6, overflow: 'hidden',
      background: t.bgSunken,
    }}>
      <button type="button" onClick={() => setOpen(v => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '2px 8px', background: t.bgRaised,
        borderBottom: open ? `0.5px solid ${t.hair}` : 'none',
        border: 'none', cursor: 'pointer', textAlign: 'left', flexShrink: 0,
      }}>
        <span style={{ fontSize: 8, color: t.muted, width: 8 }}>{open ? '▼' : '▶'}</span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
          color: t.faint, fontWeight: 600, letterSpacing: 0.4,
        }}>schema</span>
        <span style={{ flex: 1 }} />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.faint,
        }}>{params.length} {params.length === 1 ? 'field' : 'fields'}</span>
      </button>
      {open && <SchemaGrid params={params} t={t} />}

    </div>
  );
}

function SchemaTabView({ schema, body, language, t, fill = false }: {
  schema?: ApiParam[];
  body?: string;
  language?: string;
  t: ReturnType<typeof useTheme>;
  fill?: boolean;
}) {
  const hasSchema = schema && schema.length > 0;
  const hasBody   = !!body;

  const [tab, setTab] = useState<'schema' | 'example'>(hasBody ? 'example' : 'schema');

  if (!hasSchema && !hasBody) return null;

  // Single source — no tabs needed
  if (!hasSchema) return <CodeBlock code={body ?? ''} language={language} t={t} fill={fill} />;
  if (!hasBody)   return <SchemaBlock params={schema} t={t} />;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
    fontWeight: 700, letterSpacing: 0.4,
    padding: '2px 10px',
    background: active ? `color-mix(in oklch, ${t.accent} 12%, ${t.bgRaised})` : 'transparent',
    color: active ? t.accent : t.muted,
    border: 'none', cursor: 'pointer',
    borderBottom: active ? `1.5px solid ${t.accent}` : `1.5px solid transparent`,
    transition: 'color 0.1s, background 0.1s',
  });

  return (
    <div style={{
      border: `0.5px solid ${t.hair}`, borderRadius: 6, overflow: 'hidden',
      background: t.bgSunken,
      ...(fill ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } : {}),
    }}>
      {/* Tab strip */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        background: t.bgRaised, borderBottom: `0.5px solid ${t.hair}`,
        flexShrink: 0,
      }}>
        <button type="button" style={tabStyle(tab === 'schema')}  onClick={() => setTab('schema')}>schema</button>
        <button type="button" style={tabStyle(tab === 'example')} onClick={() => setTab('example')}>example</button>
      </div>

      {/* Tab body — no outer border since the wrapper already has one */}
      <div style={{
        ...(fill ? { flex: 1, minHeight: 0, overflow: 'auto' } : {}),
      }}>
        {tab === 'schema' && <SchemaGrid params={schema} t={t} />}
        {tab === 'example' && (
          // Render without outer border — wrapper already provides it
          <div style={{
            overflow: 'auto', maxHeight: fill ? 480 : 360,
            ...(fill ? { flex: 1, minHeight: 0 } : {}),
            background: t.bgSunken,
          }}>
            {(() => {
              const formatted = (() => {
                const trimmed = body.trim();
                if (language === 'json') {
                  try { return JSON.stringify(JSON.parse(trimmed), null, 2); }
                  catch { return trimmed; }
                }
                return trimmed;
              })();
              const lines = formatted.split('\n');
              const gutterW = `${Math.max(2, String(lines.length).length)}ch`;
              return (
                <div style={{
                  display: 'inline-grid', gridTemplateColumns: `${gutterW} 1fr`,
                  minWidth: '100%',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, lineHeight: 1.55,
                }}>
                  {lines.map((line, li) => (
                    <Fragment key={li}>
                      <span style={{
                        padding: '0 8px 0 10px', color: t.faint, fontSize: 10.5,
                        textAlign: 'right', userSelect: 'none',
                        borderRight: `0.5px solid ${t.hairSoft}`, whiteSpace: 'nowrap',
                        background: t.bgSunken,
                      }}>{li + 1}</span>
                      <span style={{ padding: '0 12px', whiteSpace: 'pre', color: t.inkSoft }}>{line || ' '}</span>
                    </Fragment>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function GqlRequestView({ query, variables, schema, t, fill = false }: {
  query?: string;
  variables?: string;
  schema?: ApiParam[];
  t: ReturnType<typeof useTheme>;
  fill?: boolean;
}) {
  const hasQuery   = !!query;
  const hasSchema  = schema && schema.length > 0;
  const hasVars    = !!variables;

  // Build the flat tab list: query · schema · example (only present ones)
  type GqlTab = 'query' | 'schema' | 'example';
  const tabs: GqlTab[] = [
    ...(hasQuery  ? ['query'   as GqlTab] : []),
    ...(hasSchema ? ['schema'  as GqlTab] : []),
    ...(hasVars   ? ['example' as GqlTab] : []),
  ];

  const defaultTab: GqlTab = hasQuery ? 'query' : hasSchema ? 'schema' : 'example';
  const [tab, setTab] = useState<GqlTab>(defaultTab);

  if (!tabs.length) return null;
  // Single tab — render directly, no chrome needed
  if (tabs.length === 1) {
    if (tab === 'query')   return <CodeBlock code={query ?? ''}     language="graphql" t={t} fill={fill} />;
    if (tab === 'schema')  return <div style={{ border: `0.5px solid ${t.hair}`, borderRadius: 6, overflow: 'hidden' }}><SchemaGrid params={schema ?? []} t={t} /></div>;
    return <CodeBlock code={variables ?? ''} language="json" t={t} fill={fill} />;
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
    fontWeight: 700, letterSpacing: 0.4,
    padding: '2px 10px',
    background: active ? `color-mix(in oklch, ${t.accent} 12%, ${t.bgRaised})` : 'transparent',
    color: active ? t.accent : t.muted,
    border: 'none', cursor: 'pointer',
    borderBottom: active ? `1.5px solid ${t.accent}` : `1.5px solid transparent`,
    transition: 'color 0.1s, background 0.1s',
  });

  return (
    <div style={{
      border: `0.5px solid ${t.hair}`, borderRadius: 6, overflow: 'hidden',
      background: t.bgSunken,
      ...(fill ? { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } : {}),
    }}>
      <div style={{
        display: 'flex', alignItems: 'stretch',
        background: t.bgRaised, borderBottom: `0.5px solid ${t.hair}`,
        flexShrink: 0,
      }}>
        {tabs.map(tKey => (
          <button key={tKey} type="button" style={tabStyle(tab === tKey)} onClick={() => setTab(tKey)}>
            {tKey}
          </button>
        ))}
      </div>
      <div style={{ ...(fill ? { flex: 1, minHeight: 0, overflow: 'auto' } : {}) }}>
        {tab === 'query'   && <CodeBlock code={query ?? ''}     language="graphql" t={t} fill={fill} />}
        {tab === 'schema'  && <SchemaGrid params={schema ?? []} t={t} />}
        {tab === 'example' && <CodeBlock code={variables ?? ''} language="json"    t={t} fill={fill} />}
      </div>
    </div>
  );
}

function ScenarioBody({ scenario, isGraphQL, gqlQuery, t }: {
  scenario: ApiScenario;
  isGraphQL: boolean;
  gqlQuery?: string;
  t: ReturnType<typeof useTheme>;
}) {
  const hasRequest  = isGraphQL
    ? (!!gqlQuery || !!scenario.request || (scenario.requestSchema?.length ?? 0) > 0)
    : (!!scenario.request || (scenario.requestSchema?.length ?? 0) > 0);
  const hasResponses = scenario.responses.length > 0;
  if (!hasRequest && !hasResponses) return null;

  const labelStyle: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
    fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    color: t.muted,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {scenario.description && (
        <p style={{
          margin: 0, fontFamily: 'Inter, sans-serif', fontSize: 12.5,
          color: t.inkSoft, lineHeight: 1.6,
        }}>{scenario.description}</p>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: hasRequest && hasResponses ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
        gap: 12,
        alignItems: 'stretch',
      }}>
        {hasRequest && (
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ ...labelStyle, marginBottom: 4, minHeight: 18, display: 'flex', alignItems: 'center' }}>
              Request
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {isGraphQL
                ? <GqlRequestView query={gqlQuery} variables={scenario.request} schema={scenario.requestSchema} t={t} fill />
                : <SchemaTabView schema={scenario.requestSchema} body={scenario.request} language="json" t={t} fill />
              }
            </div>
          </div>
        )}
        {hasResponses && (
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {scenario.responses.map((r, i) => (
              <div key={i} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, minHeight: 18 }}>
                  <span style={labelStyle}>Response</span>
                  <StatusBadge status={r.status} />
                </div>
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <SchemaTabView schema={r.schema} body={r.body} language="json" t={t} fill />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {scenario.notes && (
        <p style={{
          margin: 0, fontFamily: 'Inter, sans-serif', fontSize: 12,
          color: t.inkSoft, lineHeight: 1.6,
          borderTop: `0.5px solid ${t.hairSoft}`, paddingTop: 8,
        }}>{scenario.notes}</p>
      )}
    </div>
  );
}

function ScenarioPicker({ scenarios, isGraphQL, gqlQuery, t }: {
  scenarios: ApiScenario[];
  isGraphQL: boolean;
  gqlQuery?: string;
  t: ReturnType<typeof useTheme>;
}) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx]   = useState(0);
  const rootRef         = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!scenarios.length) return null;
  const sel = scenarios[Math.min(idx, scenarios.length - 1)];
  const selStatuses = sel.responses.map(r => r.status);

  return (
    <div ref={rootRef}>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '4px 8px',
            background: t.bgRaised,
            border: `0.5px solid ${open ? t.accent : t.hair}`,
            borderRadius: 5,
            cursor: 'pointer', textAlign: 'left',
            transition: 'border-color 0.1s',
          }}
        >
          <span style={{
            fontFamily: 'Inter, sans-serif', fontSize: 9.5,
            fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
            color: t.faint,
          }}>{`${idx + 1} / ${scenarios.length}`}</span>
          <span style={{
            fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600,
            color: t.ink, flex: 1, lineHeight: 1.4,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{sel.name || `Scenario ${idx + 1}`}</span>
          {selStatuses.length > 0 && (
            <span style={{ display: 'flex', gap: 4 }}>
              {selStatuses.map((s, i) => <StatusBadge key={i} status={s} />)}
            </span>
          )}
          <span style={{ fontSize: 8, color: t.muted, marginLeft: 2 }}>
            {open ? '▲' : '▼'}
          </span>
        </button>

        {open && (
          <div
            role="listbox"
            aria-label="Scenarios"
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
              zIndex: 5,
              background: t.bgRaised,
              border: `0.5px solid ${t.hair}`,
              borderRadius: 7,
              boxShadow: t.shadowLg,
              padding: 4,
              maxHeight: 280, overflowY: 'auto',
            }}
          >
            {scenarios.map((sc, i) => {
              const active = i === idx;
              const statuses = sc.responses.map(r => r.status);
              return (
                <button
                  key={i}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => { setIdx(i); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '4px 6px', borderRadius: 4,
                    background: active
                      ? `color-mix(in oklch, ${t.accent} 12%, ${t.bgRaised})`
                      : 'transparent',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => {
                    if (!active) (e.currentTarget as HTMLButtonElement).style.background = t.bgSunken;
                  }}
                  onMouseLeave={e => {
                    if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                  }}
                >
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
                    color: t.faint, fontWeight: 600, letterSpacing: 0.3,
                    width: 22, flexShrink: 0,
                  }}>{i + 1}</span>
                  <span style={{
                    fontFamily: 'Inter, sans-serif', fontSize: 12.5,
                    fontWeight: active ? 600 : 500,
                    color: active ? t.accent : t.ink,
                    flex: 1, lineHeight: 1.4,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{sc.name || `Scenario ${i + 1}`}</span>
                  {statuses.length > 0 && (
                    <span style={{ display: 'flex', gap: 4 }}>
                      {statuses.map((s, j) => <StatusBadge key={j} status={s} />)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ScenarioBody scenario={sel} isGraphQL={isGraphQL} gqlQuery={gqlQuery} t={t} />
    </div>
  );
}

function RowLabel({ title, sub, t }: {
  title: string;
  sub?: React.ReactNode;
  t: ReturnType<typeof useTheme>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
        fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
        color: t.muted,
      }}>{title}</div>
      {sub && <div>{sub}</div>}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function ApiSpecBlock({ spec }: { spec: ApiSpec }) {
  const t = useTheme();
  const isGraphQL = spec.type === 'graphql';

  const titleText = spec.description
    || (isGraphQL ? (spec.endpoint || 'GraphQL endpoint') : `${spec.method ?? ''} ${spec.path ?? ''}`.trim() || 'API endpoint');

  const rows: { label: React.ReactNode; content: React.ReactNode }[] = [];

  if (!isGraphQL && spec.method) {
    rows.push({
      label: <RowLabel title="Method" t={t} />,
      content: <MethodChip method={spec.method} />,
    });
  }
  if (!isGraphQL && spec.path) {
    rows.push({
      label: <RowLabel title="Path" t={t} />,
      content: (
        <code style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
          color: t.ink, fontWeight: 600, background: 'transparent', padding: 0,
        }}>{spec.path}</code>
      ),
    });
  }
  if (isGraphQL && spec.endpoint) {
    rows.push({
      label: <RowLabel title="Endpoint" t={t} />,
      content: (
        <code style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
          color: t.ink, fontWeight: 600, background: 'transparent', padding: 0,
          wordBreak: 'break-all',
        }}>{spec.endpoint}</code>
      ),
    });
  }
  if (spec.domain && !isGraphQL) {
    rows.push({
      label: <RowLabel title="Domain" t={t} />,
      content: (
        <code style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
          color: t.inkSoft, background: 'transparent', padding: 0,
          wordBreak: 'break-all',
        }}>{spec.domain}</code>
      ),
    });
  }
  if (spec.environments.length > 0) {
    rows.push({
      label: <RowLabel title="Environments" t={t} />,
      content: <EnvList envs={spec.environments} t={t} />,
    });
  }
  if (spec.auth && (spec.auth.types.length > 0 || spec.auth.scopes.length > 0)) {
    rows.push({
      label: <RowLabel title="Auth" t={t} />,
      content: <AuthBlock auth={spec.auth} t={t} />,
    });
  }
  // GraphQL query is shown inline per-scenario in GqlRequestView; no top-level row needed.
  if (spec.pathParams.length > 0) {
    rows.push({
      label: <RowLabel title="Path params" t={t} />,
      content: <ParamList params={spec.pathParams} t={t} />,
    });
  }
  if (spec.queryParams.length > 0) {
    rows.push({
      label: <RowLabel title="Query params" t={t} />,
      content: <ParamList params={spec.queryParams} t={t} />,
    });
  }
  if (spec.headers.length > 0) {
    rows.push({
      label: <RowLabel title="Headers" t={t} />,
      content: <ParamList params={spec.headers} t={t} />,
    });
  }
  if (spec.scenarios.length > 0) {
    rows.push({
      label: <RowLabel title={`Scenarios (${spec.scenarios.length})`} t={t} />,
      content: <ScenarioPicker scenarios={spec.scenarios} isGraphQL={isGraphQL} gqlQuery={spec.query} t={t} />,
    });
  }

  return (
    <div style={{
      margin: '1em 0', borderRadius: 8,
      border: `0.5px solid ${t.hair}`, overflow: 'hidden',
      background: t.bgSunken,
    }}>
      {/* Title bar: tag + description */}
      <div style={{
        padding: '7px 14px 8px',
        background: t.bgRaised,
        borderBottom: `0.5px solid ${t.hair}`,
        borderLeft: `3px solid ${t.accent}`,
        display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
          color: t.faint, fontWeight: 700, letterSpacing: 0.5,
          textTransform: 'uppercase', flexShrink: 0,
        }}>{isGraphQL ? 'GraphQL' : 'REST'}</span>
        <span style={{
          fontFamily: 'Inter, sans-serif', fontSize: 13,
          fontWeight: 600, color: t.ink, lineHeight: 1.35,
        }}>{titleText}</span>
      </div>

      {/* Body — two-column grid: title on the left, value on the right */}
      {rows.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '130px 1fr',
          columnGap: 12,
          padding: '4px 14px',
        }}>
          {rows.map((r, i) => (
            <Fragment key={i}>
              <div style={{
                padding: '9px 0',
                borderTop: i === 0 ? 'none' : `0.5px solid ${t.hairSoft}`,
              }}>{r.label}</div>
              <div style={{
                padding: '9px 0',
                borderTop: i === 0 ? 'none' : `0.5px solid ${t.hairSoft}`,
                minWidth: 0,
              }}>{r.content}</div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Editor descriptor ─────────────────────────────────────────────────────────
// Buddy renders this block read-only (MarkdownView) and never registers an editor for it, so
// there was no descriptor to port — this wraps the existing `ApiSpecBlock` renderer in the same
// preview/source shell every other block here uses.

function ApiSpecToolBtn({ children, onClick, title, t }: {
  children: React.ReactNode; onClick: () => void; title?: string; t: ReturnType<typeof useTheme>;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        fontSize: 11, padding: '2px 7px', borderRadius: 4, lineHeight: 1.6,
        border: `0.5px solid ${hov ? t.muted : t.hair}`,
        background: hov ? t.bgSunken : 'transparent',
        color: hov ? t.ink : t.inkSoft,
        cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.1s',
      }}>
      {children}
    </button>
  );
}

function ApiSpecBlockEditor({ code }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const t = useTheme();
  const [viewMode, setViewMode] = useState<'spec' | 'source'>('spec');
  const deleteBlock = () => parentEditor.update(() => lexicalNode.remove());
  const spec = parseApiSpec(code);

  return (
    <div data-rich-block="true" style={{ margin: '8px 0', borderRadius: 8, border: `0.5px solid ${t.hair}`, background: t.bgSunken, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px', borderBottom: `0.5px solid ${t.hair}`,
        background: t.bgRaised, userSelect: 'none',
      }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.muted, fontWeight: 600, letterSpacing: 0.3, flex: 1 }}>api</span>
        <ApiSpecToolBtn title={viewMode === 'spec' ? 'Edit source' : 'Show spec'}
          onClick={() => setViewMode(v => (v === 'spec' ? 'source' : 'spec'))} t={t}>
          {viewMode === 'spec' ? 'Edit' : 'Spec'}
        </ApiSpecToolBtn>
        <ApiSpecToolBtn title="Delete block" onClick={deleteBlock} t={t}>✕</ApiSpecToolBtn>
      </div>

      {viewMode === 'spec' && (
        <div style={{ background: t.bg, padding: '4px 0' }}>
          {spec ? <ApiSpecBlock spec={spec} /> : (
            <div style={{
              padding: '32px 0', textAlign: 'center',
              color: t.faint, fontSize: 12, fontStyle: 'italic', fontFamily: 'Inter, sans-serif',
            }}>
              Describe an endpoint — switch to Edit to write the spec
            </div>
          )}
        </div>
      )}

      {viewMode === 'source' && (
        <SourceTextarea
          code={code}
          onCodeChange={setCode}
          ariaLabel="API spec"
          minHeight={220}
        />
      )}
    </div>
  );
}

export const apiSpecCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'api',
  priority: 100,
  Editor: ApiSpecBlockEditor,
};
