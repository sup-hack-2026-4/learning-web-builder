import { useEffect, useRef } from "react";
import { buildSiteArtifacts } from "@/features/artifacts/build-site-artifacts";
import type { SiteModel } from "@/features/site-model/schema";

type Props = {
  site: SiteModel;
  onElementSelect: (elementId: string) => void;
};

export function SitePreview({ site, onElementSelect }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const artifacts = buildSiteArtifacts(site);

  useEffect(() => {
    const receiveMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === "learning-builder:select" && typeof event.data.elementId === "string") {
        onElementSelect(event.data.elementId);
      }
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, [onElementSelect]);

  return (
    <iframe
      ref={iframeRef}
      title="生成サイトのプレビュー"
      sandbox="allow-scripts"
      srcDoc={artifacts.srcdoc}
      className="min-h-[720px] w-full flex-1 rounded-2xl border border-slate-300 bg-white shadow-xl"
    />
  );
}
