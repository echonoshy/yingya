import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientRequestId } from "./requestId";

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("createClientRequestId", () => {
  it("creates a UUID v4 in the normal browser environment", () => {
    expect(createClientRequestId()).toMatch(uuidV4);
  });

  it("uses getRandomValues when randomUUID is unavailable on HTTP", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(1) });
    expect(createClientRequestId()).toBe("01010101-0101-4101-8101-010101010101");
  });
});
