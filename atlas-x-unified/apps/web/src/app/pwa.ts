export type PwaPhase = 'initializing' | 'ready' | 'offline' | 'recovered' | 'updateReady' | 'unsupported' | 'error';

export interface PwaSnapshot {
  readonly phase: PwaPhase;
  readonly online: boolean;
  readonly installAvailable: boolean;
  readonly updateAvailable: boolean;
  readonly message: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{
    readonly outcome: 'accepted' | 'dismissed';
    readonly platform: string;
  }>;
}

const serverSnapshot: PwaSnapshot = {
  phase: 'unsupported',
  online: true,
  installAvailable: false,
  updateAvailable: false,
  message: '当前环境不支持 PWA。',
};

let snapshot: PwaSnapshot = serverSnapshot;
let installPrompt: BeforeInstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;
let updateRequested = false;
let registrationStarted = false;
const listeners = new Set<() => void>();

export function resolvePwaPhase(input: {
  readonly supported: boolean;
  readonly online: boolean;
  readonly updateAvailable: boolean;
  readonly recovered: boolean;
}): PwaPhase {
  if (!input.supported) return 'unsupported';
  if (!input.online) return 'offline';
  if (input.updateAvailable) return 'updateReady';
  if (input.recovered) return 'recovered';
  return 'ready';
}

export function shouldReloadAfterControllerChange(
  requestedUpdate: boolean,
  hadController: boolean,
): boolean {
  return requestedUpdate && hadController;
}

function publish(next: PwaSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function patch(next: Partial<PwaSnapshot>) {
  publish({ ...snapshot, ...next });
}

export function subscribePwa(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaSnapshot(): PwaSnapshot {
  return snapshot;
}

export function getPwaServerSnapshot(): PwaSnapshot {
  return serverSnapshot;
}

export async function requestPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = installPrompt;
  if (prompt === null) return 'unavailable';
  await prompt.prompt();
  const choice = await prompt.userChoice;
  installPrompt = null;
  patch({
    installAvailable: false,
    message: choice.outcome === 'accepted' ? '安装请求已接受。' : '安装已取消，可稍后重试。',
  });
  return choice.outcome;
}

export function activatePwaUpdate(): boolean {
  if (waitingWorker === null) return false;
  updateRequested = true;
  patch({ message: '正在激活新版本…' });
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export function dismissPwaNotice() {
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  patch({
    phase: online ? 'ready' : 'offline',
    message: online ? '应用已就绪。' : '当前离线，公共行情会显示真实缓存或明确标识的测试数据。',
  });
}

export async function registerPwa(): Promise<void> {
  if (registrationStarted) return;
  registrationStarted = true;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    publish(serverSnapshot);
    return;
  }

  const initialOnline = navigator.onLine !== false;
  publish({
    phase: initialOnline ? 'initializing' : 'offline',
    online: initialOnline,
    installAvailable: false,
    updateAvailable: false,
    message: initialOnline ? '正在启用离线应用壳…' : '当前离线，正在尝试恢复本地应用壳。',
  });

  const hadController = navigator.serviceWorker.controller !== null;
  const onBeforeInstall = (event: Event) => {
    event.preventDefault();
    installPrompt = event as BeforeInstallPromptEvent;
    patch({ installAvailable: true, message: '可安装为独立应用。' });
  };
  const onInstalled = () => {
    installPrompt = null;
    patch({ installAvailable: false, message: 'ATLAS X 已安装。' });
  };
  const onOffline = () => {
    publish({
      ...snapshot,
      phase: 'offline',
      online: false,
      message: '网络已断开；应用壳仍可用，公共行情将降级为真实缓存或明确标识的测试数据。',
    });
  };
  const onOnline = () => {
    publish({
      ...snapshot,
      phase: snapshot.updateAvailable ? 'updateReady' : 'recovered',
      online: true,
      message: snapshot.updateAvailable ? '网络已恢复，新版本可安全激活。' : '网络已恢复，公共行情正在重新连接。',
    });
  };
  const onControllerChange = () => {
    if (shouldReloadAfterControllerChange(updateRequested, hadController)) globalThis.location.reload();
  };

  globalThis.addEventListener('beforeinstallprompt', onBeforeInstall);
  globalThis.addEventListener('appinstalled', onInstalled);
  globalThis.addEventListener('offline', onOffline);
  globalThis.addEventListener('online', onOnline);
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

  try {
    const registration = await navigator.serviceWorker.register(
      new URL('sw.js', document.baseURI),
      { scope: './', updateViaCache: 'none' },
    );

    const markUpdateReady = (worker: ServiceWorker) => {
      waitingWorker = worker;
      publish({
        ...snapshot,
        phase: 'updateReady',
        updateAvailable: true,
        message: '新版本已下载。完成当前操作后可安全更新。',
      });
    };

    if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
      markUpdateReady(registration.waiting);
    }

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (installing === null) return;
      installing.addEventListener('statechange', () => {
        if (installing.state !== 'installed') return;
        if (navigator.serviceWorker.controller === null) {
          patch({ phase: navigator.onLine === false ? 'offline' : 'ready', message: '离线应用壳已就绪。' });
          return;
        }
        markUpdateReady(registration.waiting ?? installing);
      });
    });

    if (registration.waiting === null) {
      patch({
        phase: navigator.onLine === false ? 'offline' : 'ready',
        online: navigator.onLine !== false,
        message: navigator.onLine === false ? '离线应用壳已就绪。' : '离线应用壳已启用。',
      });
    }

    globalThis.setInterval(() => {
      if (navigator.onLine !== false) void registration.update();
    }, 60 * 60 * 1000);
  } catch (error) {
    publish({
      ...snapshot,
      phase: 'error',
      message: error instanceof Error ? `离线应用壳启用失败：${error.message}` : '离线应用壳启用失败。',
    });
  }
}
