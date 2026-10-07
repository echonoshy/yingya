import { ArrowClockwise, Check, File, Warning } from '@phosphor-icons/react';
import type { UploadItem } from '../hooks/useUploadQueue';
import './upload-progress.css';

export function UploadProgressList({ items, onRetry, onClear }: { items: UploadItem[]; onRetry?: (id: string) => void; onClear?: () => void }) {
  if (!items.length) return null;
  const completed = items.filter(item => item.status === 'complete').length;
  const failed = items.filter(item => item.status === 'error').length;
  const active = items.some(item => ['queued', 'uploading', 'processing'].includes(item.status));
  return <section className="upload-progress-list" aria-label="素材上传进度">
    <header><strong>{active ? '正在上传素材' : failed ? '部分素材未上传' : '素材上传完成'}</strong><span role="status">已完成 {completed}/{items.length}{failed ? ` · ${failed} 项失败` : ''}</span>{onClear && completed ? <button type="button" onClick={onClear}>清除已完成</button> : null}</header>
    <ul>{items.map(item => {
      const label = item.status === 'complete' ? '已完成' : item.status === 'error' ? '上传失败' : item.status === 'queued' ? '等待上传' : item.status === 'processing' ? '已传输，正在保存' : item.progress === undefined ? '正在上传' : `正在上传 ${item.progress}%`;
      return <li key={item.id} data-state={item.status}>
        <span className="upload-file-icon" aria-hidden="true">{item.status === 'complete' ? <Check/> : item.status === 'error' ? <Warning/> : <File/>}</span>
        <div className="upload-file-copy"><div><span title={item.name}>{item.name}</span><small>{label}</small></div>
          {['queued', 'uploading', 'processing'].includes(item.status) ? <progress aria-label={`上传 ${item.name}`} max={100} value={item.status === 'queued' ? 0 : item.progress}/> : null}
          {item.error ? <p>{item.error}</p> : null}
        </div>{item.status === 'error' && onRetry ? <button type="button" aria-label={`重试上传 ${item.name}`} onClick={() => onRetry(item.id)}><ArrowClockwise/>重试</button> : null}
      </li>;
    })}</ul>
  </section>;
}
