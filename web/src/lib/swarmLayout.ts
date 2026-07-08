import type { LlmAgent } from "../types";

export const NODE_W = 200;
export const NODE_H = 110;

export type SwarmTreeNode = {
  agent: LlmAgent;
  children: SwarmTreeNode[];
  depth: number;
};

export function buildOrgTree(agents: LlmAgent[]): SwarmTreeNode[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const childrenOf = new Map<string, LlmAgent[]>();
  const hasParent = new Set<string>();

  for (const agent of agents) {
    if (agent.parentId && byId.has(agent.parentId)) {
      const children = childrenOf.get(agent.parentId) ?? [];
      children.push(agent);
      childrenOf.set(agent.parentId, children);
      hasParent.add(agent.id);
    }
  }

  function buildNode(agent: LlmAgent, depth: number, visited = new Set<string>()): SwarmTreeNode {
    if (visited.has(agent.id)) {
      return { agent, children: [], depth };
    }
    const nextVisited = new Set(visited);
    nextVisited.add(agent.id);
    return {
      agent,
      depth,
      children: (childrenOf.get(agent.id) ?? []).map((child) => buildNode(child, depth + 1, nextVisited))
    };
  }

  return agents.filter((agent) => !hasParent.has(agent.id)).map((agent) => buildNode(agent, 0));
}

interface LayoutOpts {
  nodeWidth?: number;
  nodeHeight?: number;
  levelGap?: number;
  siblingGap?: number;
}

export function layoutTree(roots: SwarmTreeNode[], opts?: LayoutOpts): Map<string, { x: number; y: number }> {
  const nodeWidth = opts?.nodeWidth ?? NODE_W;
  const nodeHeight = opts?.nodeHeight ?? NODE_H;
  const levelGap = opts?.levelGap ?? 120;
  const siblingGap = opts?.siblingGap ?? 40;

  const positions = new Map<string, { x: number; y: number }>();
  const cellWidth = nodeWidth + siblingGap;

  function subtreeWidth(node: SwarmTreeNode): number {
    if (node.children.length === 0) return 1;
    let total = 0;
    for (const child of node.children) total += subtreeWidth(child);
    return total;
  }

  function assignPositions(node: SwarmTreeNode, leftX: number): void {
    const width = subtreeWidth(node);
    const span = width * cellWidth - siblingGap;
    const centerX = leftX + span / 2;
    const y = node.depth * (nodeHeight + levelGap);

    positions.set(node.agent.id, { x: centerX - nodeWidth / 2, y });

    let childLeft = leftX;
    for (const child of node.children) {
      assignPositions(child, childLeft);
      childLeft += subtreeWidth(child) * cellWidth;
    }
  }

  let offsetX = 0;
  for (const root of roots) {
    assignPositions(root, offsetX);
    offsetX += subtreeWidth(root) * cellWidth;
  }

  return positions;
}
