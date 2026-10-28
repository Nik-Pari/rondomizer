import { useState } from 'react';
import type { AppStore } from '../useAppStore';
import type { InstallPromptState, PwaState } from '../hooks';
import { currentAppUrl, APP_VERSION, plural } from '../utils';
import { useUi } from '../ui';
import { InstallScreen } from './InstallScreen';
import { ShareScreen } from './ShareScreen';
import { Modal } from '../components/Modal';
import {
  IconChevronRight,
  IconInfo,
  IconInstall,
  IconRefresh,
  IconShare,
  IconShield,
  IconSpark,
  IconTrash,
  IconWifi,
  IconWifiOff,
} from '../components/Icons';

interface MoreScreenProps {
  store: AppStore;
  pwa: PwaState;
  install: InstallPromptState;
  online: boolean;
}

type View = 'menu' | 'install' | 'share';

function pwaStatusText(pwa: PwaState): string {
  switch (pwa.status) {
    case 'dev':
      return 'Режим разработки: service worker отключён. В собранной версии офлайн-кэш включится сам.';
    case 'single':
      return 'Одиночный файл: приложение работает без интернета, но без service worker и установки PWA.';
    case 'unsupported':
      return 'Этот браузер не поддерживает service worker. Приложение работает, но офлайн-кэш недоступен.';
    case 'insecure':
      return 'Сайт открыт без HTTPS. Для офлайн-режима и установки нужен HTTPS (или localhost).';
    case 'registering':
      return 'Регистрируем офлайн-кэш…';
    case 'ready':
      return 'Офлайн-кэш активен. После первого полного открытия приложение работает без сети.';
    case 'error':
      return 'Не удалось включить офлайн-кэш. Проверьте HTTPS и обновите страницу.';
    default:
      return '';
  }
}

