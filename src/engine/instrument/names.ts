/** Generated identifier names (kept free of Babel imports so the runner worker stays tiny). */
export const PREFIX = '__as_';
export const TRACER = `${PREFIX}t`;
export const SELF = `${PREFIX}self`;
export const handleName = (fnId: number) => `${PREFIX}c${fnId}`;
export const loopName = (loopId: number) => `${PREFIX}L${loopId}`;
