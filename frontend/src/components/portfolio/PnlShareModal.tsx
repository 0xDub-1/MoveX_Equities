"use client";

// =============================================================================
// Share modal
// =============================================================================
//
// Renders the result card for one position and offers it as a download or a
// clipboard image. The card is drawn once per position rather than once per
// open, so closing and reopening the same result costs nothing.

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Loader2 } from "lucide-react";

import { fmtBps } from "@/lib/format";
import { TIER_META } from "@/lib/market";
import { generatePnlCard, pnlCardFilename, type PnlCardData } from "@/lib/pnl-card";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";

type CopyState = "idle" | "copied" | "failed";

export default function PnlShareModal({
  open,
  data,
  onClose,
}: {
  open: boolean;
  data: PnlCardData | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    generatePnlCard(data)
      .then((png) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(png);
        setBlob(png);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not render the card.");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Reset everything for the next position, the error included, so a
      // failed render never lingers over a different card.
      setUrl(null);
      setBlob(null);
      setError(null);
      setCopyState("idle");
    };
  }, [data]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const canCopy =
    typeof ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === "function";

  const copy = async () => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState("idle"), 1500);
  };

  const subtitle = data
    ? `${data.symbol} · ${TIER_META[data.tier].label} · ${fmtBps(data.strikeBps)}`
    : undefined;
  const filename = data ? pnlCardFilename(data) : "movex-result.png";
  const rendering = !url && !error;

  return (
    <Modal open={open && data !== null} onClose={onClose} title="Share result" subtitle={subtitle} size="lg">
      <div className="flex flex-col gap-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-md border border-line-1 bg-surface-0">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={subtitle ? `Result card for ${subtitle}` : "Result card"}
              className="block h-full w-full object-contain"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
              {error ? (
                <p className="text-[12.5px] text-loss">{error}</p>
              ) : (
                <Loader2 size={22} className="animate-spin text-text-3" />
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href={url ?? undefined}
            download={filename}
            aria-disabled={!url}
            className={cn(
              "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-line-2 bg-white/[0.04] px-4 text-[13px] font-semibold text-text-1",
              "transition-all hover:border-line-3 hover:bg-white/[0.07] active:scale-[0.985]",
              !url && "pointer-events-none opacity-40",
            )}
          >
            <Download size={14} />
            Download PNG
          </a>
          <Button
            variant="primary"
            className="flex-1"
            disabled={!blob || !canCopy}
            onClick={() => void copy()}
          >
            {copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Failed" : "Copy image"}
          </Button>
        </div>

        <p className="text-[11.5px] leading-relaxed text-text-3">
          {rendering
            ? "Drawing the card."
            : canCopy
              ? `Saved as ${filename}. Copy puts the PNG on the clipboard, ready to paste into a post.`
              : `Saved as ${filename}. This browser cannot copy images to the clipboard, so use the download.`}
        </p>
      </div>
    </Modal>
  );
}
