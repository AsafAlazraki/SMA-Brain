/**
 * Design tokens — "The Workshop Bench" (docs/02 §6).
 * CSS is the source of truth (src/index.css @theme); this mirror exists for
 * JS consumers (charts, canvas, dynamic styles). Keep the two in sync.
 */
export const theme = {
  color: {
    iron950: '#0a0d13',
    iron900: '#0e1219',
    steel900: '#121826',
    steel800: '#1a2333',
    steel700: '#263349',
    steel600: '#33445f',
    denim500: '#48679c',
    denim400: '#7c97c9',
    denim300: '#a7bcdf',
    cloth100: '#edf1f8',
    cloth400: '#97a5bc',
    cloth600: '#5c6a81',
    safety500: '#ff6b1a',
    safety400: '#ff8442',
    safety950: '#1f0e03',
    go500: '#59c983',
    stop500: '#e5484d',
  },
  font: {
    display: '"Big Shoulders Variable", "Archivo Variable", sans-serif',
    sans: '"Archivo Variable", system-ui, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, monospace',
  },
} as const
