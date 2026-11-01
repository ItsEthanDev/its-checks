export interface Named {
  readonly name: string;
}

export function readName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Expected a name');
  }
  return value;
}

export function present(text: string, count: number, value: Named | undefined): boolean {
  return text !== '' && count > 0 && value !== undefined;
}

export function label(value: 'ready' | 'waiting'): string {
  switch (value) {
    case 'ready':
      return 'Ready';
    case 'waiting':
      return 'Waiting';
    default:
      throw new Error('Unknown status');
  }
}

export function openLabel(value: string): string {
  switch (value) {
    case 'ready':
      return 'Ready';
    default:
      return 'Unknown';
  }
}

export async function forward(value: Promise<number>): Promise<number> {
  return await value;
}

export async function recover(value: Promise<number>): Promise<number> {
  return await value.catch((error: unknown): number => {
    if (error instanceof Error) {
      throw new Error('Unable to read value', { cause: error });
    }
    return 0;
  });
}

export function describe(value: boolean | null, count: number): string {
  return `value: ${String(value)}, count: ${count}`;
}

export function collect(values: readonly number[]): number[] {
  const result: number[] = [];
  for (const value of values) {
    result.push(value);
  }
  return result;
}

export function rename(value: Named, name: string): Named {
  return { ...value, name };
}

export function increment(value: number): number {
  const next = value + 1;
  return next;
}

// Explained, rule-specific exceptions remain possible.
// oxlint-disable-next-line no-debugger -- Demonstrate an intentional debugging breakpoint.
debugger;
