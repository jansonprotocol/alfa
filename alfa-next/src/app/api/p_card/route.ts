// app/api/p-card/route.ts
import { NextResponse } from "next/server";

/**
 * MULTI-SOURCE PCARD BUILDER (drop-in)
 * - Supports: bookmaker anchor (from request odds), + up to 3 live providers
 * - Providers are optional (skip if env var missing) to keep dev friction low
 *
 * Providers (examples):
 *  A) football-data.org (FREE, limited stats) — set FOOTBALL_DATA_TOKEN
 *  B) API-Football (RapidAPI) — set RAPIDAPI_KEY (optional)
 *  C) TheOddsAPI or your custom feed — set ODDS_API_KEY (optional)
 *
 * Returns:
 *  - p_card { O15,O25,U35,U45,HT_O05,HOME_O15,AWAY_O05, coverage }
 *  - sources[] with per-source notes
 *  - disagreement (0..1), coverage (0..1), reason log
 */

type MarketRow = { label: string; odds: number; opp: number };
type PCard = {
  O15: number; O25: number; U35: number; U45: number;
  HT_O05: number; HOME_O15: number; AWAY_O05: number;
  coverage: number;
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const toPct = (x: number) => `${(x * 100).toFixed(1)}%`;

// --------- Odds helpers
function nvFromOdds(odds: number, opp: number) {
  const a = 1 / odds;
  const b = 1 / Math.abs(opp);
  const d = a + b;
  return d > 0 ? a / d : NaN;
}
function pick(m: MarketRow[], name: string) {
  const r = m.find(x => x.label.trim().toLowerCase() === name.trim().toLowerCase());
  return r ? { odds: Number(r.odds), opp: Number(r.opp) } : null;
}

// --------- tiny fetch utils (with timeout + safe JSON)
async function fetchJSON(url: string, init: RequestInit, timeoutMs = 6000) {
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

// --------- Provider adapters (all optional)

// A) football-data.org — standings/fixtures/basic form (FREE). Set FOOTBALL_DATA_TOKEN
async function fromFootballData(params: { home: string; away: string; leagueCode?: string }) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return null;

  // NOTE: This is a placeholder call; football-data.org endpoints vary by competition.
  // You’ll map teams to IDs/competition outside or pass them in the request.
  // Here we just return weak priors when the call is not fully wired.
  try {
    // Example sanity fetch (won’t give xG): competitions list (as a ping)
    await fetchJSON("https://api.football-data.org/v4/competitions", {
      headers: { "X-Auth-Token": token },
    });

    // Heuristic priors (replace with real team lookups you implement):
    return {
      source: "football-data.org",
      tempo: 2.55,               // league avg goals
      homeAttackRel: 1.08,       // >1 strong
      awayAttackRel: 0.95,
      homeDefenseRel: 0.95,      // <1 strong defense
      awayDefenseRel: 1.05,
      weight: 0.35,
      note: "FD priors (placeholder until you wire team IDs).",
    };
  } catch (e: any) {
    return { source: "football-data.org", error: e?.message || "fetch failed", weight: 0 };
  }
}

// B) API-Football (RapidAPI) — richer stats (xG on some plans). Set RAPIDAPI_KEY
async function fromApiFootball(params: { home: string; away: string; leagueId?: number }) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return null;

  try {
    // Placeholder ping — wire real endpoints (teams/stats) with params you pass in
    await fetchJSON("https://api-football-v1.p.rapidapi.com/v3/timezone", {
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": "api-football-v1.p.rapidapi.com",
      },
    });

    return {
      source: "API-Football",
      tempo: 2.65,
      homeAttackRel: 1.12,
      awayAttackRel: 0.92,
      homeDefenseRel: 0.93,
      awayDefenseRel: 1.08,
      weight: 0.45,
      note: "AF priors (placeholder until real team stats are mapped).",
    };
  } catch (e: any) {
    return { source: "API-Football", error: e?.message || "fetch failed", weight: 0 };
  }
}

