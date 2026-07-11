import { useMemo } from "react";
import multiavatar from "@multiavatar/multiavatar";
import DOMPurify from "dompurify";

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "AG"
  );
}

export function AgentAvatar({ seed, name }: { seed: string | null; name: string }) {
  const svgHtml = useMemo(() => {
    if (!seed) return "";
    return DOMPurify.sanitize(multiavatar(seed), { USE_PROFILES: { svg: true, svgFilters: true } });
  }, [seed]);

  if (!svgHtml) {
    return <span className="swarm-avatar fallback">{initials(name)}</span>;
  }

  return <span className="swarm-avatar" dangerouslySetInnerHTML={{ __html: svgHtml }} />;
}
