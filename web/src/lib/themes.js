/** Built-in looks. Each sets CSS variables on :root; `accent` is still user-overridable. */
export const THEMES = {
  aurora: {
    name: 'Aurora',
    vars: { '--accent': '#7c5cff', '--accent-2': '#ff5cab', '--accent-3': '#22d3ee', '--bg': '#07080d', '--glass': 'rgba(14, 16, 26, 0.5)', '--glass-strong': 'rgba(11, 13, 21, 0.86)', '--text': '#f2f3f8', '--muted': '#9aa1b5', '--dim': '#626a7e' },
  },
  cyberpunk: {
    name: 'Cyberpunk',
    vars: { '--accent': '#00e5ff', '--accent-2': '#ff2d95', '--accent-3': '#f5ff00', '--bg': '#05060c', '--glass': 'rgba(8, 12, 24, 0.55)', '--glass-strong': 'rgba(6, 9, 18, 0.9)', '--text': '#eafcff', '--muted': '#8fb3c9', '--dim': '#5a7a90' },
  },
  nord: {
    name: 'Nord',
    vars: { '--accent': '#88c0d0', '--accent-2': '#b48ead', '--accent-3': '#a3be8c', '--bg': '#2e3440', '--glass': 'rgba(59, 66, 82, 0.55)', '--glass-strong': 'rgba(46, 52, 64, 0.92)', '--text': '#eceff4', '--muted': '#d8dee9', '--dim': '#8a93a6' },
  },
  catppuccin: {
    name: 'Catppuccin Mocha',
    vars: { '--accent': '#cba6f7', '--accent-2': '#f5c2e7', '--accent-3': '#89dceb', '--bg': '#1e1e2e', '--glass': 'rgba(49, 50, 68, 0.55)', '--glass-strong': 'rgba(30, 30, 46, 0.92)', '--text': '#cdd6f4', '--muted': '#a6adc8', '--dim': '#7f849c' },
  },
  dracula: {
    name: 'Dracula',
    vars: { '--accent': '#bd93f9', '--accent-2': '#ff79c6', '--accent-3': '#8be9fd', '--bg': '#282a36', '--glass': 'rgba(68, 71, 90, 0.5)', '--glass-strong': 'rgba(40, 42, 54, 0.92)', '--text': '#f8f8f2', '--muted': '#bfc2d6', '--dim': '#6272a4' },
  },
  gruvbox: {
    name: 'Gruvbox',
    vars: { '--accent': '#fabd2f', '--accent-2': '#fe8019', '--accent-3': '#8ec07c', '--bg': '#1d2021', '--glass': 'rgba(50, 48, 47, 0.55)', '--glass-strong': 'rgba(29, 32, 33, 0.92)', '--text': '#ebdbb2', '--muted': '#bdae93', '--dim': '#7c6f64' },
  },
  oled: {
    name: 'OLED Black',
    vars: { '--accent': '#7c5cff', '--accent-2': '#ff5cab', '--accent-3': '#22d3ee', '--bg': '#000000', '--glass': 'rgba(8, 8, 10, 0.75)', '--glass-strong': 'rgba(0, 0, 0, 0.94)', '--text': '#f4f4f8', '--muted': '#9a9fb0', '--dim': '#5c6070' },
  },
  light: {
    name: 'Light',
    light: true,
    vars: { '--accent': '#5b3df5', '--accent-2': '#e0389a', '--accent-3': '#0891b2', '--bg': '#eef0f6', '--glass': 'rgba(255, 255, 255, 0.62)', '--glass-strong': 'rgba(255, 255, 255, 0.94)', '--text': '#14161f', '--muted': '#5b6275', '--dim': '#8a90a3', '--border': 'rgba(0, 0, 0, 0.08)', '--border-hover': 'rgba(0, 0, 0, 0.16)', '--bg-elev': 'rgba(0, 0, 0, 0.04)', '--shadow': '0 10px 30px rgba(20, 22, 40, 0.12)' },
  },
};

export const THEME_ORDER = ['aurora', 'cyberpunk', 'nord', 'catppuccin', 'dracula', 'gruvbox', 'oled', 'light'];

const ALL_VARS = ['--accent', '--accent-2', '--accent-3', '--bg', '--glass', '--glass-strong', '--text', '--muted', '--dim', '--border', '--border-hover', '--bg-elev', '--shadow'];

/** Per-theme Liquid Glass defaults: tint strength (%), blur (px). */
const GLASS = {
  aurora: { amount: 14, blur: 28 },
  cyberpunk: { amount: 18, blur: 24 },
  nord: { amount: 12, blur: 30 },
  catppuccin: { amount: 16, blur: 30 },
  dracula: { amount: 16, blur: 28 },
  gruvbox: { amount: 12, blur: 26 },
  oled: { amount: 8, blur: 32 },
  light: { amount: 10, blur: 34 },
};

export function applyTheme(themeId, accentOverride, glass = {}) {
  const t = THEMES[themeId] || THEMES.aurora;
  const r = document.documentElement.style;
  for (const v of ALL_VARS) r.removeProperty(v);
  for (const [k, v] of Object.entries(t.vars)) r.setProperty(k, v);
  if (accentOverride) r.setProperty('--accent', accentOverride);
  document.documentElement.dataset.theme = t.light ? 'light' : 'dark';
  const g = GLASS[themeId] || GLASS.aurora;
  r.setProperty('--lg-tint', glass.tint || accentOverride || t.vars['--accent']);
  r.setProperty('--lg-tint-amt', `${glass.amount ?? g.amount}%`);
  r.setProperty('--lg-blur', `${glass.blur ?? g.blur}px`);
}
export const glassDefaults = (themeId) => GLASS[themeId] || GLASS.aurora;
