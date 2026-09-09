import { CaretDown, Check } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';

export function UsageModelFilter({ models, value, onChange }: {
  models: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const options = Array.from(new Set(['', ...models, ...(value ? [value] : [])]));
  const activeIndex = Math.max(0, options.indexOf(active));

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, id]);

  function select(model: string) {
    onChange(model);
    setOpen(false);
  }

  return <div className="usage-model-field" ref={root}>
    <span id={`${id}-label`}>模型</span>
    <div className="usage-model-picker">
      <button type="button" role="combobox" className="usage-model-trigger"
        aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        onBlur={() => setOpen(false)}
        onClick={() => { setActive(value); setOpen(current => !current); }}
        onKeyDown={event => {
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
          if (event.key === 'Tab') { setOpen(false); return; }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open) select(options[activeIndex]);
            else { setActive(value); setOpen(true); }
            return;
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
              : !open ? Math.max(0, options.indexOf(value))
              : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            setActive(options[next]); setOpen(true);
          }
        }}>
        <span id={`${id}-value`} title={value || '全部模型'}>{value || '全部模型'}</span>
        <CaretDown aria-hidden="true"/>
      </button>
      {open ? <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="usage-model-menu">
        {options.map((model, index) => <div key={model} id={`${id}-option-${index}`} role="option"
          aria-selected={value === model} className={`usage-model-option${index === activeIndex ? ' is-active' : ''}`}
          onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(model)} onClick={() => select(model)}>
          <span title={model || '全部模型'}>{model || '全部模型'}</span>
          {value === model ? <Check aria-hidden="true"/> : null}
        </div>)}
      </div> : null}
    </div>
  </div>;
}
