export async function forward(): Promise<number> {
  return Promise.resolve(1);
}
void Promise.resolve(1);
const thenable: PromiseLike<number> = Promise.resolve(1);
thenable;
[1, 2].forEach(async (value) => {
  await Promise.resolve(value);
});
export function fail(): never {
  throw 'failure';
}
void Promise.reject('failure');
Promise.resolve(1).catch((error) => {
  return error;
});
