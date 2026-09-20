import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { readDraft } from "./useSavedState";

afterEach(() => vi.unstubAllGlobals());

it("distinguishes first use from an explicitly saved free-creation choice", () => {
  const getItem = vi.fn().mockReturnValue(null);
  vi.stubGlobal("localStorage", { getItem });
  const schema = z.enum(["product-intro", "feature-launch", "walkthrough"]).nullable();
  expect(readDraft("workflow", schema, "product-intro")).toBe("product-intro");
  getItem.mockReturnValue("null");
  expect(readDraft("workflow", schema, "product-intro")).toBeNull();
  getItem.mockReturnValue('"walkthrough"');
  expect(readDraft("workflow", schema, "product-intro")).toBe("walkthrough");
  getItem.mockReturnValue('"removed-workflow"');
  expect(readDraft("workflow", schema, "product-intro")).toBe("product-intro");
});
