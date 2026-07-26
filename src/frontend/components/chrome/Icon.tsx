/** Curry Leaves's icon set — 24×24, stroke 1.5, round caps. Ported from the old app so
 *  the chrome matches one-to-one. Add glyphs here as needed. */
interface IconProps {
  name: string;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 16, color = 'currentColor' }: IconProps) {
  const p = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: color, strokeWidth: 1.5, strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'mic':      return <svg {...p}><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>;
    case 'chat':     return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
    case 'library':  return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/></svg>;
    case 'sparkle':  return <svg {...p}><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5zM19 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/></svg>;
    case 'theme':    return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill={color} stroke="none"/></svg>;
    case 'keyboard': return <svg {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>;
    case 'settings': return <svg {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>;
    case 'search':   return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>;
    case 'bell':     return <svg {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
    case 'pause':    return <svg {...p}><rect x="7" y="5" width="3" height="14"/><rect x="14" y="5" width="3" height="14"/></svg>;
    case 'play':     return <svg {...p}><path d="M7 5l12 7-12 7z"/></svg>;
    case 'stop':     return <svg {...p}><rect x="6" y="6" width="12" height="12" rx="1" fill={color} stroke="none"/></svg>;
    case 'send':     return <svg {...p}><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>;
    case 'check':    return <svg {...p}><path d="M5 13l4 4L19 7"/></svg>;
    case 'copy':     return <svg {...p}><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
    case 'chevR':    return <svg {...p}><path d="M9 6l6 6-6 6"/></svg>;
    case 'chevD':    return <svg {...p}><path d="M6 9l6 6 6-6"/></svg>;
    case 'arrowR':   return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
    case 'wave':     return <svg {...p}><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>;
    case 'plus':     return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case 'trash':    return <svg {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>;
    case 'x':        return <svg {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case 'zap':      return <svg {...p}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>;
    case 'edit':     return <svg {...p}><path d="M16 3l5 5-11 11H5v-5L16 3z"/></svg>;
    case 'refresh':  return <svg {...p}><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/></svg>;
    case 'chart':    return <svg {...p}><path d="M3 3v18h18M8 17v-5M13 17V8M18 17v-9"/></svg>;
    case 'paperclip':return <svg {...p}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
    case 'file':     return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>;
    case 'lock':     return <svg {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>;
    case 'warning':  return <svg {...p}><path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.01"/></svg>;
    case 'grid':     return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case 'grip':     return <svg {...p}><path d="M17 17l4 4M21 17l-4 4"/></svg>;
    case 'more':     return <svg {...p}><circle cx="12" cy="5" r="1.4" fill={color} stroke="none"/><circle cx="12" cy="12" r="1.4" fill={color} stroke="none"/><circle cx="12" cy="19" r="1.4" fill={color} stroke="none"/></svg>;
    case 'globe':    return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>;
    case 'history':  return <svg {...p}><path d="M3 12a9 9 0 1 0 3-6.71"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>;
    case 'ear':      return <svg {...p}><path d="M8 13a5 5 0 0 1 5-9 6 6 0 0 1 6 6c0 4-3 4-3 8a3 3 0 0 1-6 0v-1"/><path d="M8 13a3 3 0 0 0 3 3"/></svg>;
    case 'headphones': return <svg {...p}><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/></svg>;
    case 'speaker':  return <svg {...p}><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a4 4 0 0 1 0 7M18.5 6a7 7 0 0 1 0 12"/></svg>;
    case 'user':     return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>;
    case 'brain':    return <svg {...p}><path d="M9.5 3a3.5 3.5 0 0 0-3.5 3.5v.55A3 3 0 0 0 4 9.5a3 3 0 0 0 .3 5.3A3.5 3.5 0 0 0 7 20h1.5a1.5 1.5 0 0 0 1.5-1.5v-12A3 3 0 0 0 9.5 3z"/><path d="M14.5 3a3.5 3.5 0 0 1 3.5 3.5v.55A3 3 0 0 1 20 9.5a3 3 0 0 1-.3 5.3A3.5 3.5 0 0 1 17 20h-1.5A1.5 1.5 0 0 1 14 18.5v-12A3 3 0 0 1 14.5 3z"/><path d="M6.5 9.5H9M6.7 14.8H9M15 9.5h2.5M15 14.8h2.5M9.5 6.7v11.8M14.5 6.7v11.8"/></svg>;
    case 'leaf':     return <svg {...p}><path d="M5 21C5 12 11 5 20 4c0 9-7 15-16 16z"/><path d="M6 20c3-4 6-7 11-11"/></svg>;
    case 'steps':    return <svg {...p}><path d="M4 6h4M4 12h4M4 18h4"/><rect x="10" y="4.5" width="10" height="3" rx="1"/><rect x="10" y="10.5" width="10" height="3" rx="1"/><rect x="10" y="16.5" width="10" height="3" rx="1"/></svg>;
    case 'server':   return <svg {...p}><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>;
    case 'slides':   return <svg {...p}><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M9 17v4M15 17v4M7 8h6M7 11.5h4"/></svg>;
    case 'download': return <svg {...p}><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>;
    case 'link':     return <svg {...p}><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.36-1.36"/></svg>;
    case 'fork':     return <svg {...p}><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7"/><path d="M6 8.5a6 6 0 0 0 6 5.5h1.5"/><path d="M18 11.5V13"/></svg>;
    case 'bot':      return <svg {...p}><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1.4" fill={color} stroke="none"/><circle cx="9" cy="14" r="1.4" fill={color} stroke="none"/><circle cx="15" cy="14" r="1.4" fill={color} stroke="none"/><path d="M9 18h6"/><path d="M2 12v3M22 12v3"/></svg>;
    case 'artifact': return <svg {...p}><path d="M9.5 14V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1z"/><path d="M3 19V9a1 1 0 0 1 1-1h3v9.5A1.5 1.5 0 0 0 8.5 19H3z"/></svg>;
    default:         return null;
  }
}