export function MoreScreen({ store, pwa, install, online }: MoreScreenProps) {
  const { confirm } = useUi();
  const [view, setView] = useState<View>('menu');
  const [newEveningOpen, setNewEveningOpen] = useState(false);
  const [allActive, setAllActive] = useState(true);

  const appUrl = currentAppUrl();
  const installed = install.isStandalone || install.installed;

  if (view === 'install') {
    return (
      <InstallScreen
        onBack={() => setView('menu')}
        install={install}
        secure={window.isSecureContext}
        appUrl={appUrl}
        pwaStatus={pwa.status}
      />
    );
  }

  if (view === 'share') {
    return (
      <ShareScreen
        state={store.state}
        onBack={() => setView('menu')}
        onReplace={(next) => {
          store.replaceState(next, 'Снимок загружен');
          setView('menu');
        }}
      />
    );
  }

  const startEvening = () => {
    store.newEvening(allActive);
    setNewEveningOpen(false);
  };

  const eraseEverything = async () => {
    const ok = await confirm({
      title: 'Удалить все данные?',
      text: 'Будут удалены участники, история, круги и настройки вечера на этом устройстве. Отменить это действие нельзя. Сначала можно сохранить JSON-снимок.',
      confirmLabel: 'Удалить всё',
      danger: true,
    });
    if (ok) store.clearAll();
  };

  return (
    <div className="screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">Настройки вечера</p>
          <h1>Ещё</h1>
          <p className="screen-sub">
            {store.state.participants.length} {plural(store.state.participants.length, 'человек', 'человека', 'человек')} ·{' '}
            {store.state.history.length} {plural(store.state.history.length, 'раунд', 'раунда', 'раундов')}
          </p>
        </div>
      </div>

      <section className="card data-card">
        <div className="data-row">
          <IconShield size={22} />
          <div>
            <strong>Данные только на этом устройстве</strong>
            <p>Без облака и регистрации. Снимок можно передать ссылкой или JSON-файлом.</p>
          </div>
        </div>
      </section>

      <div className="menu-list card no-padding">
        <button type="button" className="menu-row" onClick={() => setView('install')}>
          <span className="menu-icon">
            <IconInstall size={22} />
          </span>
          <span className="menu-text">
            <strong>Установить</strong>
            <small>{installed ? 'Уже установлено' : 'Инструкция для iPhone и Android'}</small>
          </span>
          {install.canInstall ? <span className="badge badge-ok">доступно</span> : null}
          <IconChevronRight size={18} />
        </button>

        <button type="button" className="menu-row" onClick={() => setView('share')}>
          <span className="menu-icon">
            <IconShare size={22} />
          </span>
          <span className="menu-text">
            <strong>Передать данные</strong>
            <small>Ссылка, QR-код или JSON-файл</small>
          </span>
          <IconChevronRight size={18} />
        </button>

        <button
          type="button"
          className="menu-row"
          onClick={() => {
            setAllActive(true);
            setNewEveningOpen(true);
          }}
        >
          <span className="menu-icon">
            <IconRefresh size={22} />
          </span>
          <span className="menu-text">
            <strong>Новый вечер</strong>
            <small>Очистить историю и круги, сохранить людей</small>
          </span>
          <IconChevronRight size={18} />
        </button>
      </div>

      <section className="card offline-card">
        <div className="card-head">
          <h2>Офлайн и обновления</h2>
          <span className={online ? 'badge badge-ok' : 'badge badge-muted'}>
            {online ? <IconWifi size={14} /> : <IconWifiOff size={14} />}
            {online ? 'онлайн' : 'офлайн'}
          </span>
        </div>
        <p className="muted">{pwaStatusText(pwa)}</p>
        {pwa.updateReady ? (
          <button type="button" className="btn btn-primary btn-block" onClick={pwa.applyUpdate}>
            <IconSpark size={18} />
            Доступно обновление — обновить
          </button>
        ) : null}
        <p className="form-hint">
          Обновление проверяется при открытии приложения и возврате на вкладку. Данные при этом не
          пропадают.
        </p>
      </section>

      <details className="card details-card">
        <summary>
          <span>Как составляются пары</span>
          <span className="summary-hint">алгоритм</span>
        </summary>
        <div className="algorithm">
          <p>
            Сначала программа выравнивает число танцев: в большей роли пропускают те, кто танцевал
            больше. Разница внутри роли не превышает одного танца, когда состав не меняется.
          </p>
          <ol>
            <li>Равенство танцев — самый строгий приоритет.</li>
            <li>Не повторять партнёра, пока не перетанцевали со всеми в текущем круге.</li>
            <li>Не ставить одного и того же партнёра два раунда подряд, если есть альтернатива.</li>
            <li>Предпочитать пары, которые танцевали реже и давно.</li>
          </ol>
          <p>
            Пара подбирается венгерским алгоритмом по матрице стоимости: повтор в круге стоит очень
            дорого, прошлый партнёр — дорого, редкие и давние пары — дешевле. Пропуск участника с
            меньшим числом танцев штрафуется настолько сильно, что штрафы за повторы не могут его
            перевесить.
          </p>
          <p>
            Круг закрывается у участника, когда он станцевал со всеми активными партнёрами
            противоположной роли. Тогда его список обнуляется, а номер круга увеличивается.
          </p>
        </div>
      </details>

      <section className="card about-card">
        <div className="card-head">
          <h2>О приложении</h2>
          <span className="badge badge-muted">v{APP_VERSION}</span>
        </div>
        <p className="muted">
          Рондомайзер для тренировок West Coast Swing. Работает полностью в браузере, без сервера и
          аналитики. Данные хранятся в localStorage устройства.
        </p>
        <details>
          <summary className="details-link">
            <IconInfo size={16} /> Важно знать
          </summary>
          <ul className="plain-list">
            <li>Очистка данных браузера удалит и данные приложения.</li>
            <li>Снимок по ссылке — не синхронизация: изменения не передаются автоматически.</li>
            <li>Для установки и офлайна нужен HTTPS. Локально подходит localhost.</li>
            <li>Обычную сборку нельзя открыть через file:// — используйте одиночный HTML-файл.</li>
          </ul>
        </details>
      </section>

      <button type="button" className="btn btn-danger-ghost btn-block" onClick={() => void eraseEverything()}>
        <IconTrash size={18} />
        Удалить все данные
      </button>

      <p className="footnote">Сделано для дружелюбных тренировок. Хорошего вечера!</p>

      {newEveningOpen ? (
        <Modal
          title="Начать новый вечер?"
          subtitle="Список участников, роли и имена сохранятся."
          onClose={() => setNewEveningOpen(false)}
          footer={
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setNewEveningOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary" onClick={startEvening}>
                Начать вечер
              </button>
            </div>
          }
        >
          <p className="dialog-text">
            Будут очищены история раундов, счётчики танцев, пропусков и круги. Прошлый вечер нельзя
            будет вернуть — при необходимости сначала сохраните JSON-снимок.
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={allActive}
              onChange={(event) => setAllActive(event.target.checked)}
            />
            <span>
              <strong>Сделать всех активными</strong>
              <small>Отсутствующие и ушедшие снова попадут в ротацию.</small>
            </span>
          </label>
          <p className="form-hint">
            Номера кругов начнутся с 1, раунды — с 1. Часы вечера запустятся заново.
          </p>
          {!allActive ? (
            <p className="form-hint warn">
              Участники со статусами «Отсутствует» и «Ушёл» останутся неактивными.
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
