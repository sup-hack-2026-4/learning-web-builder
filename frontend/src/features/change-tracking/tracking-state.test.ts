import { describe, expect, it } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import type { SiteModel } from "@/features/site-model/schema";
import { packTracking, restoreTracking, trackingFromSite, type TrackingState } from "./tracking-state";

const image = { dataUri: `data:image/jpeg;base64,${"A".repeat(4000)}`, fileName: "about.jpg" };

function siteWithImage(): SiteModel {
  const site = createSampleSite();
  return { ...site, sections: site.sections.map((section) => (section.id === "about" ? { ...section, image } : section)) };
}

// 保存して読み戻すまでを、JSONを通して再現する。
function roundTrip(tracking: TrackingState, site: SiteModel): TrackingState {
  return restoreTracking(JSON.parse(JSON.stringify(packTracking(tracking, site))), site);
}

describe("変更記録の保存と読み戻し", () => {
  it("記録が無ければ、サイトを基準にした状態から始める", () => {
    const site = createSampleSite();

    expect(restoreTracking(undefined, site)).toEqual(trackingFromSite(site));
  });

  it("基準の画像がサイトと同じなら、画像本体を重ねて保存せず、読み戻すと元に戻る", () => {
    // 理由を1文字書くたびに全体を保存するため、画像が何重にも入ると書き込みが大きくなる。
    const site = siteWithImage();
    const tracking = { ...trackingFromSite(site), reason: "書きかけ" };

    const packed = JSON.stringify(packTracking(tracking, site));

    expect(packed).not.toContain(image.dataUri);
    expect(roundTrip(tracking, site)).toEqual(tracking);
  });

  it("基準だけが持つ画像は、そのまま保存して読み戻せる", () => {
    // 記録前に画像を差し替えた場合、基準には元の画像しか残っていない。
    const baselineSite = siteWithImage();
    const tracking = trackingFromSite(baselineSite);
    const site = { ...baselineSite, sections: baselineSite.sections.map((section) => {
      if (section.id !== "about") return section;
      const next = { ...section };
      delete next.image;
      return next;
    }) };

    expect(JSON.stringify(packTracking(tracking, site))).toContain(image.dataUri);
    expect(roundTrip(tracking, site)).toEqual(tracking);
  });

  it("参照している画像がサイトに無ければ、サイトを基準にして始め直す", () => {
    const site = siteWithImage();
    const packed = JSON.parse(JSON.stringify(packTracking(trackingFromSite(site), site)));
    const siteWithoutImage = createSampleSite();

    expect(restoreTracking(packed, siteWithoutImage)).toEqual(trackingFromSite(siteWithoutImage));
  });

  it("型は合っていても、サイトに無いセクションの追加を記録していれば使わない", () => {
    const site = createSampleSite();
    const tracking = { ...trackingFromSite(site), pendingStructure: [{ id: "add-no-such-section", label: "セクション追加（存在しない）" }] };

    expect(restoreTracking(tracking, site)).toEqual(trackingFromSite(site));
  });

  it("型は合っていても、内容の基準のキーと中身のidが食い違っていれば使わない", () => {
    const site = createSampleSite();
    const base = trackingFromSite(site);
    const tracking = { ...base, sectionBaselines: { ...base.sectionBaselines, hero: base.sectionBaselines.about } };

    expect(restoreTracking(tracking, site)).toEqual(trackingFromSite(site));
  });

  it("追加と削除の記録がサイトと合っていれば、そのまま読み戻す", () => {
    const baselineSite = createSampleSite();
    const site = { ...baselineSite, sections: baselineSite.sections.filter((section) => section.id !== "features") };
    const tracking = {
      ...trackingFromSite(baselineSite),
      sectionBaselines: Object.fromEntries(site.sections.map((section) => [section.id, section])),
      pendingStructure: [{ id: "remove-features", label: "セクション削除（特徴）" }],
    };

    expect(restoreTracking(tracking, site)).toEqual(tracking);
  });
});
