import { useCallback, useEffect, useRef, useState } from 'react';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  return online;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface InstallPromptState {
  canInstall: boolean;
  installed: boolean;
  isStandalone: boolean;
  promptInstall: () => Promise<boolean>;
}

export function useInstallPrompt(): InstallPromptState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  });

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      setIsStandalone(true);
    };
    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => {
      setIsStandalone(
        media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    media.addEventListener?.('change', onDisplayChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      media.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return false;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      return choice.outcome === 'accepted';
    } catch {
      setDeferred(null);
      return false;
    }
  }, [deferred]);

  return { canInstall: Boolean(deferred), installed, isStandalone, promptInstall };
}

export type PwaStatus =
  | 'dev'
  | 'single'
  | 'unsupported'
  | 'insecure'
  | 'registering'
  | 'ready'
  | 'error';

export interface PwaState {
  status: PwaStatus;
  updateReady: boolean;
  applyUpdate: () => void;
}

export function usePwa(): PwaState {
  const [status, setStatus] = useState<PwaStatus>(() => {
    if (import.meta.env.MODE === 'singlefile') return 'single';
    if (!import.meta.env.PROD) return 'dev';
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
    if (!window.isSecureContext) return 'insecure';
    return 'registering';
  });
  const [updateReady, setUpdateReady] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const applyingRef = useRef(false);

  useEffect(() => {
    if (import.meta.env.MODE === 'singlefile') return;
    if (!import.meta.env.PROD) return;
    if (!('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) return;

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;

    const markWaiting = () => {
      if (!disposed && navigator.serviceWorker.controller) setUpdateReady(true);
    };

    const register = async () => {
      try {
        const swUrl = new URL('sw.js', document.baseURI).href;
        registration = await navigator.serviceWorker.register(swUrl, { scope: './' });
        if (disposed) return;
        registrationRef.current = registration;
        if (registration.waiting) markWaiting();
        registration.addEventListener('updatefound', () => {
          const worker = registration?.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') markWaiting();
          });
        });
        // Статус «готово» ставим только после реальной активации: если кэш
        // не скачался, приложение не должно обещать офлайн-режим.
        void navigator.serviceWorker.ready.then(() => {
          if (!disposed) setStatus('ready');
        });
      } catch (error) {
        if (!disposed) {
          setStatus('error');
          console.warn('Не удалось зарегистрировать service worker', error);
        }
      }
    };

    const onLoad = () => {
      void register();
    };

    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', onLoad, { once: true });
    }

    const onControllerChange = () => {
      if (applyingRef.current) {
        applyingRef.current = false;
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      registration?.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      window.removeEventListener('load', onLoad);
      document.removeEventListener('visibilitychange', onVisibility);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const registration = registrationRef.current;
    if (registration?.waiting) {
      applyingRef.current = true;
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.setTimeout(() => {
        if (applyingRef.current) {
          applyingRef.current = false;
          window.location.reload();
        }
      }, 2500);
    } else {
      window.location.reload();
    }
  }, []);

  return { status, updateReady, applyUpdate };
}

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

/** Не даёт экрану погаснуть, пока открыт экран для группы. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const request = async () => {
      try {
        const wakeLock = (
          navigator as Navigator & {
            wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
          }
        ).wakeLock;
        if (!wakeLock || cancelled) return;
        sentinel = await wakeLock.request('screen');
      } catch {
        // Некоторые браузеры не поддерживают Wake Lock — это не критично.
      }
    };

    void request();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
