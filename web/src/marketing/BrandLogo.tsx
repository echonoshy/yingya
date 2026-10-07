import './brandLogo.css';

/** The same English wordmark as the promotional film's closing frame. */
export function BrandWordmark() {
  return <span className="yingya-wordmark">YingYa<span className="yingya-wordmark-dot" aria-hidden="true" /></span>;
}

export function BrandLogo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return <a href={href} className={`print-brand${compact ? " print-brand--compact" : ""}`} aria-label="YingYa 首页">
    <BrandWordmark />
  </a>;
}
