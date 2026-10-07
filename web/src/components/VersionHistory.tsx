import {ActionDialog} from './ActionDialog';
import {productVersion, publicReleaseNotes} from '../productVersion';
import './version-history.css';

export function VersionHistory({onClose}: {onClose: () => void}) {
  return <ActionDialog title="版本记录" className="version-history" onClose={onClose}>
    <div className="version-history-current"><span>当前版本</span><strong>v{productVersion}</strong></div>
    <p className="version-history-intro">最近 5 次更新</p>
    <ol className="version-history-list" aria-label="版本更新说明">
      {publicReleaseNotes.map(release => <li key={release.version}>
        <div className="version-history-meta"><span>v{release.version}</span><time dateTime={release.date}>{release.date.replaceAll('-', '.')}</time></div>
        <p>{release.summary}</p>
      </li>)}
    </ol>
  </ActionDialog>;
}
