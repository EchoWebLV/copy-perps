export const metadata = {
  title: "Breach Mobile",
};

export default function MobilePresentationPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center overflow-hidden bg-[#151417] px-4 py-6 text-white sm:px-8">
      <div className="relative h-[min(844px,calc(100dvh-48px))] w-full max-w-[390px] aspect-[390/844] rounded-[42px] border border-white/15 bg-black p-[10px] shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
        <div className="pointer-events-none absolute left-1/2 top-[17px] z-10 h-[5px] w-16 -translate-x-1/2 rounded-full bg-white/20" />
        <div className="h-full overflow-hidden rounded-[32px] bg-black">
          <iframe
            title="Breach mobile app"
            src="/feed"
            className="h-full w-full border-0 bg-black"
            allow="clipboard-write"
          />
        </div>
      </div>
    </main>
  );
}
