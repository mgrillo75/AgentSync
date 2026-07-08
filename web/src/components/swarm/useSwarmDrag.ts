import { useCallback, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { Transform } from "./useSwarmPanZoom";

export type DragState = {
  agentId: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type UseSwarmDragOpts = {
  transform: Transform;
  containerRef: RefObject<HTMLDivElement | null>;
  getPosition: (agentId: string) => { x: number; y: number } | null;
  onDrop: (agentId: string, x: number, y: number) => void;
};

export function useSwarmDrag({ transform, containerRef, getPosition, onDrop }: UseSwarmDragOpts) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const moved = useRef(false);
  const lastDragMoved = useRef(false);
  const pointerIdRef = useRef<number | null>(null);

  const screenToCanvas = useCallback(
    (screenX: number, screenY: number) => {
      const el = containerRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: (screenX - rect.left - transform.x) / transform.scale,
        y: (screenY - rect.top - transform.y) / transform.scale
      };
    },
    [containerRef, transform]
  );

  const startDrag = useCallback(
    (event: PointerEvent<HTMLElement>, agentId: string) => {
      if (event.button !== 0 || event.altKey) return;
      const position = getPosition(agentId);
      if (!position) return;
      event.stopPropagation();
      moved.current = false;
      lastDragMoved.current = false;
      pointerIdRef.current = event.pointerId;
      const canvas = screenToCanvas(event.clientX, event.clientY);
      const state: DragState = {
        agentId,
        startX: canvas.x - position.x,
        startY: canvas.y - position.y,
        currentX: position.x,
        currentY: position.y
      };
      dragRef.current = state;
      setDragState(state);
      containerRef.current?.setPointerCapture(event.pointerId);
    },
    [containerRef, getPosition, screenToCanvas]
  );

  const moveDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const state = dragRef.current;
      if (!state) return;
      const canvas = screenToCanvas(event.clientX, event.clientY);
      const next = {
        ...state,
        currentX: canvas.x - state.startX,
        currentY: canvas.y - state.startY
      };
      if (Math.abs(next.currentX - state.currentX) > 0.5 || Math.abs(next.currentY - state.currentY) > 0.5) {
        moved.current = true;
      }
      dragRef.current = next;
      setDragState(next);
    },
    [screenToCanvas]
  );

  const endDrag = useCallback(() => {
    const state = dragRef.current;
    if (!state) return;
    if (pointerIdRef.current != null) {
      try {
        containerRef.current?.releasePointerCapture(pointerIdRef.current);
      } catch {
        // Pointer capture may already be released.
      }
    }
    pointerIdRef.current = null;
    dragRef.current = null;
    setDragState(null);
    lastDragMoved.current = moved.current;
    if (!moved.current) return;
    onDrop(
      state.agentId,
      Math.round(state.currentX / 20) * 20,
      Math.round(state.currentY / 20) * 20
    );
  }, [containerRef, onDrop]);

  const consumeLastDragMoved = useCallback(() => {
    const value = lastDragMoved.current;
    lastDragMoved.current = false;
    return value;
  }, []);

  return { dragState, isDragging: dragState != null, startDrag, moveDrag, endDrag, consumeLastDragMoved };
}
