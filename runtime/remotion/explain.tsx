// Yingya native explanation primitives. Copied into each project as editable source.
import React from 'react';
import {interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

type Theme = {ink?: string; accent?: string; panel?: string; fontFamily?: string; fontSize?: number};
type Base = {title?: string; theme?: Theme; style?: React.CSSProperties};
type Item = {id: string; label: string; detail?: string};
const defaults = {ink: '#182229', accent: '#216b79', panel: '#f1f4f3', fontFamily: 'sans-serif', fontSize: 42};
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

function Surface({title, theme, style, children}: Base & {children: React.ReactNode}) {
  const t = {...defaults, ...theme};
  return <section style={{color: t.ink, fontFamily: t.fontFamily, fontSize: t.fontSize, lineHeight: 1.45, width: '100%', height: '100%', boxSizing: 'border-box', padding: '6%', ...style}}>
    {title ? <h2 style={{fontSize: '1.45em', lineHeight: 1.2, margin: '0 0 1em', fontWeight: 700}}>{title}</h2> : null}
    {children}
  </section>;
}

function Reveal({at, children, style}: {at: number; children: React.ReactNode; style?: React.CSSProperties}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = interpolate(frame, [at * fps, (at + .45) * fps], [0, 1], clamp);
  return <div style={{opacity: p, transform: `translateY(${(1-p)*18}px)`, ...style}}>{children}</div>;
}

/** A whole and its named parts. Items and content stay editable. */
export function ExplainConcept({subject, items, ...base}: Base & {subject: string; items: Item[]}) {
  const t = {...defaults, ...base.theme};
  return <Surface {...base}><div style={{display: 'flex', alignItems: 'center', gap: '7%', height: '65%'}}>
    <Reveal at={0} style={{width: '30%', fontSize: '1.4em', fontWeight: 700, color: t.accent}}>{subject}</Reveal>
    <div style={{flex: 1, borderLeft: `3px solid ${t.accent}`, paddingLeft: '5%'}}>
      {items.map((item, i) => <Reveal key={item.id} at={.35 + i*.4} style={{margin: '.4em 0'}}><strong>{item.label}</strong>{item.detail ? <div style={{fontSize: '.7em'}}>{item.detail}</div> : null}</Reveal>)}
    </div>
  </div></Surface>;
}

/** Ordered steps with permanent numbering, revealed by the scene-local frame. */
export function ExplainProcess({items, ...base}: Base & {items: Item[]}) {
  const t = {...defaults, ...base.theme};
  return <Surface {...base}><div style={{display: 'flex', gap: '4%', alignItems: 'flex-start', marginTop: '8%'}}>
    {items.map((item, i) => <Reveal key={item.id} at={i*.55} style={{flex: 1, minWidth: 0}}>
      <div style={{color: t.accent, fontSize: '1.8em', borderBottom: `3px solid ${t.accent}`, marginBottom: '.3em'}}>{i+1}</div>
      <strong>{item.label}</strong>{item.detail ? <p style={{fontSize: '.72em'}}>{item.detail}</p> : null}
    </Reveal>)}
  </div></Surface>;
}

/** Compare corresponding attributes in aligned rows, without invented values. */
export function ExplainComparison({labels, rows, ...base}: Base & {labels: [string, string]; rows: {id: string; label: string; left: string; right: string}[]}) {
  const t = {...defaults, ...base.theme};
  return <Surface {...base}><div style={{display: 'grid', gridTemplateColumns: '1fr 1.4fr 1.4fr', gap: '.35em 1em'}}>
    <div />{labels.map((label, i) => <strong key={i} style={{color: t.accent}}>{label}</strong>)}
    {rows.map((row, i) => <React.Fragment key={row.id}>
      <Reveal at={i*.4} style={{borderTop: '1px solid currentColor', paddingTop: '.6em', fontSize: '.8em'}}>{row.label}</Reveal>
      <Reveal at={i*.4} style={{borderTop: '1px solid currentColor', paddingTop: '.6em'}}>{row.left}</Reveal>
      <Reveal at={i*.4} style={{borderTop: '1px solid currentColor', paddingTop: '.6em'}}>{row.right}</Reveal>
    </React.Fragment>)}
  </div></Surface>;
}

/** Shared zero baseline and scale; negative values remain visibly negative. */
export function ExplainDataChange({items, unit, domain, ...base}: Base & {items: {id: string; label: string; value: number}[]; unit: string; domain?: [number, number]}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = {...defaults, ...base.theme};
  const low = domain?.[0] ?? Math.min(0, ...items.map(x => x.value));
  const high = domain?.[1] ?? Math.max(1, ...items.map(x => x.value));
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low || low > 0 || high < 0
      || items.some(x => !Number.isFinite(x.value) || x.value < low || x.value > high)) throw Error('Data domain must include zero and every finite value');
  const percent = (value: number) => (value-low)/(high-low)*100;
  return <Surface {...base}>{items.map((item, i) => {
    const p = interpolate(frame, [i*.35*fps, (i*.35+1)*fps], [0, 1], clamp);
    const end = item.value*p;
    return <div key={item.id} style={{display: 'grid', gridTemplateColumns: '22% 1fr 19%', gap: '3%', alignItems: 'center', margin: '.7em 0'}}>
      <span>{item.label}</span><div style={{position: 'relative', height: '1.1em', background: t.panel}}>
        <div style={{position: 'absolute', left: `${percent(0)}%`, top: '-20%', height: '140%', borderLeft: `2px solid ${t.ink}`}} />
        <div style={{position: 'absolute', left: `${percent(Math.min(0,end))}%`, width: `${Math.abs(end)/(high-low)*100}%`, height: '100%', background: t.accent}} />
      </div><span style={{fontVariantNumeric: 'tabular-nums'}}>{item.value}{unit}</span>
    </div>;
  })}</Surface>;
}

