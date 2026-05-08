import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs · gwak.gg",
  description: "How gwak.gg works. The feed, the rails, stakes, closes, funding, and fees.",
  robots: { index: false, follow: false },
};

const sections = [
  { id: "feed", label: "The feed" },
  { id: "rails", label: "The three rails" },
  { id: "stake", label: "Placing a stake" },
  { id: "close", label: "Closing a position" },
  { id: "funding", label: "Funding" },
  { id: "withdraw", label: "Withdrawing" },
  { id: "fees", label: "Fees and gas" },
  { id: "watchlist", label: "Watchlist" },
  { id: "gwak-take", label: "Gwak's take" },
  { id: "control", label: "What you control" },
];

export default function DocsPage() {
  return (
    <div className="min-h-dvh bg-black text-white">
      <div className="mx-auto max-w-3xl px-6 pb-32 pt-10 sm:px-8 sm:pt-16">
        <Header />
        <Hero />
        <TOC />

        <article className="mt-16 space-y-16">
          <Section
            id="feed"
            kicker="01"
            title="The feed"
            blurb="One vertical scroll. Three kinds of opportunities. Each card is a chance to act."
          >
            <p>
              gwak.gg is a single feed that mixes three different ways to put
              money in motion. You scroll up to see the next card, you scroll
              down to revisit the last one. Cards are ranked by heat, not time,
              so what you see at the top is whatever the rest of the feed is
              piling into right now.
            </p>
            <p>
              You can also pick which rails appear in your feed from the rail
              picker. If you only want memes, set it to memes. If you want
              everything, leave it on all three. Your pick is remembered for
              next time.
            </p>
          </Section>

          <Section
            id="rails"
            kicker="02"
            title="The three rails"
            blurb="Each card is one of three flavours. They share the same controls so the muscle memory carries across."
          >
            <RailRow
              tint="#ff5e3a"
              name="Memes"
              one="Buy a hot Solana token."
              detail="A meme card surfaces a token that the market is currently piling into. Tap a stake and you are buying that token with USDC at the live market price. You hold it until you close. Closing sells it back to USDC."
            />
            <RailRow
              tint="#3b82f6"
              name="Markets"
              one="Bet YES or NO on an event."
              detail="A market card is a real prediction market: an event with a yes-or-no outcome and live odds priced by the rest of the market. Tap YES or NO, pick a stake, and you own a position that pays $1 per share if your side wins. You can sell out before the event resolves at the market price."
            />
            <RailRow
              tint="#a855f7"
              name="Whales"
              one="Tail or fade a tracked trader."
              detail="A whale card shows a position a tracked trader just opened or sized up. Tail copies their direction (long if they are long), fade does the opposite. Your trade is sized in USDC, not theirs, and runs as a leveraged perp on Solana. You exit when you exit, not when they do."
            />
          </Section>

          <Section
            id="stake"
            kicker="03"
            title="Placing a stake"
            blurb="Four buttons. Pick one. The position is live within seconds."
          >
            <p>
              Every card has the same four stake buttons across the bottom:
              $5, $10, $20, $50. Tap one and you confirm the trade in your
              wallet. The button flashes green when the on-chain confirmation
              comes back, and a fresh row shows up in your portfolio.
            </p>
            <p>
              You do not need to set slippage, pick a venue, or babysit a
              swap screen. The price you see on the card is the price you are
              taking, and the size you tap is the size you get.
            </p>
          </Section>

          <Section
            id="close"
            kicker="04"
            title="Closing a position"
            blurb="Open positions live in your portfolio. One tap closes them."
          >
            <p>
              Your portfolio lists everything you currently hold across the
              three rails, with a live PnL number on each row. Hit close on
              any row and gwak builds the exit trade, you sign once, and the
              proceeds land back in your USDC balance.
            </p>
            <p>
              You can close at any time. Markets close at the live market
              price. Memes close at the live token price. Whale trades close
              the perp at the live mark. There are no time locks and no
              minimum holds.
            </p>
            <p>
              Resolved markets settle automatically. If your YES side wins,
              the dollar-per-share payout is credited back without you needing
              to do anything.
            </p>
          </Section>

          <Section
            id="funding"
            kicker="05"
            title="Funding"
            blurb="Send USDC on Solana to your gwak address. That is the whole flow."
          >
            <p>
              The first time you sign in, gwak gives you a Solana wallet that
              holds your USDC. Settings shows the address, a QR code, and a
              copy button. Send USDC from any exchange or wallet that supports
              Solana, and the balance updates as soon as the transfer
              confirms, usually within a few seconds.
            </p>
            <p>
              Only USDC on Solana works for funding. Sending a different token
              or a different chain will not credit your account, so if you
              are not sure, double-check the network in your sending wallet
              before you hit send.
            </p>
          </Section>

          <Section
            id="withdraw"
            kicker="06"
            title="Withdrawing"
            blurb="Move your USDC out to any Solana address you control."
          >
            <p>
              Withdraw lets you send your USDC balance off gwak to any Solana
              address. Paste the destination, pick the amount, sign, and the
              transfer broadcasts immediately. There is no withdrawal hold and
              no review step on our side.
            </p>
            <p>
              If part of your balance is in a settled prediction market
              currency, gwak quietly converts it to USDC for you on the way
              out, so you always withdraw a single, clean USDC number.
            </p>
          </Section>

          <Section
            id="fees"
            kicker="07"
            title="Fees and gas"
            blurb="A small flat fee on opens. Closes and withdraws are free. Gas is on us."
          >
            <p>
              Opening a position costs a flat 0.5% of your stake plus $0.05.
              That is the only platform fee. Closing a position, withdrawing,
              and depositing are all free.
            </p>
            <p>
              Solana network fees on every action you take, opening, closing,
              withdrawing, are paid by gwak, not by you. You never need to
              hold SOL to use the app. Your balance is just USDC, and that is
              the only thing you ever spend.
            </p>
            <p>
              Underneath each rail there can also be a market-side cost: the
              spread when you buy or sell a memecoin, the bid-ask on a
              prediction market, the funding rate on a perp. Those are not
              gwak fees, they are the cost of the underlying market, and they
              are already baked into the price you see on the card.
            </p>
          </Section>

          <Section
            id="watchlist"
            kicker="08"
            title="Watchlist"
            blurb="Bookmark anything in the feed. Come back to it from your portfolio."
          >
            <p>
              Tap the bookmark on any card to add it to your watchlist. The
              watchlist is a private shortlist that lives next to your open
              positions. It is useful when something looks interesting but
              you do not want to size in yet, or when you want to track an
              event whose card has already scrolled past.
            </p>
            <p>
              Watchlisting is not a stake. Nothing is bought, nothing is
              risked. Removing a watchlist entry is one tap.
            </p>
          </Section>

          <Section
            id="gwak-take"
            kicker="09"
            title="Gwak's take"
            blurb="A second opinion on any card, on demand."
          >
            <p>
              Every card has a small bot icon. Tap it and Gwak gives you a
              quick read: what the card is, why it is hot, what the obvious
              risks are, and how it stacks up against similar plays in the
              feed.
            </p>
            <p>
              Treat it as a sanity check, not a signal. It is meant to fill in
              the context the card itself cannot fit, not to tell you what to
              do.
            </p>
          </Section>

          <Section
            id="control"
            kicker="10"
            title="What you control"
            blurb="Every move is signed by you. Nothing happens behind your back."
          >
            <p>
              gwak does not custody your funds. Your USDC sits in a wallet
              tied to your login, and every action that moves money, opening,
              closing, withdrawing, requires your signature. We build the
              transaction, you approve it, the network does the rest.
            </p>
            <p>
              If you stop using gwak, you can withdraw your full balance at
              any time. There is no lock-up and no minimum.
            </p>
          </Section>
        </article>

        <Footer />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center justify-between">
      <Link
        href="/feed"
        className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/45 transition hover:text-white"
      >
        ← gwak.gg
      </Link>
      <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/35">
        v1
      </span>
    </div>
  );
}

