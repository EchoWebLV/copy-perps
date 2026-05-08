import { MoonPayReel } from "./MoonPayReel";

export const metadata = {
  title: "gwak.gg — add money",
};

const FULL_BLEED_CSS = `
@media (min-width: 768px) {
  body {
    display: block !important;
    height: auto !important;
    min-height: 100dvh !important;
    overflow: visible !important;
    background: #000 !important;
  }
  .phone-frame {
    width: 100vw !important;
    max-width: none !important;
    height: 100dvh !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    transform: none !important;
    isolation: auto !important;
    overflow: hidden !important;
  }
}
`;

export default function MoonPayMockPage() {
  return (
    <>
      <style>{FULL_BLEED_CSS}</style>
      <main
        className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-black"
        style={{
          background:
            "radial-gradient(circle at 30% 35%, rgba(123,102,255,0.10), transparent 55%), radial-gradient(circle at 70% 70%, rgba(74,222,128,0.10), transparent 55%), #000",
        }}
      >
        <MoonPayReel />
      </main>
    </>
  );
}
