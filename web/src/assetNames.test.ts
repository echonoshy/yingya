import { describe, expect, it } from "vitest";
import { assetName } from "./assetNames";

describe("asset names", () => {
  it("keeps legacy generated names independent of prompts and preserves explicit names", () => {
    const asset = { id: "ba7d2752-0d67-48d4-a682-ccff991a046a", mimeType: "image/png", projectPath: "assets/generated/ba7d2752-0d67-48d4-a682-ccff991a046a.png", prompt: "A full prompt must stay in the details" };
    expect(assetName(asset)).toBe("image_ba7d2752-0d67-48d4-a682-ccff991a046a.png");
    expect(assetName({ ...asset, sourceName: "品牌主图.png" })).toBe("品牌主图.png");
    expect(assetName({ ...asset, sourceName: "我的原始文件.jpg" })).toBe("我的原始文件.jpg");
    expect(assetName({ ...asset, mimeType: "image/svg+xml" })).toMatch(/\.svg$/);
  });
});
