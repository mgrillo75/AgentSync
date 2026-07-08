import { useCallback, useRef, useState, type PointerEvent, type WheelEvent } from "react";

export type Transform = {
  x: number;
  y: number;
  scale: number;
};

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const ZOOM_FACTOR = 0.002;

export function useSwarmPanZoom() {
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  const onWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    const container = event.currentTarget;
    if (!container.contains(event.target as Node)) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const clientX = event.clientX;
    const clientY = event.clientY;
    const deltaY = event.deltaY;
    setTransform((prev) => {
      const delta = -deltaY * ZOOM_FACTOR;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * (1 + delta)));
      const ratio = nextScale / prev.scale;
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      return {
        x: px - (px - prev.x) * ratio,
        y: py - (py - prev.y) * ratio,
        scale: nextScale
      };
    });
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const container = event.currentTarget;
    if (!container.contains(event.target as Node)) return;
    event.preventDefault();
    isPanning.current = true;
    lastPointer.current = { x: event.clientX, y: event.clientY };
    container.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!isPanning.current) return;
    const dx = event.clientX - lastPointer.current.x;
    const dy = event.clientY - lastPointer.current.y;
    lastPointer.current = { x: event.clientX, y: event.clientY };
    setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!isPanning.current) return;
    isPanning.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released after a drag cancellation.
    }
  }, []);

  const zoomIn = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.min(MAX_SCALE, prev.scale * 1.25) }));
  }, []);

  const zoomOut = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.max(MIN_SCALE, prev.scale / 1.25) }));
  }, []);

  const fitToScreen = useCallback(
    (bounds: { minX: number; minY: number; maxX: number; maxY: number }, viewport: { width: number; height: number }) => {
      const width = bounds.maxX - bounds.minX + 200;
      const height = bounds.maxY - bounds.minY + 200;
      if (width <= 0 || height <= 0) return;
      const scale = Math.min(viewport.width / width, viewport.height / height, 1.5);
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      setTransform({
        x: viewport.width / 2 - cx * scale,
        y: viewport.height / 2 - cy * scale,
        scale
      });
    },
    []
  );

  return {
    transform,
    setTransform,
    handlers: { onWheel, onPointerDown, onPointerMove, onPointerUp },
    zoomIn,
    zoomOut,
    fitToScreen
  };
}