/** Use only for supported causal claims; direction is always explicit. */
export function ExplainCausality({cause, mechanism, effect, ...base}: Base & {cause: string; mechanism: string; effect: string}) {
  const t = {...defaults, ...base.theme};
  return <Surface {...base}><div style={{display: 'flex', alignItems: 'center', gap: '3%', height: '60%'}}>
    {[cause, mechanism, effect].map((text, i) => <React.Fragment key={i}>
      {i ? <Reveal at={i*.6-.2}><span style={{color: t.accent}} aria-label="导致">→</span></Reveal> : null}
      <Reveal at={i*.6} style={{flex: 1, minWidth: 0, borderTop: `4px solid ${t.accent}`, paddingTop: '.7em'}}>{text}</Reveal>
    </React.Fragment>)}
  </div></Surface>;
}

/** Transparent overlay. Underlying footage is mounted by remotion.json.media. */
export function ExplainFootage({label, focus, theme}: {label: string; focus: {x: number; y: number; width: number; height: number}; theme?: Theme}) {
  const t = {...defaults, ...theme};
  const {x,y,width,height} = focus;
  if ([x,y,width,height].some(n => !Number.isFinite(n)) || x<0 || y<0 || width<=0 || height<=0 || x+width>1 || y+height>1) throw Error('Focus uses normalized bounds within the canvas');
  return <Reveal at={0} style={{position: 'absolute', inset: 0, fontFamily: t.fontFamily}}>
    <div style={{position: 'absolute', left: `${x*100}%`, top: `${y*100}%`, width: `${width*100}%`, height: `${height*100}%`, border: `4px solid ${t.accent}`, boxSizing: 'border-box'}} />
    <div style={{position: 'absolute', left: '6%', bottom: '15%', maxWidth: '88%', background: t.panel, color: t.ink, fontSize: t.fontSize, padding: '.35em .65em'}}>{label}</div>
  </Reveal>;
}

/** Scene-local, half-open intervals; no media mounting and no independent clock. */
export function SentenceCaptions({captions, offsetMs=0, style}: {captions: {text: string; startMs: number; endMs: number}[]; offsetMs?: number; style?: React.CSSProperties}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const ms = frame/fps*1000-offsetMs;
  const current = captions.find(c => ms>=c.startMs && ms<c.endMs);
  return current ? <div data-yingya-caption style={{position: 'absolute', bottom: '5%', left: '8%', width: '84%', textAlign: 'center', fontSize: 40, lineHeight: 1.5, color: 'white', textShadow: '0 2px 6px black', whiteSpace: 'pre-line', ...style}}>{current.text}</div> : null;
}
