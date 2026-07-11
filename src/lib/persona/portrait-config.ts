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
  /** eye band: x, y, w, h in % of the image */
  eyes: { x: 22, y: 34, w: 56, h: 14 },
  /** mouth region */
  mouth: { x: 34, y: 58, w: 32, h: 16 },
} as const
