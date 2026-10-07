import { Children, Fragment, isValidElement, useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import "./select-control.css";

type Option = { value: string; label: string; disabled: boolean };
function textContent(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : String(child)).join("");
}
function readOptions(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type === Fragment) return readOptions(child.props.children);
    if (child.type !== "option") return [];
    const label = textContent(child.props.children);
    return [{ value: String(child.props.value ?? label), label, disabled: Boolean(child.props.disabled) }];
  });
}

/** A shared select-only combobox. The native field preserves form values and change events;
 * the top-layer listbox also works inside modal dialogs and scrollable panels. */
export function SelectControl({ children, value, defaultValue, onChange, className = "", id, disabled, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const generatedId = useId();
  const listId = `${generatedId}-options`;
  const options = readOptions(children);
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? options[0]?.value ?? ""));
  const selectedValue = String(value ?? internalValue);
  const selectedIndex = options.findIndex(option => option.value === selectedValue);
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ value: "", time: 0 });

  const position = useCallback(() => {
    const button = trigger.current, panel = list.current;
    if (!button || !panel) return;
    const bounds = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    const panelWidth = Math.min(Math.max(bounds.width, 200), width - 24);
    panel.style.width = `${panelWidth}px`;
    const below = y + height - bounds.bottom - 18, above = bounds.top - y - 18;
    const upward = below < Math.min(panel.scrollHeight, 240) && above > below;
    panel.style.maxHeight = `${Math.max(40, Math.min(360, upward ? above : below, height - 24))}px`;
    panel.style.left = `${Math.max(x + 12, Math.min(bounds.left, x + width - panelWidth - 12))}px`;
    panel.style.top = `${Math.max(y + 12, upward ? bounds.top - panel.getBoundingClientRect().height - 6 : bounds.bottom + 6)}px`;
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    position();
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !list.current?.contains(event.target)) position(); };
    const viewport = window.visualViewport;
    window.addEventListener("resize", position);
    window.addEventListener("scroll", scroll, true);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    const observer = new ResizeObserver(position);
    if (trigger.current) observer.observe(trigger.current);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", scroll, true);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      observer.disconnect();
    };
  }, [open, position]);
  useLayoutEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);
  useLayoutEffect(() => {
    const form = field.current?.form;
    const reset = () => setInternalValue(String(defaultValue ?? options[0]?.value ?? ""));
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue, options[0]?.value]);
  useLayoutEffect(() => { if (disabled) list.current?.hidePopover(); }, [disabled]);

  function close() { list.current?.hidePopover(); setOpen(false); }
  function show(index = selectedIndex) {
    if (disabled || !options.some(option => !option.disabled)) return;
    setActiveIndex(index >= 0 && !options[index]?.disabled ? index : options.findIndex(option => !option.disabled));
    list.current?.showPopover();
    setOpen(true);
    position();
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled || !field.current) return;
    field.current.value = option.value;
    field.current.dispatchEvent(new Event("change", { bubbles: true }));
    close();
    trigger.current?.focus({ preventScroll: true });
  }
  function move(direction: number) {
    let next = activeIndex;
    for (let count = 0; count < options.length; count++) {
      next = (next + direction + options.length) % options.length;
      if (!options[next].disabled) { setActiveIndex(next); break; }
    }
  }

  return <span className={`select-control ${className}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <select {...props} aria-label={undefined} aria-labelledby={undefined} hidden aria-hidden="true" tabIndex={-1} ref={field} disabled={disabled} value={value} defaultValue={defaultValue}
      onChange={event => { setInternalValue(event.target.value); onChange?.(event); }} onInvalid={() => trigger.current?.focus()}>{children}</select>
    <button ref={trigger} id={id} type="button" className="select-control-trigger" role="combobox" disabled={disabled}
      aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-describedby={props["aria-describedby"]}
      aria-invalid={props["aria-invalid"]} aria-required={props.required} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={listId} aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
      onClick={() => open ? close() : show()}
      onKeyDown={event => {
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) {
          if (event.key === "Escape" && !open) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") { close(); return; }
          if (event.key === "Enter" || event.key === " ") { if (open) choose(activeIndex); else show(); return; }
          if (event.key === "Home" || event.key === "End") {
            const index = event.key === "Home" ? options.findIndex(option => !option.disabled) : options.length - 1 - [...options].reverse().findIndex(option => !option.disabled);
            if (open) setActiveIndex(index); else show(index);
          } else if (open) move(event.key === "ArrowDown" ? 1 : -1); else show();
        } else if (event.key === "Tab") close();
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const now = Date.now();
          search.current = { value: now - search.current.time < 700 ? search.current.value + event.key : event.key, time: now };
          const index = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(search.current.value.toLocaleLowerCase()));
          if (index >= 0) { if (open) setActiveIndex(index); else show(index); }
        }
      }}>
      <span>{options[selectedIndex]?.label ?? options[0]?.label ?? "请选择"}</span><CaretDown aria-hidden="true"/>
    </button>
    <div ref={list} id={listId} popover="auto" role="listbox" aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]}
      className="select-control-menu" onToggle={event => setOpen(event.newState === "open")}>
      {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === selectedValue}
        aria-disabled={option.disabled || undefined} data-index={index} data-active={index === activeIndex || undefined}
        onPointerDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }} onClick={event => { event.preventDefault(); choose(index); }}>
        <span>{option.label}</span><Check aria-hidden="true" style={{ visibility: option.value === selectedValue ? "visible" : "hidden" }}/>
      </div>)}
    </div>
  </span>;
}
