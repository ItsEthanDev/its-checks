import { first } from './cycle-a.js';

export function second(value: number): number {
  return first(value);
}
