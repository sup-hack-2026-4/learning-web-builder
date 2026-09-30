import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleSite } from "@/features/site-model/sample";
import { MAX_IMAGE_COUNT, type SectionImage } from "@/features/site-model/schema";
import { useBuilderStore } from "@/features/site-model/store";
import { prepareSectionImage } from "./prepare-image";
import { SectionImageField } from "./section-image-field";

// 縮小と再圧縮はブラウザの画像処理に頼るため、ここでは結果が届く時点だけを操る。
vi.mock("./prepare-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./prepare-image")>()),
  prepareSectionImage: vi.fn(),
}));

const image: SectionImage = { dataUri: "data:image/jpeg;base64,/9j/4AAQ", fileName: "about.jpg" };

function pendingImage() {
  let resolve!: (value: SectionImage) => void;
  vi.mocked(prepareSectionImage).mockReturnValue(new Promise((settle) => {
    resolve = settle;
  }));
  return { resolve: (value: SectionImage) => act(async () => resolve(value)) };
}

function renderField() {
  const onSelect = vi.fn();
  const site = useBuilderStore.getState().site;
  const section = site.sections.find((item) => item.id === "about")!;
  render(<SectionImageField section={section} sections={site.sections} onSelect={onSelect} onRemove={() => {}} />);
  return { onSelect };
}

async function chooseFile() {
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("画像ファイル"), new File(["x"], "photo.jpg", { type: "image/jpeg" }));
}

beforeEach(() => {
  vi.mocked(prepareSectionImage).mockReset();
  useBuilderStore.setState({ site: createSampleSite() });
});

describe("SectionImageField", () => {
  it("処理が終わると、選んだ画像を渡す", async () => {
    const pending = pendingImage();
    const { onSelect } = renderField();

    await chooseFile();
    await pending.resolve(image);

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(image));
  });

  it("処理中に作業を切り替えたら、新しい作品の同じidのセクションへ画像を入れない(#115)", async () => {
    const pending = pendingImage();
    const { onSelect } = renderField();

    await chooseFile();
    act(() => useBuilderStore.getState().reset());
    await pending.resolve(image);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("処理中にほかのセクションへ画像が入り上限に達したら、反映せずに理由を伝える", async () => {
    const pending = pendingImage();
    const { onSelect } = renderField();

    await chooseFile();
    // 処理を待つ間に、ほかのセクションで上限まで画像を入れた（画面へ渡したsectionsは古いまま）。
    act(() => {
      useBuilderStore.getState().addSection("gallery");
      useBuilderStore.getState().addSection("gallery");
      const others = useBuilderStore.getState().site.sections.filter((section) => section.id !== "about" && section.kind !== "contact");
      others.slice(0, MAX_IMAGE_COUNT).forEach((section, index) => {
        useBuilderStore.getState().setSectionImage(section.id, { dataUri: image.dataUri, fileName: `other-${index}.jpg` });
      });
    });
    await pending.resolve(image);

    expect(await screen.findByRole("alert")).toHaveTextContent(`画像は全体で${MAX_IMAGE_COUNT}枚までです`);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("処理中にセクションを削除して同じidで追加し直したら、新しいセクションへ画像を入れない", async () => {
    // 削除したidは次の追加で使い回されるため、idだけでは同じセクションか見分けられない。
    const pending = pendingImage();
    const { onSelect } = renderField();

    await chooseFile();
    act(() => {
      useBuilderStore.getState().removeSection("about");
      useBuilderStore.getState().addSection("about");
    });
    expect(useBuilderStore.getState().site.sections.some((section) => section.id === "about")).toBe(true);
    await pending.resolve(image);

    expect(await screen.findByRole("alert")).toHaveTextContent("画像の処理中にセクションが削除されたため、反映しませんでした。");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
