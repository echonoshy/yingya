import { afterEach, expect, it, vi } from "vitest";
import { newCreationAttempt, readCreationAttempt, saveCreationAttempt } from "./creationAttempt";

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
}
afterEach(() => vi.unstubAllGlobals());

it("recovers the same request IDs before acceptance and the completed stage afterwards", () => {
  storage();
  const attempt = newCreationAttempt("brief");
  saveCreationAttempt("user-a", attempt);
  expect(readCreationAttempt("user-a")).toEqual(attempt);
  attempt.projectId = "project-a";
  attempt.uploadedPaths = { reference: "assets/reference.png" };
  attempt.accepted = true;
  saveCreationAttempt("user-a", attempt);
  expect(readCreationAttempt("user-a")).toEqual(attempt);
  expect(readCreationAttempt("user-b")).toBeNull();
  saveCreationAttempt("user-a", null);
  expect(readCreationAttempt("user-a")).toBeNull();
});

it("rejects malformed persistence and reports unavailable storage before a request", () => {
  storage();
  localStorage.setItem("attempt", '{"accepted":true}');
  expect(readCreationAttempt("attempt")).toBeNull();
  vi.stubGlobal("localStorage", { setItem() { throw new Error("quota"); } });
  expect(() => saveCreationAttempt("attempt", newCreationAttempt("brief"))).toThrow("无法保存提交进度");
});
