// Where a card was on Home when it was tapped, so its coin page can lift it from there into place.
export interface Rect { x: number; y: number; w: number; h: number }
let from: Rect | null = null;
export const setLift = (r: Rect | null) => { from = r; };
/** Read once: a later visit to the page must not replay an old tap. */
export const takeLift = (): Rect | null => { const r = from; from = null; return r; };
