// Court geometry of the tactical map (SVG units). Positions are stored as fractions of the playing area.
export const COURT = { w: 400, h: 600, x0: 26, y0: 34, x1: 374, y1: 566 };
export const toCourt = (fx: number, fy: number) => ({ x: COURT.x0 + fx * (COURT.x1 - COURT.x0), y: COURT.y0 + fy * (COURT.y1 - COURT.y0) });
export const fromCourt = (x: number, y: number) => ({ fx: (x - COURT.x0) / (COURT.x1 - COURT.x0), fy: (y - COURT.y0) / (COURT.y1 - COURT.y0) });
