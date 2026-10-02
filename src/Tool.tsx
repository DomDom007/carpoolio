// Carpoolio: a school run rota that shares driving fairly across families, respects who can drive when, and handles swaps.
import { useMemo, useState } from "react";
import { downloadIcs } from "./lib/ics";
import { waLink } from "./lib/share";
import { uid, useStored } from "./lib/store";
import { addDays, prettyDate, todayISO } from "./lib/time";
import { Section, Stat, Stats } from "./ui/kit";

const T = "carpoolio";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const LEGS = [{ k: "am", label: "Drop-off", time: "07:30" }, { k: "pm", label: "Pick-up", time: "16:30" }] as const;
type Fam = { id: string; name: string; seats: number; kids: number; cant: string[] }; // cant: "Mon-am"
type Rota = Record<string, string>; // "2026-10-05-am" -> family id

function monday(iso: string) { const d = new Date(iso + "T12:00:00Z"); const k = (d.getUTCDay() + 6) % 7; return addDays(iso, -k); }
/** Give each slot to the available family that has driven least so far (ties: fewest this week, then name). */
function build(fams: Fam[], start: string, weeks: number, prev: Rota): Rota {
  const count: Record<string, number> = Object.fromEntries(fams.map(f => [f.id, 0]));
  const out: Rota = {};
  for (let w = 0; w < weeks; w++) {
    const week: Record<string, number> = Object.fromEntries(fams.map(f => [f.id, 0]));
    DAYS.forEach((d, di) => LEGS.forEach(l => {
      const date = addDays(start, w * 7 + di), key = `${date}-${l.k}`;
      const locked = prev[key + "!"];
      const pick = locked ?? [...fams].filter(f => !f.cant.includes(`${d}-${l.k}`)).sort((a, b) => count[a.id] - count[b.id] || week[a.id] - week[b.id] || a.name.localeCompare(b.name))[0]?.id;
      if (pick) { out[key] = pick; count[pick]++; week[pick]++; if (locked) out[key + "!"] = locked; }
    }));
  }
  return out;
}

