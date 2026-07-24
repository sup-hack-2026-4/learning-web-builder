import { useEffect, useMemo, useRef } from "react";
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

  useEffect(() => {
    const receiveMessage = (event: MessageEvent) => {
      const elementId = resolveSelectedElementId(event, iframeRef.current?.contentWindow ?? null);
      if (elementId) onElementSelect(elementId);
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
