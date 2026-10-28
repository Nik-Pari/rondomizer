import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal } from './components/Modal';
import { IconX } from './components/Icons';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export type Notify = (text: string, kind?: ToastKind, action?: ToastAction) => void;

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  action?: ToastAction;
}

interface UiContextValue {
  notify: Notify;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const UiContext = createContext<UiContextValue | null>(null);

export function useUi(): UiContextValue {
  const context = useContext(UiContext);
  if (!context) throw new Error('useUi must be used inside UiProvider');
  return context;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const counterRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const notify = useCallback<Notify>(
    (text, kind = 'info', action) => {
      counterRef.current += 1;
      const id = counterRef.current;
      const item: ToastItem = { id, text, kind, action };
      setToasts((current) => [...current.slice(-1), item]);
      const duration = action ? 20_000 : kind === 'error' ? 7000 : 4500;
      const timer = window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
        timersRef.current.delete(id);
      }, duration);
      timersRef.current.set(id, timer);
    },
    [],
  );

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setDialog(options);
    });
  }, []);

  const closeDialog = useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolve?.(value);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const value = useMemo<UiContextValue>(() => ({ notify, confirm }), [notify, confirm]);

  return (
    <UiContext.Provider value={value}>
      {children}

      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.kind}`} key={toast.id} role="status">
            <span className="toast-dot" aria-hidden="true" />
            <span className="toast-text">{toast.text}</span>
            {toast.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label="Закрыть уведомление"
            >
              <IconX size={16} />
            </button>
          </div>
        ))}
      </div>

      {dialog ? (
        <Modal
          title={dialog.title}
          onClose={() => closeDialog(false)}
          footer={
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                data-autofocus={dialog.danger ? true : undefined}
                onClick={() => closeDialog(false)}
              >
                {dialog.cancelLabel ?? 'Отмена'}
              </button>
              <button
                type="button"
                className={dialog.danger ? 'btn btn-danger' : 'btn btn-primary'}
                data-autofocus={dialog.danger ? undefined : true}
                onClick={() => closeDialog(true)}
              >
                {dialog.confirmLabel ?? 'Продолжить'}
              </button>
            </div>
          }
        >
          {dialog.text ? <p className="dialog-text">{dialog.text}</p> : null}
        </Modal>
      ) : null}
    </UiContext.Provider>
  );
}
