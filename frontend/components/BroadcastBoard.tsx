"use client";

import { useEffect, useRef } from "react";

const DOOR_COLORS = ["#ff4655", "#5aa7ff", "#f4c542", "#58d68d"];
const SIGILS = ["\u2660", "\u2665", "\u2666", "\u2663"];
const N = 5;

type Cell = { edges: string[]; sigil: string };

export default function BroadcastBoard() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cell = canvas.width / N;
    let grid: Cell[][] = Array.from({ length: N }, () =>
      Array.from({ length: N }, () => ({
        edges: DOOR_COLORS.slice().sort(() => Math.random() - 0.5),
        sigil: SIGILS[Math.floor(Math.random() * SIGILS.length)],
      }))
    );
    let frame = 0;
    let raf = 0;

    const draw = (time: number) => {
      frame += 1;
      if (!reduced && frame % 90 === 0) {
        const row = Math.floor(Math.random() * N);
        const shift = Math.random() > 0.5 ? 1 : -1;
        grid[row] = grid[row].slice().sort(() => shift * (Math.random() - 0.5));
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(4, 5, 7, 0.18)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const pulse = 0.5 + 0.38 * Math.sin(time / 700);

      for (let y = 0; y < N; y += 1) {
        for (let x = 0; x < N; x += 1) {
          const px = x * cell;
          const py = y * cell;
          const isYou = x === 2 && y === 2;
          const isExit = x === 0 && y === 4;

          ctx.fillStyle = isExit
            ? "rgba(244, 197, 66, 0.10)"
            : isYou
              ? "rgba(104, 232, 255, 0.08)"
              : "rgba(244, 241, 234, 0.025)";
          ctx.fillRect(px + 5, py + 5, cell - 10, cell - 10);

          ctx.strokeStyle = isYou
            ? "rgba(244, 197, 66, 0.95)"
            : isExit
              ? "rgba(255, 70, 85, 0.55)"
              : "rgba(244, 241, 234, 0.13)";
          ctx.lineWidth = isYou ? 2 : 1;
          ctx.strokeRect(px + 5, py + 5, cell - 10, cell - 10);

          const edges = grid[y][x].edges;
          const cellPulse = 0.5 + 0.38 * Math.sin(time / 700 + x + y);
          const bars = [
            [px + 12, py + 5, cell - 24, 3, edges[0]],
            [px + cell - 8, py + 12, 3, cell - 24, edges[1]],
            [px + 12, py + cell - 8, cell - 24, 3, edges[2]],
            [px + 5, py + 12, 3, cell - 24, edges[3]],
          ] as const;

          for (const [bx, by, bw, bh, color] of bars) {
            ctx.globalAlpha = cellPulse;
            ctx.fillStyle = color;
            ctx.fillRect(bx, by, bw, bh);
            ctx.globalAlpha = 1;
          }

          if (isYou) {
            ctx.fillStyle = "rgba(244, 197, 66, 0.22)";
            ctx.beginPath();
            ctx.arc(px + cell / 2, py + cell / 2, 18 + cellPulse * 5, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.fillStyle = isYou ? "#f4c542" : "rgba(244, 241, 234, 0.62)";
          ctx.font = "12px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(grid[y][x].sigil, px + cell / 2, py + cell / 2 + 1);

          ctx.fillStyle = "rgba(244, 241, 234, 0.34)";
          ctx.font = "8px ui-monospace, monospace";
          ctx.fillText(
            `${String.fromCharCode(65 + y)}${x + 1}`,
            px + cell / 2,
            py + cell - 12
          );
        }
      }

      ctx.strokeStyle = "rgba(104, 232, 255, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, 34 + pulse * 8, 0, Math.PI * 2);
      ctx.stroke();

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      width={520}
      height={520}
      className="h-full w-full"
      aria-label="Animated 5 by 5 arena map preview"
    />
  );
}
