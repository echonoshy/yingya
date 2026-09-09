import { afterEach, expect, it, vi } from "vitest";
import { SESSION_EXPIRED, sessionFetch, setCurrentUser } from "./session";

afterEach(() => { setCurrentUser(""); vi.unstubAllGlobals(); });

it("notifies once on 401 and ignores a late 401 from an earlier login", async () => {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  const expired = vi.fn(); target.addEventListener(SESSION_EXPIRED, expired);
  let release!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; })).mockResolvedValue(new Response(null, { status: 401 })));
  setCurrentUser("a");
  const late = sessionFetch("/old").catch(reason => reason);
  expect((await sessionFetch("/current")).status).toBe(401);
  expect(expired).toHaveBeenCalledTimes(1);
  setCurrentUser("b");
  release(new Response(null, { status: 401 }));
  expect(await late).toMatchObject({ name: "AbortError" });
  expect(expired).toHaveBeenCalledTimes(1);
});

it("keeps service failures distinct from login expiry", async () => {
  const target = new EventTarget(); vi.stubGlobal("window", target);
  const expired = vi.fn(); target.addEventListener(SESSION_EXPIRED, expired);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  setCurrentUser("a");
  expect((await sessionFetch("/project")).status).toBe(503);
  expect(expired).not.toHaveBeenCalled();
});
