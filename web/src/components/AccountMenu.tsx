import { UpdateBadge, useAppUpdate } from './AppUpdate';
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { ArrowLeft, CaretRight, ChartBar, ClockCounterClockwise, EnvelopeSimple, GearSix, Lifebuoy, Receipt, ShieldCheck, SignOut, UserCircle } from '@phosphor-icons/react';
import { AvatarImage } from './AvatarPicker';
import { productVersion } from '../productVersion';
import './account-menu.css';

type Section = 'main' | 'usage' | 'settings' | 'help';
const sectionLabels = { usage: '使用情况', settings: '设置', help: '帮助' };
const sections = [
  { id: 'usage', Icon: ChartBar }, { id: 'settings', Icon: GearSix }, { id: 'help', Icon: Lifebuoy },
] as const;

export function AccountMenu({ email, isAdmin, avatarUrl, error, returnFocus, onAvatarTap, onAvatar, onUsage, onBilling, onVersion, onLogout }: {
  email: string; isAdmin: boolean; avatarUrl?: string; error: string;
  returnFocus: RefObject<HTMLElement | null>; onAvatarTap: (event: MouseEvent<HTMLElement>) => void;
  onAvatar: () => void; onUsage: () => void; onBilling: () => void; onVersion: () => void; onLogout: () => Promise<void>;
}) {
  const { available } = useAppUpdate();
  const root = useRef<HTMLDetailsElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [section, setSection] = useState<Section>('main');
  const [submenuMode, setSubmenuMode] = useState<'page' | 'flyout' | 'inline'>('page');
  const [flyoutPosition, setFlyoutPosition] = useState({ side: 'right', top: 0 });
  const [loggingOut, setLoggingOut] = useState(false);
  const focusAfterChange = useRef<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelHoverClose() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }

  function close(restoreFocus = false) {
    const details = root.current;
    if (!details) return;
    details.open = false;
    cancelHoverClose();
    setSection('main');
    setSubmenuMode('page');
    focusAfterChange.current = null;
    if (restoreFocus) details.querySelector('summary')?.focus();
  }
  function openSection(next: Exclude<Section, 'main'>) {
    cancelHoverClose();
    focusAfterChange.current = '.account-submenu-back';
    setSubmenuMode('page');
    setSection(next);
  }
  function hoverSection(next: Exclude<Section, 'main'>, target: HTMLElement) {
    cancelHoverClose();
    const bounds = menu.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = 240, gap = 8, inset = 12;
    const rightFits = bounds.right + gap + width <= window.innerWidth - inset;
    const leftFits = bounds.left - gap - width >= inset;
    if (rightFits || leftFits) {
      const height = 14 + 44 * (next === 'settings' && !isAdmin ? 1 : 2);
      const top = Math.max(inset - bounds.top, Math.min(target.getBoundingClientRect().top - bounds.top - 6, window.innerHeight - inset - bounds.top - height));
      setFlyoutPosition({ side: rightFits ? 'right' : 'left', top });
      setSubmenuMode('flyout');
    } else setSubmenuMode('inline');
    // Hover reveals options without moving keyboard focus.
    focusAfterChange.current = null;
    setSection(next);
  }
  function back() {
    cancelHoverClose();
    focusAfterChange.current = `[data-account-section="${section}"]`;
    setSection('main');
    setSubmenuMode('page');
  }
  function action(callback: () => void) {
    returnFocus.current = root.current?.querySelector('summary') ?? null;
    close(true);
    callback();
  }
  useLayoutEffect(() => {
    if (focusAfterChange.current) {
      menu.current?.querySelector<HTMLElement>(focusAfterChange.current)?.focus();
      focusAfterChange.current = null;
    }
  }, [section, submenuMode]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const details = root.current;
      if (details?.open && !details.contains(event.target as Node)) {
        details.open = false;
        setSection('main');
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('pointerdown', outside); cancelHoverClose(); };
  }, []);

  const submenu = section !== 'main' ? <div className={`account-submenu account-submenu--${submenuMode}${submenuMode === 'flyout' ? ` account-submenu--${flyoutPosition.side}` : ''}`}
    style={submenuMode === 'flyout' ? { top: flyoutPosition.top } : undefined} role="region" aria-label={`${sectionLabels[section]}二级菜单`}>
    {submenuMode === 'page' ? <>
      <button type="button" className="account-submenu-back" aria-label="返回账号菜单" onClick={back}><ArrowLeft aria-hidden="true"/><span>{sectionLabels[section]}</span></button>
      <div className="account-menu-divider"/>
    </> : null}
    {section === 'usage' ? <>
      <button type="button" onClick={() => action(onUsage)}><ChartBar aria-hidden="true"/><span>用量统计</span></button>
      <button type="button" onClick={() => action(onBilling)}><Receipt aria-hidden="true"/><span>API 等价账单</span></button>
    </> : section === 'settings' ? <>
      <button type="button" onClick={() => action(onAvatar)}><UserCircle aria-hidden="true"/><span>更换头像</span></button>
      {isAdmin ? <button type="button" onClick={() => action(() => window.location.assign('/admin'))}><ShieldCheck aria-hidden="true"/><span>账号管理</span></button> : null}
    </> : <>
      <button type="button" aria-label="版本记录" onClick={() => action(onVersion)}><ClockCounterClockwise aria-hidden="true"/><span>版本记录</span><small className="account-menu-meta">v{productVersion}</small></button>
      <a href="mailto:echonoshy@gmail.com" onClick={() => close(true)}><EnvelopeSimple aria-hidden="true"/><span>联系管理员</span></a>
    </>}
  </div> : null;

  return <details ref={root} className="account-panel"
    onToggle={event => { if (!event.currentTarget.open) { cancelHoverClose(); setSection('main'); setSubmenuMode('page'); focusAfterChange.current = null; } }}
    onBlur={event => {
      // Replacing a focused menu item with a submenu temporarily clears focus.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
    }}
    onKeyDown={event => {
      if (!event.currentTarget.open) return;
      if (event.key === 'Escape' || (event.key === 'ArrowLeft' && section !== 'main')) {
        event.preventDefault(); event.stopPropagation();
        if (section !== 'main') back(); else close(true);
      } else if (event.key === 'ArrowRight') {
        const next = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-account-section]')?.dataset.accountSection;
        if (next === 'usage' || next === 'settings' || next === 'help') { event.preventDefault(); openSection(next); }
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const controls = Array.from(menu.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []);
        if (!controls.length) return;
        event.preventDefault();
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
          : event.key === 'ArrowDown' ? (current + 1) % controls.length
          : (current <= 0 ? controls.length : current) - 1;
        controls[next]?.focus();
      }
    }}>
    <summary onClick={onAvatarTap} aria-label={`账号：${email}${available ? "，有新版本" : ""}`} aria-controls={menuId} title="账号菜单"><AvatarImage url={avatarUrl}/>{available ? <span className="account-update-label" aria-hidden="true">新版本</span> : null}</summary>
    <div ref={menu} id={menuId} className="account-menu" aria-label="账号菜单" onPointerEnter={cancelHoverClose}
      onPointerLeave={event => {
        if (event.pointerType !== 'mouse' || submenuMode === 'page') return;
        cancelHoverClose();
        hoverTimer.current = setTimeout(() => { setSection('main'); setSubmenuMode('page'); hoverTimer.current = null; }, 160);
      }}>
      {section === 'main' || submenuMode !== 'page' ? <div className="account-menu-main">
        <div className="account-menu-identity"><AvatarImage url={avatarUrl}/><div><b title={email}>{email}</b><small>{isAdmin ? '管理员' : '内测账号'}</small></div></div>
        <UpdateBadge beforeOpen={() => close(true)} />
        {sections.map(({ id, Icon }) => <div key={id}>
          <button type="button" data-account-section={id} aria-controls={menuId} aria-expanded={section === id}
            onPointerEnter={event => { if (event.pointerType === 'mouse' && matchMedia('(hover: hover) and (pointer: fine)').matches) hoverSection(id, event.currentTarget); }}
            onClick={() => openSection(id)}><Icon aria-hidden="true"/><span>{sectionLabels[id]}</span><CaretRight className="account-menu-caret" aria-hidden="true"/></button>
          {submenuMode === 'inline' && section === id ? submenu : null}
        </div>)}
        <div className="account-menu-divider"/>
        <button type="button" disabled={loggingOut} onClick={async () => { setLoggingOut(true); try { await onLogout(); } finally { setLoggingOut(false); } }}><SignOut aria-hidden="true"/><span>{loggingOut ? '正在退出…' : '退出登录'}</span></button>
      </div> : submenu}
      {submenuMode === 'flyout' ? submenu : null}
      {error ? <p className="account-error" role="alert">{error}</p> : null}
    </div>
  </details>;
}
