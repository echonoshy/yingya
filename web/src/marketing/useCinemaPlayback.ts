import { useEffect, useRef, useState } from 'react';

/** Decorative films run only while visible and allowed by the motion preference. */
export function useCinemaPlayback(source: string) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let disposed = false;
    let request = 0;
    let failed = false;
    const synchronize = () => {
      const current = ++request;
      if (!visible || document.hidden || preference.matches || failed) {
        video.pause();
        if (preference.matches || failed) setStarted(false);
        return;
      }
      if (!video.getAttribute('src')) video.src = source;
      void video.play().then(() => {
        if (disposed || current !== request) return;
        setStarted(true);
      }).catch(() => { if (!disposed && current === request) setStarted(false); });
    };
    const error = () => { failed = true; synchronize(); };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .1;
      synchronize();
    }, { threshold: [0, .1] });
    observer.observe(video);
    video.addEventListener('error', error);
    preference.addEventListener('change', synchronize);
    document.addEventListener('visibilitychange', synchronize);
    // Some mobile browsers defer even muted media until the first page gesture.
    document.addEventListener('pointerdown', synchronize, { once: true });
    return () => {
      disposed = true;
      request += 1;
      video.pause();
      observer.disconnect();
      video.removeEventListener('error', error);
      preference.removeEventListener('change', synchronize);
      document.removeEventListener('visibilitychange', synchronize);
      document.removeEventListener('pointerdown', synchronize);
    };
  }, [source]);
  return { videoRef, started, time, onTimeUpdate: () => setTime(videoRef.current?.currentTime ?? 0) };
}
