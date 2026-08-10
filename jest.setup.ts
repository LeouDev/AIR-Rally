import "@testing-library/jest-dom";
import { TextEncoder, TextDecoder } from "node:util";

// jsdom doesn't expose these globally, but Next's server internals (e.g.
// next/cache, pulled in transitively by any "use server" action file) need
// them at import time.
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = TextEncoder as unknown as typeof globalThis.TextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
  globalThis.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;
}
