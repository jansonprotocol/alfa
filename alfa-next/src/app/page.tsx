"use client";
import { useState } from "react";

type MarketRow = { label: string; odds: number; opp: number };

export default function Page() {
  const [fixture, setFixture] = useState("Marseille vs PSG");
  const [home, setHome] = useState("Marseille");
  const [away, setAway] = useState("PSG");
  const [oddsText, setOddsText] = useState("");
  const [result, setResult] = useState<any>(null);

  // Parse textarea rows → MarketRow[]
  function parseRows(text: string): MarketRow[] {
    return text
      .split("\n")
      .map((line) => line.split("|").map((p) => p.trim()))
      .filter((parts) => parts.length >= 3)
      .map(([label, odds, opp]) => ({
        label,
        odds: parseFloat(odds),
        opp: parseFloat(opp),
      }));
  }

  async function handleRun() {
    const markets = parseRows(oddsText);

    const res = await fetch("/api/p-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fixture,
        home,
        away,
        markets,
        leagueCode: "FRA1", // optional
      }),
    });

    const data = await res.json();
    setResult(data);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <h1 className="text-2xl font-bold">ALFA V3.4 — Odds Scanner</h1>

      {/* Fixture + team inputs */}
      <div className="mt-4 grid gap-2">
        <input
          className="rounded border p-2"
          value={fixture}
          onChange={(e) => setFixture(e.target.value)}
        />
        <input
          className="rounded border p-2"
          placeholder="Home team"
          value={home}
          onChange={(e) => setHome(e.target.value)}
        />
        <input
          className="rounded border p-2"
          placeholder="Away team"
          value={away}
          onChange={(e) => setAway(e.target.value)}
        />
      </div>

      {/* Odds input */}
      <textarea
        className="mt-4 w-full rounded border p-2 font-mono"
        rows={8}
        placeholder="Paste odds: Market | Odds | Opp"
        value={oddsText}
        onChange={(e) => setOddsText(e.target.value)}
      />

      <button
        className="mt-4 rounded bg-blue-600 px-4 py-2 text-white"
        onClick={handleRun}
      >
        Run ALFA
      </button>

      {/* Results */}
      {result && (
        <div className="mt-6 rounded bg-white p-4 shadow">
          <h2 className="font-bold">p_card (blended)</h2>
          <pre className="whitespace-pre-wrap text-sm">
            {JSON.stringify(result.p_card, null, 2)}
          </pre>
          <h3 className="mt-4 font-bold">Sources</h3>
          <pre className="whitespace-pre-wrap text-sm">
            {JSON.stringify(result.sources, null, 2)}
          </pre>
          <h3 className="mt-4 font-bold">Reasons</h3>
          <pre className="whitespace-pre-wrap text-sm">
            {JSON.stringify(result.reasons, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