export default function Carpoolio() {
  const [fams, setFams] = useStored<Fam[]>(T, "fams", [
    { id: "f1", name: "Haddad", seats: 4, kids: 2, cant: ["Mon-am", "Wed-pm"] }, { id: "f2", name: "Trabelsi", seats: 3, kids: 1, cant: ["Fri-pm"] },
    { id: "f3", name: "Ben Ali", seats: 4, kids: 1, cant: [] }, { id: "f4", name: "Mansour", seats: 2, kids: 1, cant: ["Tue-am", "Tue-pm", "Thu-am", "Thu-pm"] },
  ]);
  const [school, setSchool] = useStored(T, "school", "École Pilote El Menzah");
  const [weeks, setWeeks] = useStored(T, "weeks", 4);
  const [start, setStart] = useStored(T, "start", monday(addDays(todayISO(), 7)));
  const [locks, setLocks] = useStored<Rota>(T, "locks", {});
  const [me, setMe] = useStored(T, "me", "f1");
  const [nf, setNf] = useState({ name: "", seats: "4", kids: "1" });
  const rota = useMemo(() => build(fams, start, weeks, locks), [fams, start, weeks, locks]);
  const slots = Object.entries(rota).filter(([k]) => !k.endsWith("!"));
  const counts = fams.map(f => ({ f, n: slots.filter(([, v]) => v === f.id).length }));
  const kids = fams.reduce((a, f) => a + f.kids, 0);
  const tooSmall = fams.filter(f => f.seats < kids);
  const name = (id?: string) => fams.find(f => f.id === id)?.name ?? "Nobody free";
  const text = () => `Car pool for ${school}\n` + Array.from({ length: weeks }, (_, w) => `\nWeek of ${prettyDate(addDays(start, w * 7))}\n` + DAYS.map((d, di) => { const date = addDays(start, w * 7 + di); return `${d}: ${name(rota[`${date}-am`])} drops off, ${name(rota[`${date}-pm`])} picks up`; }).join("\n")).join("\n");
  const myIcs = () => downloadIcs(`carpool-${name(me).toLowerCase()}.ics`, slots.filter(([, v]) => v === me).map(([k]) => { const date = k.slice(0, 10), leg = LEGS.find(l => k.endsWith(l.k))!; const s = new Date(`${date}T${leg.time}:00`); return { title: `Car pool ${leg.label.toLowerCase()}: ${school}`, start: s, end: new Date(s.getTime() + 45 * 60000), alarmMinutes: 20 }; }), "Car pool");

  return (
    <div className="stack">
      <Section title={school} aside={<><a className="btn small primary" href={waLink(text())} target="_blank" rel="noreferrer">Send rota to the group</a><button className="btn small" onClick={myIcs}>My drives to calendar</button></>}>
        <Stats><Stat value={fams.length} label="Families" /><Stat value={kids} label="Children" /><Stat value={slots.length} label="Trips planned" />{counts.map(c => <Stat key={c.f.id} value={c.n} label={`${c.f.name} drives`} />)}</Stats>
        {tooSmall.length > 0 && <p className="pill warn" style={{ marginTop: 10 }}>{tooSmall.map(f => f.name).join(", ")} can't fit all {kids} children. Split into two cars on their days or let them swap.</p>}
        <div className="row" style={{ marginTop: 14, alignItems: "flex-end" }}>
          <label className="field"><span>School</span><input id="cp-s" className="input" value={school} onChange={e => setSchool(e.target.value)} /></label>
          <label className="field" style={{ flex: "0 0 170px" }}><span>Starting Monday</span><input id="cp-st" type="date" className="input" value={start} onChange={e => setStart(monday(e.target.value))} /></label>
          <label className="field" style={{ flex: "0 0 110px" }}><span>Weeks</span><select id="cp-w" className="input" value={weeks} onChange={e => setWeeks(+e.target.value)}>{[1, 2, 4, 6, 8].map(n => <option key={n}>{n}</option>)}</select></label>
          <label className="field" style={{ flex: "0 0 150px" }}><span>I am</span><select id="cp-me" className="input" value={me} onChange={e => setMe(e.target.value)}>{fams.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        </div>
      </Section>

      {Array.from({ length: weeks }, (_, w) => (
        <Section key={w} title={`Week of ${prettyDate(addDays(start, w * 7))}`}>
          <div className="cp-grid">
            <span />{DAYS.map(d => <b key={d}>{d}</b>)}
            {LEGS.map(l => [<em key={l.k}>{l.label}<br /><span className="note">{l.time}</span></em>, ...DAYS.map((d, di) => {
              const key = `${addDays(start, w * 7 + di)}-${l.k}`, who = rota[key], locked = !!locks[key + "!"];
              return (
                <select key={key} className={"cp-cell" + (who === me ? " me" : "") + (locked ? " locked" : "")} aria-label={`${d} ${l.label}`} value={who ?? ""} onChange={e => setLocks({ ...locks, [key + "!"]: e.target.value })}>
                  {!who && <option value="">Nobody free</option>}
                  {fams.map(f => <option key={f.id} value={f.id} disabled={f.cant.includes(`${d}-${l.k}`)}>{f.name}</option>)}
                </select>);
            })])}
          </div>
        </Section>
      ))}
      <p className="note">Change any cell to swap a trip. Swapped trips stay fixed and the rest rebalances. <button className="btn ghost small" onClick={() => setLocks({})}>Clear all swaps</button></p>

      <Section title="Families and when they can't drive">
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Family</th><th className="r">Seats</th><th className="r">Kids</th>{DAYS.flatMap(d => LEGS.map(l => <th key={d + l.k} style={{ textAlign: "center" }}>{d}<br />{l.k === "am" ? "AM" : "PM"}</th>))}<th /></tr></thead>
          <tbody>{fams.map(f => (
            <tr key={f.id}><td><input className="input" style={{ minWidth: 110 }} aria-label="Family" value={f.name} onChange={e => setFams(fams.map(x => x.id === f.id ? { ...x, name: e.target.value } : x))} /></td>
              <td><input className="input num" style={{ width: 54 }} aria-label="Seats" value={f.seats} onChange={e => setFams(fams.map(x => x.id === f.id ? { ...x, seats: parseInt(e.target.value) || 0 } : x))} /></td>
              <td><input className="input num" style={{ width: 54 }} aria-label="Kids" value={f.kids} onChange={e => setFams(fams.map(x => x.id === f.id ? { ...x, kids: parseInt(e.target.value) || 0 } : x))} /></td>
              {DAYS.flatMap(d => LEGS.map(l => { const k = `${d}-${l.k}`, no = f.cant.includes(k); return <td key={k} style={{ textAlign: "center" }}><button className={"cp-av" + (no ? " no" : "")} aria-label={`${f.name} ${no ? "can't" : "can"} drive ${d} ${l.label}`} onClick={() => setFams(fams.map(x => x.id === f.id ? { ...x, cant: no ? x.cant.filter(c => c !== k) : [...x.cant, k] } : x))}>{no ? "No" : "Yes"}</button></td>; }))}
              <td><button className="btn ghost small danger" onClick={() => setFams(fams.filter(x => x.id !== f.id))}>×</button></td></tr>
          ))}</tbody>
        </table></div>
        <form className="row" style={{ marginTop: 12, alignItems: "flex-end" }} onSubmit={e => { e.preventDefault(); if (!nf.name.trim()) return; setFams([...fams, { id: uid(), name: nf.name.trim(), seats: parseInt(nf.seats) || 4, kids: parseInt(nf.kids) || 1, cant: [] }]); setNf({ ...nf, name: "" }); }}>
          <label className="field"><span>Family</span><input id="cp-nf" className="input" value={nf.name} onChange={e => setNf({ ...nf, name: e.target.value })} /></label>
          <label className="field" style={{ flex: "0 0 90px" }}><span>Seats</span><input id="cp-ns" className="input num" value={nf.seats} onChange={e => setNf({ ...nf, seats: e.target.value })} /></label>
          <label className="field" style={{ flex: "0 0 90px" }}><span>Kids</span><input id="cp-nk" className="input num" value={nf.kids} onChange={e => setNf({ ...nf, kids: e.target.value })} /></label>
          <button className="btn small" type="submit">Add family</button>
        </form>
      </Section>
      <style>{`.cp-grid{display:grid;grid-template-columns:90px repeat(5,1fr);gap:6px;align-items:center}.cp-grid b{text-align:center;font-family:var(--mono);font-size:12px;font-weight:500;color:var(--muted)}.cp-grid em{font-style:normal;font-weight:600;font-size:13px}
      .cp-cell{width:100%;min-width:0;border:1px solid var(--line);background:var(--sunk);color:var(--ink);border-radius:8px;padding:10px 4px;font-weight:600;font-size:13px;text-align:center}.cp-cell.me{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}.cp-cell.locked{outline:2px dashed var(--warn)}
      .cp-av{border:1px solid var(--line);background:color-mix(in srgb,var(--good) 14%,transparent);color:var(--good);border-radius:6px;padding:4px 8px;font-size:12px;font-weight:700;cursor:pointer}.cp-av.no{background:color-mix(in srgb,var(--bad) 12%,transparent);color:var(--bad)}
      @media(max-width:560px){.cp-grid{grid-template-columns:62px repeat(5,1fr);gap:3px}.cp-cell{font-size:11px;padding:8px 2px}}`}</style>
    </div>
  );
}
