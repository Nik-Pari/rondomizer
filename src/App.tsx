import { useEffect, useRef, useState } from 'react';
import { UiProvider, useUi } from './ui';
import { useAppStore } from './useAppStore';
import { useInstallPrompt, useOnline, usePwa } from './hooks';
import { decodeState, SNAPSHOT_HASH_PREFIX } from './core/codec';
import { plural } from './utils';
import { RoundScreen } from './screens/RoundScreen';
import { PeopleScreen } from './screens/PeopleScreen';
import { StatsScreen } from './screens/StatsScreen';
import { MoreScreen } from './screens/MoreScreen';
import { LogoMark, IconChart, IconDance, IconMore, IconUsers, IconWifiOff } from './components/Icons';

type Tab = 'round' | 'people' | 'stats' | 'more';

const TABS: Array<{ id: Tab; label: string; icon: typeof IconDance }> = [
  { id: 'round', label: 'Танец', icon: IconDance },
  { id: 'people', label: 'Люди', icon: IconUsers },
  { id: 'stats', label: 'Статистика', icon: IconChart },
  { id: 'more', label: 'Ещё', icon: IconMore },
];

function AppInner() {
  const ui = useUi();
  const store = useAppStore(ui.notify);
  const online = useOnline();
  const install = useInstallPrompt();
  const pwa = usePwa();

  const [tab, setTab] = useState<Tab>('round');
  const hashHandled = useRef(false);
  const updateNotified = useRef(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [tab]);

  useEffect(() => {
    if (!pwa.updateReady || updateNotified.current) return;
    updateNotified.current = true;
    ui.notify('Доступно обновление приложения', 'info', {
      label: 'Обновить',
      onClick: pwa.applyUpdate,
    });
  }, [pwa.updateReady, pwa.applyUpdate, ui]);

  // Снимок в ссылке: спрашиваем подтверждение и очищаем hash.
  useEffect(() => {
    if (hashHandled.current) return;
    const hash = window.location.hash;
    if (!hash.startsWith(SNAPSHOT_HASH_PREFIX)) return;
    hashHandled.current = true;

    const encoded = hash.slice(SNAPSHOT_HASH_PREFIX.length);
    const next = decodeState(encoded);
    const clearHash = () => {
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch {
        window.location.hash = '';
      }
    };

    if (!next) {
      ui.notify('Ссылка со снимком повреждена или устарела', 'error');
      clearHash();
      return;
    }

    const timer = window.setTimeout(() => {
      void ui
        .confirm({
          title: 'Загрузить данные из ссылки?',
          text: `В снимке: ${next.participants.length} ${plural(next.participants.length, 'участник', 'участника', 'участников')}, ${next.history.length} ${plural(next.history.length, 'раунд', 'раунда', 'раундов')}. Текущие данные на этом устройстве будут заменены.`,
          confirmLabel: 'Загрузить',
        })
        .then((ok) => {
          clearHash();
          if (ok) {
            store.replaceState(next, 'Данные из ссылки загружены');
            setTab('round');
          }
        });
    }, 350);

    return () => window.clearTimeout(timer);
    // store.replaceState и ui.confirm стабильны; эффект должен выполниться один раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeDraft = store.state.pending;

  return (
    <>
      <div className="app">
        <header className="topbar">
          <button type="button" className="brand" onClick={() => setTab('round')}>
            <LogoMark size={38} />
            <span className="brand-text">
              <span className="brand-title">Рондомайзер</span>
              <span className="brand-sub">West Coast Swing · офлайн</span>
            </span>
          </button>
          <div className="topbar-right">
            <span className={activeDraft ? 'round-chip draft' : 'round-chip'}>
              #{activeDraft ? activeDraft.number : store.state.nextRoundNumber}
              {activeDraft ? ' · черновик' : ''}
            </span>
          </div>
        </header>

        {!online ? (
          <div className="offline-banner">
            <IconWifiOff size={16} />
            Нет сети — приложение работает офлайн, данные сохраняются на устройстве.
          </div>
        ) : null}

        <main className="content">
          {tab === 'round' ? (
            <RoundScreen store={store} onGoPeople={() => setTab('people')} />
          ) : null}
          {tab === 'people' ? <PeopleScreen store={store} /> : null}
          {tab === 'stats' ? <StatsScreen store={store} /> : null}
          {tab === 'more' ? (
            <MoreScreen store={store} pwa={pwa} install={install} online={online} />
          ) : null}
        </main>
      </div>

      <nav className="tabbar" aria-label="Основная навигация">
        <div className="tabbar-inner">
          {TABS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                className={tab === item.id ? 'tab active' : 'tab'}
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
              >
                <Icon size={23} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}

export default function App() {
  return (
    <UiProvider>
      <AppInner />
    </UiProvider>
  );
}
