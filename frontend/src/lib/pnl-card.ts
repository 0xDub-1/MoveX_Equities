// =============================================================================
// P&L share card
// =============================================================================
//
// Draws one resolved position over the branded template in
// `public/pnl_card.png`. The template is 3600 by 2025 and every coordinate
// below is written in those pixels; the canvas is scaled down once at the
// start, so the layout reads like the design file while the output stays a
// sensible size for a post.

import { fmtBps, fmtPct, fmtUsdx, fmtUsdxSigned } from "./format";
import { SIDE_META, TIER_META, type MarketKind, type Side, type Tier } from "./market";

export interface PnlCardData {
  symbol: string;
  tier: Tier;
  strikeBps: number;
  side: Side;
  /** USDX base units. */
  stake: bigint;
  /** USDX base units. Zero on a loss, equal to the stake on a refund. */
  payout: bigint;
  kind: MarketKind;
  /** `Wed, Sep 16` for a daily market, `10:00 to 11:00 ET` for an hourly one. */
  sessionLabel: string;
  outcome: "won" | "lost" | "refund";
}

export const TEMPLATE_SRC = "/pnl_card.png";
export const TEMPLATE_WIDTH = 3600;
export const TEMPLATE_HEIGHT = 2025;
/** The output is 1800 by 1012. */
export const RENDER_SCALE = 0.5;

const COLOR = {
  text: "#F4F5F7",
  muted: "#6B7280",
  green: "#AECB31",
  sky: "#4EA1FF",
  red: "#F0555C",
} as const;

const DISPLAY = '"Space Grotesk", "Inter", ui-sans-serif, system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';

/** Left margin shared by the title, the session line and the bottom row. */
const MARGIN = 240;
/** Right edge of the hero numbers. */
const HERO_RIGHT = 3150;
/** Breathing room between the left column and the right-aligned hero. */
const GUTTER = 120;

interface TextStyle {
  font: string;
  color: string;
  align?: CanvasTextAlign;
  /** Tracking in template pixels. */
  spacing?: number;
}

function font(weight: number, px: number, family: string): string {
  return `${weight} ${px}px ${family}`;
}

// ---------------------------------------------------------------------------
// Derived numbers
// ---------------------------------------------------------------------------

export function pnlNet(d: PnlCardData): bigint {
  return d.payout - d.stake;
}

/** Return on the stake as a percentage. Zero on a refund. */
export function pnlReturnPct(d: PnlCardData): number {
  if (d.stake === 0n) return 0;
  return (Number(d.payout - d.stake) / Number(d.stake)) * 100;
}

/** `movex-nvda-fair-above-+143pct.png`. */
export function pnlCardFilename(d: PnlCardData): string {
  const pct = Math.round(pnlReturnPct(d));
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return `movex-${d.symbol.toLowerCase()}-${d.tier}-${d.side}-${sign}${Math.abs(pct)}pct.png`;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

function loadTemplate(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the card template."));
    img.src = TEMPLATE_SRC;
  });
}

/**
 * Asks for every face the card uses before drawing. A canvas only sees a
 * font once the document has loaded it, and the page may not have used the
 * heavier display weights yet.
 */
async function ensureFonts(): Promise<void> {
  const faces = [
    font(700, 240, DISPLAY),
    font(500, 160, DISPLAY),
    font(800, 380, DISPLAY),
    font(700, 150, DISPLAY),
    font(500, 108, MONO),
    font(500, 64, MONO),
    font(500, 52, MONO),
    font(500, 50, MONO),
  ];
  // A face that fails to load falls back to the system stack; the card still renders.
  await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => [])));
  await document.fonts.ready;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pillPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function applyStyle(ctx: CanvasRenderingContext2D, style: TextStyle): void {
  ctx.font = style.font;
  ctx.fillStyle = style.color;
  ctx.textAlign = style.align ?? "left";
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = `${style.spacing ?? 0}px`;
}

function measure(ctx: CanvasRenderingContext2D, text: string, style: TextStyle): TextMetrics {
  applyStyle(ctx, style);
  return ctx.measureText(text);
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): void {
  applyStyle(ctx, style);
  ctx.fillText(text, x, y);
}

