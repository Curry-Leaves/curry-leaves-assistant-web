import { useState, useCallback, useRef } from 'react';
import {
  MDXEditor,
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
  insertCodeBlock$,
  headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin,
  markdownShortcutPlugin, linkPlugin, linkDialogPlugin, tablePlugin,
  codeBlockPlugin, codeMirrorPlugin, toolbarPlugin, diffSourcePlugin,
  BoldItalicUnderlineToggles, StrikeThroughSupSubToggles,
  BlockTypeSelect, ListsToggle, CreateLink, InsertTable, InsertCodeBlock, InsertThematicBreak, Separator, UndoRedo,
  ConditionalContents, ChangeCodeMirrorLanguage,
} from '@mdxeditor/editor';
import { usePublisher } from '@mdxeditor/gurx';
import { Plus, X, LayoutPanelLeft, LayoutPanelTop } from 'lucide-react';
import { useTheme } from './theme';
import { parseTabs, serializeTabs, type TabItem, type TabLayout } from './TabViewBlock';

// ── Toolbar button ────────────────────────────────────────────────────────────

const TABS_STARTER = '=== Tab 1\nContent for the first tab.\n\n=== Tab 2\nContent for the second tab.\n';

export function InsertTabsButton() {
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const t = useTheme();
  return (
    <button
      type="button"
      title="Insert tab group"
      data-toolbar-item="true"
      onClick={() => insertCodeBlock({ language: 'tabs', code: TABS_STARTER })}
      style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'Inter, sans-serif', fontSize: 11.5 }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        <span style={{ display: 'flex', gap: 2 }}>
          <span style={{ width: 13, height: 4, borderRadius: '2px 2px 0 0', background: t.accent }} />
          <span style={{ width: 9, height: 4, borderRadius: '2px 2px 0 0', background: t.muted, opacity: 0.5 }} />
        </span>
        <span style={{ width: 24, height: 7, borderRadius: '0 2px 2px 2px', border: `1.5px solid ${t.hair}` }} />
      </span>
      Tabs
    </button>
  );
}

// ── Inner tab toolbar ─────────────────────────────────────────────────────────

function TabToolbar() {
  return (
    <>
      <UndoRedo />
      <Separator />
      <BlockTypeSelect />
      <Separator />
      <BoldItalicUnderlineToggles />
      <StrikeThroughSupSubToggles options={['Strikethrough']} />
      <Separator />
      <ListsToggle />
      <Separator />
      <CreateLink />
      <InsertTable />
      <InsertCodeBlock />
      <InsertThematicBreak />
      <Separator />
      <ConditionalContents
        options={[
          { when: (e) => e?.editorType === 'codeblock', contents: () => <ChangeCodeMirrorLanguage /> },
        ]}
      />
    </>
  );
}

// ── Tab editor component ──────────────────────────────────────────────────────

