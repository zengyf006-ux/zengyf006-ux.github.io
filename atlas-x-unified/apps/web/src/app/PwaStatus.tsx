import { useState, useSyncExternalStore } from 'react';
import {
  activatePwaUpdate,
  dismissPwaNotice,
  getPwaServerSnapshot,
  getPwaSnapshot,
  requestPwaInstall,
  subscribePwa,
} from './pwa.js';

export function PwaStatus() {
  const snapshot = useSyncExternalStore(subscribePwa, getPwaSnapshot, getPwaServerSnapshot);
  const [installing, setInstalling] = useState(false);

  if (
    snapshot.phase === 'unsupported'
    || (snapshot.phase === 'ready' && !snapshot.installAvailable && !snapshot.updateAvailable)
    || snapshot.phase === 'initializing'
  ) return null;

  async function install() {
    setInstalling(true);
    try {
      await requestPwaInstall();
    } finally {
      setInstalling(false);
    }
  }

  return (
    <aside className={`pwa-status phase-${snapshot.phase}`} aria-live="polite" aria-label="应用状态">
      <div>
        <strong>{snapshot.phase === 'offline' ? '离线模式' : snapshot.phase === 'updateReady' ? '版本更新' : snapshot.phase === 'recovered' ? '连接已恢复' : 'PWA 状态'}</strong>
        <span>{snapshot.message}</span>
      </div>
      <div className="pwa-actions">
        {snapshot.installAvailable ? <button disabled={installing} onClick={() => void install()}>{installing ? '正在请求…' : '安装应用'}</button> : null}
        {snapshot.updateAvailable ? <button className="primary" onClick={() => activatePwaUpdate()}>安全更新</button> : null}
        {snapshot.phase === 'recovered' || snapshot.phase === 'error' ? <button onClick={dismissPwaNotice} aria-label="关闭应用状态提示">关闭</button> : null}
      </div>
    </aside>
  );
}
