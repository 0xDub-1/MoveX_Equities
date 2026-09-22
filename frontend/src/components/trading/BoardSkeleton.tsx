"use client";

// The loading state of the board, shaped like the board: an asset header,
// a strip, and a row of cards, so the page does not jump when data lands.

import { Skeleton } from "@/components/ui/primitives";

export default function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-2" aria-hidden>
      <div className="flex items-baseline justify-between gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="hidden h-4 w-72 lg:block" />
      </div>
      <Skeleton className="h-6" />
      <Skeleton className="h-3.5 w-96 max-w-full" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[330px]" />
        ))}
      </div>
    </div>
  );
}
