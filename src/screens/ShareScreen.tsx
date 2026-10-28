import { useMemo, useRef } from 'react';
import type { AppState } from '../core/types';
import { buildSnapshotUrl, exportStateJson, importStateJson, MAX_QR_URL_LENGTH } from '../core/codec';
import { copyText, currentAppUrl, downloadFile, formatBytes, formatDateForFile, plural } from '../utils';
import { useUi } from '../ui';
import { QrCode } from '../components/QrCode';
import {
  IconArrowLeft,
  IconCopy,
  IconDownload,
  IconQr,
  IconShare,
  IconUpload,
} from '../components/Icons';

interface ShareScreenProps {
  state: AppState;
  onBack: () => void;
  onReplace: (next: AppState) => void;
}

export function ShareScreen({ state, onBack, onReplace }: ShareScreenProps) {
  const { notify, confirm } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const url = useMemo(() => buildSnapshotUrl(currentAppUrl(), state), [state]);
  const urlBytes = useMemo(() => new Blob([url]).size, [url]);
  const tooLong = url.length > MAX_QR_URL_LENGTH;
  const pendingText = state.pending ? ' и текущий черновик' : '';

  const handleCopy = async () => {
    const ok = await copyText(url);
    notify(ok ? 'Ссылка со снимком скопирована' : 'Не удалось скопировать ссылку', ok ? 'success' : 'error');
  };

  const handleShare = async () => {
    if (typeof navigator.share !== 'function') {
      await handleCopy();
      return;
    }
    try {
      await navigator.share({
        title: 'Рондомайзер — снимок вечера',
        text: `Данные вечера: ${state.participants.length} ${plural(state.participants.length, 'участник', 'участника', 'участников')}, ${state.history.length} ${plural(state.history.length, 'раунд', 'раунда', 'раундов')}. Это снимок, а не онлайн-синхронизация.`,
        url,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      notify('Не удалось поделиться ссылкой', 'error');
    }
  };

  const exportJson = () => {
    downloadFile(
      `rondomizer-${formatDateForFile()}.json`,
      exportStateJson(state),
      'application/json',
    );
    notify('JSON-файл сохранён', 'success');
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const next = importStateJson(text);
      if (!next) {
        notify('Не удалось прочитать файл: это не снимок Рондомайзера.', 'error');
        return;
      }
      const ok = await confirm({
        title: 'Загрузить данные из файла?',
        text: `В файле: ${next.participants.length} ${plural(next.participants.length, 'участник', 'участника', 'участников')}, ${next.history.length} ${plural(next.history.length, 'раунд', 'раунда', 'раундов')}. Текущие данные на этом устройстве будут заменены.`,
        confirmLabel: 'Загрузить',
      });
      if (ok) onReplace(next);
    } catch {
      notify('Не удалось прочитать файл', 'error');
    }
  };

  return (
    <div className="screen subview">
      <div className="subview-head">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Назад">
          <IconArrowLeft size={22} />
        </button>
        <div>
          <p className="eyebrow">Снимок данных</p>
          <h1>Передать данные</h1>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Ссылка со снимком</h2>
          <span className="badge badge-muted">{formatBytes(urlBytes)}</span>
        </div>
        <p className="muted">
          В ссылке зашиты участники, история и круги{pendingText}. Открывший её человек увидит
          предложение загрузить данные вместо своих.
        </p>

        {tooLong ? (
          <div className="notice notice-warn">
            <span>
              Данных слишком много для QR-кода. Ссылка всё равно работает, но для телефона надёжнее
              скачать JSON-файл и открыть его на другом устройстве.
            </span>
          </div>
        ) : (
          <div className="qr-center">
            <QrCode text={url} size={210} />
          </div>
        )}

        <div className="url-row">
          <code className="url-text url-long">{url}</code>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={() => void handleCopy()}>
            <IconCopy size={18} />
            Скопировать
          </button>
          <button type="button" className="btn" onClick={() => void handleShare()}>
            <IconShare size={18} />
            Поделиться
          </button>
        </div>
        <p className="form-hint">
          Снимок не синхронизируется сам: изменения на одном телефоне не появятся на другом. Чтобы
          обновить данные, отправьте новую ссылку или файл.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Файл JSON</h2>
        </div>
        <p className="muted">
          Работает офлайн и без QR. Сохраните файл, отправьте его в мессенджере, а на другом
          устройстве загрузите через «Импорт».
        </p>
        <div className="button-row">
          <button type="button" className="btn" onClick={exportJson}>
            <IconDownload size={18} />
            Скачать JSON
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <IconUpload size={18} />
            Импорт JSON
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importFile(file);
            event.target.value = '';
          }}
        />
        <p className="form-hint">
          JSON содержит имена и историю танцев. Передавайте его только тем, кому доверяете.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Что именно передаётся</h2>
        </div>
        <ul className="plain-list">
          <li>
            <strong>{state.participants.length}</strong>{' '}
            {plural(state.participants.length, 'участник', 'участника', 'участников')}, включая
            отсутствующих и ушедших.
          </li>
          <li>
            <strong>{state.history.length}</strong>{' '}
            {plural(state.history.length, 'подтверждённый раунд', 'подтверждённых раунда', 'подтверждённых раундов')}{' '}
            и {state.pending ? 'один черновик' : 'без черновика'}.
          </li>
          <li>Круги: с кем каждый уже танцевал в текущем круге.</li>
          <li>Роли, статусы и время начала вечера.</li>
        </ul>
        <p className="form-hint">
          Кнопка «Новый вечер» очищает историю и круги, но оставляет список людей. Снимок тоже
          сохраняет текущий состав.
        </p>
      </section>

      <div className="notice notice-info">
        <IconQr size={18} />
        <span>
          Если вы открыли приложение по ссылке со снимком, после загрузки адрес очистится — это
          защита от случайной повторной загрузки старых данных.
        </span>
      </div>

      <button type="button" className="btn btn-ghost btn-block" onClick={onBack}>
        <IconArrowLeft size={18} />
        Назад в меню
      </button>
    </div>
  );
}
