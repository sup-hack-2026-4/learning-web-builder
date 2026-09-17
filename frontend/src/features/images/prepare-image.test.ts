import { describe, expect, it } from "vitest";
import {
  imageAddBlockReason,
  imageSourceBlockReason,
  imageTotalBlockReason,
  maxSourceBytes,
  sectionImageFileName,
} from "./prepare-image";
import { MAX_IMAGE_COUNT, MAX_TOTAL_IMAGE_BASE64_BYTES, type SiteSection } from "../site-model/schema";

function section(values: Partial<SiteSection> & Pick<SiteSection, "id">): SiteSection {
  return {
    kind: "about",
    title: "見出し",
    body: "本文",
    imageAlt: "",
    visible: true,
    ...values,
  };
}

function imageOfBytes(fileName: string, base64Bytes: number) {
  return { dataUri: `data:image/jpeg;base64,${"A".repeat(base64Bytes)}`, fileName };
}

function fileOf(type: string, size: number): File {
  const file = new File(["x"], "photo", { type });
  // Fileのsizeは読み取り専用のため、テストでは見かけの大きさだけ差し替える。
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("画像のファイル名", () => {
  it("セクションidをそのまま使う", () => {
    expect(sectionImageFileName("about", [])).toBe("about.jpg");
  });

  it("ZIPのパスとして安全な文字だけに絞る", () => {
    // セクションidはGeminiの生成結果に由来することもあり、日本語や記号が混ざりうる。
    expect(sectionImageFileName("私たちについて", [])).toBe("image.jpg");
    expect(sectionImageFileName("Hero Section!", [])).toBe("hero-section.jpg");
    expect(sectionImageFileName("../../etc/passwd", [])).toBe("etc-passwd.jpg");
  });

  it("すでにある名前は連番で避ける", () => {
    // サーバー側の site.Validate がファイル名の重複を弾くため、ここで衝突させてはいけない。
    expect(sectionImageFileName("about", ["about.jpg"])).toBe("about-2.jpg");
    expect(sectionImageFileName("about", ["about.jpg", "about-2.jpg"])).toBe("about-3.jpg");
  });

  it("長いidは切り詰める", () => {
    const fileName = sectionImageFileName("a".repeat(80), []);
    expect(fileName).toMatch(/^[a-z0-9-]{1,40}\.jpg$/);
  });
});

describe("選べるファイルの判定", () => {
  it("扱える形式なら選べる", () => {
    expect(imageSourceBlockReason(fileOf("image/jpeg", 1024))).toBeNull();
    expect(imageSourceBlockReason(fileOf("image/png", 1024))).toBeNull();
    expect(imageSourceBlockReason(fileOf("image/webp", 1024))).toBeNull();
  });

  it("扱えない形式は理由を返す", () => {
    expect(imageSourceBlockReason(fileOf("image/gif", 1024))).toContain("JPEG");
    expect(imageSourceBlockReason(fileOf("application/pdf", 1024))).toContain("JPEG");
  });

  it("元ファイルが大きすぎるものは縮小する前に断る", () => {
    expect(imageSourceBlockReason(fileOf("image/jpeg", maxSourceBytes + 1))).toContain("MB");
  });
});

describe("画像を追加できるかの判定", () => {
  it("まだ上限に届いていなければ追加できる", () => {
    expect(imageAddBlockReason([section({ id: "about" })], "about")).toBeNull();
  });

  it("基本情報のセクションには置けない", () => {
    const sections = [section({ id: "contact", kind: "contact" })];
    expect(imageAddBlockReason(sections, "contact")).toContain("基本情報");
  });

  it("枚数の上限に達したら理由を返す", () => {
    const sections = Array.from({ length: MAX_IMAGE_COUNT }, (_, index) =>
      section({ id: `s${index}`, image: imageOfBytes(`s${index}.jpg`, 100) }),
    );
    sections.push(section({ id: "new" }));
    expect(imageAddBlockReason(sections, "new")).toContain(`${MAX_IMAGE_COUNT}枚`);
  });

  it("差し替えなら枚数は増えないので上限でも選べる", () => {
    const sections = Array.from({ length: MAX_IMAGE_COUNT }, (_, index) =>
      section({ id: `s${index}`, image: imageOfBytes(`s${index}.jpg`, 100) }),
    );
    expect(imageAddBlockReason(sections, "s0")).toBeNull();
  });
});

describe("合計容量の判定", () => {
  it("合計が上限内なら入れられる", () => {
    const sections = [section({ id: "about", image: imageOfBytes("about.jpg", 1000) })];
    expect(imageTotalBlockReason(sections, "hero", imageOfBytes("hero.jpg", 1000))).toBeNull();
  });

  it("1枚ずつが上限内でも、合計で超えるなら理由を返す", () => {
    const half = Math.floor(MAX_TOTAL_IMAGE_BASE64_BYTES / 2);
    const sections = [
      section({ id: "about", image: imageOfBytes("about.jpg", half) }),
      section({ id: "hero", image: imageOfBytes("hero.jpg", half) }),
    ];
    expect(imageTotalBlockReason(sections, "features", imageOfBytes("features.jpg", 1000))).toContain("合計");
  });

  it("差し替えでは、入れ替わる前の画像を合計に数えない", () => {
    const sections = [
      section({ id: "about", image: imageOfBytes("about.jpg", MAX_TOTAL_IMAGE_BASE64_BYTES - 100) }),
    ];
    expect(imageTotalBlockReason(sections, "about", imageOfBytes("about.jpg", 1000))).toBeNull();
  });
});
