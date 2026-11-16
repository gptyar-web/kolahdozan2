const paths={
 home:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4m-3-12a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 message:'<path d="M21 11a8 8 0 0 1-8 8H6l-3 2v-9a8 8 0 0 1 8-8h2a8 8 0 0 1 8 7Z"/><path d="M8 10h8m-8 4h5"/>',
 report:'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
 shield:'<path d="M12 22s7-3 7-10V5l-7-3-7 3v7c0 7 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 5h2m4 0h2"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.1a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1h-.1a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1.1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.1Z"/>',
 logout:'<path d="M10 17l5-5-5-5m5 5H3m9-8h8v16h-8"/>',
 left:'<path d="m15 5-7 7 7 7"/>',right:'<path d="m9 5 7 7-7 7"/>',down:'<path d="m5 9 7 7 7-7"/>',
 plus:'<path d="M12 5v14M5 12h14"/>', plusUser:'<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2m3-13v6m-3-3h6"/>',
 print:'<path d="M6 9V3h12v6M6 17H3v-7h18v7h-3"/><path d="M6 14h12v7H6zm11-2h1"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
 list:'<path d="M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 16-5-5-7 10"/>',
 upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>',
 key:'<circle cx="8" cy="10" r="4"/><path d="m11 13 7 7 3-3-2-2-2 2m-4-2 2-2"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 cap:'<path d="m2 9 10-5 10 5-10 5zM6 11v6a12 12 0 0 0 12 0v-6m4-2v6"/>',
 sparkle:'<path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8z"/>',
 check:'<path d="m4 12 5 5L20 6"/>',
 refresh:'<path d="M20 7v5h-5m5 0a8 8 0 1 0-2 5"/>',
 file:'<path d="M6 3h8l4 4v14H6zM14 3v5h4"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01"/>'
};
export function icon(name){
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[name]??paths.help)+'</svg>';
}
