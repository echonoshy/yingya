import { describe, expect, it } from "vitest";
import { clampPanelWidth } from "./panelLayout";
describe("editor panel width", () => {
  it("keeps space for the canvas when a saved desktop width meets a narrower window", () => {
    expect(clampPanelWidth(760,1024)).toBe(592);
    expect(clampPanelWidth(760,800)).toBe(368);
    expect(clampPanelWidth(760,1920)).toBe(760);
  });
  it("bounds invalid and extreme preferences",()=>{
    expect(clampPanelWidth(-30,1440)).toBe(280);
    expect(clampPanelWidth(Number.NaN,1440)).toBe(440);
    expect(clampPanelWidth(2000,1440)).toBe(760);
  });
});
