import JSZip from "jszip";
import { buildSiteArtifacts } from "../artifacts/build-site-artifacts";
import { evaluateQuality } from "../quality/evaluate-quality";
import type { AiUsage, LearningNote, SiteModel } from "../site-model/schema";

export async function exportProject(site: SiteModel, notes: LearningNote[], aiUsage: AiUsage[]) {
  const artifacts = buildSiteArtifacts(site);
  const quality = evaluateQuality(site);
  const zip = new JSZip();

  zip.file("index.html", artifacts.html);
  zip.file("style.css", artifacts.css);
  zip.file("script.js", artifacts.javascript);
  zip.file("learning-notes.md", buildLearningNotes(notes));
  zip.file(
    "quality-report.md",
    `# 品質レポート\n\n${quality.map((item) => `- ${item.passed ? "✅" : "❌"} ${item.label}: ${item.detail}`).join("\n")}\n`,
  );
  zip.file("ai-usage.json", JSON.stringify(aiUsage, null, 2));
  zip.file(
    "README.md",
    `# ${site.siteTitle}\n\nこのフォルダはLearning Web Builderから出力されました。index.htmlをブラウザで開くと確認できます。AI生成文は仮テキストです。提出前に事実確認し、自分の言葉へ直してください。\n`,
  );

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${toSafeFileName(site.topic)}-site.zip`;
  anchor.click();
  URL.revokeObjectURL(url);
}

// 書いた理由と、そのとき実際に変わったコードを並べて残す。
// 提出後に読み返したとき、理由と変更が対応しているかを自分で確かめられるようにするため。
export function buildLearningNotes(notes: LearningNote[]): string {
  if (notes.length === 0) return "# 学習メモ\n\n- まだ学習メモはありません。\n";

  const body = notes
    .map((note) => {
      const heading = `- ${note.target}: ${note.reason}`;
      if (!note.codeChanges?.length) return heading;
      const changes = note.codeChanges.map((line) => `    - \`${line}\``).join("\n");
      return `${heading}\n  - 変わったコード:\n${changes}`;
    })
    .join("\n");

  return `# 学習メモ\n\n${body}\n`;
}

function toSafeFileName(value: string) {
  const safe = value.trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, 48);
  return safe || "learning-site";
}

