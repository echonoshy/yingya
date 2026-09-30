/** The original ghost mark with the current navy ink is shared by the public site and the working app. */
export function BrandLogo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return <a href={href} className={`print-brand${compact ? " print-brand--compact" : ""}`} aria-label="映芽首页">
    <img src="/brand/yingya-ghost-navy.svg" alt="" width="36" height="36" />
    <b>映芽</b>{!compact && <span>yingya</span>}
  </a>;
}
