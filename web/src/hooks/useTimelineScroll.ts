import { useCallback, useLayoutEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD = 64;

/** Follow live output only while the reader is at the end of the conversation. */
export function useTimelineScroll(revision: string) {
  const timelineRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const jumping = useRef(false);
  const lastRevision = useRef(revision);
  const [hasNewContent, setHasNewContent] = useState(false);

  const onScroll = useCallback(() => {
    const timeline = timelineRef.current;
    if (!timeline || !timeline.clientHeight || jumping.current) return;
    following.current = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= BOTTOM_THRESHOLD;
    if (following.current) setHasNewContent(false);
  }, []);

  const scrollToLatest = useCallback(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    following.current = true;
    setHasNewContent(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    jumping.current = !reduce && timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop > 1;
    // Explicit navigation can animate; frequent streaming updates must not queue smooth scrolls.
    timeline.scrollTo({ top: timeline.scrollHeight, behavior: reduce ? "instant" : "smooth" });
  }, []);

  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    const content = contentRef.current;
    if (!timeline || !content) return;
    const follow = () => {
      if (following.current && !jumping.current && timeline.clientHeight) timeline.scrollTop = timeline.scrollHeight;
    };
    const finishJump = () => {
      if (!jumping.current) return;
      jumping.current = false;
      follow();
    };
    const interruptJump = () => {
      if (!jumping.current) return;
      jumping.current = false;
      following.current = false;
      timeline.scrollTo({ top: timeline.scrollTop, behavior: "instant" });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) interruptJump();
    };
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onPreferenceChange = () => { if (preference.matches) finishJump(); };
    timeline.addEventListener("scrollend", finishJump);
    timeline.addEventListener("wheel", interruptJump, { passive: true });
    timeline.addEventListener("pointerdown", interruptJump, { passive: true });
    timeline.addEventListener("touchstart", interruptJump, { passive: true });
    timeline.addEventListener("keydown", onKeyDown);
    preference.addEventListener("change", onPreferenceChange);
    follow();
    // Covers streamed text, lazy Markdown, media loading, composer height and mobile view changes.
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(timeline);
    return () => {
      observer.disconnect();
      timeline.removeEventListener("scrollend", finishJump);
      timeline.removeEventListener("wheel", interruptJump);
      timeline.removeEventListener("pointerdown", interruptJump);
      timeline.removeEventListener("touchstart", interruptJump);
      timeline.removeEventListener("keydown", onKeyDown);
      preference.removeEventListener("change", onPreferenceChange);
    };
  }, []);

  useLayoutEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    const timeline = timelineRef.current;
    if (following.current) {
      if (!jumping.current && timeline?.clientHeight) timeline.scrollTop = timeline.scrollHeight;
    } else setHasNewContent(true);
  }, [revision]);

  return { timelineRef, contentRef, onScroll, hasNewContent, scrollToLatest };
}
