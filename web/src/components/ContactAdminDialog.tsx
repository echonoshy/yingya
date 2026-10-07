import { useState, type RefObject } from 'react';
import { Check, Copy } from '@phosphor-icons/react';
import { ActionDialog } from './ActionDialog';
import './contact-admin.css';

const adminEmail = 'echonoshy@gmail.com';

export function ContactAdminDialog({ onClose, returnFocus }: { onClose: () => void; returnFocus?: RefObject<HTMLElement | null> }) {
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');

  async function copyEmail() {
    setCopyState('copying');
    try {
      await navigator.clipboard.writeText(adminEmail);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return <ActionDialog title="联系管理员" className="contact-admin-dialog" onClose={onClose} returnFocus={returnFocus} dismissOnBackdrop>
    <p>请发邮件至以下邮箱，说明需要协助的问题。</p>
    <p className="contact-admin-email">{adminEmail}</p>
    <p className="contact-admin-status" role="status" data-error={copyState === 'failed' || undefined}>
      {copyState === 'failed' ? '复制失败，请选中上方邮箱手动复制。' : copyState === 'copied' ? '邮箱已复制，可粘贴到邮件收件人。' : '需要邀请码、激活账号或重置密码时，请注明账号邮箱。'}
    </p>
    <footer><button type="button" className="primary-button" disabled={copyState === 'copying'} onClick={() => void copyEmail()}>
      {copyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copyState === 'copying' ? '正在复制…' : copyState === 'copied' ? '已复制' : '复制邮箱'}
    </button></footer>
  </ActionDialog>;
}
