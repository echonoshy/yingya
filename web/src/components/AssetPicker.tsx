import { useState } from 'react';
import { File, FileAudio, FilmSlate } from '@phosphor-icons/react';
import type { AssetFolder, AssetLibraryItem } from '../types';

export function AssetPicker({ assets, folders, selectedIds, onToggle }: { assets: AssetLibraryItem[]; folders: AssetFolder[]; selectedIds: string[]; onToggle: (asset: AssetLibraryItem) => void }) {
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('*');
  const visible = assets.filter(asset => (folder === '*' || (asset.folderId ?? '') === folder) && `${asset.sourceName} ${asset.prompt}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="reference-picker"><div className="reference-picker-tools"><input aria-label="搜索参考素材" placeholder="搜索素材名称" value={query} onChange={event => setQuery(event.target.value)}/><select aria-label="参考素材文件夹" value={folder} onChange={event => setFolder(event.target.value)}><option value="*">全部文件夹</option><option value="">未整理</option>{folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><p role="status">已选 {selectedIds.length} 项 · 找到 {visible.length} 项</p><div className="reference-picker-grid">{visible.map(asset => <label key={asset.id}><input type="checkbox" aria-label={asset.sourceName || asset.prompt || "未命名素材"} checked={selectedIds.includes(asset.id)} onChange={() => onToggle(asset)}/><span className="reference-picker-thumb">{asset.category === 'image' ? <img src={asset.url} alt="" loading="lazy"/> : asset.category === 'video' ? <FilmSlate/> : asset.category === 'audio' ? <FileAudio/> : <File/>}</span><span><b>{asset.sourceName || asset.prompt || '未命名素材'}</b><small>{({ image: '图片', video: '视频', audio: '音频', document: '文档', file: '文件' })[asset.category]}</small></span></label>)}</div>{!visible.length ? <p>没有匹配的素材，可调整筛选或添加附件。</p> : null}</div>;
}
