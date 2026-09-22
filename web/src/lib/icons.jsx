import React, { useState } from 'react';

/**
 * Bookmark icon resolution:
 *  - "https://…"  → that image
 *  - "plex", "sonarr"… → colored logo from the dashboard-icons set (same one Homarr/Homepage use)
 *  - anything else (emoji, single letter) → rendered as text
 */
const DASHBOARD_ICONS = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg';

export function ServiceIcon({ icon, title, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const isUrl = /^https?:\/\//.test(icon || '');
  const isSlug = /^[a-z0-9-]+$/.test(icon || '');
  if (icon && !failed && (isUrl || isSlug)) {
    const src = isUrl ? icon : `${DASHBOARD_ICONS}/${icon}.svg`;
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    );
  }
  const text = icon || (title || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="icon-fallback" style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {text}
    </span>
  );
}

const paths = {
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L14.8 3H9.2l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L4.7 11a7.4 7.4 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h5.6l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1Z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-3h6v6m-11 5L21 3',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  image: 'M21 15l-5-5L5 21M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm5 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  up: 'm18 15-6-6-6 6',
  down: 'm6 9 6 6 6-6',
  expand: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3',
  shrink: 'M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3',
  sound: 'M11 5 6 9H2v6h4l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14',
  muted: 'M11 5 6 9H2v6h4l5 4V5Zm12 4-6 6m0-6 6 6',
  play: 'M6 4l14 8-14 8V4Z',
  stop: 'M6 6h12v12H6z',
  logs: 'M4 5h16M4 12h10M4 19h16',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9m-4.3 13a2 2 0 0 1-3.4 0',
  search: 'M21 21l-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z',
  warn: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
};

export function Icon({ name, size = 18, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
