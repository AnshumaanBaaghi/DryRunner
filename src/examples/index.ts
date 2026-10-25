import { BASIC_EXAMPLES } from './basics';
import { STRUCTURE_EXAMPLES } from './structures';
import type { Example } from './types';

export type { Example, VizId } from './types';

export const EXAMPLES: Example[] = [...BASIC_EXAMPLES, ...STRUCTURE_EXAMPLES];

export const CATEGORIES: string[] = [...new Set(EXAMPLES.map((e) => e.category))];

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

export const DEFAULT_EXAMPLE_ID = 'loop-sum';
