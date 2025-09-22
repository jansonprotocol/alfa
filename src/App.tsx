import { useMemo, useState } from "react";

type Row = { label: string; odds: number; opp: number };

const pf = (x: number) => `${(x * 100).toFixed(1)}%`;

function parseRows(text: string): Row[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/\s*\|\s*/g, "|"))
    .map(l => {
      const [label, o, opp] = l.split("|");
      return { label, odds: Number(o), opp: Math.abs(Number(opp)) };
    })
    .filter(r => r.label && r.odds > 1 && r.opp > 1);
}

function noVigProb(odds: number, opp: number) {
  const a = 1 / odds, b = 1 / opp, d = a + b;
  return d ? a / d : NaN;
}

function bandRequirement(odds: number) {
  if (odds >= 1.11 && odds <= 1.17) return { band: "micro", pMin: 0.90, edgeMin: 0.10 };
  if (odds >= 1.18 && odds <= 1.30) return { band: "1.18–1.30", pMin: 0.79, edgeMin: 0.04 };
  if (odds >= 1.31 && odds <= 1.35) return { band: "1.31–1.35", pMin: 0.78, edgeMin: 0.03 };
  if (odds >= 1.36 && odds <= 1.45) return { band: "1.36–1.45", pMin: 0.78, edgeMin: 0.03 };
  return { band: "outside", pMin: 0.78, edgeMin: 0.10 };
}

export default function App() {
  const [fixture, setFixture] = useState("Home FC vs Away FC (Today)");
  const [text, setText] = useState(
`FT Over 1.5 | 1.18 | 4.60
FT Over 2.5 | 1.62 | 2.23
FT Under 3.5 | 1.38 | 2.95
Home Over 1.5 | 1.33 | 3.10
Away Under 1.5 | 1.42 | 2.60
HT Over 0.5 | 1.28 | 3.35`
  );

  const rows = useMemo(() => parseRows(text), [text]);

  const results = useMemo(() => {
    const out = rows.map(r => {
      const p_nv = noVigProb(r.odds, r.opp);
      // simple p_user guess (you’ll replace with your model later)
      const p_user = Math.min(0.99, Math.max(0.01, p_nv + 0.04)); // +4pp bias as placeholder
      const p_assist = p_nv; // assistant = no-vig for now
      let p_blend = 0.7 * p_user + 0.3 * p_assist;
      // clamp: [p_nv-7pp, p_nv+15pp]
      p_blend = Math.min(p_nv + 0.15, Math.max(p_nv - 0.07, p_blend));
      const edge = p_blend - p_nv;
      const band = bandRequirement(r.odds);
      const passes = p_blend >= band.pMin && edge >= band.edgeMin;
      return { ...r, p_nv, p_user, p_assist, p_blend, edge, band, passes };
    });
    const shortlist = out.filter(x => x.passes).sort((a,b)=>b.edge-a.edge);
    const nearmiss = out
      .filter(x => !x.passes)
      .map(x => ({...x, pShort: Math.max(0, x.band.pMin - x.p_blend), eShort: Math.max(0, x.band.edgeMin - x.edge)}))
      .sort((a,b)=>(a.pShort+a.eShort)-(b.pShort+b.eShort));
    return { shortlist, nearmiss, all: out };
  }, [rows]);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">ALFA V3.4 — Odds Scanner (Lite)</h1>

        <div className="rounded-2xl bg-white p-4 shadow grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-600">Fixture</label>
            <input className="mt-1 w-full rounded-lg border p-2"
              value={fixture} onChange={e=>setFixture(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-600">Paste odds (Market | Odds | Opp A)</label>
            <textarea rows={8} className="mt-1 w-full rounded-lg border p-2 font-mono text-sm"
              value={text} onChange={e=>setText(e.target.value)} />
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow">
          <h2 className="font-semibold mb-3">Shortlist — PASSES</h2>
          {results.shortlist.length === 0 && <p className="text-slate-500">No passes at current inputs.</p>}
          <div className="grid gap-3">
            {results.shortlist.map(r=>(
              <div key={r.label} className="grid md:grid-cols-6 gap-2 items-center border rounded-xl p-3">
                <div className="font-medium">{r.label}</div>
                <div><div className="text-xs text-slate-500">Odds</div>{r.odds.toFixed(2)}</div>
                <div><div className="text-xs text-slate-500">p_blend / p_nv</div>{pf(r.p_blend)} / {pf(r.p_nv)}</div>
                <div><div className="text-xs text-slate-500">Edge</div><b>{pf(r.edge)}</b></div>
                <div><div className="text-xs text-slate-500">Band</div>{r.band.band}</div>
                <div className="text-right text-green-700 font-semibold">PASS</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow">
          <h2 className="font-semibold mb-3">Nearmisses</h2>
          {results.nearmiss.length === 0 && <p className="text-slate-500">None.</p>}
          <div className="grid gap-3">
            {results.nearmiss.slice(0,8).map((r:any)=>(
              <div key={r.label} className="grid md:grid-cols-7 gap-2 items-center border rounded-xl p-3">
                <div className="font-medium">{r.label}</div>
                <div><div className="text-xs text-slate-500">Odds</div>{r.odds.toFixed(2)}</div>
                <div><div className="text-xs text-slate-500">p_blend / need</div>{pf(r.p_blend)} / ≥{pf(r.band.pMin)}</div>
                <div><div className="text-xs text-slate-500">Edge / need</div>{pf(r.edge)} / ≥{pf(r.band.edgeMin)}</div>
                <div><div className="text-xs text-slate-500">Band</div>{r.band.band}</div>
                <div><div className="text-xs text-slate-500">Short by</div>{pf(r.pShort + r.eShort)}</div>
                <div className="text-right text-xs text-slate-600">Nudge p or wait for price drift.</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
