import { Buffer } from "buffer";

const globalWithBuffer = globalThis as unknown as {
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
  process?: unknown;
};

globalWithBuffer.global ??= globalThis;
globalWithBuffer.Buffer ??= Buffer;
if (!globalWithBuffer.process || typeof globalWithBuffer.process !== "object") {
  globalWithBuffer.process = { browser: true, env: {} };
} else {
  const processShim = globalWithBuffer.process as { browser?: boolean; env?: Record<string, string | undefined> };
  processShim.browser ??= true;
  processShim.env ??= {};
}