// C) Odds provider (as a sanity anchor besides your pasted odds). Set ODDS_API_KEY
async function fromOddsApi(params: { fixtureKey?: string }) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return null;

  try {
    // Placeholder ping — you’d fetch odds for the fixture & compute an external no-vig anchor.
    // For now, just return a tiny-weight neutral prior so the code path works.
    return {
      source: "OddsAPI",
      tempo: 2.60,
      homeAttackRel: 1.00,
      awayAttackRel: 1.00,
      homeDefenseRel: 1.00,
      awayDefenseRel: 1.00,
      weight: 0.20,
      note: "External odds anchor (placeholder).",
    };
  } catch (e: any) {
    return { source: "OddsAPI", error: e?.message || "fetch failed", weight: 0 };
  }
}

// --------- Build bookmaker anchor from request odds
function buildBookAnchor(markets: MarketRow[]) {
  const o15 = pick(markets, "FT Over 1.5");
  const o25 = pick(markets, "FT Over 2.5");
  const u35 = pick(markets, "FT Under 3.5");
  const u45 = pick(markets, "FT Under 4.5");
  const hO15 = pick(markets, "Home Over 1.5");
  const aO05 = pick(markets, "Away Over 0.5");

  const base = {
    O15: o15 ? nvFromOdds(o15.odds, o15.opp) : NaN,
    O25: o25 ? nvFromOdds(o25.odds, o25.opp) : NaN,
    U35: u35 ? nvFromOdds(u35.odds, u35.opp) : NaN,
    U45: u45 ? nvFromOdds(u45.odds, u45.opp) : NaN,
    HOME_O15: hO15 ? nvFromOdds(hO15.odds, hO15.opp) : NaN,
    AWAY_O05: aO05 ? nvFromOdds(aO05.odds, aO05.opp) : NaN,
  };

  // sanity defaults if any NaN
  const filled = {
    O15: isFinite(base.O15) ? base.O15 : 0.82,
    O25: isFinite(base.O25) ? base.O25 : 0.62,
    U35: isFinite(base.U35) ? base.U35 : 0.72,
    U45: isFinite(base.U45) ? base.U45 : 0.78,
    HOME_O15: isFinite(base.HOME_O15) ? base.HOME_O15 : 0.70,
    AWAY_O05: isFinite(base.AWAY_O05) ? base.AWAY_O05 : 0.66,
  };

  return { ...filled, source: "bookmaker-no-vig", weight: 0.40, note: "Anchor from provided odds." };
}

// --------- Turn provider priors into probabilities (very light model)
function priorsToCard(p: any) {
  // Convert tempo + team strengths into rough totals/team-goal probabilities.
  const tempoAdj = clamp((p.tempo - 2.45) * 0.06, -0.06, 0.06); // ±6pp to overs
  const O15 = clamp(0.78 + tempoAdj + 0.02 * (p.homeAttackRel - p.awayDefenseRel), 0.55, 0.97);
  const O25 = clamp(0.60 + tempoAdj * 0.8 + 0.02 * (p.homeAttackRel + p.awayAttackRel - p.homeDefenseRel - p.awayDefenseRel), 0.38, 0.93);
  const U35 = clamp(0.76 - tempoAdj * 0.6 - 0.02 * (p.homeAttackRel + p.awayAttackRel), 0.35, 0.96);
  const U45 = clamp(0.82 - tempoAdj * 0.5 - 0.015 * (p.homeAttackRel + p.awayAttackRel), 0.55, 0.98);
  const HOME_O15 = clamp(0.66 + 0.05 * (p.homeAttackRel - 1) - 0.03 * (p.awayDefenseRel - 1), 0.30, 0.95);
  const AWAY_O05 = clamp(0.62 + 0.04 * (p.awayAttackRel - 1) - 0.02 * (p.homeDefenseRel - 1), 0.25, 0.95);
  const HT_O05 = clamp(0.74 + tempoAdj * 0.4, 0.42, 0.95);
  return { O15, O25, U35, U45, HOME_O15, AWAY_O05, HT_O05 };
}

