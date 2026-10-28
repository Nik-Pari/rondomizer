import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AppStore } from '../useAppStore';
import type { Participant, ParticipantStatus, Role } from '../core/types';
import { ROLE_LABEL, ROLE_LABEL_PLURAL, STATUS_LABEL } from '../core/types';
import { initials, plural } from '../utils';
import { ParticipantSheet } from '../components/ParticipantSheet';
import { Modal } from '../components/Modal';
import { IconChevronRight, IconPlus, IconSearch, IconUsers } from '../components/Icons';

interface PeopleScreenProps {
  store: AppStore;
}

function statusClass(status: ParticipantStatus): string {
  if (status === 'away') return 'away';
  if (status === 'left') return 'left';
  return 'active';
}

export function PeopleScreen({ store }: PeopleScreenProps) {
  const { state, stats } = store;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | Role>('all');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('leader');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkRole, setBulkRole] = useState<Role>('follower');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = state.participants.find((participant) => participant.id === selectedId) ?? null;
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (participant: Participant) =>
    !normalizedQuery || participant.name.toLowerCase().includes(normalizedQuery);

  const active = useMemo(
    () =>
      state.participants
        .filter(
          (participant) =>
            participant.status === 'active' &&
            matches(participant) &&
            (filter === 'all' || participant.role === filter),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [state.participants, normalizedQuery, filter],
  );

  const inactive = useMemo(
    () =>
      state.participants
        .filter(
          (participant) =>
            participant.status !== 'active' &&
            matches(participant) &&
            (filter === 'all' || participant.role === filter),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [state.participants, normalizedQuery, filter],
  );

  const leaders = active.filter((participant) => participant.role === 'leader');
  const followers = active.filter((participant) => participant.role === 'follower');

  const duplicate = state.participants.some(
    (participant) => participant.name.toLowerCase() === name.trim().toLowerCase() && name.trim().length > 0,
  );

  const submitAdd = (event: FormEvent) => {
    event.preventDefault();
    if (store.addPerson(name, role)) setName('');
  };

  const bulkNames = bulkText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const bulkCount = bulkNames.length;

  const submitBulk = (event: FormEvent) => {
    event.preventDefault();
    const count = store.addPeople(bulkNames, bulkRole);
    if (count > 0) {
      setBulkText('');
      setBulkOpen(false);
    }
  };

  const renderRow = (participant: Participant) => {
    const personStats = stats.byId.get(participant.id);
    const dances = personStats?.dances ?? 0;
    const skips = personStats?.skips ?? 0;
    const circleNumber = personStats?.circleNumber ?? 1;
    const met = personStats?.circleMet ?? 0;
    const total = personStats?.circleTotal ?? 0;
    const percent = total > 0 ? Math.round((met / total) * 100) : 0;
    const lagging =
      participant.status === 'active' && stats.maxDances[participant.role] - dances >= 2;
    return (
      <button
        type="button"
        className="person-row"
        key={participant.id}
        onClick={() => setSelectedId(participant.id)}
      >
        <span className={`avatar avatar-${participant.role}`}>{initials(participant.name)}</span>
        <span className="person-main">
          <span className="person-name-line">
            <span className="person-name">{participant.name}</span>
            {lagging ? <span className="badge badge-warn">догоняет</span> : null}
            {participant.status !== 'active' ? (
              <span className={`badge badge-${statusClass(participant.status)}`}>
                {STATUS_LABEL[participant.status]}
              </span>
            ) : null}
          </span>
          <span className="person-sub">
            {dances} {plural(dances, 'танец', 'танца', 'танцев')} · {skips}{' '}
            {plural(skips, 'пропуск', 'пропуска', 'пропусков')} · круг {circleNumber} · {met}/{total}
          </span>
          <span className="progress progress-small">
            <span style={{ width: `${percent}%` }} />
          </span>
        </span>
        <span className={`role-mark role-mark-${participant.role}`} title={ROLE_LABEL[participant.role]}>
          {participant.role === 'leader' ? 'Л' : 'Ф'}
        </span>
        <IconChevronRight size={18} />
      </button>
    );
  };

  return (
    <div className="screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">Состав вечера</p>
          <h1>Люди</h1>
          <p className="screen-sub">
            {state.participants.filter((p) => p.status === 'active').length}{' '}
            {plural(
              state.participants.filter((p) => p.status === 'active').length,
              'активный',
              'активных',
              'активных',
            )}{' '}
            · {state.participants.length} всего
          </p>
        </div>
      </div>

      <form className="card add-card" onSubmit={submitAdd}>
        <div className="card-head">
          <h2>Добавить участника</h2>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => setBulkOpen(true)}
          >
            <IconUsers size={16} />
            Списком
          </button>
        </div>
        <div className="segmented">
          {(['leader', 'follower'] as Role[]).map((value) => (
            <button
              type="button"
              key={value}
              className={role === value ? 'segment active' : 'segment'}
              onClick={() => setRole(value)}
            >
              {ROLE_LABEL_PLURAL[value]}
            </button>
          ))}
        </div>
        <div className="add-row">
          <input
            className="input"
            value={name}
            maxLength={80}
            placeholder="Имя участника"
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            <IconPlus size={18} />
            Добавить
          </button>
        </div>
        {duplicate ? (
          <p className="form-hint warn">Человек с таким именем уже есть — это не запрещено, но проверьте.</p>
        ) : null}
      </form>

      {state.participants.length > 6 ? (
        <div className="search-row">
          <span className="search-icon" aria-hidden="true">
            <IconSearch size={18} />
          </span>
          <input
            className="input search-input"
            value={query}
            placeholder="Найти человека"
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Поиск по имени"
          />
        </div>
      ) : null}

      <div className="segmented segmented-3 filter-row">
        <button
          type="button"
          className={filter === 'all' ? 'segment active' : 'segment'}
          onClick={() => setFilter('all')}
        >
          Все
        </button>
        <button
          type="button"
          className={filter === 'leader' ? 'segment active' : 'segment'}
          onClick={() => setFilter('leader')}
        >
          Лидеры
        </button>
        <button
          type="button"
          className={filter === 'follower' ? 'segment active' : 'segment'}
          onClick={() => setFilter('follower')}
        >
          Фоловеры
        </button>
      </div>

      {active.length === 0 ? (
        <div className="card empty-list">
          <p className="muted">
            {state.participants.length === 0
              ? 'Пока никого нет. Добавьте первого участника выше.'
              : 'По этому фильтру никого нет.'}
          </p>
        </div>
      ) : null}

      {leaders.length > 0 && filter !== 'follower' ? (
        <section className="people-group">
          <div className="section-heading">
            <h2>Лидеры</h2>
            <span className="counter">{leaders.length}</span>
          </div>
          <div className="people-list">{leaders.map(renderRow)}</div>
        </section>
      ) : null}

      {followers.length > 0 && filter !== 'leader' ? (
        <section className="people-group">
          <div className="section-heading">
            <h2>Фоловеры</h2>
            <span className="counter">{followers.length}</span>
          </div>
          <div className="people-list">{followers.map(renderRow)}</div>
        </section>
      ) : null}

      {inactive.length > 0 ? (
        <details className="card inactive-card">
          <summary>
            <span>Отсутствуют и ушли</span>
            <span className="counter">{inactive.length}</span>
          </summary>
          <div className="people-list">{inactive.map(renderRow)}</div>
        </details>
      ) : null}

      <p className="footnote">
        Нажмите на человека, чтобы переименовать, сменить роль, отметить отсутствие или удалить.
      </p>

      {bulkOpen ? (
        <Modal
          title="Добавить списком"
          subtitle="Одно имя в строке. Роль выбирается для всех сразу."
          onClose={() => setBulkOpen(false)}
        >
          <form onSubmit={submitBulk}>
            <div className="segmented">
              {(['leader', 'follower'] as Role[]).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={bulkRole === value ? 'segment active' : 'segment'}
                  onClick={() => setBulkRole(value)}
                >
                  {ROLE_LABEL_PLURAL[value]}
                </button>
              ))}
            </div>
            <textarea
              className="input textarea"
              rows={8}
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder={'Анна\nБорис\nВиктория\nГлеб'}
            />
            <p className="form-hint">
              Будет добавлено: <strong>{bulkCount}</strong>{' '}
              {plural(bulkCount, 'человек', 'человека', 'человек')}.
            </p>
            <button type="submit" className="btn btn-primary btn-block" disabled={bulkCount === 0}>
              <IconPlus size={18} />
              Добавить {bulkCount > 0 ? bulkCount : ''}
            </button>
          </form>
        </Modal>
      ) : null}

      {selected ? (
        <ParticipantSheet
          participant={selected}
          stats={stats.byId.get(selected.id)}
          onClose={() => setSelectedId(null)}
          onRename={(id, value) => store.renamePerson(id, value)}
          onStatus={(id, status) => store.setStatus(id, status)}
          onRole={(id, value) => store.setRole(id, value)}
          onDelete={(id) => store.removePerson(id)}
        />
      ) : null}
    </div>
  );
}
