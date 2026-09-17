import { describe, expect, it } from "vitest";
import { createSampleSite } from "./sample";
import {
  MAX_IMAGE_BASE64_BYTES,
  MAX_IMAGE_COUNT,
  MAX_TOTAL_IMAGE_BASE64_BYTES,
  siteModelSchema,
} from "./schema";

describe("siteModelSchema", () => {
  it("サンプルサイトを正常に検証できる", () => {
    expect(() => siteModelSchema.parse(createSampleSite())).not.toThrow();
  });

  it("不正なカラーコードを拒否する", () => {
    const site = createSampleSite();
    site.theme.primary = "blue";
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("セクションが2件未満だと拒否する", () => {
    const site = createSampleSite();
    site.sections = site.sections.slice(0, 1);
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("セクションが8件を超えると拒否する", () => {
    const site = createSampleSite();
    const extra = site.sections[0];
    site.sections = Array.from({ length: 9 }, (_, index) => ({ ...extra, id: `${extra.id}-${index}` }));
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("不明なsection.kindを拒否する", () => {
    const site = createSampleSite();
    // @ts-expect-error 意図的に不正な値を渡す
    site.sections[0].kind = "unknown";
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("上限を超えるtitleを拒否する", () => {
    const site = createSampleSite();
    site.sections[0].title = "あ".repeat(81);
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("空のtopicを拒否する", () => {
    const site = createSampleSite();
    site.topic = "";
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("サロゲートペア文字はコードポイント数で判定する(UTF-16長ではない)", () => {
    // 😀はUTF-16では2コード単位だが、コードポイントとしては1文字。
    // 51文字(コードポイント)はtopicの上限100以内だが、UTF-16長では102になり誤って拒否されうる。
    const site = createSampleSite();
    site.topic = "😀".repeat(51);
    expect(() => siteModelSchema.parse(site)).not.toThrow();

    site.siteTitle = "😀".repeat(41); // コードポイント41 <= 80、UTF-16長は82
    expect(() => siteModelSchema.parse(site)).not.toThrow();

    site.sections[0].title = "😀".repeat(41); // コードポイント41 <= 80
    expect(() => siteModelSchema.parse(site)).not.toThrow();
  });

  it("コードポイント数が上限を超えるtopicは拒否する", () => {
    const site = createSampleSite();
    site.topic = "😀".repeat(101); // コードポイント101 > 100
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("theme.headingは任意。バックエンドが返さないJSONも受け入れる", () => {
    // バックエンド/Geminiはheadingを返さない。必須にすると生成結果が全て弾かれるため任意にしている。
    const site = createSampleSite();
    expect(site.theme.heading).toBeUndefined();
    expect(() => siteModelSchema.parse(site)).not.toThrow();
  });

  it("theme.headingを指定した場合はカラーコードとして検証する", () => {
    const site = createSampleSite();
    expect(() => siteModelSchema.parse({ ...site, theme: { ...site.theme, heading: "#b91c1c" } })).not.toThrow();
    expect(() => siteModelSchema.parse({ ...site, theme: { ...site.theme, heading: "red" } })).toThrow();
  });
});

describe("セクションの画像", () => {
  const image = { dataUri: "data:image/jpeg;base64,/9j/4AAQ", fileName: "about.jpg" };

  function withImages(count: number, base64Bytes: number) {
    const site = createSampleSite();
    const base = site.sections[0];
    site.sections = Array.from({ length: Math.max(count, 2) }, (_, index) => ({
      ...base,
      id: `s${index}`,
      image:
        index < count
          ? { dataUri: `data:image/jpeg;base64,${"A".repeat(base64Bytes)}`, fileName: `s${index}.jpg` }
          : undefined,
    }));
    return site;
  }

  it("画像を持たないモデルを受け付ける", () => {
    // 保存済みの古いプロジェクトはこの項目を持たない。必須にすると復元できなくなる。
    expect(() => siteModelSchema.parse(createSampleSite())).not.toThrow();
  });

  it("JPEGのデータURIを受け付ける", () => {
    const site = createSampleSite();
    site.sections[1].image = image;
    expect(() => siteModelSchema.parse(site)).not.toThrow();
  });

  it("JPEG以外のデータURIを拒否する", () => {
    const site = createSampleSite();
    site.sections[1].image = { ...image, dataUri: "data:image/png;base64,iVBORw0KGgo=" };
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("外部URLを拒否する", () => {
    const site = createSampleSite();
    site.sections[1].image = { ...image, dataUri: "https://example.com/photo.jpg" };
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("ZIPのパスとして危険なファイル名を拒否する", () => {
    const site = createSampleSite();
    site.sections[1].image = { ...image, fileName: "../about.jpg" };
    expect(() => siteModelSchema.parse(site)).toThrow();
  });

  it("画像1枚が上限を超えると拒否する", () => {
    expect(() => siteModelSchema.parse(withImages(1, MAX_IMAGE_BASE64_BYTES + 4))).toThrow();
  });

  it("枚数が上限を超えると拒否する", () => {
    expect(() => siteModelSchema.parse(withImages(MAX_IMAGE_COUNT + 1, 100))).toThrow();
  });

  it("合計が上限を超えると拒否する", () => {
    // 1枚ずつは上限内でも、合計では超える組み合わせを弾けることを確かめる。
    // 上限いっぱいの画像を枚数の上限まで並べると、合計だけが超える。
    expect(MAX_IMAGE_COUNT * MAX_IMAGE_BASE64_BYTES).toBeGreaterThan(MAX_TOTAL_IMAGE_BASE64_BYTES);
    expect(() => siteModelSchema.parse(withImages(MAX_IMAGE_COUNT, MAX_IMAGE_BASE64_BYTES))).toThrow();
  });

  it("ファイル名の重複を拒否する", () => {
    const site = createSampleSite();
    site.sections[1].image = { ...image, fileName: "photo.jpg" };
    site.sections[2].image = { ...image, fileName: "photo.jpg" };
    expect(() => siteModelSchema.parse(site)).toThrow();
  });
});
