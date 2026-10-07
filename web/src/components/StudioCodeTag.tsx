/** Static code accents shared by the creation and library pages. */
export function StudioCodeTag({ name, closing = false, className = "" }: { name: "Create" | "Projects" | "Assets"; closing?: boolean; className?: string }) {
  return <code className={`studio-code-tag${closing ? " studio-code-tag--close" : ""} ${className}`} aria-hidden="true"><span>{closing ? "</" : "<"}</span>{name}<span>{">"}</span></code>;
}
