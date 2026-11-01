export function collect(values: number[]): number[] {
  return values.reduce<number[]>((accumulator, value) => [...accumulator, value], []);
}
export function annotate(): { value: number; active: boolean }[] {
  const values = [{ value: 1 }, { value: 2 }];
  return values.map((value) => ({ ...value, active: true }));
}
