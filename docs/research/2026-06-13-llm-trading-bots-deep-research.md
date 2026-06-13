I'll write this report directly. The research corpus and verified claims are comprehensive enough to synthesize the definitive reference. Let me produce it as my final response.

Before I do, one note on a citation hygiene issue I'll flag inline: several `arxiv.org` IDs in the corpus (e.g. `2605.16895`, `2602.18481`, `2605.19337`, `2602.07085`) carry year prefixes (26xx, implying 2026) that are internally consistent with the corpus's stated dates but which I cannot independently confirm resolve — I cite them as given and mark the ones whose existence I'd verify before load-bearing use.

---

# LLM-Driven Trading Bots: A Definitive Reference Briefing

*For the engineer who built the on-chain oracle-bot arena (Claude Opus 4.8 + Grok 4.3, crypto perps, MagicBlock ER on Solana devnet). Written 2026-06-13.*

---

## 1. Executive summary

1. **LLMs cannot reliably trade crypto perps profitably net of fees — this is the consensus finding, not a hedge.** Across StockBench (2025), FINSABER, LiveTradeBench and the Alpha Arena live competition, most agents underperform buy-and-hold once realistic costs are applied (https://arxiv.org/html/2510.02209v2; https://protos.com/llm-crypto-trading-contest-finds-llms-cant-trade-crypto/).
2. **Discipline beats signal. Position sizing and a hard risk layer dominate directional accuracy for survival** — removing a deterministic sizing module roughly doubled max drawdown (42%→83%) in documented ablations; Brinson-style attribution puts ~91% of return variability on allocation, not selection (https://arxiv.org/pdf/2510.27251). Your immutable on-chain safety floor is the single most defensible thing you've built.
3. **The Alpha Arena result (Qwen 3 Max +22%, GPT-5 −40%, Gemini −57%, Grok −45%, Claude −31%) is real but is a coin-flip-grade sample** — one 2–3 week window, no winner replication across seasons; treat it as variance, not skill (https://www.iweaver.ai/blog/alpha-arena-ai-trading-season-1-results/).
4. **LLM decisions are unstable run-to-run even at temperature 0**, so any single-run backtest is untrustworthy; the instability is mainly at the *strategy-generation* step, less so within a fixed generated strategy (https://arxiv.org/html/2408.04667v5).
5. **Reported "memory/reflection" wins (FinAgent +36% profit, FinMem) largely evaporate out-of-sample and are contaminated by information leakage** — FinMem MSFT flips from +23% to −22% when the window extends two months; 82%+ leakage scores indicate memorized patterns, not learned signal (https://arxiv.org/pdf/2510.07920).
6. **Frontier benchmark rank does NOT predict trading skill** — LiveTradeBench found ~zero correlation (Spearman 0.054 stocks) between LMArena scores and live returns, and **zero generalization across market types** (https://arxiv.org/abs/2511.03628). Your "model is the only variable" framing is sound; assuming "smarter model = better trader" is not.
7. **Separate reasoning from execution.** The most defensible architecture uses the LLM as an *auditable information interface* upstream of independent, deterministic calibration/risk/execution modules — never feeding LLM "confidence" straight into position size (https://arxiv.org/abs/2605.16895 [year-prefix unverified]).
8. **High-conviction, low-frequency wins; overtrading is the dominant killer.** Alpha Arena's Gemini bled 13%+ of capital to fees over 238 trades; ~2–3 trades/day strategies dominated (https://www.iweaver.ai/blog/alpha-arena-ai-trading-season-1-results/). Your blind 4-min cadence (~360 decisions/day potential) is a fee-and-noise hazard the on-chain cooldown/daily-cap partially contains.
9. **On-chain, unfakeable track records are a genuine, under-exploited trust moat** — the regulatory and copy-trading literature treats verifiability as the scarce asset (https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/AITradingBots.html; https://docs.numer.ai). This is your strongest product wedge, stronger than the alpha itself.
10. **LLM trading agents are an open attack surface** — prompt injection via news can invert signals (Sharpe 5.72→0.29), memory poisoning turns +12.7% into −2%, and a single hijacked price feed causes persistent state corruption (https://arxiv.org/html/2512.02261v1). Your stub sentiment oracle is an injection vector; your on-chain book is the right anti-state-tampering pattern.

---

## 2. The landscape — frameworks and what to steal

### The open-source / academic field

| Framework | What the LLM decides | Architecture | Maturity | Steal / Ignore |
|---|---|---|---|---|
| **TradingAgents** (TauricResearch) | Final buy/hold/sell after multi-agent debate | LangGraph: analyst team → bull/bear researchers → trader → risk/portfolio manager; `propagate(ticker, date)` (https://github.com/TauricResearch/TradingAgents) | Active, multi-provider (GPT-5.x, Gemini 3.x, Claude 4.x, Grok, DeepSeek, etc.) | **Steal:** deep-think vs quick-think LLM split (`deep_think_llm`/`quick_think_llm`), decision-tape persistence to `trading_memory.md`. **Ignore:** the headline backtest — outperformance is cherry-picked (see §4). |
| **FinRobot** | Strategy config via Financial CoT | 4-layer platform (AI agents → LLM algorithms → LLMOps/DataOps → foundation models) (https://arxiv.org/abs/2405.14767) | Platform announcement; crypto specifics thin | Steal the layering vocabulary; ignore as a turnkey trader. |
| **FinMem / FinAgent** | Buy/hold/sell with memory + reflection | Layered memory (FinMem 3-tier), dual-level reflection (FinAgent) (https://arxiv.org/abs/2311.13743; https://arxiv.org/abs/2402.18485) | Research-grade | Steal the *memory decay* idea (§3); treat reported returns as leakage-inflated (§4). |
| **TradingGroup** | Forecast + decision with adaptive SL/TP | Specialized agents + data-synthesis SFT pipeline (https://arxiv.org/abs/2508.17565) | Research | **Steal:** their *volatility-scaled* SL/TP formulas and adaptive sizing (§3, §5) — directly applicable to your stop/TP. |
| **QuantAgent** | LONG/SHORT over 3-candle horizon | 4 agents (Indicator/Pattern/Trend/Risk) via LangGraph (https://arxiv.org/abs/2509.09995) | Research | **Steal:** the explicit indicator decomposition. **Heed:** "inference latency can exceed the exploitable window" — a direct warning about LLM-cadence trading. |
| **virattt/ai-hedge-fund** | Multi-analyst equity picks | Persona analysts (Buffett/Munger/etc.) → portfolio manager | Popular OSS | Educational; no rigorous live results — ignore for alpha. |
| **FinGPT** | Sentiment / instruction-tuned outputs | Fine-tuned finance LLM | Active | Useful as a *sentiment* component, not a trader. |
| **AlphaAgent / RD-Agent / QuantaAlpha** | Generate *alpha factors*, not trades | LLM-as-quant-researcher; evolutionary factor mining (https://arxiv.org/abs/2602.07085 [year-prefix unverified]) | 2026 frontier | **Steal the paradigm shift** (§3, §8): LLM produces factors/strategies that are then deterministically backtested — this kills run-to-run execution instability. |

### The one architectural lesson that subsumes the table

The single most important meta-finding: **agent *architecture* drives behavior more than the model backbone does.** The ArXiv 2510.11695 benchmark (InvestorAgent/TradeAgent/HedgeFundAgent/DeepAgentFund across GPT-4o/4.1, Claude-3.5-haiku/sonnet-4, Gemini-2.0-flash) found "agent frameworks display markedly distinct behavioral patterns… model backbones contribute less to outcome variation than architecture choice" (https://arxiv.org/abs/2510.11695). **Implication for you:** the "same brief + same floor, model is the only variable" design is scientifically clean *but* it isolates the *weakest* lever. The bigger swings live in the harness you share across both bots.

---

## 3. What the best systems actually do (evidence-backed techniques)

### 3.1 Decouple reasoning from execution
The strongest structural recommendation in the literature: use the LLM as an "auditable information interface upstream of independent calibration, risk, and execution modules," so narrative confidence never becomes a tradable probability and model priors don't leak in as undisclosed factor exposures (https://arxiv.org/abs/2605.16895 [unverified prefix]). AlphaForgeBench makes the sharper version: reframe the LLM as a *quantitative researcher generating alpha factors/strategies*, which "eliminates execution-induced instability" and enables deterministic, reproducible evaluation (https://arxiv.org/abs/2602.18481 [unverified prefix]). **You already do a soft version** (LLM emits a structured decision, TS guardrail + Anchor floor execute) — the floor is your deterministic layer. The gap is that the LLM still chooses leverage/side/stake directly rather than emitting a *signal* that a deterministic sizer converts.

### 3.2 Memory done right (and the trap)
- FinMem's three-tier memory (shallow=daily, intermediate=weekly, deep=quarterly) with **different decay rates** and recency/relevancy/importance scoring is the credible design (https://arxiv.org/abs/2311.13743).
- FinAgent's **dual-level reflection** (low-level on price patterns, high-level on decision quality) and **split retrieval** (trading-task summaries vs retrieval queries, to suppress noise) is the credible refinement (https://arxiv.org/abs/2402.18485).
- TradingGroup reflects over the **last 20 days** of labeled wins/losses with an auto-compiled "experience summary" (https://arxiv.org/abs/2508.17565).

**The trap, stated plainly:** the reported gains from these systems are heavily leakage-driven. FactFin/FinLake-Bench shows FinMem's 0.82 memorization score and a +23%→−22% MSFT collapse on a 2-month window extension (https://arxiv.org/pdf/2510.07920). And in a controlled bubble-market study, *adding* prior-session history + CoT notes **changed nothing** — MAE, realized profit, and forecast accuracy were identical with vs without memory (https://arxiv.org/html/2502.15800v3). So: memory's *structure* is worth copying; memory's *reported alpha* is not. If you add memory, add it with an **outcome embargo** (an episode recorded at t may not expose its outcome until current_time ≥ t+k) to prevent the "Oracle Fallacy" of post-hoc narratives (https://arxiv.org/html/2605.19337v1 [unverified prefix]).

### 3.3 Volatility-scaled risk parameters (directly liftable)
TradingGroup's adaptive stops are concrete and regime-aware:
- `TSL = ms_sl × σ_d,10` and `TTP = ms_tp × σ_d,10`, where `σ_d,10` is the unannualized std-dev of daily log-returns over 10 days, and `ms_*` are style multipliers (https://arxiv.org/abs/2508.17565).
- Their `SimplifiedATR20 = (100/20)·√(mean(ln(Pt/Pt-1)²) − r20²)` feeds a breakout threshold `max(1%, 0.5×SimplifiedATR20)`.

QuantAgent's RiskAgent uses a fixed stop `ρ=0.0005` with an LLM-predicted risk-reward `r∈[1.2,1.8]` for TP (https://arxiv.org/abs/2509.09995). **For you:** your stop is mandatory but (per your gap list) crude/symmetric. Replacing a flat `stopLossPct` with an ATR/σ-scaled stop is a small, high-evidence upgrade and you *already compute ATR* in the brief.

### 3.4 Decision schema and prompt context (state of the art)
- **Structured JSON output + ReAct-style reasoning** is standard. LiveTradeBench: ReAct prompt, dynamic context (prices, 10-day history, news summaries), JSON schema, **temperature 0.3**, max_tokens 16k, news window [t-3,t-1] (3-day lag), 10-day price lookback (https://arxiv.org/abs/2511.03628).
- **Delaying actions hurts:** LiveTradeBench's k-delta ablation found k=2 optimal and that delaying agent actions by k days "systematically harms performance." Freshness matters.
- **Numeric time-series is a known LLM weakness** — Alpha Arena explicitly noted "LLMs struggle with numerical time series data" (https://protos.com/llm-crypto-trading-contest-finds-llms-cant-trade-crypto/), which is *why* pre-computing EMA/RSI/MACD/ATR into the brief (as you do) is the right call: don't make the model do arithmetic on raw candles.
- **Temperature is under-tested.** 0.3 is the common default but *no* major study tests temperature sensitivity rigorously — a known blind spot you can exploit as an experiment.

### 3.5 Regime awareness
The recurring failure (StockBench, the bubble study, FINSABER) is that agents win in bull markets and collapse in downturns; "LLM agents typically outperform in bull markets but fail during downturns, making them unreliable diversifiers" (https://arxiv.org/html/2510.02209v2). The best systems either (a) inject a regime label into context (TradingGroup uses RSI/HV thresholds: HV-10 <20% = sideways), or (b) carry an explicit risk-seeking/risk-averse switch (FinMem flips when cumulative return goes negative in a 3-day window). Your brief has the *inputs* for regime detection (vol, funding, OI, long/short) but no explicit regime label — adding one is cheap.

---

## 4. Does any of it make money? (the honest answer)

**Net of fees, the weight of evidence is: no, not reliably.**

### The skeptical canon
- **Most agents lose to buy-and-hold net of costs.** "Most LLM trading agents underperform buy-and-hold after accounting for realistic transaction costs (0.05–0.1%+)," with the knowledge-execution gap as the root cause — strong financial QA does not transfer to profitable trading (https://arxiv.org/html/2510.02209v2).
- **The 500× rationality gap.** In controlled markets LLMs trade "textbook-rational" (Claude-3.5 MSE 0.536 from fundamental value vs human MSE 429.8), which means human momentum traders arbitrage them out of exactly the regimes where money is made (https://arxiv.org/html/2502.15800v3). Model personalities differ: Grok-2 is 68% speculative language (bubble-prone), Claude is 82.8% fundamental-focused (bubble-suppressing) — relevant since you run Claude vs Grok.
- **No emergent learning.** Frozen weights + prompt strategy means a miscalibrated bot cannot self-correct from sustained losses (https://arxiv.org/html/2502.15800v3).
- **Scalability cliff.** Positive returns vanished at ~30 stocks even for the largest model tested; crypto exchanges list 100–500 pairs (https://arxiv.org/html/2510.02209v1). Your SOL/BTC/ETH universe is *safely* on the right side of this cliff — a real design virtue.

### Where the headline numbers come from (and why to distrust them)
- **TradingAgents:** reported 23%+ returns, Sharpe 5.60+ on Jan–Mar 2024 with seed=42. Independent reproduction: stochastic runs at T=1 mean 15.8–18.1%, which **do not consistently beat buy-and-hold (17.4–19.1%)**; the seed=42 number is cherry-picking (https://dl.acm.org/doi/10.1145/3800973.3801029). *Verdict: confirmed cherry-pick.*
- **FinAgent +36% / FinMem:** accurate as *backtested* on 6 assets 2020–2024, but the window overlaps LLM training data, leakage scores are 82%+, and extending the window two months reverses Sharpe from +1.44 to −1.25 (https://arxiv.org/pdf/2510.07920). *Verdict: partly-true, leakage-inflated.*
- **Six structural validity failures** invalidate most reported alpha: temporal integrity/lookahead, real-world frictions, counterfactual robustness, predictive calibration, numerical execution fidelity, multi-agent disaggregation. Named targets: FinCon, FinMem, TradingAgents, FinAgent, QuantAgent, FLAG-Trader (https://arxiv.org/abs/2605.16895 [unverified prefix]).

### Alpha Arena (nof1.ai) — what it really showed
Confirmed facts: **Season 1, Oct 18–Nov 3 2025**, six frontier LLMs, **$10,000 each, real money, Hyperliquid perps**, identical data/feeds. Results: **Qwen 3 Max +22.3%** (43 trades, 30% win rate, ~2.5/day), DeepSeek V3.1 +4.89% (0.359 Sharpe, best risk-adjusted, 92% long, 35h holds), then **Claude Sonnet 4.5 −30.8%, Grok 4 −45.3%, Gemini 2.5 Pro −56.7%, GPT-5 −62.7%**. Win rates 25–30% across the board (https://www.iweaver.ai/blog/alpha-arena-ai-trading-season-1-results/).

What it actually demonstrated:
- **Overtrading is fatal:** Gemini's 238 trades burned $1,331 (13%+ of capital) in fees (https://www.iweaver.ai/blog/...). Even the winner paid $1,654 in fees.
- **Behavior is personality-like, not optimized:** Grok/GPT/Gemini shorted aggressively; Claude maintained ~100% long with no dynamic stop-loss. GPT-5's "safety layers became liabilities," freezing on conflicting signals (https://protos.com/...).
- **It was not skill.** The verified verdict: one 2–3 week window is too small to separate luck from ability; DeepSeek swung +125% mid-competition; and **no consistent winner has emerged across Seasons 1.5 and 2** — replication has failed (https://www.iweaver.ai/blog/alpha-arena-ai-trading-season-1-results/). Protos's framing — "LLMs can't trade crypto" — overstates, but the leaderboard is noise dressed as signal.

**Bottom line for your arena:** the *honest* product framing is "a transparent, on-chain experiment in whether models can trade," not "an AI hedge fund that makes money." The CFTC prohibits exactly the latter framing (guaranteed/implausible returns; see §7/§9).

---

## 5. Risk & discipline — the science that discipline > signal

### The core evidence
- Removing a deterministic **position-sizing module nearly doubled max drawdown (42%→83%)**; systematic sizers showed **3.2× higher survival**; Brinson (1991) attributed **~91% of return variability to allocation** (https://arxiv.org/pdf/2510.27251). *Verified: confirmed.* This is the empirical backbone of "the floor matters more than the model."
- The caveat in the same verdict: sizing is *dominant, not exclusive* — catastrophically bad signal still fails even with good sizing.

### The toolkit (and the crypto-perp corrections)
- **Fixed-fractional:** `Position = (Balance × Risk%) / (Entry − Stop)`, typically 1–2%/trade. Auto-scales with account; ignores volatility (https://www.investopedia.com/terms/f/fixed-fractional-position-sizing.asp).
- **Kelly:** `f* = (bp − q)/b`. Full Kelly → 20–40% sizes; practitioners use **0.25–0.5× fractional Kelly**. **Kelly assumes infinite capital and independent trades — both violated by leveraged, correlated-liquidation perps** (https://www.amazon.com/Portfolio-Management-Formulas.../dp/0471549192).
- **Volatility targeting:** `Position = Base × (TargetVol / CurrentVol)` holds expected P&L volatility constant across regimes — *especially* valuable in perps because funding spikes during volatility, so constant-vol sizing cuts forced-liquidation probability (https://quantiacs.com/blog/post/position-sizing-techniques).
- **The crypto-perp synthesis:** size on the **underlying account (0.5–1%), not leveraged notional**; multiply down on low-conviction; **hard-cap leverage at 3–5×** to preserve an equity buffer against maintenance-margin liquidation (https://www.amazon.com/Portfolio-Management-Formulas.../dp/0471549192). Nautilus Trader's production pattern (max_notional per instrument, portfolio-level constraints, real-time margin awareness) is the reference implementation (https://github.com/nautilus-trader/nautilus_trader).

### The pattern you should institutionalize
"A deterministic risk layer wrapping the model" is the recommended design and **you have the best version of it: an immutable Anchor program enforcing leverage clamp, mandatory stop, cooldown, daily cap, daily-loss/HWM kill-switch, confidence floor.** The science says this is the right priority order. **The one glaring gap: risk-based sizing is OFF.** Per the evidence (drawdown doubling), turning on volatility-scaled, account-fraction sizing is plausibly your highest-impact change after the eval harness (see §10).

---

## 6. Evaluation — how not to fool yourself

This is your single largest *methodological* gap (no eval harness, no Sortino/benchmark). The trust standard:

1. **Benchmark against buy-and-hold AND levered buy-and-hold.** Most "wins" vanish against passive holds (https://arxiv.org/html/2510.02209v2). For perps, the relevant benchmark is *levered* hold at the same average leverage — otherwise you flatter the bot.
2. **Risk-adjusted, downside-aware metrics:** Sortino (downside-only), Calmar/MAR (return/max-DD). Raw Sharpe over-credits upside vol. *Critically for perps: a low-Sortino-but-liquidated agent is worth $0 — Sortino ignores tail/liquidation risk entirely* (https://arxiv.org/html/2510.02209v1). Track liquidation probability and margin ratio as first-class metrics.
3. **Deflated Sharpe Ratio / PBO (Bailey & López de Prado).** Adjusts for the number of strategy trials and non-normal returns; PBO estimates the probability your backtest is overfit. (The corpus could not fetch the paywalled originals — https://doi.org/10.1080/14697688.2013.850986 — but this is the canonical standard; cite López de Prado's *Advances in Financial Machine Learning* directly.)
4. **Walk-forward / out-of-sample discipline.** No tuning on the test window. Crypto-specific leakage: sentiment models trained through late 2024 embed 2025 events, so a 2025 eval window is contaminated even when prices aren't (https://arxiv.org/html/2510.02209v1).
5. **Multi-seed / multi-temperature variance for LLMs.** Because single runs are unreliable (§1.4), report distributions across seeds. Note the corrected nuance: intra-query variance (same generated strategy) is ~an order of magnitude smaller than inter-query variance (re-generated strategy); the instability is mostly at generation, so re-running the *decision* many times per tick and measuring dispersion is the right probe (https://arxiv.org/html/2408.04667v5).
6. **Counterfactual robustness.** Perturb position sizes, leverage, rebalance frequency, regime filters. Fragile alpha fails these; FinMem-type systems showed 69–82% unchanged predictions under perturbation, a memorization tell (https://arxiv.org/pdf/2510.07920).
7. **The reproducibility bar almost nobody clears:** only 2/19 LLM-trading studies report time-consistent split protocols, 1/19 an explicit transaction-cost model, **0/19 reach full reproducibility** (https://arxiv.org/html/2605.19337v1 [unverified prefix]). If you publish your on-chain results with a documented cost model and seed protocol, you'd be ahead of nearly the entire literature.

---

## 7. Crypto-perp & on-chain specifics

### Funding as mechanic and signal
- **Funding rate** = `clamp(Premium + Interest − Premium, −d, +d)`, `Premium = (Mark − Index)/Index`. Hyperliquid: premium from impact-price differences over oracle, clamp ±0.0005, fixed interest 0.0001/8h (https://medium.com/@joaotx/inside-the-perpetual-the-mechanics-of-funding-rates-3896384695c7).
- **Magnitude is real money:** 1 BTC long at 83,950 with +0.01% funding = ~25.2 USDT/day (~11% annualized). Funding is a *carry cost and a sentiment signal* (positive funding = crowded longs). Your "crude symmetric funding proxy" understates this — asymmetric, magnitude-aware funding is a legitimate edge input and a cost you must net out in eval.
- **Impact prices** use depth-aware fill cost for 20,000 USDC notional per side — funding embeds liquidity, not just price.

### Liquidations
- Trigger when equity < maintenance margin (50% of initial margin at max leverage); maintenance ranges **1.25%–16.7%** by leverage tier (3×–40×) (https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations).
- **Partial liquidation** (positions >100k USDC, 10k testnet): 20% sent to book, 30s cooldown, then full liquidation. No clearance fee.
- `liq_price = price − side × margin_available / position_size / (1 − l·side)`, `l = 1/MAINTENANCE_LEVERAGE`. Cross vs isolated changes whether leverage moves the liq price.
- **Cascades** are the structural risk: forced liquidations trigger shocks LLMs have never trained on, producing severe anchoring (the GPT-3.5 pre-shock-anchoring failure) (https://arxiv.org/html/2502.15800v3). Your per-tick liq check + mandatory stop is the right defense.

### Latency — the binding constraint for LLM-cadence trading
- Latency taxonomy: **Reactive (ms, rule-based — LLMs excluded), Reflective (seconds, CoT), Strategic (minutes–hours, tree search).** "LLM reasoning is incompatible with millisecond finality requirements" — deliberation must be off the critical path (https://arxiv.org/html/2605.19337v1 [unverified prefix]). QuantAgent's blunt warning: "latency per inference cycle can exceed the window in which a 1-minute opportunity remains exploitable" (https://arxiv.org/abs/2509.09995).
- **Solana / your venue:** block time ~400ms, economic finality sub-second to a few seconds, fee ~$0.00025 (https://sanctum.so/blog/solana-speed-guide-2026). A **MagicBlock Ephemeral Rollup pushes execution into the 10s-of-ms range**, so your *infrastructure* latency is excellent. The binding constraint is your **~4-min LLM brain loop** — which is *correctly* in the "Strategic" band. The mismatch is not speed but **blindness between ticks**: a 4-min fixed cadence misses intra-tick liquidation triggers unless the per-tick on-chain stop/liq/max-hold logic runs independently (which yours does — keep it).

### On-chain execution & verifiable track records
- Solana perp venues: Drift, Flash, Byreal; Solana agent stacks exist. Your stack (Anchor program + ER + on-chain paper book) is architecturally current.
- **The verifiable track record is the moat.** Numerai's entire model is staked, verifiable prediction performance (https://docs.numer.ai); copy-trading literature treats an *auditable, non-backfillable* history as the scarce trust asset, with strict selection filters (>60% win rate over ≥50 closed positions, 4+ month track record) (https://medium.com/@0xmega/how-to-find-the-best-polymarket-wallets-to-copy-trade-without-getting-rekt-26dd65123324). **Your on-chain, non-backfillable decision tape is exactly this asset — and almost no competitor has it.**

---

## 8. The 2025–2026 frontier — what changed

1. **From "LLM-as-trader" to "LLM-as-quant-researcher."** The decisive shift. QuantaAlpha (evolutionary factor mining, GPT-5.2: IC 0.0472, ARR 4.68%, MDD 11.8% on CSI 300, with cross-market transfer) and AlphaForgeBench reframe the LLM as a generator of *alpha factors and strategies* that are then deterministically backtested — sidestepping run-to-run execution instability (https://arxiv.org/abs/2602.07085; https://arxiv.org/abs/2602.18481 [both year-prefixes unverified]).
2. **Live, leakage-resistant benchmarks arrived.** LiveTradeBench (21 models, 50-day live, US stocks + Polymarket) is the new standard, and its headline finding reframes everything: **benchmark rank ≠ trading skill, and zero cross-market generalization** (https://arxiv.org/abs/2511.03628). InvestorBench (ACL 2025, 13 backbones across stocks/crypto/ETFs) standardizes evaluation environments (https://aclanthology.org/2025.acl-long.126/).
3. **Information leakage got quantified and partially solved.** FactFin documents 50–71.85% return degradation post-knowledge-cutoff and proposes counterfactual simulation (SCG→RAG→MCTS→Counterfactual) yielding +31.9% avg return improvement with *lower* prediction consistency (the desired direction — less memorization) (https://arxiv.org/abs/2510.07920).
4. **Real money, public competition (Alpha Arena).** The first widely-watched live LLM perp contest — and its lesson was humility (§4).
5. **RL/fine-tuning matured but did not clearly win.** Reasoning-augmented RL (PPO, KL≈0.02, realized-P&L-only reward) beats direct action prediction; DPO reports +11% over SFT (67% annual, 2.0 Sharpe, 5bps costs) (https://arxiv.org/pdf/2509.11420; https://arxiv.org/abs/2507.18417). But the verified verdict is *partly-true*: fine-tuning helps on **narrow, stable-pattern tasks**; for broad strategy and especially **live** trading, a well-prompted frontier model is competitive and fine-tuned live results are rarely published. Fine-tuning also shows the in-distribution/out-of-sample paradox (+20.55% / −21.53%) — it memorizes (https://arxiv.org/abs/2510.07920).
6. **Adversarial robustness became a field (TradeTrap).** Trading agents are now studied as attack surfaces, not just predictors (§9).

---

## 9. Pitfalls and mitigations

| Pitfall | Evidence | Mitigation (and your status) |
|---|---|---|
| **Overtrading / fee bleed** | Gemini −13% to fees on 238 trades; low-freq strategies dominated (https://www.iweaver.ai/blog/...) | Conviction threshold before execution; cooldown + daily cap. *You have cooldown + daily cap — good; add a confidence-weighted minimum-edge gate.* |
| **Net-of-fee losses hidden by zero-cost backtests** | TradeTrap & most studies omit fees/slippage (https://arxiv.org/html/2512.02261v1) | Always model funding (0.01–0.1%/8h) + taker fees + spread. *Your funding proxy is crude — make it asymmetric and net it in eval.* |
| **Run-to-run instability / action flipping at temp 0** | Stateless autoregressive models flip across adjacent steps (https://arxiv.org/abs/2602.18481 [unverified]) | Position-aware state in context; hysteresis on flips; multi-sample-and-vote per tick. *Feed your on-chain book back in (you do) + add a flip penalty.* |
| **Prompt injection via news** | Inverts signals: return 7.81%→0.89%, Sharpe 5.72→0.29, freq 47→391, concentration →99.98% (https://arxiv.org/html/2512.02261v1) | Treat news as untrusted; Label-Disguise-Defense for sentiment labels (https://arxiv.org/abs/2511.21752); cross-check against price. *Your stub sentiment oracle is a live injection vector — sandbox it.* |
| **Memory poisoning / state tampering** | +12.7%→−2% return; NAV $5,000→$1,928 (61% loss) on tampered state (https://arxiv.org/html/2512.02261v1) | Tamper-evident, signed state. *Your on-chain book is the strongest possible mitigation — it's unfakeable. Keep the model reading on-chain truth, never a local mirror.* |
| **MCP / tool / price-feed hijack** | Single hijacked feed → persistent phantom-portfolio corruption (https://arxiv.org/html/2512.02261v1) | Cryptographically verify feed provenance; multi-source price. *Pin/sign your oracle feed; MagicBlock ephemeral-oracle PDAs help but verify trust-copy.* |
| **Hallucinated indicators/prices, arithmetic/schema errors** | ~5–8% arithmetic errors; schema errors rise with "thinking" models; a misplaced decimal during liquidation = portfolio wipe (https://arxiv.org/html/2510.02209v1) | Pre-compute indicators (you do); strict schema validation in the TS guardrail; clamp every numeric field. *Your guardrail pre-check is the right place — ensure it rejects out-of-range leverage/stake/SL, not just parses.* |
| **Regime collapse (bull-only competence)** | All agents failed vs passive in Jan–Apr 2025 downturn (https://arxiv.org/html/2510.02209v1) | Explicit regime label + risk-seeking/averse switch (FinMem 3-day rule). *Add a regime tag from your existing vol/funding/OI inputs.* |
| **Inference cost > edge** | QuantAgent: inference cycle exceeds 1-min opportunity (https://arxiv.org/abs/2509.09995) | Match cadence to strategy band; don't chase sub-minute. *Your 4-min cadence is appropriately "Strategic" — fine.* |
| **Survivorship / cherry-picking in reported results** | TradingAgents seed=42 cherry-pick (https://dl.acm.org/doi/10.1145/3800973.3801029) | Multi-seed reporting; pre-register windows. *Build into your eval harness.* |
| **Numeric time-series weakness** | "LLMs struggle with numerical time series" (https://protos.com/...) | Feed indicators, not raw candles (you do). |

---

## 10. What this means for OUR system — candid gap analysis

Your design is, by the standards of this literature, **unusually disciplined**: pre-computed indicators (avoids the numeric-time-series trap), a constrained 3-asset universe (avoids the 30-instrument scalability cliff), an immutable deterministic risk floor (the single most evidence-backed pattern), and an on-chain non-backfillable track record (the genuine moat). The gaps, ranked by **evidence-backed impact**:

### Rank 1 — Build the eval harness (Sortino/Calmar + buy-and-hold & levered-hold benchmark + multi-seed). *Highest leverage.*
**Why #1:** You currently cannot tell skill from variance — and the entire literature says that without this you *will* fool yourself (Alpha Arena, TradingAgents cherry-pick, §6). With two on-chain bots and an unfakeable tape, you are one harness away from being more rigorous than 17/19 published studies (only 2/19 report proper split protocols; 0/19 fully reproduce — https://arxiv.org/html/2605.19337v1). Add liquidation-probability and margin-ratio as first-class metrics, because Sortino alone scores a liquidated bot as merely "low-downside-vol" while it's actually $0 (https://arxiv.org/html/2510.02209v1). **This is the single highest-leverage move:** it converts your experiment from a demo into evidence, and it gates every other change (you can't know if sizing/memory helped without it).

### Rank 2 — Turn on risk-based sizing (volatility-scaled, account-fraction).
The drawdown-doubling and 3.2×-survival evidence (https://arxiv.org/pdf/2510.27251) make this the highest-*return* change. You already compute ATR/vol in the brief; implement `Position = Base × (TargetVol / CurrentVol)`, size on **account fraction (0.5–1%), not leveraged notional**, keep the 3–5× leverage clamp. Wire it into the Anchor floor or the TS guardrail so it's deterministic, not LLM-chosen. (Files: wherever the brief computes ATR; the guardrail pre-check; the `apply_decision` sizing path.)

### Rank 3 — Replace symmetric funding proxy with asymmetric, magnitude-aware funding.
Funding is ~11% annualized at 0.01% and is both a cost and a crowding signal (https://medium.com/@joaotx/...). A crude symmetric proxy mis-prices carry and corrupts your eval's net-of-fee numbers. This is cheap and improves both the decision *and* the honesty of your metrics.

### Rank 4 — Add an explicit regime label + risk switch to the brief.
You have the inputs (vol, funding, OI, long/short); you lack the label. The bull-only-competence failure is universal (§3.5, §9). A FinMem-style 3-day risk-seeking/averse flip plus an HV-based sideways/trend tag is a small prompt-context addition with regime-collapse mitigation upside.

### Rank 5 — ATR/σ-scaled stops (replace flat stopLossPct).
Lift TradingGroup's `TSL = ms_sl × σ_d,10` directly (https://arxiv.org/abs/2508.17565). Small change, regime-aware, uses data you already have.

### Rank 6 — Harden the sentiment oracle against injection (it's currently a stub *and* a vector).
Even as a stub it's the documented prompt-injection surface (signal inversion, Sharpe 5.72→0.29 — https://arxiv.org/html/2512.02261v1). When you build it for real: treat all text as untrusted, apply Label-Disguise-Defense (https://arxiv.org/abs/2511.21752), cross-validate sentiment against price, and **cryptographically pin the feed** (your MagicBlock ephemeral-oracle PDA path needs verified trust-copy per your own spec).

### Rank 7 — Memory/reflection: add the *structure*, not the *hype*, and only after the harness exists.
FinAgent dual-level reflection + 20-day labeled-outcome summaries (https://arxiv.org/abs/2402.18485; https://arxiv.org/abs/2508.17565) are worth a *measured* trial — but the leakage evidence (§3.2) and the "memory changed nothing" finding (https://arxiv.org/html/2502.15800v3) mean you must gate it behind the eval harness and an **outcome embargo** or you'll just overfit to noise. Lower priority precisely because its real-world payoff is unproven.

### Things you should NOT do
- Don't add more models for their own sake (#2 models is fine; architecture > backbone, and benchmark rank ≠ skill — https://arxiv.org/abs/2510.11695, https://arxiv.org/abs/2511.03628).
- Don't fine-tune/RL yet — for live trading it doesn't clearly beat well-prompted frontier models and it memorizes (§8).
- Don't speed up the cadence — 4 min is correctly "Strategic"; faster invites fee bleed and the inference-vs-opportunity-window trap.
- Don't ever frame this as a profit product (CFTC §9).

**The single highest-leverage move, restated:** the eval harness (Rank 1). Everything else is unmeasurable noise until you can prove a change moved Sortino/Calmar against a levered-hold benchmark across seeds — and once you have it, your on-chain tape makes your evidence more credible than almost anything published.

---

## 11. Open questions / what's still unknown

1. **Does the on-chain track record actually convert to copy-trading trust and capital?** No public data on whether verifiable AI-bot records drive real follower flows. The Numerai/copy-trade analogy is suggestive, not proven (https://docs.numer.ai). *Research next:* small live copy-trade pilot with explicit consent + dry-run gate.
2. **Claude vs Grok personality, controlled.** The bubble study (Claude 82.8% fundamental vs Grok-style 68% speculative — https://arxiv.org/html/2502.15800v3) predicts your two bots will exhibit divergent risk personalities; nobody has measured this on-chain with an immutable floor holding everything else constant. *You are positioned to produce the first clean datapoint.*
3. **Temperature sensitivity is essentially untested** across the entire field (every system defaults to ~0.3 without ablation). Your shared-brief/shared-floor rig is ideal for a temperature sweep.
4. **Does the LLM-as-factor-researcher paradigm transfer to live crypto perps?** QuantaAlpha/AlphaForge are equities-and-backtest; live perp validation is explicitly listed as future work (https://arxiv.org/abs/2602.07085 [unverified prefix]).
5. **Compound adversarial attacks** are unmeasured — TradeTrap only tested attacks in isolation; real adversaries combine news injection + feed hijack + memory poisoning (https://arxiv.org/html/2512.02261v1).
6. **The optimal cadence** for Strategic-band LLM trading is unknown — 4 min is reasonable but unvalidated; the only datapoint is "don't go sub-minute" (https://arxiv.org/abs/2509.09995).
7. **Citation-integrity caveat:** the corpus contains several arXiv IDs with 2026 year-prefixes (`2605.16895`, `2602.18481`, `2602.07085`, `2605.19337`, `2512.02261`) consistent with its stated dates; the *claims* are well-corroborated by the verified-claims pass and by the non-prefixed sources, but I'd confirm those exact IDs resolve before quoting them in anything load-bearing or public.

---

*Reference compiled from the provided research corpus and adversarially-verified claims. Where the verification pass corrected a corpus claim (TradingAgents cherry-pick, FinAgent/FinMem leakage, Alpha Arena skill-vs-variance, fine-tuning vs prompting, temp-0 instability source), the corrected version is used inline.*