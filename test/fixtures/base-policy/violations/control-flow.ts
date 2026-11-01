export function loose(value: string | number): boolean {
  if (value == 1) return true;
  return false;
}
export function mutate(value: number): number {
  return (value = 2);
}
export function sequence(left: number, right: number): number {
  return (left, right);
}
export function discard(values: number[]): number[] {
  return values.map((value) => {
    if (value > 0) {
      return value;
    }
  });
}
export let mutable = 1;
export function increment(): void {
  mutable += 1;
}
