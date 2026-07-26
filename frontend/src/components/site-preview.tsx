import { useEffect, useMemo, useRef, useState } from "react";
import { buildSiteArtifacts } from "@/features/artifacts/build-site-artifacts";
import { resolveSelectedElementId } from "@/features/preview/resolve-selected-element";
import type { SiteModel } from "@/features/site-model/schema";

type Props = {
  site: SiteModel;
  onElementSelect: (elementId: string) => void;
};

export function SitePreview({ site, onElementSelect }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const artifacts = useMemo(() => buildSiteArtifacts(site), [site]);

  // sandbox="allow-scripts"のiframeは親からcontentDocumentへ触れないため、
  // テーマ更新はpostMessageでiframe内スクリプトへCSSを渡してstyleタグを差し替える。
  // HTML構造（見出し・本文・alt・表示セクション）が変わったときだけsrcDocを差し替え、
  // themeだけの変更ではリロードせずにちらつき・スクロール位置リセットを避ける。
  const structureHtml = artifacts.srcdoc.replace(
    /<style id="builder-theme">[\s\S]*?<\/style>/,
    "",
  );

  const [srcDoc, setSrcDoc] = useState(artifacts.srcdoc);
  const lastStructureRef = useRef(structureHtml);

  useEffect(() => {
    const receiveMessage = (event: MessageEvent) => {
      const elementId = resolveSelectedElementId(event, iframeRef.current?.contentWindow ?? null);
      if (elementId) onElementSelect(elementId);
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [onElementSelect]);

  useEffect(() => {
    if (structureHtml !== lastStructureRef.current) {
      lastStructureRef.current = structureHtml;
      setSrcDoc(artifacts.srcdoc);
      return;
    }
    // themeのみ変更: iframe内スクリプトへCSSを送り、styleタグだけ差し替えてもらう。
    iframeRef.current?.contentWindow?.postMessage(
      { type: "learning-builder:theme", css: artifacts.css },
      "*",
    );
  }, [structureHtml, artifacts.srcdoc, artifacts.css]);

  return (
    <iframe
      ref={iframeRef}
      title="生成サイトのプレビュー"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="min-h-[720px] w-full flex-1 rounded-2xl border border-slate-300 bg-white shadow-xl"
    />
  );
}
