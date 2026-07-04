import { useEffect, useRef } from "react";

type NodePoint = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hex: boolean;
  rot: number;
  vr: number;
  phase: number;
  pulse: number;
};

export function NetworkCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const draw: CanvasRenderingContext2D = ctx;

    const cyan = "56, 242, 224";
    const mouse = { x: -9999, y: -9999 };
    let width = 0;
    let height = 0;
    let nodes: NodePoint[] = [];
    let raf = 0;

    function buildNodes() {
      const target = Math.max(36, Math.min(120, Math.floor(width * height * 0.00009)));
      nodes = Array.from({ length: target }, () => {
        const hex = Math.random() < 0.22;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          r: hex ? 5 + Math.random() * 6 : 1.4 + Math.random() * 2.2,
          hex,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.01,
          phase: Math.random() * Math.PI * 2,
          pulse: 1.5 + Math.random() * 2.5
        };
      });
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvasEl.width = width * dpr;
      canvasEl.height = height * dpr;
      canvasEl.style.width = `${width}px`;
      canvasEl.style.height = `${height}px`;
      draw.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildNodes();
    }

    function drawHex(x: number, y: number, r: number, rot: number, alpha: number) {
      draw.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = rot + (Math.PI / 3) * i;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (i === 0) draw.moveTo(px, py);
        else draw.lineTo(px, py);
      }
      draw.closePath();
      draw.strokeStyle = `rgba(${cyan}, ${alpha})`;
      draw.lineWidth = 1.2;
      draw.shadowColor = `rgba(${cyan}, ${alpha})`;
      draw.shadowBlur = 12;
      draw.stroke();
    }

    function frame(t: number) {
      draw.clearRect(0, 0, width, height);
      draw.globalCompositeOperation = "lighter";

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < 170) {
            const alpha = (1 - dist / 170) * 0.5;
            draw.beginPath();
            draw.moveTo(a.x, a.y);
            draw.lineTo(b.x, b.y);
            draw.strokeStyle = `rgba(${cyan}, ${alpha})`;
            draw.lineWidth = 0.8;
            draw.shadowColor = `rgba(${cyan}, ${alpha * 0.8})`;
            draw.shadowBlur = 6;
            draw.stroke();
          }
        }
      }

      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;
        node.rot += node.vr;

        const md = Math.hypot(node.x - mouse.x, node.y - mouse.y);
        if (md > 0 && md < 130) {
          const f = ((130 - md) / 130) * 0.6;
          node.x += ((node.x - mouse.x) / md) * f;
          node.y += ((node.y - mouse.y) / md) * f;
        }

        if (node.x < -20) node.x = width + 20;
        if (node.x > width + 20) node.x = -20;
        if (node.y < -20) node.y = height + 20;
        if (node.y > height + 20) node.y = -20;

        const pulse = 0.55 + 0.45 * Math.sin(t * 0.001 * node.pulse + node.phase);
        if (node.hex) {
          drawHex(node.x, node.y, node.r, node.rot, 0.35 + pulse * 0.4);
        }
        draw.beginPath();
        draw.arc(node.x, node.y, node.hex ? 1.6 : node.r, 0, Math.PI * 2);
        draw.fillStyle = `rgba(127, 255, 242, ${node.hex ? 0.6 * pulse : 0.5 + pulse * 0.5})`;
        draw.shadowColor = `rgba(${cyan}, 0.9)`;
        draw.shadowBlur = 16;
        draw.fill();
      }

      draw.globalCompositeOperation = "source-over";
      draw.shadowBlur = 0;
      raf = requestAnimationFrame(frame);
    }

    const onMouse = (event: MouseEvent) => {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    };
    const onMouseOut = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    resize();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("mouseout", onMouseOut);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mouseout", onMouseOut);
    };
  }, []);

  return <canvas className="network" ref={ref} />;
}
