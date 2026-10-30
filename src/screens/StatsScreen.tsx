import { useMemo } from 'react';
import type { AppStore } from '../useAppStore';
import type { Participant, Role } from '../core/types';
import { ROLE_LABEL_PLURAL, STATUS_LABEL, pairKey } from '../core/types';
import { laggingIds } from '../core/stats';
import { formatTime, plural } from '../utils';
import { IconChart, IconClock, IconUsers } from '../components/Icons';

interface StatsScreenProps {
  store: AppStore;
}

export function StatsScreen({ store }: StatsScreenProps) {
  const { state, stats } = store;
  const lagging = useMemo(() => laggingIds(state, stats), [state, stats]);

  const active = useMemo(
    () => state.participants.filter((participant) => participant.status === 'active'),
    [state.participants],
  );
  const inactive = useMemo(
    () => state.participants.filter((participant) => participant.status !== 'active'),
    [state.participants],
  );

  const sortPeople = (people: Participant[]) =>
    [...people].sort((a, b) => {
      const da = stats.byId.get(a.id)?.dances ?? 0;
      const db = stats.byId.get(b.id)?.dances ?? 0;
      if (db !== da) return db - da;
      return a.name.localeCompare(b.name, 'ru');
    });

  const leaders = sortPeople(active.filter((participant) => participant.role === 'leader'));
  const followers = sortPeople(active.filter((participant) => participant.role === 'follower'));
  const inactiveSorted = sortPeople(inactive);

  const totalPairs = state.history.reduce((sum, round) => sum + round.pairs.length, 0);
  const leaderSpread = active.some((p) => p.role === 'leader')
    ? stats.maxDances.leader - stats.minDances.leader
    : 0;
  const followerSpread = active.some((p) => p.role === 'follower')
    ? stats.maxDances.follower - stats.minDances.follower
    : 0;

  const matrixLeaders = useMemo(
    () =>
      state.participants
        .filter(
          (participant) =>
            participant.role === 'leader' &&
            (participant.status === 'active' || (stats.byId.get(participant.id)?.dances ?? 0) > 0),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [state.participants, stats],
  );
  const matrixFollowers = useMemo(
    () =>
      state.participants
        .filter(
          (participant) =>
            participant.role === 'follower' &&
            (participant.status === 'active' || (stats.byId.get(participant.id)?.dances ?? 0) > 0),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [state.participants, stats],
  );

  /** Медиана числа танцев по каждому столбцу (фолловеру) матрицы. */
  const columnMedians = useMemo(() => {
    const medians = new Map<string, number>();
    for (const follower of matrixFollowers) {
      const values = matrixLeaders
        .map((leader) => stats.pairCounts.get(pairKey(leader.id, follower.id)) ?? 0)
        .sort((a, b) => a - b);
      if (values.length > 0) medians.set(follower.id, values[Math.floor((values.length - 1) / 2)]);
    }
    return medians;
  }, [matrixLeaders, matrixFollowers, stats]);

  const matrixCellClass = (value: number, median: number): string => {
    if (value === 0) return 'cell-red';
    if (value > median) return 'cell-green';
    if (value === median) return 'cell-blue';
    return 'cell-red';
  };

  /** Номера участников по спискам ролей — как в «первом танце» и презентации. */
  const numbers = useMemo(() => {
    const leaderNo = new Map<string, number>();
    const followerNo = new Map<string, number>();
    for (const p of state.participants) {
      if (p.role === 'leader') leaderNo.set(p.id, leaderNo.size + 1);
      else followerNo.set(p.id, followerNo.size + 1);
    }
    return { leaderNo, followerNo };
  }, [state.participants]);

  const renderActiveTable = (people: Participant[], role: Role) => {
    if (people.length === 0) return <p className="muted">Нет активных {ROLE_LABEL_PLURAL[role].toLowerCase()}.</p>;
    const spread = role === 'leader' ? leaderSpread : followerSpread;
    return (
      <section className="card stats-card">
        <div className="card-head">
          <h2>{ROLE_LABEL_PLURAL[role]}</h2>
          <span className={spread > 1 ? 'badge badge-warn' : 'badge badge-ok'}>
            разброс {spread}
          </span>
        </div>
        <div className="table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Имя</th>
                <th className="num">Танцев</th>
                <th className="num">Проп.</th>
                <th className="num">Круг</th>
                <th className="progress-col">Прогресс</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const personStats = stats.byId.get(person.id);
                const dances = personStats?.dances ?? 0;
                const skips = personStats?.skips ?? 0;
                const met = personStats?.circleMet ?? 0;
                const total = personStats?.circleTotal ?? 0;
                const percent = total > 0 ? Math.round((met / total) * 100) : 0;
                return (
                  <tr key={person.id} className={lagging.has(person.id) ? 'lagging' : undefined}>
                    <td>
                      <span className={`role-dot ${role}`} />
                      <span className="table-name">{person.name}</span>
                      {lagging.has(person.id) ? <span className="mini-flag">отстаёт</span> : null}
                    </td>
                    <td className="num">{dances}</td>
                    <td className="num">{skips}</td>
                    <td className="num">{personStats?.circleNumber ?? 1}</td>
                    <td>
                      <div className="progress-cell">
                        <div className="progress progress-small">
                          <span style={{ width: `${percent}%` }} />
                        </div>
                        <span className="progress-label">
                          {met}/{total}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="table-hint">
          «Круг» — номер текущего круга. Он увеличивается, когда участник станцевал со всеми
          активными партнёрами противоположной роли. «Прогресс» — сколько из них уже встречено в
          текущем круге.
        </p>
      </section>
    );
  };

  return (
    <div className="screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">После {stats.rounds} {plural(stats.rounds, 'раунда', 'раундов', 'раундов')}</p>
          <h1>Статистика</h1>
          <p className="screen-sub">
            <IconClock size={14} /> вечер начат в {formatTime(state.eveningStartedAt)}
          </p>
        </div>
      </div>

      <div className="metric-grid">
        <div className="metric">
          <span>Раундов</span>
          <strong>{stats.rounds}</strong>
        </div>
        <div className="metric">
          <span>Пар</span>
          <strong>{totalPairs}</strong>
        </div>
        <div className="metric">
          <span>Лидеров</span>
          <strong>{stats.activeCounts.leader}</strong>
        </div>
        <div className="metric">
          <span>Фоловеров</span>
          <strong>{stats.activeCounts.follower}</strong>
        </div>
      </div>

      {leaderSpread > 1 || followerSpread > 1 ? (
        <div className="notice notice-warn">
          <IconUsers size={18} />
          <span>
            Разброс танцев больше одного. Обычно это значит, что кто-то недавно пришёл или вернулся —
            новые участники догоняют остальных в первых раундах.
          </span>
        </div>
      ) : null}

      {renderActiveTable(leaders, 'leader')}
      {renderActiveTable(followers, 'follower')}

      {inactiveSorted.length > 0 ? (
        <details className="card stats-card">
          <summary>
            <span>Отсутствуют и ушли</span>
            <span className="counter">{inactiveSorted.length}</span>
          </summary>
          <div className="table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th className="num">Танцев</th>
                  <th className="num">Проп.</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {inactiveSorted.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <span className={`role-dot ${person.role}`} />
                      <span className="table-name">{person.name}</span>
                    </td>
                    <td className="num">{stats.byId.get(person.id)?.dances ?? 0}</td>
                    <td className="num">{stats.byId.get(person.id)?.skips ?? 0}</td>
                    <td>{STATUS_LABEL[person.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <details className="card details-card">
        <summary>
          <span>
            <IconChart size={18} /> Кто с кем танцевал
          </span>
          <span className="summary-hint">матрица</span>
        </summary>
        {matrixLeaders.length === 0 || matrixFollowers.length === 0 ? (
          <p className="muted">Пока нет пар для матрицы.</p>
        ) : (
          <div className="matrix-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="matrix-corner">Лидер \ Фоловер</th>
                  {matrixFollowers.map((follower) => (
                    <th key={follower.id} title={follower.name}>
                      {follower.name}
                    </th>
                  ))}
                  <th>Σ</th>
                </tr>
              </thead>
              <tbody>
                {matrixLeaders.map((leader) => {
                  let rowTotal = 0;
                  return (
                    <tr key={leader.id}>
                      <th className="matrix-name" title={leader.name}>
                        {leader.name}
                      </th>
                      {matrixFollowers.map((follower) => {
                        const value = stats.pairCounts.get(pairKey(leader.id, follower.id)) ?? 0;
                        rowTotal += value;
                        return (
                          <td key={follower.id} className={matrixCellClass(value, columnMedians.get(follower.id) ?? 0)}>
                            {value === 0 ? '·' : value}
                          </td>
                        );
                      })}
                      <td className="matrix-total">{rowTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th>Σ</th>
                  {matrixFollowers.map((follower) => {
                    let total = 0;
                    for (const leader of matrixLeaders) {
                      total += stats.pairCounts.get(pairKey(leader.id, follower.id)) ?? 0;
                    }
                    return (
                      <td key={follower.id} className="matrix-total">
                        {total}
                      </td>
                    );
                  })}
                  <td className="matrix-total">{totalPairs}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="table-hint">
          Число совместных танцев за вечер, подсветка по столбцу фоловера:{' '}
          <span className="legend-chip cell-green">чаще медианы</span>{' '}
          <span className="legend-chip cell-blue">медиана</span>{' '}
          <span className="legend-chip cell-red">реже медианы / не танцевали</span>
        </p>
      </details>

      <details className="card details-card">
        <summary>
          <span>История раундов</span>
          <span className="counter">{state.history.length}</span>
        </summary>
        {state.history.length === 0 ? (
          <p className="muted">История пока пуста.</p>
        ) : (
          <div className="history-list">
            {[...state.history].reverse().map((round) => (
              <article className="history-round" key={round.number}>
                <div className="history-head">
                  <strong>Раунд {round.number}</strong>
                  <span>{formatTime(round.confirmedAt)}</span>
                </div>
                <ul className="history-pairs">
                  {round.pairs.map((pair, position) => {
                    const leader = state.participants.find((p) => p.id === pair.leaderId);
                    const follower = state.participants.find((p) => p.id === pair.followerId);
                    return (
                      <li key={`${pair.leaderId}-${pair.followerId}`}>
                        <span className="history-pos">{position + 1}.</span>{' '}
                        {leader?.name ?? '—'} × {follower?.name ?? '—'}
                      </li>
                    );
                  })}
                </ul>
                {round.skipIds.length > 0 ? (
                  <p className="history-skips">
                    Пропускали:{' '}
                    {round.skipIds
                      .map((id) => {
                        const person = state.participants.find((p) => p.id === id);
                        if (!person) return '—';
                        const no =
                          person.role === 'leader'
                            ? numbers.leaderNo.get(id)
                            : numbers.followerNo.get(id);
                        return `${no ?? '?'} ${person.name}`;
                      })
                      .join(', ')}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}