function Hero() {
  return (
    <header className="mt-12">
      <div className="font-mono text-[11px] uppercase tracking-[0.32em] text-emerald-300/80">
        documentation
      </div>
      <h1 className="mt-4 text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl">
        How <span className="welcome-grad">gwak</span> works.
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-white/65 sm:text-lg">
        A short tour of the product. What the feed is, what the three rails do,
        how a stake becomes a position, and how money moves in and out.
      </p>
    </header>
  );
}

function TOC() {
  return (
    <nav className="mt-10 flex flex-wrap gap-2">
      {sections.map((s, i) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] font-medium text-white/70 transition hover:border-white/25 hover:text-white"
        >
          <span className="mr-2 font-mono text-[10px] tabular-nums text-white/35">
            {String(i + 1).padStart(2, "0")}
          </span>
          {s.label}
        </a>
      ))}
    </nav>
  );
}

function Section({
  id,
  kicker,
  title,
  blurb,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-12">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] tabular-nums tracking-wider text-white/35">
          {kicker}
        </span>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h2>
      </div>
      <p className="mt-3 max-w-2xl text-sm uppercase tracking-[0.18em] text-white/45">
        {blurb}
      </p>
      <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-white/75">
        {children}
      </div>
    </section>
  );
}

function RailRow({
  tint,
  name,
  one,
  detail,
}: {
  tint: string;
  name: string;
  one: string;
  detail: string;
}) {
  return (
    <div
      className="rounded-2xl border bg-white/[0.02] p-5"
      style={{ borderColor: `${tint}33` }}
    >
      <div className="flex items-center gap-3">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: tint, boxShadow: `0 0 12px ${tint}` }}
        />
        <span
          className="text-base font-semibold"
          style={{ color: tint }}
        >
          {name}
        </span>
        <span className="text-sm text-white/55">{one}</span>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed text-white/75">
        {detail}
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-white/5 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4 text-[12px] text-white/40">
        <span className="font-mono uppercase tracking-[0.28em]">
          gwak.gg / docs
        </span>
        <Link
          href="/feed"
          className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 font-semibold uppercase tracking-[0.18em] text-emerald-300 transition hover:bg-emerald-400/20"
        >
          Back to feed →
        </Link>
      </div>
    </footer>
  );
}
