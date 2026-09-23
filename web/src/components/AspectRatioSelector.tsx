import { CaretDown, Check, DeviceMobile, Rectangle, Sparkle, Square } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { usePopoverPosition } from "../hooks/usePopoverPosition";
import { useMotionPresence } from "../hooks/useMotionPresence";

const options = [
  { value: "auto", label: "自动画幅", hint: "根据内容选择", icon: Sparkle },
  { value: "16:9", label: "16:9", hint: "横屏", icon: Rectangle },
  { value: "9:16", label: "9:16", hint: "竖屏", icon: DeviceMobile },
  { value: "1:1", label: "1:1", hint: "方形", icon: Square },
] as const;

export type AspectRatioValue = typeof options[number]["value"];

export function AspectRatioSelector({ value, onChange }: {
  value: AspectRatioValue;
  onChange: (value: AspectRatioValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const presence = useMotionPresence(open ? true : null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const position = usePopoverPosition(open, trigger, 240);
  const selected = options.find(option => option.value === value)!;

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  return <div className="home-aspect-select aspect-selector" ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => {
      if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault(); setOpen(true); return;
      }
      if (!open) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key === "Tab") { close(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus({ preventScroll: true });
    }}>
    <button ref={trigger} className="aspect-trigger" type="button" aria-label="首页视频画幅"
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(current => !current)}>
      <span>{selected.label}</span><CaretDown className="control-chevron" aria-hidden="true" />
    </button>
    {presence.value ? <div ref={presence.ref} inert={presence.exiting} aria-hidden={presence.exiting || undefined} id={menuId} className="aspect-menu" role="menu" aria-label="选择视频画幅" style={position}>
      {options.map(({ value: option, label, hint, icon: Icon }) => <button key={option} type="button"
        role="menuitemradio" aria-checked={value === option} tabIndex={-1}
        onClick={() => { onChange(option); close(); }}>
        <Icon className="aspect-option-icon" aria-hidden="true" />
        <span className="aspect-option-copy"><span>{label}</span><small>{hint}</small></span>
        {value === option ? <Check className="aspect-option-check" weight="bold" aria-hidden="true" /> : null}
      </button>)}
    </div> : null}
  </div>;
}