/**
 * The font string for `text` at `px`, or a smaller size when the line would
 * be wider than `maxWidth`. Large returns carry more digits than the design
 * leaves room for, and running into the left column is worse than shrinking.
 */
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  px: number,
  family: string,
  maxWidth: number,
  style: Omit<TextStyle, "font">,
): string {
  const base = font(weight, px, family);
  const width = measure(ctx, text, { ...style, font: base }).width;
  if (width <= maxWidth || width === 0) return base;
  return font(weight, Math.floor((px * maxWidth) / width), family);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode the card."));
    }, "image/png");
  });
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export async function generatePnlCard(data: PnlCardData): Promise<Blob> {
  const [template] = await Promise.all([loadTemplate(), ensureFonts()]);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(TEMPLATE_WIDTH * RENDER_SCALE);
  canvas.height = Math.round(TEMPLATE_HEIGHT * RENDER_SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");

  ctx.scale(RENDER_SCALE, RENDER_SCALE);
  ctx.drawImage(template, 0, 0, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);

  const sideColor = data.side === "above" ? COLOR.green : COLOR.sky;
  const net = pnlNet(data);
  const heroColor = net >= 0n ? COLOR.green : COLOR.red;

  // Side pill, top left. The label sits at (360, 680) and the pill hugs it.
  const sideLabel = SIDE_META[data.side].label;
  const sideStyle: TextStyle = { font: font(700, 240, DISPLAY), color: sideColor };
  const sideMetrics = measure(ctx, sideLabel, sideStyle);
  const capHeight = sideMetrics.actualBoundingBoxAscent || 170;
  const padX = 120;
  const padY = 72;
  const pillX = 360 - padX;
  const pillY = 680 - capHeight - padY;
  const pillW = sideMetrics.width + padX * 2;
  const pillH = capHeight + padY * 2;
  pillPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = hexToRgba(sideColor, 0.18);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = hexToRgba(sideColor, 0.55);
  ctx.stroke();
  drawText(ctx, sideLabel, 360, 680, sideStyle);
  const pillRight = pillX + pillW;

  // Market title and the session line under it.
  const title = `${data.symbol} · ${TIER_META[data.tier].label} · ${fmtBps(data.strikeBps)}`;
  const titleStyle: TextStyle = { font: font(500, 160, DISPLAY), color: COLOR.text };
  const titleWidth = measure(ctx, title, titleStyle).width;
  drawText(ctx, title, MARGIN, 980, titleStyle);
  drawText(ctx, `${data.kind.toUpperCase()} · ${data.sessionLabel.toUpperCase()}`, MARGIN, 1120, {
    font: font(500, 64, MONO),
    color: COLOR.muted,
    spacing: 6,
  });

  // Hero on the right: the return, then the net result under it. Each line
  // shrinks if it would otherwise run into what sits to its left.
  const heroBase = { color: heroColor, align: "right" as const };
  const heroText = fmtPct(pnlReturnPct(data), { signed: true });
  const heroFont = fitFont(ctx, heroText, 800, 380, DISPLAY, HERO_RIGHT - pillRight - GUTTER, heroBase);
  drawText(ctx, heroText, HERO_RIGHT, 800, { ...heroBase, font: heroFont });

  const netText = `${fmtUsdxSigned(net)} USDX`;
  const netMax = HERO_RIGHT - MARGIN - titleWidth - GUTTER;
  const netFont = fitFont(ctx, netText, 700, 150, DISPLAY, netMax, heroBase);
  drawText(ctx, netText, HERO_RIGHT, 1010, { ...heroBase, font: netFont });

  // Bottom row: stake and payout. The payout column moves right when the
  // stake needs more digits than the design leaves room for.
  const labelStyle: TextStyle = { font: font(500, 50, MONO), color: COLOR.muted, spacing: 8 };
  const valueStyle: TextStyle = { font: font(500, 108, MONO), color: COLOR.text };
  const stakeText = `${fmtUsdx(data.stake)} USDX`;
  const stakeWidth = measure(ctx, stakeText, valueStyle).width;
  const payoutX = Math.max(1100, MARGIN + stakeWidth + 160);
  drawText(ctx, "STAKE", MARGIN, 1620, labelStyle);
  drawText(ctx, stakeText, MARGIN, 1730, valueStyle);
  drawText(ctx, data.outcome === "refund" ? "REFUND" : "PAYOUT", payoutX, 1620, labelStyle);
  drawText(ctx, `${fmtUsdx(data.payout)} USDX`, payoutX, 1730, valueStyle);

  drawText(ctx, "movex.market", MARGIN, 1880, { font: font(500, 52, MONO), color: COLOR.muted, spacing: 4 });

  return toBlob(canvas);
}
