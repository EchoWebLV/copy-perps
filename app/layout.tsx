import type { Metadata, Viewport } from "next";
import { PrivyClientProvider } from "@/components/providers/PrivyClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "gwak.gg",
  description: "Trade. Watch. Grow.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "gwak.gg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0a",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PrivyClientProvider>{children}</PrivyClientProvider>
      </body>
    </html>
  );
}
