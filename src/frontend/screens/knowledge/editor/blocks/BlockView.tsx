/** Read-only rendering for the rich blocks.
 *
 * The editor claims these fenced languages through MDXEditor descriptors; this is the other half
 * — what a note looks like when you're *reading* it (and in chat answers, recording summaries and
 * dashboard tiles, which all share `components/Markdown.tsx`). Without it a ```timeline block
 * would render as a wall of raw CSV in every one of those places.
 *
 * Same parsers and same SVG renderers as the editor, minus the editing chrome: no source toggle,
 * no delete button, no click-to-add. Calendar keeps month navigation because a calendar you can't
 * page through isn't much use.
 *
 * A block whose content doesn't parse renders the caller's `fallback` (its ordinary code box),
 * so a half-typed one stays readable as text instead of collapsing to nothing.
 */
import type { ReactNode } from 'react';
import { readTitle, stripTitle } from './blockTitle';
import { useTheme } from './theme';
import { parseTabs, TabViewBlock } from './TabViewBlock';
import { CalendarViewBlock } from './CalendarCodeBlockEditor';
import { parseChartData, ResponsiveChart } from './ChartCodeBlockEditor';
import { parseDiffData, ResponsiveDiffChart } from './DiffChartCodeBlockEditor';
import { parseTimelineData, ResponsiveTimeline } from './TimelineCodeBlockEditor';
import { parseMindMapData, ResponsiveMindMap } from './MindMapCodeBlockEditor';
import { parseWaterfallData, ResponsiveWaterfall } from './WaterfallCodeBlockEditor';
import { parseSankeyData, ResponsiveSankey } from './SankeyCodeBlockEditor';
import { parseKanbanData, KanbanBoard } from './KanbanCodeBlockEditor';
import { parseApiSpec, ApiSpecBlock } from './ApiSpecCodeBlockEditor';
import {
  parseExcalidrawScene, ExcalidrawView,
  readExcalidrawHeight, readExcalidrawAlign,
} from './ExcalidrawCodeBlockEditor';

/** Languages this module renders — used to decide whether to intercept a fenced block at all. */
export const RICH_BLOCK_LANGUAGES = new Set([
  'tabs', 'calendar', 'chart', 'diffchart', 'timeline',
  'mindmap', 'waterfall', 'sankey', 'kanban', 'api', 'excalidraw',
]);

function BlockTitle({ title }: { title: string }) {
  const t = useTheme();
  if (!title) return null;
  return (
    <div style={{
      fontFamily: 'Inter, sans-serif', fontSize: 13.5, fontWeight: 600,
      color: t.ink, padding: '4px 0 6px',
    }}>{title}</div>
  );
}

function Framed({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ margin: '1em 0' }}>
      <BlockTitle title={title} />
      {children}
    </div>
  );
}

/**
 * Render one fenced block, falling back to `fallback` when the content doesn't parse (or the
 * language isn't one of ours). The caller passes its own code-box as that fallback rather than
 * testing the result: this is a component, so its return value is always a truthy JSX element
 * even when nothing rendered.
 *
 * `renderMarkdown` is how tab contents get rendered — the caller passes its own markdown
 * renderer so nested content matches the surrounding page (and so this module doesn't have to
 * import a renderer, which would make the dependency circular).
 */
export function RichBlockView({ language, code, renderMarkdown, fallback = null }: {
  language: string;
  code: string;
  renderMarkdown?: (md: string) => ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  const title = readTitle(code);
  const body = stripTitle(code);

  switch (language) {
    case 'tabs': {
      const parsed = parseTabs(body);
      if (!parsed.tabs.length) return fallback;
      return (
        <Framed title={title}>
          <TabViewBlock
            tabs={parsed.tabs}
            layout={parsed.layout}
            renderContent={(content) => renderMarkdown ? renderMarkdown(content) : content}
          />
        </Framed>
      );
    }
    case 'calendar':
      return <CalendarViewBlock code={body} title={title} />;

    case 'chart': {
      const data = parseChartData(body);
      if (!data) return fallback;
      return <Framed title={title}><ResponsiveChart data={data} height={260} /></Framed>;
    }
    case 'diffchart': {
      const res = parseDiffData(body);
      if (!res || !res.rows.length) return fallback;
      return (
        <Framed title={title}>
          <ResponsiveDiffChart rows={res.rows} beforeLabel={res.beforeLabel} afterLabel={res.afterLabel} />
        </Framed>
      );
    }
    case 'timeline': {
      const rows = parseTimelineData(body);
      if (!rows?.length) return fallback;
      return <Framed title={title}><ResponsiveTimeline rows={rows} /></Framed>;
    }
    case 'mindmap': {
      const data = parseMindMapData(body);
      if (!data) return fallback;
      return <Framed title={title}><ResponsiveMindMap data={data} /></Framed>;
    }
    case 'waterfall': {
      const data = parseWaterfallData(body);
      if (!data) return fallback;
      return <Framed title={title}><ResponsiveWaterfall data={data} /></Framed>;
    }
    case 'sankey': {
      const data = parseSankeyData(body);
      if (!data) return fallback;
      return <Framed title={title}><ResponsiveSankey data={data} /></Framed>;
    }
    case 'kanban': {
      const columns = parseKanbanData(body);
      if (!columns) return fallback;
      return <Framed title={title}><KanbanReadOnly columns={columns} /></Framed>;
    }
    case 'api': {
      const spec = parseApiSpec(body);
      if (!spec) return fallback;
      return <Framed title={title}><ApiSpecBlock spec={spec} /></Framed>;
    }
    case 'excalidraw': {
      // Sized/aligned from the directive, which lives on the ORIGINAL code — `body` has had the
      // title stripped but the parser strips the directive itself.
      const scene = parseExcalidrawScene(code);
      if (!scene) return fallback;
      return (
        <Framed title={title}>
          <ExcalidrawView
            scene={scene}
            height={readExcalidrawHeight(code)}
            align={readExcalidrawAlign(code)}
          />
        </Framed>
      );
    }
    default:
      return fallback;
  }
}

/** KanbanBoard needs the theme object; omitting `onChange` is what makes it read-only. */
function KanbanReadOnly({ columns }: { columns: ReturnType<typeof parseKanbanData> }) {
  const t = useTheme();
  if (!columns) return null;
  return <KanbanBoard columns={columns} t={t} />;
}