// --------- Blend multiple p_cards + bookmaker anchor
function blendCards(cards: Array<{card: any, weight: number, source: string}>) {
  // Normalize weights
  const wsum = cards.reduce((s, c) => s + (c.weight || 0), 0) || 1;
  const w = cards.map(c => ({ ...c, w: (c.weight || 0) / wsum }));

  const keys = ["O15","O25","U35","U45","HOME_O15","AWAY_O05","HT_O05"] as const;
  const out: any = {};
  for (const k of keys) {
    out[k] = w.reduce((s, c) => s + (c.card[k] || 0) * c.w, 0);
  }

  // Coverage = sum of non-zero weights, clipped to [0..1]
  const coverage = clamp(wsum / 1.4, 0.40, 0.95);

  // Disagreement = avg std-dev across metrics
  const stdev = (arr: number[]) => {
    const m = arr.reduce((s, x) => s + x, 0) / arr.length;
    const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
    return Math.sqrt(v);
  };
  const perKeyStdev = keys.map(k => stdev(cards.map(c => c.card[k])));
  const disagreement = clamp(perKeyStdev.reduce((s,x)=>s+x,0)/perKeyStdev.length / 0.12, 0, 1);

  return { p: { ...out, coverage }, disagreement };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { fixture, markets, home, away, leagueCode, leagueId } = body as {
      fixture?: string;
      markets: MarketRow[];
      home?: string; away?: string;
      leagueCode?: string; leagueId?: number;
    };

    if (!markets || !Array.isArray(markets) || markets.length === 0) {
      return NextResponse.json({ error: "No markets provided." }, { status: 400 });
    }

    // 1) Bookmaker anchor from request odds
    const book = buildBookAnchor(markets);
    const bookCard = {
      O15: book.O15, O25: book.O25, U35: book.U35, U45: book.U45,
      HOME_O15: book.HOME_O15, AWAY_O05: book.AWAY_O05,
      HT_O05: clamp(0.70 * book.O15 + 0.05, 0.40, 0.95),
    };

    // 2) Multi-source fetch in parallel (any missing keys → provider skipped)
    const [fd, af, oa] = await Promise.all([
      fromFootballData({ home: home || "", away: away || "", leagueCode }),
      fromApiFootball({ home: home || "", away: away || "", leagueId }),
      fromOddsApi({ fixtureKey: fixture }),
    ]);

    const providers = [fd, af, oa].filter(Boolean) as any[];

    // 3) Turn each provider into a p_card fragment
    const cards: Array<{card:any, weight:number, source:string, note?:string, error?:string}> = [];

    // bookmaker anchor (always included)
    cards.push({ card: bookCard, weight: book.weight, source: book.source, note: book.note });

    for (const p of providers) {
      if (p.error || !p.weight) {
        cards.push({ card: priorsToCard({ tempo: 2.55, homeAttackRel:1, awayAttackRel:1, homeDefenseRel:1, awayDefenseRel:1 }),
                     weight: 0, source: p.source, note: p.error ? `error: ${p.error}` : p.note });
      } else {
        const card = priorsToCard(p);
        cards.push({ card, weight: p.weight, source: p.source, note: p.note });
      }
    }

    // 4) Blend all cards
    const { p, disagreement } = blendCards(cards);

    // 5) Compose sources & reasons for UI
    const sources = cards.map(c => ({
      name: c.source,
      weight: c.weight,
      sample: {
        O15: toPct(c.card.O15), O25: toPct(c.card.O25), U35: toPct(c.card.U35), U45: toPct(c.card.U45)
      },
      note: c.note || "",
    }));

    const reasons = [
      { key: "anchor", note: "Anchored on bookmaker no-vig from provided odds." },
      { key: "providers", note: `Blended ${providers.length} extra provider(s).` },
      { key: "coverage", note: `Coverage ${toPct(p.coverage)} (weights normalized).` },
      { key: "disagree", note: `Disagreement ${(disagreement*100).toFixed(0)}% (lower is better).` },
    ];

    const p_card: PCard = {
      O15: p.O15, O25: p.O25, U35: p.U35, U45: p.U45,
      HT_O05: p.HT_O05, HOME_O15: p.HOME_O15, AWAY_O05: p.AWAY_O05,
      coverage: p.coverage,
    };

    return NextResponse.json({
      fixture: fixture || `${home || "Home"} vs ${away || "Away"}`,
      p_card,
      sources,
      disagreement,
      reasons,
    }, { status: 200 });

  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Bad request" }, { status: 400 });
  }
}
