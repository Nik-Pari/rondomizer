import { useEffect, useMemo, useState } from 'react';
import type { AppStore } from '../useAppStore';
import type { Participant, Role } from '../core/types';
import { swapInRound } from '../core/rotation';
import { plural } from '../utils';
import { useUi } from '../ui';
import {
  IconCheck,
  IconEye,
  IconMore,
  IconPlus,
  IconRefresh,
  IconShuffle,
  IconTrash,
  IconUndo,
  IconUsers,
} from '../components/Icons';
import { LogoMark } from '../components/Icons';
import { Modal } from '../components/Modal';

interface RoundScreenProps {
  store: AppStore;
  onShowPresentation: () => void;
  onGoPeople: () => void;
}

export function RoundScreen({ store, onShowPresentation, onGoPeople }: RoundScreenProps) {
  const { state, stats, leaders, followers, pendingErrors } = store;
  const { confirm, notify } = useUi();
  const pending = state.pending;
  const lastRound = state.history[state.history.length - 1] ?? null;

  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const byId = useMemo(
    () => new Map(state.participants.map((participant) => [participant.id, participant])),
    [state.participants],
  );

  useEffect(() => {
    setEditing(false);
    setSelected(null);
  }, [pending?.number]);

  const warnings = useMemo(() => {
    const values = (pending?.warnings ?? []).filter((warning) => !warning.startsWith('Пропускают:'));
    return [...new Set(values)];
  }, [pending]);

  const skipPeople = useMemo(
    () => (pending?.skipIds ?? []).map((id) => byId.get(id)).filter((p): p is Participant => Boolean(p)),
    [pending, byId],
  );

  const canGenerate = leaders.length > 0 && followers.length > 0;
  const canConfirm = Boolean(pending && pending.pairs.length > 0 && pendingErrors.length === 0);

  const selectPerson = (id: string) => {
    if (!pending) return;
    if (selected === id) {
      setSelected(null);
      return;
    }
    if (!selected) {
      setSelected(id);
      return;
    }
    const first = byId.get(selected);
    const second = byId.get(id);
    if (!first || !second) {
      setSelected(id);
      return;
    }
    if (first.role !== second.role) {
      notify('Менять местами можно только участников одной роли', 'warn');
      return;
    }
    const updated = swapInRound(state, pending, selected, id);
    store.editPending(updated);
    setSelected(null);
  };

  const confirmRound = () => {
    store.confirm();
  };

  const requestUndo = async () => {
    const ok = await confirm({
      title: 'Отменить последний раунд?',
      text: 'Раунд исчезнет из истории, а круги вернутся к состоянию до его подтверждения.',
      confirmLabel: 'Отменить раунд',
      danger: true,
    });
    if (ok) store.undo();
  };

  const requestRegenerate = async () => {
    const ok = await confirm({
      title: 'Пересоздать раунд?',
      text: editing
        ? 'Ручные перестановки в текущем черновике будут потеряны.'
        : 'Текущий вариант пар будет заменён новым.',
      confirmLabel: 'Пересоздать',
    });
    if (!ok) return;
    setMenuOpen(false);
    setEditing(false);
    setSelected(null);
    store.generate();
  };

  const requestDiscard = async () => {
    const ok = await confirm({
      title: 'Отменить черновик?',
      text: 'Раунд не попадёт в историю, счётчики танцев не изменятся.',
      confirmLabel: 'Отменить черновик',
      danger: true,
    });
    if (!ok) return;
    setMenuOpen(false);
    store.discard();
  };

  const renderPerson = (id: string, role: Role) => {
    const person = byId.get(id);
    const name = person?.name ?? '—';
    if (!editing) {
      return <span className={`pair-name ${role}`}>{name}</span>;
    }
    return (
      <button
        type="button"
        className={selected === id ? 'person-button selected' : 'person-button'}
        onClick={() => selectPerson(id)}
        aria-pressed={selected === id}
      >
        {name}
      </button>
    );
  };

  if (state.participants.length === 0) {
    return (
      <section className="empty-screen">
        <LogoMark size={72} />
        <p className="eyebrow">West Coast Swing</p>
        <h1>Начнём вечер</h1>
        <p className="muted">
          Добавьте лидеров и фоловеров — приложение составит пары так, чтобы все танцевали примерно
          одинаково и не повторялись внутри круга.
        </p>
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={onGoPeople}>
          <IconPlus size={20} />
          Добавить участников
        </button>
        <div className="hint-list">
          <div><strong>1.</strong> Внесите людей и укажите роли.</div>
          <div><strong>2.</strong> Нажмите «Составить пары».</div>
          <div><strong>3.</strong> Покажите группе и подтвердите раунд.</div>
        </div>
      </section>
    );
  }

  if (pending) {
    return (
      <div className="screen round-screen">
        <div className="screen-heading">
          <div>
            <p className="eyebrow">Черновик · раунд {pending.number}</p>
            <h1>{editing ? 'Поменяйте местами' : 'Текущий танец'}</h1>
            <p className="screen-sub">
              {leaders.length} {plural(leaders.length, 'лидер', 'лидера', 'лидеров')} ·{' '}
              {followers.length} {plural(followers.length, 'фоловер', 'фоловера', 'фоловеров')}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onShowPresentation}
            aria-label="Показать раунд группе"
            title="Показать группе"
            disabled={pending.pairs.length === 0}
          >
            <IconEye size={24} />
          </button>
        </div>

        {editing ? (
          <div className="notice notice-info edit-notice">
            <IconShuffle size={18} />
            <span>
              Нажмите на двух участников <strong>одной роли</strong>, чтобы поменять их местами: пару с
              парой или пару с пропуском.
              {selected ? ' Первый выбран — выберите второго.' : ''}
            </span>
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div className="notice notice-warn">
            <span>{warnings.join(' ')}</span>
          </div>
        ) : null}

        {pendingErrors.length > 0 ? (
          <div className="notice notice-error">
            <span>{pendingErrors[0]}</span>
          </div>
        ) : null}

        {pending.pairs.length === 0 ? (
          <div className="card empty-pairs">
            <h2>Пары пока не составились</h2>
            <p className="muted">
              {pending.warnings[0] ?? 'Проверьте активный состав и роли участников.'}
            </p>
            <button type="button" className="btn btn-primary" onClick={onGoPeople}>
              <IconUsers size={18} />
              Открыть список людей
            </button>
          </div>
        ) : (
          <div className="pair-list">
            {pending.pairs.map((pair, index) => (
              <div className="pair-card" key={`${index}-${pair.leaderId}-${pair.followerId}`}>
                <span className="pair-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="pair-side">
                  <span className="pair-role">Лидер</span>
                  {renderPerson(pair.leaderId, 'leader')}
                </div>
                <span className="pair-x" aria-hidden="true">
                  ×
                </span>
                <div className="pair-side">
                  <span className="pair-role">Фоловер</span>
                  {renderPerson(pair.followerId, 'follower')}
                </div>
              </div>
            ))}
          </div>
        )}

        <section className="skip-block">
          <div className="section-heading">
            <h2>Пропускают</h2>
            <span className="counter">{skipPeople.length}</span>
          </div>
          {skipPeople.length === 0 ? (
            <p className="muted">Все танцуют — пропусков нет.</p>
          ) : (
            <div className="chip-row">
              {skipPeople.map((person) =>
                editing ? (
                  <button
                    type="button"
                    key={person.id}
                    className={
                      selected === person.id
                        ? `chip chip-${person.role} selected`
                        : `chip chip-${person.role}`
                    }
                    onClick={() => selectPerson(person.id)}
                    aria-pressed={selected === person.id}
                  >
                    {person.name}
                  </button>
                ) : (
                  <span key={person.id} className={`chip chip-${person.role}`}>
                    {person.name}
                  </span>
                ),
              )}
            </div>
          )}
        </section>

        <div className="sticky-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={confirmRound}
            disabled={!canConfirm}
          >
            <IconCheck size={22} />
            Подтвердить раунд
          </button>
          <div className="action-row">
            <button
              type="button"
              className={editing ? 'btn btn-soft active' : 'btn btn-soft'}
              onClick={() => {
                setEditing((value) => !value);
                setSelected(null);
              }}
            >
              <IconShuffle size={18} />
              {editing ? 'Готово' : 'Поменять'}
            </button>
            <button
              type="button"
              className="btn btn-soft"
              onClick={onShowPresentation}
              disabled={pending.pairs.length === 0}
            >
              <IconEye size={18} />
              Показать
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenuOpen(true)}
              aria-label="Действия с раундом"
            >
              <IconMore size={22} />
            </button>
          </div>
        </div>

        {menuOpen ? (
          <Modal title="Действия с раундом" onClose={() => setMenuOpen(false)}>
            <div className="menu-list">
              <button type="button" className="menu-row" onClick={() => void requestRegenerate()}>
                <IconRefresh size={20} />
                <span>
                  <strong>Пересоздать раунд</strong>
                  <small>Подобрать другой вариант пар</small>
                </span>
              </button>
              <button
                type="button"
                className="menu-row danger"
                onClick={() => void requestDiscard()}
              >
                <IconTrash size={20} />
                <span>
                  <strong>Отменить черновик</strong>
                  <small>Раунд не попадёт в историю</small>
                </span>
              </button>
            </div>
          </Modal>
        ) : null}
      </div>
    );
  }

  return (
    <div className="screen round-screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">Следующий танец</p>
          <h1>Раунд {state.nextRoundNumber}</h1>
          <p className="screen-sub">
            {leaders.length} {plural(leaders.length, 'лидер', 'лидера', 'лидеров')} ·{' '}
            {followers.length} {plural(followers.length, 'фоловер', 'фоловера', 'фоловеров')} · разброс{' '}
            {stats.activeCounts.leader > 0 ? stats.maxDances.leader - stats.minDances.leader : 0}/
            {stats.activeCounts.follower > 0 ? stats.maxDances.follower - stats.minDances.follower : 0}
          </p>
        </div>
        {lastRound ? (
          <button
            type="button"
            className="icon-btn"
            onClick={onShowPresentation}
            aria-label="Показать последний раунд группе"
            title="Показать группе"
          >
            <IconEye size={24} />
          </button>
        ) : null}
      </div>

      {!canGenerate ? (
        <div className="notice notice-warn">
          <span>
            {leaders.length === 0
              ? 'Нет активных лидеров — добавьте хотя бы одного.'
              : 'Нет активных фоловеров — добавьте хотя бы одного.'}
          </span>
          <button type="button" className="btn btn-small" onClick={onGoPeople}>
            <IconUsers size={16} />
            Люди
          </button>
        </div>
      ) : null}

      <section className="hero-card">
        <div className="hero-orbit" aria-hidden="true" />
        <p className="eyebrow">Готовы?</p>
        <h2>Составить пары на раунд</h2>
        <p>
          Программа учтёт число танцев, текущие круги, прошлого партнёра и давность встреч. Пропуски
          достанутся тем, кто танцевал больше.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={store.generate}
          disabled={!canGenerate}
        >
          <IconShuffle size={22} />
          {state.history.length === 0 ? 'Составить первый раунд' : 'Составить пары'}
        </button>
      </section>

      {state.history.length === 0 ? (
        <div className="hint-list card">
          <div><strong>1.</strong> Проверьте, что все активные и роли указаны верно.</div>
          <div><strong>2.</strong> Нажмите «Составить пары» и покажите экран группе.</div>
          <div><strong>3.</strong> Подтвердите раунд — счётчики обновятся.</div>
        </div>
      ) : null}

      {lastRound ? (
        <section className="card last-round">
          <div className="card-head">
            <div>
              <p className="eyebrow">Последний подтверждённый</p>
              <h2>Раунд {lastRound.number}</h2>
            </div>
            <span className="badge badge-ok">подтверждён</span>
          </div>
          <div className="last-pairs">
            {lastRound.pairs.map((pair) => (
              <div key={`${pair.leaderId}-${pair.followerId}`} className="last-pair">
                <span className="role-dot leader" />
                <span>{byId.get(pair.leaderId)?.name ?? '—'}</span>
                <span className="muted">×</span>
                <span className="role-dot follower" />
                <span>{byId.get(pair.followerId)?.name ?? '—'}</span>
              </div>
            ))}
          </div>
          {lastRound.skipIds.length > 0 ? (
            <p className="last-skips">
              Пропускали: {lastRound.skipIds.map((id) => byId.get(id)?.name ?? '—').join(', ')}
            </p>
          ) : null}
          <button type="button" className="btn btn-ghost btn-block" onClick={() => void requestUndo()}>
            <IconUndo size={18} />
            Отменить последний раунд
          </button>
        </section>
      ) : null}
    </div>
  );
}
