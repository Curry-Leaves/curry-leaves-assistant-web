import type { KnowledgeNote } from '../../types';

// Split YAML frontmatter from the markdown body (mirrors the backend parser).
export function splitFrontmatter(text: string): { fm: string; body: string } {
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) return { fm: text.slice(3, end).trim(), body: text.slice(end + 4).replace(/^\n+/, '') };
  }
  return { fm: '', body: text };
}

// Pull tags out of the frontmatter for display chips (inline `[a, b]` or `- a` list forms).
export function parseTags(fm: string): string[] {
  const inline = fm.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline) return inline[1].split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const block = fm.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
  if (block) return block[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  return [];
}

// ── tree model ─────────────────────────────────────────────────────────────────
// Our KB is a flat OKF bundle, so the sidebar tree is derived from note paths:
// folder segments become branch nodes, the note itself is a leaf.
export type TreeNode = {
  id: string;                 // folder prefix, or the note path for leaves
  name: string;
  kind: 'folder' | 'note';
  path?: string;              // leaves only
  type?: string | null;      // leaves only
  children: TreeNode[];
};

// `dirs` are bundle-relative folder paths from the API — passing them in lets empty,
// user-created folders appear in the tree even before any note lives inside them.
export function buildTree(notes: KnowledgeNote[], dirs: string[] = []): TreeNode {
  const root: TreeNode = { id: '', name: 'Knowledge', kind: 'folder', children: [] };
  const folders = new Map<string, TreeNode>([['', root]]);
  const folderAt = (prefix: string, name: string, parent: TreeNode) => {
    let node = folders.get(prefix);
    if (!node) { node = { id: prefix, name, kind: 'folder', children: [] }; folders.set(prefix, node); parent.children.push(node); }
    return node;
  };
  // Materialize every known folder first (each segment of every dir path), so an empty
  // folder is a real branch node with nothing under it.
  const ensureDir = (dirPath: string) => {
    let parent = root, prefix = '';
    for (const seg of dirPath.split('/')) {
      if (!seg) continue;
      prefix = prefix ? `${prefix}/${seg}` : seg;
      parent = folderAt(prefix, seg, parent);
    }
  };
  for (const d of dirs) ensureDir(d);
  for (const n of notes) {
    const parts = n.path.split('/');
    const file = parts.pop()!;
    let parent = root, prefix = '';
    for (const seg of parts) { prefix = prefix ? `${prefix}/${seg}` : seg; parent = folderAt(prefix, seg, parent); }
    parent.children.push({ id: n.path, name: n.title || file.replace(/\.md$/, ''), kind: 'note', path: n.path, type: n.type, children: [] });
  }
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)));
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

export const countNotes = (node: TreeNode): number =>
  node.kind === 'note' ? 1 : node.children.reduce((s, c) => s + countNotes(c), 0);
