// =============================================================================
// Background
// =============================================================================
//
// Static, institutional. A fine grid under a radial mask, one warm brand
// glow top-left, one cool counter-glow bottom-right, and a vignette. Nothing
// animates: the numbers on the page are the only things that should move.

export default function Background() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
      style={{ backgroundColor: "#06070A" }}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 85% 65% at 50% 30%, black 40%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 85% 65% at 50% 30%, black 40%, transparent 100%)",
        }}
      />

      <div
        className="absolute -top-40 -left-40 h-[640px] w-[640px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(174,203,49,0.07) 0%, rgba(174,203,49,0) 60%)",
          filter: "blur(40px)",
        }}
      />

      <div
        className="absolute -bottom-60 -right-40 h-[720px] w-[720px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(78,161,255,0.07) 0%, rgba(78,161,255,0) 60%)",
          filter: "blur(60px)",
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 100% 80% at 50% 40%, transparent 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </div>
  );
}
