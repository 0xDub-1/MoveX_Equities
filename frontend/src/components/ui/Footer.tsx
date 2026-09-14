import Image from "next/image";
import { ExternalLink } from "lucide-react";

import { PROGRAM_ID, explorerAddress } from "@/lib/config";
import { shortKey } from "@/lib/format";

export default function Footer() {
  const programId = PROGRAM_ID.toBase58();
  return (
    <footer className="relative z-10 border-t border-line-1 bg-[#06070A]/85 backdrop-blur-md">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="MoveX" width={88} height={22} className="h-[18px] w-auto opacity-80" />
            <span className="border-l border-line-2 pl-3 font-display text-[12px] text-text-3">Equities</span>
            <span className="inline-flex h-5 items-center rounded-sm border border-line-2 px-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-text-3">
              Devnet
            </span>
          </div>

          <a
            href={explorerAddress(programId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-3 transition-colors hover:text-text-1"
            title={programId}
          >
            Program {shortKey(programId, 4)}
            <ExternalLink size={11} />
          </a>
        </div>

        <div className="my-4 border-t border-line-1/60" />

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-4">
            © 2026 MoveX · All rights reserved
          </p>
          <p className="text-[11px] leading-relaxed text-text-4 md:max-w-lg md:text-right">
            Devnet deployment with a test quote asset. Prices are published by a single keeper.
            Nothing here is financial advice.
          </p>
        </div>
      </div>
    </footer>
  );
}
