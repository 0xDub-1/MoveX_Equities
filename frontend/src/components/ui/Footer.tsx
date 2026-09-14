import Image from "next/image";
import { ExternalLink } from "lucide-react";

import { GITHUB_URL, PROGRAM_ID, explorerAddress } from "@/lib/config";
import { shortKey } from "@/lib/format";

export default function Footer() {
  const programId = PROGRAM_ID.toBase58();
  return (
    <footer className="relative z-10 border-t border-line-1 bg-[#06070A]/85 backdrop-blur-md">
      <div className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="MoveX" width={88} height={22} className="h-[18px] w-auto opacity-80" />
            <span className="font-display text-[12px] text-text-3 border-l border-line-2 pl-3">Equities</span>
            <span className="inline-flex items-center h-5 px-1.5 rounded-sm border border-line-2 font-mono text-[9px] font-medium tracking-[0.18em] uppercase text-text-3">
              Devnet
            </span>
          </div>

          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href={explorerAddress(programId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-text-3 hover:text-text-1 transition-colors"
              title={programId}
            >
              Program {shortKey(programId, 4)}
              <ExternalLink size={10} />
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] text-text-3 hover:text-text-1 transition-colors"
            >
              Source
              <ExternalLink size={10} />
            </a>
          </nav>
        </div>

        <div className="my-4 border-t border-line-1/60" />

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-text-4">
            © 2026 MoveX · All rights reserved
          </p>
          <p className="text-[10.5px] text-text-4 leading-relaxed md:text-right md:max-w-lg">
            Devnet deployment with a test quote asset. Prices are published by a single keeper.
            Nothing here is financial advice.
          </p>
        </div>
      </div>
    </footer>
  );
}
