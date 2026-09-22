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
  /** What this venue lists, for a sentence that names them all. */
  blurb: string;
  /** When it runs, for the same sentence. */
  clockPhrase: string;
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
    tagline: "NVDA, TSLA and SPY on the NYSE session, in New York time.",
    blurb: "tokenized US equities",
    clockPhrase: "Equities run on the New York session",
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
    tagline: "BTC, ETH and SOL, around the clock, in UTC.",
    blurb: "crypto",
    clockPhrase: "crypto runs around the clock in UTC",
  },
};

/**
 * The venues this deployment shows. Both are built; only the ones named here
 * get a tab, a board and a listed asset. This is the one switch: the
 * navigation, the asset registry and the routes all read it, so opening
 * crypto to the public is a single line.
 */
export const VENUE_LIST: readonly Venue[] = ["equities", "crypto"];

export function isVenueListed(venue: Venue): boolean {
  return VENUE_LIST.includes(venue);
}

/** What this deployment lists, in prose: `tokenized US equities and crypto`. */
export const LISTED_BLURB = VENUE_LIST.map((v) => VENUES[v].blurb).join(" and ");

/** When each listed venue runs, in prose. */
export const LISTED_CLOCKS = VENUE_LIST.map((v) => VENUES[v].clockPhrase).join(", ");

/** The venue a route belongs to, or null for pages shared by both. */
export function venueOfPath(pathname: string): Venue | null {
  if (pathname === "/crypto" || pathname.startsWith("/crypto/")) return "crypto";
  if (pathname === "/equities" || pathname.startsWith("/equities/")) return "equities";
  if (pathname === "/trading" || pathname.startsWith("/trading/")) return "equities";
  return null;
}
