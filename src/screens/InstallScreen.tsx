import type { InstallPromptState, PwaStatus } from '../hooks';
import { copyText } from '../utils';
import { useUi } from '../ui';
import { QrCode } from '../components/QrCode';
import { LogoMark, IconArrowLeft, IconCheck, IconCopy, IconInstall } from '../components/Icons';

interface InstallScreenProps {
  onBack: () => void;
  install: InstallPromptState;
  secure: boolean;
  appUrl: string;
  pwaStatus: PwaStatus;
}

export function InstallScreen({ onBack, install, secure, appUrl, pwaStatus }: InstallScreenProps) {
  const { notify } = useUi();
  const installed = install.isStandalone || install.installed;

  const handleInstall = async () => {
    if (!install.canInstall) {
      notify('Кнопка установки недоступна. Используйте инструкцию для вашего браузера.', 'info');
      return;
    }
    const accepted = await install.promptInstall();
    if (accepted) notify('Приложение добавлено на главный экран', 'success');
    else notify('Установка отменена', 'info');
  };

  const handleCopy = async () => {
    const ok = await copyText(appUrl);
    notify(ok ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку', ok ? 'success' : 'error');
  };

  return (
    <div className="screen subview">
      <div className="subview-head">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Назад">
          <IconArrowLeft size={22} />
        </button>
        <div>
          <p className="eyebrow">На телефон</p>
          <h1>Установка</h1>
        </div>
      </div>

      <section className={installed ? 'card install-hero installed' : 'card install-hero'}>
        <LogoMark size={68} />
        <h2>{installed ? 'Приложение установлено' : 'Рондомайзер как приложение'}</h2>
        <p>
          {installed
            ? 'Открывайте с иконки на главном экране — интерфейс будет без адресной строки, а данные останутся на телефоне.'
            : 'Добавьте приложение на главный экран. После первого открытия оно работает без интернета: пары, история и статистика остаются доступны.'}
        </p>
        {installed ? (
          <div className="installed-mark">
            <IconCheck size={20} />
            Уже на главном экране
          </div>
        ) : install.canInstall ? (
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => void handleInstall()}>
            <IconInstall size={22} />
            Установить приложение
          </button>
        ) : (
          <p className="form-hint">
            Браузер не показал кнопку установки. Это нормально для iPhone/Safari и некоторых
            браузеров — используйте инструкцию ниже.
          </p>
        )}
      </section>

      {!secure ? (
        <div className="notice notice-error">
          <span>
            Сайт открыт без HTTPS. Установка и офлайн-режим требуют HTTPS (или localhost). На обычном
            HTTP приложение всё равно работает, но service worker не включится.
          </span>
        </div>
      ) : null}

      {pwaStatus === 'single' ? (
        <div className="notice notice-warn">
          <span>
            Это одиночный HTML-файл. Он работает с флешки и без интернета, но установка как PWA и
            офлайн-кэш недоступны — для них нужна обычная сборка на HTTPS.
          </span>
        </div>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h2>QR-код на это приложение</h2>
        </div>
        <div className="qr-center">
          <QrCode text={appUrl} size={240} />
        </div>
        <p className="qr-caption">Наведите камеру телефона — откроется эта же страница.</p>
        <div className="url-row">
          <code className="url-text">{appUrl}</code>
          <button type="button" className="icon-btn" onClick={() => void handleCopy()} aria-label="Скопировать ссылку">
            <IconCopy size={20} />
          </button>
        </div>
        <p className="form-hint">
          QR ведёт на текущий адрес. Если вы откроете приложение с другого адреса, QR нужно
          сгенерировать заново.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>iPhone / iPad</h2>
        </div>
        <ol className="steps">
          <li>Откройте сайт в Safari. Внутри Telegram, Instagram или другого приложения установка не сработает.</li>
          <li>Нажмите кнопку «Поделиться» — квадрат со стрелкой вверх.</li>
          <li>Прокрутите и выберите «На экран „Домой“».</li>
          <li>Нажмите «Добавить». Иконка появится на главном экране.</li>
        </ol>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Android</h2>
        </div>
        <ol className="steps">
          <li>Откройте сайт в Chrome.</li>
          <li>Нажмите меню ⋮ в правом верхнем углу.</li>
          <li>Выберите «Установить приложение» или «Добавить на главный экран».</li>
          <li>Подтвердите установку.</li>
        </ol>
        <p className="form-hint">
          Первый запуск должен произойти при интернете: приложение скачает и сохранит все файлы. Дальше
          интернет не нужен.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Если что-то не работает</h2>
        </div>
        <ul className="plain-list">
          <li>Откройте сайт по HTTPS: без него service worker и установка часто недоступны.</li>
          <li>На iPhone используйте именно Safari, а не встроенный браузер мессенджера.</li>
          <li>Если приложение уже открыто, обновите страницу и попробуйте снова.</li>
          <li>Данные хранятся в браузере этого телефона и не синхронизируются сами.</li>
        </ul>
      </section>

      <button type="button" className="btn btn-ghost btn-block" onClick={onBack}>
        <IconArrowLeft size={18} />
        Назад в меню
      </button>
    </div>
  );
}
