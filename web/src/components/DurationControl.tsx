import { CaretDown, Clock } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { usePopoverPosition } from '../hooks/usePopoverPosition';
import './duration-control.css';

export function DurationControl({ value, onChange, disabled }: { value: number; onChange: (seconds: number) => void; disabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(String(value));
  const id = useId();
  const position = usePopoverPosition(open, trigger, 280);
  useEffect(() => { if (open) input.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => { if (disabled) panel.current?.hidePopover(); }, [disabled]);
  const show = () => { if (disabled) return; setDraft(String(value)); setOpen(true); panel.current?.showPopover(); };
  const close = () => { panel.current?.hidePopover(); trigger.current?.focus({ preventScroll: true }); };
  const apply = () => { if (input.current?.reportValidity()) { onChange(Number(draft)); close(); } };
  return <div className="duration-control" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && open) panel.current?.hidePopover(); }}
    onKeyDown={event => {
      if (!open && event.key === 'ArrowDown') { event.preventDefault(); show(); }
      if (!open) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Enter' && event.target === input.current) { event.preventDefault(); apply(); }
    }}>
    <button ref={trigger} type="button" className="duration-trigger" disabled={disabled} aria-label={`参考时长：约 ${value} 秒`} title={`参考时长：约 ${value} 秒`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => open ? panel.current?.hidePopover() : show()}><Clock aria-hidden="true"/><span>{value} 秒</span><CaretDown className="control-chevron" aria-hidden="true"/></button>
    <div ref={panel} id={id} popover="auto" className="duration-panel" role="dialog" aria-label="参考时长" style={position} onToggle={event => setOpen(event.newState === 'open')}>
      <label>参考时长<div><input ref={input} type="number" disabled={!open} inputMode="numeric" min={1} max={3600} step={1} required value={draft} onChange={event => setDraft(event.target.value)} aria-label="参考时长（秒）"/><span>秒</span></div></label>
      <div className="duration-presets">{[15,30,60,90].map(seconds => <button type="button" key={seconds} aria-pressed={value === seconds} onClick={() => { onChange(seconds); close(); }}>{seconds} 秒</button>)}</div>
      <p>这是参考时长，最终按内容与旁白在方案中确认。需要精确时长时，请在描述中注明。</p>
      <button type="button" className="duration-apply" onClick={apply}>确定</button>
    </div>
  </div>;
}
