"use client";

import { useEffect } from "react";

const SUITS = ["\u2660", "\u2665", "\u2666", "\u2663"];
const TONES = ["#f4f1ea", "#ff4655", "#ff4655", "#f4f1ea"];
const FRAME_MS = 140;

function drawFrame(ctx: CanvasRenderingContext2D, size: number, time: number) {
  const center = size / 2;
  const pulse = 0.5 + Math.sin(time / 420) * 0.5;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#06070a";
  ctx.fillRect(0, 0, size, size);

  const glow = ctx.createRadialGradient(center, center, 2, center, center, size * 0.55);
  glow.addColorStop(0, `rgba(232, 181, 58, ${0.24 + pulse * 0.18})`);
  glow.addColorStop(1, "rgba(232, 181, 58, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(244, 241, 234, 0.36)";
  ctx.lineWidth = 2;
  ctx.strokeRect(3, 3, size - 6, size - 6);

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(time / 2200);
  const radius = size * 0.25;
  for (let i = 0; i < SUITS.length; i += 1) {
    const angle = (i / SUITS.length) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-time / 2200);
    ctx.fillStyle = TONES[i];
    ctx.font = `bold ${Math.round(size * 0.2)}px "Segoe UI Symbol", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(SUITS[i], 0, 1);
    ctx.restore();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#e8b53a";
  ctx.fillRect(-3.5, -3.5, 7, 7);
  ctx.restore();

  ctx.strokeStyle = `rgba(104, 232, 255, ${0.28 + pulse * 0.36})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(center, center, size * 0.36 + pulse * 1.5, 0, Math.PI * 2);
  ctx.stroke();
}

export default function AnimatedFavicon() {
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("#axiom-animated-favicon");
    if (!link) {
      link = document.createElement("link");
      link.id = "axiom-animated-favicon";
      link.rel = "icon";
      link.type = "image/png";
      link.sizes = "64x64";
      document.head.appendChild(link);
    }

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const render = (time: number) => {
      drawFrame(ctx, 64, reduced ? 0 : time);
      link!.href = canvas.toDataURL("image/png");
    };

    render(0);
    if (reduced) {
      return () => link?.remove();
    }

    const timer = window.setInterval(() => render(performance.now()), FRAME_MS);
    return () => {
      window.clearInterval(timer);
      link?.remove();
    };
  }, []);

  return null;
}
