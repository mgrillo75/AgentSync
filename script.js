// Animated blockchain-style node network — glowing teal nodes, hexagons,
// and connecting light beams drifting across a dark field.
(() => {
  const canvas = document.getElementById("network");
  const ctx = canvas.getContext("2d");

  const CYAN = "56, 242, 224";
  let width, height, dpr;
  let nodes = [];
  let mouse = { x: -9999, y: -9999 };

  const CONFIG = {
    density: 0.00009,   // nodes per pixel
    maxNodes: 120,
    minNodes: 36,
    linkDist: 170,      // px at which nodes connect
    speed: 0.25,
    hexChance: 0.22,    // portion of nodes drawn as hexagons
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildNodes();
  }

  function buildNodes() {
    const target = Math.max(
      CONFIG.minNodes,
      Math.min(CONFIG.maxNodes, Math.floor(width * height * CONFIG.density))
    );
    nodes = [];
    for (let i = 0; i < target; i++) {
      const isHex = Math.random() < CONFIG.hexChance;
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * CONFIG.speed,
        vy: (Math.random() - 0.5) * CONFIG.speed,
        r: isHex ? 5 + Math.random() * 6 : 1.4 + Math.random() * 2.2,
        hex: isHex,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.01,
        phase: Math.random() * Math.PI * 2,
        pulse: 1.5 + Math.random() * 2.5,
      });
    }
  }

  function drawHex(x, y, r, rot, alpha) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = rot + (Math.PI / 3) * i;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(${CYAN}, ${alpha})`;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = `rgba(${CYAN}, ${alpha})`;
    ctx.shadowBlur = 12;
    ctx.stroke();
  }

  function frame(t) {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";

    // links
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < CONFIG.linkDist) {
          const alpha = (1 - dist / CONFIG.linkDist) * 0.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${CYAN}, ${alpha})`;
          ctx.lineWidth = 0.8;
          ctx.shadowColor = `rgba(${CYAN}, ${alpha * 0.8})`;
          ctx.shadowBlur = 6;
          ctx.stroke();
        }
      }
    }

    // nodes
    for (const n of nodes) {
      // motion
      n.x += n.vx;
      n.y += n.vy;
      n.rot += n.vr;

      // gentle mouse repulsion
      const mdx = n.x - mouse.x;
      const mdy = n.y - mouse.y;
      const md = Math.hypot(mdx, mdy);
      if (md < 130) {
        const f = (130 - md) / 130 * 0.6;
        n.x += (mdx / md) * f;
        n.y += (mdy / md) * f;
      }

      // wrap edges
      if (n.x < -20) n.x = width + 20;
      if (n.x > width + 20) n.x = -20;
      if (n.y < -20) n.y = height + 20;
      if (n.y > height + 20) n.y = -20;

      const pulse = 0.55 + 0.45 * Math.sin(t * 0.001 * n.pulse + n.phase);

      if (n.hex) {
        drawHex(n.x, n.y, n.r, n.rot, 0.35 + pulse * 0.4);
        // inner dot
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${CYAN}, ${0.6 * pulse})`;
        ctx.shadowColor = `rgba(${CYAN}, 0.9)`;
        ctx.shadowBlur = 14;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(127, 255, 242, ${0.5 + pulse * 0.5})`;
        ctx.shadowColor = `rgba(${CYAN}, 0.9)`;
        ctx.shadowBlur = 16;
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener("mouseout", () => {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  resize();
  requestAnimationFrame(frame);
})();
