/**
 * 2.5D portrait rig configuration. The rig crossfades regions between three
 * variants of the SAME portrait (drop them in public/persona/):
 *   neutral.png     — eyes open, mouth closed, soft smile
 *   eyes-closed.png — identical, eyes closed
 *   mouth-open.png  — identical, mouth open (saying "ah")
 * Region boxes are % of image width/height — tune per portrait until seams
 * disappear (verify visually; regions get a soft mask so edges blend).
 */
export const PORTRAIT = {
  base: '/persona/neutral.png',
  eyesClosed: '/persona/eyes-closed.png',
  mouthOpen: '/persona/mouth-open.png',
  /** eye band (incl. brows): x, y, w, h in % of the image; dx/dy nudge the variant texture */
  eyes: { x: 30, y: 20, w: 40, h: 19, dx: 0, dy: 0 },
  /** mouth region — starts BELOW the eyes (overlap made her eyes bulge while talking) */
  mouth: { x: 41, y: 41, w: 19, h: 13, dx: 0, dy: 0 },
} as const
