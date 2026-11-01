import { second } from './cycle-b.js';

export function first(value: number): number {
  return second(value);
}
