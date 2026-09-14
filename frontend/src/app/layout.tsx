import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Space_Grotesk } from "next/font/google";

import { Providers } from "./providers";
import Background from "@/components/ui/Background";
import Footer from "@/components/ui/Footer";
import Navbar from "@/components/ui/Navbar";
import { ToastContainer } from "@/components/ui/Toast";

import "./globals.css";

/** Body text. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/** Numerics, labels, addresses. */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

/** Display headings. */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MoveX Equities",
    template: "%s · MoveX Equities",
  },
  description:
    "Volatility markets on US equities, settled on Solana. Pick a threshold, pick a side, and let the session play out.",
  applicationName: "MoveX Equities",
};

export const viewport: Viewport = {
  themeColor: "#06070A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} ${spaceGrotesk.variable} dark`}>
      <body className="min-h-screen flex flex-col bg-background text-foreground font-sans antialiased">
        <Background />
        <Providers>
          <Navbar />
          <main className="relative z-10 flex-1 flex flex-col">{children}</main>
          <Footer />
          <ToastContainer />
        </Providers>
      </body>
    </html>
  );
}
