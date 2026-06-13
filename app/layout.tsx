import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PrivyClientProvider } from "@/components/providers/PrivyClientProvider";
import { PostHogProvider } from "@/components/providers/PostHogProvider";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import "./globals.css";

// Single variable family with a width axis: normal widths for UI text,
// condensed cuts (font-stretch) for the hypebeast display headlines.
// Loading it here is what makes the brand render the same on
// Android/Windows instead of falling back to Arial Narrow.
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  axes: ["wdth"],
  display: "swap",
});

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
  themeColor: "#0e0d10",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <PostHogProvider>
          <PrivyClientProvider>{children}</PrivyClientProvider>
        </PostHogProvider>
        <RegisterSW />
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
