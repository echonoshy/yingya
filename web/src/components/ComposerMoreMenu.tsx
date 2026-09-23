import { Images, Plus, UploadSimple, Waveform } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePopoverPosition } from "../hooks/usePopoverPosition";
import { VoiceSelector } from "./VoiceSelector";
import { useMotionPresence } from "../hooks/useMotionPresence";

export function ComposerMoreMenu({
  onUpload,
  onSelectAssets,
  selectedCount,
  voiceId,
  onVoice,
  running,
  narration = false,
  settings,
  triggerLabel,
}: {
  onUpload: () => void;
  onSelectAssets: () => void;
  selectedCount: number;
  voiceId: string;
  onVoice: (value: string) => void | Promise<void>;
  running: boolean;
  narration?: boolean;
  settings?: ReactNode;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const presence = useMotionPresence(open ? "menu" : null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const position = usePopoverPosition(open, trigger, settings ? 480 : 280);
  const voiceName = voiceId === "default" ? "默认音色" : voiceId;
  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>('.composer-more-action')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div
      className="composer-more"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open) {
          if (event.target === trigger.current && event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (event.key === "Tab" && !settings) { setOpen(false); return; }
        if ((event.target as HTMLElement).matches("select,input,textarea"))
          return;
        if (!settings && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = Array.from(
            root.current?.querySelectorAll<HTMLButtonElement>(
              '.composer-more-action:not(:disabled)',
            ) ?? [],
          );
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length;
          items[next]?.focus({ preventScroll: true });
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="icon-button composer-more-trigger"
        aria-label="添加素材与设置"
        title="添加素材与设置"
        aria-haspopup={settings ? "dialog" : "menu"}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <Plus aria-hidden="true" />
        {triggerLabel ? <span>{triggerLabel}</span> : null}
      </button>
      {presence.value ? (
        <div
          ref={presence.ref}
          inert={presence.exiting}
          aria-hidden={presence.exiting || undefined}
          className="composer-more-menu"
          id={menuId}
          role={settings ? "dialog" : "menu"}
          aria-label="素材与旁白设置"
          style={position}
        >
          <button
            type="button"
            className="composer-more-action"
            role={settings ? undefined : "menuitem"}
            onClick={() => {
              close();
              onUpload();
            }}
          >
            <UploadSimple aria-hidden="true" />
            <span>上传素材</span>
          </button>
          <button
            type="button"
            className="composer-more-action"
            role={settings ? undefined : "menuitem"}
            onClick={() => {
              close();
              onSelectAssets();
            }}
          >
            <Images aria-hidden="true" />
            <span>选择素材</span>
            {selectedCount ? <small>已选 {selectedCount} 项</small> : null}
          </button>
          {narration ? (
            <>
              <div className="composer-more-divider" role="separator" />
              <button
                type="button"
                className="composer-more-action"
            role={settings ? undefined : "menuitem"}
                aria-haspopup="dialog"
                disabled={running}
                title={
                  running
                    ? "当前任务完成后可更换音色"
                    : `旁白音色：${voiceName}`
                }
                onClick={() => {
                  close();
                  setVoiceOpen(true);
                }}
              >
                <Waveform aria-hidden="true" />
                <span>旁白音色</span>
                <small>{running ? "制作中，暂不可更换" : voiceName}</small>
              </button>
            </>
          ) : (
            <p className="composer-audio-note">
              需要新增配音时，可在对话中说明音色要求。
            </p>
          )}
          {settings ? (
            <div
              className="composer-extra-settings"
              role="group"
              aria-label="制作设置"
            >
              {settings}
            </div>
          ) : null}
        </div>
      ) : null}
      <VoiceSelector
        value={voiceId}
        onChange={onVoice}
        disabled={running}
        hideTrigger
        open={voiceOpen}
        onOpenChange={(next) => {
          setVoiceOpen(next);
          if (!next) trigger.current?.focus({ preventScroll: true });
        }}
      />
    </div>
  );
}
