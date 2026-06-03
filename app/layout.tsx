import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PrivyClientProvider } from "@/components/providers/PrivyClientProvider";
import { PostHogProvider } from "@/components/providers/PostHogProvider";
import "./globals.css";

const isVercelDeployment = process.env.VERCEL === "1";

export const metadata: Metadata = {
  title: "gwak.gg",
  description: "Watch the whales. Tail the signal.",
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
        <PostHogProvider>
          <PrivyClientProvider>{children}</PrivyClientProvider>
        </PostHogProvider>
        {isVercelDeployment ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