function TabViewEditor({ code }: CodeBlockEditorProps) {
  const { setCode } = useCodeBlockEditorContext();
  const t = useTheme();

  const parsed = parseTabs(code);
  const [tabs, setTabs] = useState<TabItem[]>(() =>
    parsed.tabs.length > 0 ? parsed.tabs : [{ label: 'Tab 1', content: '' }]
  );
  const [layout, setLayout] = useState<TabLayout>(() => parsed.layout);
  const [activeIdx, setActiveIdx] = useState(0);
  const [editingLabel, setEditingLabel] = useState<number | null>(null);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const sync = useCallback((next: TabItem[]) => {
    setTabs(next);
    tabsRef.current = next;
    setCode(serializeTabs(next, layoutRef.current));
  }, [setCode]);

  const toggleLayout = useCallback(() => {
    const next: TabLayout = layoutRef.current === 'horizontal' ? 'vertical' : 'horizontal';
    setLayout(next);
    layoutRef.current = next;
    setCode(serializeTabs(tabsRef.current, next));
  }, [setCode]);

  const handleContentChange = useCallback((idx: number, markdown: string) => {
    const next = tabsRef.current.map((tab, i) => i === idx ? { ...tab, content: markdown } : tab);
    sync(next);
  }, [sync]);

  const handleLabelChange = useCallback((idx: number, label: string) => {
    const next = tabsRef.current.map((tab, i) => i === idx ? { ...tab, label } : tab);
    sync(next);
  }, [sync]);

  const addTab = useCallback(() => {
    const next = [...tabsRef.current, { label: `Tab ${tabsRef.current.length + 1}`, content: '' }];
    sync(next);
    setActiveIdx(next.length - 1);
  }, [sync]);

  const removeTab = useCallback((idx: number) => {
    if (tabsRef.current.length <= 1) return;
    const next = tabsRef.current.filter((_, i) => i !== idx);
    sync(next);
    setActiveIdx(i => Math.min(i, next.length - 1));
  }, [sync]);

  const active = tabs[Math.min(activeIdx, tabs.length - 1)];

  const innerPlugins = [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    markdownShortcutPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    tablePlugin(),
    codeBlockPlugin(),
    codeMirrorPlugin({
      codeBlockLanguages: {
        js: 'JavaScript', ts: 'TypeScript', python: 'Python',
        bash: 'Bash', json: 'JSON', html: 'HTML', css: 'CSS', sql: 'SQL',
      },
    }),
    // NOTE: buddy also mounts imagePlugin here, uploading through an Electron-only IPC call
    // (`window.electronAPI.hubSaveImage`). Curry Leaves has no note-image upload endpoint, and
    // must keep working in browser/Docker mode where there is no Electron at all — so image
    // insertion is left out rather than wired to something that would break outside the desktop
    // app. Markdown image syntax still renders; only the upload button is absent.
    diffSourcePlugin({ viewMode: 'rich-text' }),
    toolbarPlugin({ toolbarContents: () => <TabToolbar /> }),
  ];

  // ── Shared tab item renderer ─────────────────────────────────────────────────

  const renderTabItem = (tab: TabItem, i: number) => (
    <div
      key={i}
      onClick={() => { setActiveIdx(i); setEditingLabel(null); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        cursor: 'pointer',
        flexShrink: 0,
        ...(layout === 'vertical' ? {
          padding: '0 8px 0 4px',
          borderLeft: `2px solid ${i === activeIdx ? t.accent : 'transparent'}`,
          background: i === activeIdx ? t.bgRaised : 'transparent',
          width: '100%',
          boxSizing: 'border-box' as const,
        } : {
          padding: '0 4px 0 12px',
          borderBottom: `2px solid ${i === activeIdx ? t.accent : 'transparent'}`,
          background: 'transparent',
        }),
      }}
    >
      {editingLabel === i ? (
        <input
          autoFocus
          aria-label="Tab label"
          value={tab.label}
          onChange={e => handleLabelChange(i, e.target.value)}
          onBlur={() => setEditingLabel(null)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingLabel(null); }}
          onClick={e => e.stopPropagation()}
          style={{
            border: 'none', outline: 'none',
            background: 'transparent',
            color: t.ink,
            fontSize: 12.5,
            fontFamily: 'Inter, sans-serif',
            fontWeight: 550,
            width: Math.max(tab.label.length * 8, 60),
            padding: '6px 0',
            flex: layout === 'vertical' ? 1 : undefined,
          }}
        />
      ) : (
        <span
          onDoubleClick={e => { e.stopPropagation(); setActiveIdx(i); setEditingLabel(i); }}
          style={{
            fontSize: 12.5,
            fontFamily: 'Inter, sans-serif',
            fontWeight: i === activeIdx ? 550 : 400,
            color: i === activeIdx ? t.ink : t.muted,
            padding: layout === 'vertical' ? '9px 4px' : '8px 0',
            userSelect: 'none',
            flex: layout === 'vertical' ? 1 : undefined,
            whiteSpace: 'nowrap',
          }}
        >
          {tab.label}
        </span>
      )}

      {tabs.length > 1 && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); removeTab(i); }}
          title="Remove tab"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: t.faint, display: 'flex', alignItems: 'center',
            padding: 2, borderRadius: 3,
            opacity: i === activeIdx ? 1 : 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = t.muted)}
          onMouseLeave={e => (e.currentTarget.style.color = t.faint)}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );

  // ── Vertical layout ──────────────────────────────────────────────────────────

  if (layout === 'vertical') {
    return (
      <div data-rich-block="true" style={{
        border: `0.5px solid ${t.hair}`,
        borderRadius: 8,
        overflow: 'hidden',
        margin: '8px 0',
        background: t.bgRaised,
        display: 'flex',
        flexDirection: 'row',
      }}>
        {/* Left tab list */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          borderRight: `0.5px solid ${t.hair}`,
          background: t.bgSunken,
          minWidth: 130,
          flexShrink: 0,
          overflowY: 'auto',
        }}>
          {/* Layout toggle — top of list */}
          <button
            type="button"
            onClick={toggleLayout}
            title="Switch to horizontal tabs"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: t.muted, display: 'flex', alignItems: 'center',
              padding: '8px 12px', flexShrink: 0,
              borderLeft: '2px solid transparent',
            }}
          >
            <LayoutPanelTop size={13} />
          </button>

          <div style={{ height: '0.5px', background: t.hair, margin: '0 8px' }} />

          {tabs.map(renderTabItem)}

          {/* Add tab */}
          <button
            type="button"
            onClick={addTab}
            title="Add tab"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: t.muted, display: 'flex', alignItems: 'center',
              padding: '8px 12px', borderLeft: '2px solid transparent',
            }}
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Nested MDXEditor for active tab */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <MDXEditor
            key={activeIdx}
            markdown={active.content}
            onChange={md => handleContentChange(activeIdx, md)}
            plugins={innerPlugins}
            className={t.name === 'dark' ? 'dark-theme' : ''}
          />
        </div>
      </div>
    );
  }

  // ── Horizontal layout (default) ──────────────────────────────────────────────

  return (
    <div style={{
      border: `0.5px solid ${t.hair}`,
      borderRadius: 8,
      overflow: 'hidden',
      margin: '8px 0',
      background: t.bgRaised,
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        borderBottom: `0.5px solid ${t.hair}`,
        background: t.bgSunken,
        overflowX: 'auto',
        gap: 0,
      }}>
        {tabs.map(renderTabItem)}

        {/* Add tab */}
        <button
          type="button"
          onClick={addTab}
          title="Add tab"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: t.muted, display: 'flex', alignItems: 'center',
            padding: '0 10px', borderBottom: '2px solid transparent',
          }}
        >
          <Plus size={13} />
        </button>

        {/* Layout toggle — right end of tab bar */}
        <button
          type="button"
          onClick={toggleLayout}
          title="Switch to vertical tabs"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: t.faint, display: 'flex', alignItems: 'center',
            padding: '0 10px', marginLeft: 'auto',
            borderBottom: '2px solid transparent',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = t.muted)}
          onMouseLeave={e => (e.currentTarget.style.color = t.faint)}
        >
          <LayoutPanelLeft size={13} />
        </button>
      </div>

      {/* Nested MDXEditor for active tab */}
      <MDXEditor
        key={activeIdx}
        markdown={active.content}
        onChange={md => handleContentChange(activeIdx, md)}
        plugins={innerPlugins}
        className={t.name === 'dark' ? 'dark-theme' : ''}
      />
    </div>
  );
}

// ── Descriptor ────────────────────────────────────────────────────────────────

export const tabViewCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'tabs',
  priority: 100,
  Editor: TabViewEditor,
};
