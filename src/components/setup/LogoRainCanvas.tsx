import { useEffect, useRef } from 'react';

interface LogoItem {
  pidx: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  radius: number;
}

const OAI_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 260" fill="#383c4a"><path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z"/></svg>');

const LOGO_URLS = [
  OAI_SVG,
  'https://cdn.simpleicons.org/googlegemini/383c4a',
  'https://cdn.simpleicons.org/anthropic/383c4a',
  'https://cdn.simpleicons.org/mistralai/383c4a',
  'https://cdn.simpleicons.org/deepseek/383c4a',
  'https://cdn.simpleicons.org/meta/383c4a',
  'https://cdn.simpleicons.org/qwen/383c4a',
];

const FB = [
  { col: '#4ade80', lbl: 'O' },
  { col: '#60a5fa', lbl: 'G' },
  { col: '#fb923c', lbl: 'A' },
  { col: '#a78bfa', lbl: 'M' },
  { col: '#38bdf8', lbl: 'D' },
  { col: '#2dd4bf', lbl: 'M' },
  { col: '#f472b6', lbl: 'Q' },
];

export function LogoRainCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logosRef = useRef<LogoItem[]>([]);
  const imagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const mouseRef = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    const imgs: (HTMLImageElement | null)[] = [];
    LOGO_URLS.forEach((url, i) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { imgs[i] = img; };
      img.onerror = () => { /* stay undefined — fallback used */ };
      img.src = url;
    });
    imagesRef.current = imgs;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const handleMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000 };
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    const t0 = performance.now();
    let spawnTimer: ReturnType<typeof setTimeout>;

    function scheduleSpawn() {
      const elapsed = (performance.now() - t0) / 1000;
      const delay = Math.max(50, 1200 * Math.exp(-elapsed / 90));
      spawnTimer = setTimeout(() => {
        const pidx = Math.floor(Math.random() * LOGO_URLS.length);
        const cw = canvas!.width;
        let tries = 0;
        let x: number;
        do {
          x = 40 + Math.random() * (cw - 80);
          tries++;
        } while (
          tries < 10 &&
          logosRef.current.some((l) => Math.abs(l.x - x) < l.radius * 3)
        );
        logosRef.current.push({
          pidx,
          x,
          y: -40,
          vx: (Math.random() - 0.5) * 2,
          vy: 1 + Math.random() * 2,
          rotation: Math.random() * Math.PI * 2,
          radius: 20,
        });
        scheduleSpawn();
      }, delay);
    }
    scheduleSpawn();

    let animationFrameId: number;

    const updatePhysics = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const mouse = mouseRef.current;
      const gravity = 0.2;
      const floorBounciness = 0.35;

      const logos = logosRef.current;
      const len = logos.length;

      // Apply gravity + mouse repulsion + wall bounce
      for (let i = 0; i < len; i++) {
        const l = logos[i];
        l.vy += gravity;

        const onFloor = l.y + l.radius >= canvas.height - 1;
        if (onFloor) {
          l.vx *= 0.92;
          l.vy *= 0.92;
        }

        // Mouse repulsion
        const dx = l.x - mouse.x;
        const dy = l.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 160 && dist > 0.01) {
          const force = (160 - dist) / 160;
          l.vx += (dx / dist) * force * 2;
          l.vy += (dy / dist) * force * 2;
        }

        l.rotation += l.vx / l.radius * 0.15;

        // Walls
        if (l.x < l.radius) { l.x = l.radius; l.vx = -l.vx * 0.5; }
        else if (l.x > canvas.width - l.radius) { l.x = canvas.width - l.radius; l.vx = -l.vx * 0.5; }

        // Floor
        if (l.y > canvas.height - l.radius) {
          l.y = canvas.height - l.radius;
          l.vy = -l.vy * floorBounciness;
          if (Math.abs(l.vy) < 0.5) l.vy = 0;
        }
      }

      // Multi-pass collision resolve (3 full passes)
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < len; i++) {
          const a = logos[i];
          for (let j = i + 1; j < len; j++) {
            const b = logos[j];
            let sx = a.x - b.x;
            let sy = a.y - b.y;
            let sDist = Math.sqrt(sx * sx + sy * sy);
            const minDist = a.radius + b.radius;
            if (sDist >= minDist || sDist < 0.01) continue;

            let overlap = minDist - sDist;
            let nx = sx / sDist;
            let ny = sy / sDist;

            a.x += nx * overlap * 0.5;
            a.y += ny * overlap * 0.5;
            b.x -= nx * overlap * 0.5;
            b.y -= ny * overlap * 0.5;

            // Clamp to canvas
            if (a.x < a.radius) a.x = a.radius;
            else if (a.x > canvas.width - a.radius) a.x = canvas.width - a.radius;
            if (a.y > canvas.height - a.radius) a.y = canvas.height - a.radius;
            if (b.x < b.radius) b.x = b.radius;
            else if (b.x > canvas.width - b.radius) b.x = canvas.width - b.radius;
            if (b.y > canvas.height - b.radius) b.y = canvas.height - b.radius;

            // Velocity exchange
            const relVn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            if (relVn < 0) {
              a.vx -= relVn * nx * 0.5;
              a.vy -= relVn * ny * 0.5;
              b.vx += relVn * nx * 0.5;
              b.vy += relVn * ny * 0.5;
            }

            // Slide apart
            const slide = overlap * 0.2;
            a.vx += -ny * slide;
            a.vy += nx * slide;
            b.vx += ny * slide;
            b.vy += -nx * slide;

            a.rotation += (a.vx - b.vx) / a.radius * 0.05;
            b.rotation += (b.vx - a.vx) / b.radius * 0.05;
          }
        }
      }

      // Apply velocity + draw
      for (let i = 0; i < len; i++) {
        const l = logos[i];
        l.x += l.vx;
        l.y += l.vy;

        ctx.save();
        ctx.translate(l.x, l.y);
        ctx.rotate(l.rotation);

        const svgImg = imagesRef.current[l.pidx];
        if (svgImg) {
          ctx.drawImage(svgImg, -l.radius, -l.radius, l.radius * 2, l.radius * 2);
        } else {
          const fb = FB[l.pidx];
          ctx.fillStyle = fb.col;
          ctx.beginPath();
          ctx.arc(0, 0, l.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#000';
          ctx.font = 'bold 14px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(fb.lbl, 0, 0);
        }
        ctx.restore();
      }

      // Cull off-screen
      logosRef.current = logos.filter(
        (l) => l.y < canvas.height + 100 && l.x > -100 && l.x < canvas.width + 100
      );

      animationFrameId = requestAnimationFrame(updatePhysics);
    };

    updatePhysics();

    return () => {
      clearTimeout(spawnTimer);
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none w-full h-full bg-transparent"
    />
  );
}
