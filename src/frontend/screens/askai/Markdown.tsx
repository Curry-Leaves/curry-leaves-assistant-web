// Chat's markdown renderer is the shared one (components/Markdown.tsx) — this
// module used to hold a richer fork of it; that styling now lives in the shared
// component so chat, knowledge notes, and dashboard tiles all render identically.
// Kept as a re-export so chat-local imports (`./Markdown`) stay stable.
export { Markdown } from '../../components/Markdown';
