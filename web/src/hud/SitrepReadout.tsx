import { useMemo, useState } from "react";
import type { Snapshot, Storm } from "../types";
import Panel from "./Panel";
import { advisoryHeadline, sitrepParas } from "./sitrep";
import { fmtDayET } from "../time";

/** Briefing-style SITREP generated from feed fields, with the verbatim NHC text beside it. */
export default function SitrepReadout({ snap, storm, onSpeak, area }: { snap: Snapshot | null; storm: Storm | undefined; onSpeak?: (t: string) => void; area?: string }) {
  const paras = useMemo(() => (snap ? sitrepParas(snap, storm) : []), [snap?.version, storm?.id]);
  const [src, setSrc] = useState(false);
  const head = advisoryHeadline(storm?.advisoryText ?? null);
  return (
    <Panel title="Situation summary" feed={snap?.feeds.nhc} area={area} className="sitrep"
      source={`built from National Hurricane Center advisory ${Number(storm?.advisoryNumber ?? 0) || storm?.advisoryNumber || "—"}, National Weather Service and U.S. Geological Survey data`}
      right={<span className="head-btns">
        {onSpeak && <button className="btn" onClick={() => onSpeak(paras.map((p) => `${p.tag}. ${p.text}`).join(" "))}>read aloud</button>}
        <button className={`btn ${src ? "on" : ""}`} onClick={() => setSrc((v) => !v)}>source text</button>
      </span>}>
      <div className="brief">
        <div className="brief-head">Situation summary, made {fmtDayET(snap?.generatedAt)}. Not an official forecast.</div>
        <ol>{paras.map((p) => <li key={p.tag}><b>{p.tag}.</b> {p.text}</li>)}</ol>
        {head && <blockquote className="verbatim nhc-head"><span className="dim">National Hurricane Center headline, word for word:</span>{"\n"}{head}</blockquote>}
        {src && <pre className="verbatim">{storm?.advisoryText ?? "Advisory text not loaded."}</pre>}
      </div>
    </Panel>
  );
}
