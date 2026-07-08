export function SwarmEdge({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const midY = (y1 + y2) / 2;
  const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

  return (
    <g>
      <path d={path} fill="none" stroke="transparent" strokeWidth={20} strokeLinecap="round" pointerEvents="stroke" />
      <path className="swarm-edge-path" d={path} fill="none" strokeLinecap="round" />
    </g>
  );
}
