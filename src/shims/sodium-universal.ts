export function sodium_memzero(value: Uint8Array | ArrayBuffer | Buffer): void {
  if (value instanceof ArrayBuffer) {
    new Uint8Array(value).fill(0);
    return;
  }
  value.fill(0);
}
