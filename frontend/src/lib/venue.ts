// =============================================================================
// Venues
// =============================================================================
//
// Two sections, one program. Equities follow the NYSE session in New York
// time; crypto runs around the clock in UTC. Everything that differs between
// them is named here once, so a component asks for the venue's clock or its
// nouns instead of assuming New York.

export type Venue = "equities" | "crypto";

export interface VenueMeta {
  id: Venue;
  /** Section name, as the navigation shows it. */
  label: string;
  /** Where the board lives. */
  path: string;
  /** IANA zone every time in the section is written in. */
  timeZone: string;
  /** The short suffix after a time: `ET` or `UTC`. */
  tz: string;
  /** What a listed thing is called in copy. */
  noun: string;
  nounPlural: string;
  /** What a daily market measures across. */
  dayNoun: string;
  /** One line under the board's title. */
  tagline: string;
}

export const VENUES: Record<Venue, VenueMeta> = {
  equities: {
    id: "equities",
    label: "Equities",
    path: "/equities",
    timeZone: "America/New_York",
    tz: "ET",
    noun: "stock",
    nounPlural: "stocks",
    dayNoun: "session",
    tagline:
      "Every listed stock carries three thresholds, and each one is its own market with a single question: will it move more than this, in either direction, close to close?",
  },
  crypto: {
    id: "crypto",
    label: "Crypto",
    path: "/crypto",
    timeZone: "UTC",
    tz: "UTC",
    noun: "asset",
    nounPlural: "assets",
    dayNoun: "day",
    tagline:
      "Around the clock, in UTC. Daily ladders lock at midnight and hourly markets lock on the hour, each with its own threshold read from the last twenty moves.",
  },
};

export const VENUE_LIST: readonly Venue[] = ["equities", "crypto"];

/** The venue a route belongs to, or null for pages shared by both. */
export function venueOfPath(pathname: string): Venue | null {
  if (pathname === "/crypto" || pathname.startsWith("/crypto/")) return "crypto";
  if (pathname === "/equities" || pathname.startsWith("/equities/")) return "equities";
  if (pathname === "/trading" || pathname.startsWith("/trading/")) return "equities";
  return null;
}
