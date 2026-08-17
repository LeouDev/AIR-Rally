import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://airrally.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Air/Rally — Play More. Rally More.",
    template: "%s | Air/Rally",
  },
  description:
    "Discover and book pickleball courts near you with Air/Rally.",
  keywords: [
    "pickleball",
    "pickleball courts",
    "court booking",
    "book a court",
    "pickleball near me",
  ],
  openGraph: {
    type: "website",
    siteName: "Air/Rally",
    title: "Air/Rally — Play More. Rally More.",
    description:
      "Discover and book pickleball courts near you with Air/Rally.",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Air/Rally — Play More. Rally More.",
    description:
      "Discover and book pickleball courts near you with Air/Rally.",
    images: ["/brand/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0a121f" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Nonce-based CSP (src/proxy.ts) only reaches script tags on dynamically
  // rendered pages — a statically prerendered page has no request to read a
  // nonce from, so its bundled scripts ship with no nonce and get blocked.
  // This forces every route in the app to render per-request.
  await connection();

  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </body>
    </html>
  );
}
