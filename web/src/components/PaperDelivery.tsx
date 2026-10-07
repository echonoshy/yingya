import { useEffect, useRef } from 'react';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { usePlayMotion } from './KineticType';

/** A local acknowledgement of text being added, never a simulated network success. */
export function PaperDelivery({ cue }: { cue: number }) {
  const plane = useRef<HTMLSpanElement>(null);
  const receipt = useRef<HTMLSpanElement>(null);
  const animate = usePlayMotion();
  useEffect(() => {
    if (!cue) return;
    animate(plane.current, [
      { transform: 'translate(-92px,42px) rotate(-18deg) scale(.6)', opacity: 0 },
      { transform: 'translate(-52px,-14px) rotate(-8deg) scale(1.1)', opacity: 1, offset: .35 },
      { transform: 'translate(0,0) rotate(26deg) scale(.7)', opacity: 1, offset: .78 },
      { transform: 'translate(6px,6px) rotate(32deg) scale(.25)', opacity: 0 },
    ], 760);
    animate(receipt.current, [
      { opacity: 0, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'none', offset: .18 },
      { opacity: 1, transform: 'none', offset: .8 },
      { opacity: 0, transform: 'none' },
    ], 1700, 580);
  }, [cue, animate]);
  return <span className="paper-delivery" aria-hidden="true"><span className="paper-delivery-plane" ref={plane}><PaperPlaneTilt weight="duotone"/></span><span className="paper-delivery-receipt" ref={receipt}>已放入想法<span>↙</span></span></span>;
}
