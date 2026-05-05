import { MockReel } from "./MockReel";

export const metadata = {
  title: "gwak.gg — how it works",
};

// Scoped override: the root layout wraps every route in `.phone-frame`
// (a 390×844 box on desktop). For /mock the phone is the content itself,
// so we undo that container while this page is mounted. React 19 hoists
// this <style> to <head>; it's removed on navigation away.
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

export default function MockPage() {
  return (
    <>
      <style>{FULL_BLEED_CSS}</style>
      <main
        className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-black"
        style={{
          background:
            "radial-gradient(circle at 30% 35%, rgba(74,222,128,0.10), transparent 55%), radial-gradient(circle at 70% 70%, rgba(167,139,250,0.12), transparent 55%), #000",
        }}
      >
        <MockReel />
      </main>
    </>
  );
}
