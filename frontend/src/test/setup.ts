import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// globalsを有効にしていないため、Testing Libraryの自動後片付けが働かない。
// テストごとに描画した部品を外し、次のテストへ持ち越さない。
afterEach(() => {
  cleanup();
});
