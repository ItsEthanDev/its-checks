export function ambiguous(text: string, count: number, object: object | undefined): boolean {
  if (text) {
    return true;
  }
  if (count) {
    return true;
  }
  if (object) {
    return true;
  }
  return false;
}
export function missingCase(value: 'a' | 'b'): number {
  switch (value) {
    case 'a':
      return 1;
  }
  return 0;
}
export function missingFallback(value: string): number {
  switch (value) {
    case 'a':
      return 1;
  }
  return 0;
}
export function mixed(value: number): string {
  return 'count: ' + value;
}
export function implicitString(value: boolean | null): string {
  return `value: ${value}`;
}
