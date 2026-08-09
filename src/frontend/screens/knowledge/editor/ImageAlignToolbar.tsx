/**
 * The toolbar that floats over a selected image in the note editor: delete, plus alignment.
 *
 * Replaces MDXEditor's built-in EditImageToolbar (which only offers delete, since we disable its
 * settings dialog). Alignment is stored on the node as a `data-align` attribute rather than in a
 * custom Lexical node, because MDXEditor already round-trips unknown attributes through
 * `ImageNode.getRest()` — so the choice survives serialization without us owning a node type.
 *
 * `left` is the natural flow and is written as *no* attribute at all, keeping a left-aligned
 * image byte-identical to one that was never aligned.
 */
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';
import { Icon } from '../../../components/chrome/Icon';
import { t } from '../../../components/aitextspace/theme';
import type { ImageAlign } from '../../../components/noteImages';

// MDXEditor injects every prop through context (it types the slot as `FC<{}>`), so each is
// optional here — that keeps the component assignable to the plugin's `EditImageToolbar` slot
// while still letting us read the ones we need.
interface Props {
  nodeKey?: string;
  imageSource?: string;
  initialImagePath?: string | null;
  title?: string;
  alt?: string;
  width?: number | 'inherit';
  height?: number | 'inherit';
}

// `mdxJsxAttribute` is the shape MDXEditor's image node keeps unknown attributes in.
type RestAttr = { type: 'mdxJsxAttribute'; name: string; value: string };

const OPTIONS: { value: ImageAlign; label: string; glyph: string }[] = [
  { value: 'left', label: 'Align left', glyph: '⭰' },
  { value: 'center', label: 'Align centre', glyph: '⭤' },
  { value: 'right', label: 'Align right', glyph: '⭲' },
];

export function ImageAlignToolbar({ nodeKey }: Props) {
  const [editor] = useLexicalComposerContext();
  // MDXEditor only mounts this over a selected image, so nodeKey is always present in practice;
  // the guard is here to satisfy the optional type without scattering `!` through the callbacks.
  if (!nodeKey) return null;

  const currentAlign = (): ImageAlign => {
    let found: ImageAlign = 'left';
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey) as any;
      const rest: RestAttr[] = node?.getRest?.() ?? [];
      const attr = rest.find((a) => a.name === 'data-align' || a.name === 'align');
      if (attr?.value === 'center' || attr?.value === 'right') found = attr.value;
    });
    return found;
  };
  const active = currentAlign();

  const setAlign = (align: ImageAlign) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey) as any;
      if (!node?.getRest) return;
      const writable = node.getWritable();
      const rest: RestAttr[] = (writable.__rest ?? []).filter(
        (a: RestAttr) => !['data-align', 'align', 'style', 'class', 'className'].includes(a.name),
      );
      if (align !== 'left') {
        // `data-align` is what the markdown round-trip reads (htmlImagesToMarkdown), but
        // MDXEditor's ImageEditor only forwards `class`/`className` to the rendered <img> —
        // every other rest attribute is kept for serialization and never hits the DOM. So we
        // write BOTH: the data attribute for persistence, the class so the editor can show it.
        rest.push({ type: 'mdxJsxAttribute', name: 'data-align', value: align });
        rest.push({ type: 'mdxJsxAttribute', name: 'class', value: `cl-img-${align}` });
      }
      writable.__rest = rest;
    });
  };

  const btn = (label: string, glyph: string, onClick: () => void, isActive: boolean) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={isActive}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 5,
        border: `0.5px solid ${isActive ? t.accent : 'transparent'}`,
        background: isActive ? `color-mix(in oklch, ${t.accent} 14%, transparent)` : 'transparent',
        color: isActive ? t.accentInk : t.inkSoft,
        cursor: 'pointer', fontSize: 13, lineHeight: 1,
      }}
    >
      {glyph}
    </button>
  );

  return (
    // Sits ABOVE the image, not on top of it: a small image (the common case for a resized
    // screenshot) would otherwise be almost entirely hidden behind its own controls.
    <div style={{
      position: 'absolute', bottom: 'calc(100% + 4px)', right: 0, display: 'flex', gap: 2,
      padding: 2, borderRadius: 7, background: t.bgRaised, border: `0.5px solid ${t.hair}`,
      boxShadow: '0 2px 10px rgba(0,0,0,0.18)', zIndex: 2, whiteSpace: 'nowrap',
    }}>
      {OPTIONS.map((o) => btn(o.label, o.glyph, () => setAlign(o.value), active === o.value))}
      <span style={{ width: 1, background: t.hair, margin: '2px 1px' }} />
      <button
        type="button"
        title="Delete image"
        aria-label="Delete image"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.update(() => { $getNodeByKey(nodeKey)?.remove(); });
        }}
        style={{
          display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 5,
          border: '0.5px solid transparent', background: 'transparent', color: t.inkSoft,
          cursor: 'pointer',
        }}
      >
        <Icon name="trash" size={12} color={t.inkSoft} />
      </button>
    </div>
  );
}
