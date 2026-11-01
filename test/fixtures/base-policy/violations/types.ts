export const unchecked: any = JSON.parse('{}');
export const copied = unchecked;
export const member = unchecked.value;
unchecked();
export function leak(): string {
  return unchecked;
}
export function consume(value: string): string {
  return value;
}
consume(unchecked);
export function assume(value: string | undefined): string {
  return value!;
}
export function implicitBoundary() {
  return 1;
}
// @ts-ignore
export const ignored: string = 1;
