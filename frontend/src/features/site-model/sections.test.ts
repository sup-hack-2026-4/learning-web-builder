import { describe, expect, it } from "vitest";
import {
  addSectionBlockReason,
  createSection,
  maxSections,
  minSections,
  nextSectionId,
  removeSectionBlockReason,
} from "./sections";
import { sectionSchema } from "./schema";
import { createSampleSite } from "./sample";

describe("セクションidの採番", () => {
  it("その種類がまだ無ければ種類名をそのまま使う", () => {
    expect(nextSectionId("gallery", ["hero", "about"])).toBe("gallery");
  });

  it("すでにある種類は連番で避ける", () => {
    // サーバー側の site.Validate がid重複を弾くため、ここで衝突させてはいけない。
    expect(nextSectionId("about", ["hero", "about"])).toBe("about-2");
    expect(nextSectionId("about", ["hero", "about", "about-2"])).toBe("about-3");
  });

  it("連番の途中が空いていればそこを埋める", () => {
    expect(nextSectionId("about", ["about", "about-3"])).toBe("about-2");
  });
});

describe("追加するセクション", () => {
  it("スキーマを満たす1件を作る", () => {
    const section = createSection("gallery", ["hero"]);

    expect(() => sectionSchema.parse(section)).not.toThrow();
    expect(section.kind).toBe("gallery");
    // 追加したのに見えないと、何が起きたのか分からない。
    expect(section.visible).toBe(true);
  });

  it("altは空のままにする", () => {
    // 代替テキストを書くこと自体が品質チェックの対象。
    // それらしい説明を先に埋めると、その学習の機会が消える。
    expect(createSection("about", []).imageAlt).toBe("");
  });
});

describe("追加・削除の上限と下限", () => {
  it("8件に達したら追加できない", () => {
    expect(addSectionBlockReason(maxSections - 1)).toBeNull();
    expect(addSectionBlockReason(maxSections)).toContain(`${maxSections}件`);
  });

  it("2件になったら削除できない", () => {
    expect(removeSectionBlockReason(minSections + 1)).toBeNull();
    expect(removeSectionBlockReason(minSections)).toContain(`${minSections}件`);
  });

  it("初期サンプルはどちらの操作もできる", () => {
    const count = createSampleSite().sections.length;

    expect(addSectionBlockReason(count)).toBeNull();
    expect(removeSectionBlockReason(count)).toBeNull();
  });
});
