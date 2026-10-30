import { describe, expect, it } from 'vitest';
import {
  carryOverPairs,
  clearCarry,
  confirmRound,
  deriveCircles,
  emptyAppState,
  generateRound,
  markPairs,
  movePairToSkip,
  reconcileCircles,
  setPending,
  startNewEvening,
  swapInRound,
  undoLastRound,
  validateRound,
} from './rotation';
import { computeStats } from './stats';
import type { AppState, Round } from './types';
import {
  activeIds,
  addPerson,
  byName,
  circlePartnerSet,
  makeState,
  simulate,
  summarize,
} from './testUtils';
import { setParticipantStatus } from './state';
import {
  buildSnapshotUrl,
  decodeState,
  encodeState,
  exportStateJson,
  importStateJson,
} from './codec';

describe('ротация пар', () => {
  it('a) 5 лидеров и 5 фоловеров, 30 раундов: равенство и отсутствие повторов в круге', () => {
    const result = simulate(makeState(
      ['Аня', 'Боря', 'Вера', 'Гоша', 'Даша'],
      ['Ева', 'Женя', 'Зина', 'Игорь', 'Костя'],
    ), 30);
    summarize('a: 5 × 5, 30 раундов', result);

    for (const m of result.metrics) {
      expect(m.spread.leader).toBeLessThanOrEqual(1);
      expect(m.spread.follower).toBeLessThanOrEqual(1);
      expect(m.bothRepeats).toBe(0);
      expect(m.oneRepeats).toBe(0);
      expect(m.consecutiveSkips).toBe(0);
    }
    expect(result.metrics.every((m) => m.skips.length === 0)).toBe(true);
    expect(result.completedCircles).toBeGreaterThan(0);

    const stats = computeStats(result.state);
    expect(stats.rounds).toBe(30);
    for (const p of result.state.participants) {
      expect(stats.byId.get(p.id)?.dances).toBe(30);
    }
  });

  it('b) 8 лидеров и 12 фоловеров, 50 раундов: равенство, нет пропусков подряд, нет двойных повторов', () => {
    const leaders = Array.from({ length: 8 }, (_, i) => `Лидер ${i + 1}`);
    const followers = Array.from({ length: 12 }, (_, i) => `Фоловер ${i + 1}`);
    const result = simulate(makeState(leaders, followers), 50);
    summarize('b: 8 × 12, 50 раундов', result);

    for (const m of result.metrics) {
      expect(m.spread.leader).toBeLessThanOrEqual(1);
      expect(m.spread.follower).toBeLessThanOrEqual(1);
      expect(m.bothRepeats).toBe(0);
      expect(m.consecutiveSkips).toBe(0);
      expect(m.skips.length).toBe(4);
    }
    expect(result.completedCircles).toBeGreaterThan(0);
    expect(result.metrics.reduce((sum, m) => sum + m.oneRepeats, 0)).toBeGreaterThanOrEqual(0);
  });

  it('c) 20×20 и 20×25: генерация раунда быстрее 100 мс', () => {
    const big20 = simulate(makeState(
      Array.from({ length: 20 }, (_, i) => `Л${i}`),
      Array.from({ length: 20 }, (_, i) => `Ф${i}`),
    ), 6).state;
    const big25 = simulate(makeState(
      Array.from({ length: 20 }, (_, i) => `Л${i}`),
      Array.from({ length: 25 }, (_, i) => `Ф${i}`),
    ), 6).state;

    for (const [label, state] of [['20×20', big20], ['20×25', big25]] as const) {
      const timings: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        const start = performance.now();
        generateRound(state, 1_800_000_000_000 + i);
        timings.push(performance.now() - start);
      }
      const max = Math.max(...timings);
      const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
      console.log(`\n[c] ${label}: макс ${max.toFixed(1)} мс, среднее ${avg.toFixed(1)} мс`);
      expect(max).toBeLessThan(100);
    }
  });

  it('d) 60 лидеров и 80 фоловеров: работает без ошибок', () => {
    const state = makeState(
      Array.from({ length: 60 }, (_, i) => `L${i}`),
      Array.from({ length: 80 }, (_, i) => `F${i}`),
    );
    const started = performance.now();
    const result = simulate(state, 20);
    const total = performance.now() - started;
    summarize('d: 60 × 80, 20 раундов', result);
    console.log(`\n[d] всего ${total.toFixed(1)} мс на 20 раундов`);
    for (const m of result.metrics) {
      expect(m.spread.leader).toBeLessThanOrEqual(1);
      expect(m.spread.follower).toBeLessThanOrEqual(1);
      expect(m.bothRepeats).toBe(0);
    }
    expect(result.state.history).toHaveLength(20);
    expect(result.state.history[0].pairs).toHaveLength(60);
    expect(result.state.history[0].skipIds).toHaveLength(20);
  });

  it('e) два участника уходят в середине вечера, затем один возвращается', () => {
    const state = simulate(makeState(
      Array.from({ length: 10 }, (_, i) => `Лидер ${i}`),
      Array.from({ length: 10 }, (_, i) => `Фоловер ${i}`),
    ), 10).state;

    const leavingLeader = state.participants.find((p) => p.role === 'leader' && p.status === 'active')!;
    const leavingFollower = state.participants.find((p) => p.role === 'follower' && p.status === 'active')!;
    let next = setParticipantStatus(state, leavingLeader.id, 'away').state;
    next = setParticipantStatus(next, leavingFollower.id, 'away').state;

    const afterLeave = simulate(next, 10, 1_800_000_000_000);
    summarize('e: после ухода двоих', afterLeave);

    const inactive = new Set([leavingLeader.id, leavingFollower.id]);
    for (const round of afterLeave.state.history.slice(10)) {
      for (const pair of round.pairs) {
        expect(inactive.has(pair.leaderId)).toBe(false);
        expect(inactive.has(pair.followerId)).toBe(false);
      }
      expect(round.skipIds.some((id) => inactive.has(id))).toBe(false);
    }

    const returned = setParticipantStatus(afterLeave.state, leavingLeader.id, 'active').state;
    const nextRound = generateRound(returned, 1_810_000_000_000);
    expect(nextRound.skipIds).not.toContain(leavingLeader.id);
    const afterReturn = simulate(returned, 6, 1_810_000_000_000);
    summarize('e: после возвращения лидера', afterReturn);
    const stats = computeStats(afterReturn.state);
    const returner = stats.byId.get(leavingLeader.id)!;
    expect(returner.dances).toBeGreaterThan(10);
    expect(returner.skips).toBeLessThanOrEqual(1);
  });

  it('f) опоздавший приходит после 5-го раунда и догоняет остальных', () => {
    let state = simulate(makeState(
      Array.from({ length: 10 }, (_, i) => `Лидер ${i}`),
      Array.from({ length: 12 }, (_, i) => `Фоловер ${i}`),
    ), 5).state;

    const added = addPerson(state, 'Опоздавший', 'follower');
    state = added.state;
    const lateId = added.id;

    let violations = 0;
    for (let i = 0; i < 30; i += 1) {
      const before = computeStats(state);
      const late = before.byId.get(lateId)!;
      const maxBefore = before.maxDances.follower;
      const round = generateRound(state, 1_900_000_000_000 + i);
      if (round.skipIds.includes(lateId) && late.dances < maxBefore - 1) violations += 1;
      state = confirmRound(state, round, 1_900_000_000_000 + i).state;
    }

    const stats = computeStats(state);
    const lateStats = stats.byId.get(lateId)!;
    const followerDances = state.participants
      .filter((p) => p.role === 'follower' && p.status === 'active')
      .map((p) => stats.byId.get(p.id)?.dances ?? 0);
    console.log(
      `\n[f] опоздавший: танцев ${lateStats.dances}, пропусков ${lateStats.skips}, ` +
        `разброс фоловеров ${Math.max(...followerDances) - Math.min(...followerDances)}`,
    );
    expect(violations).toBe(0);
    expect(stats.maxDances.follower - lateStats.dances).toBeLessThanOrEqual(1);
    expect(Math.max(...followerDances) - Math.min(...followerDances)).toBeLessThanOrEqual(1);
  });

  it('g) переход от L = F к L > F', () => {
    let state = simulate(makeState(
      Array.from({ length: 8 }, (_, i) => `Л${i}`),
      Array.from({ length: 8 }, (_, i) => `Ф${i}`),
    ), 5).state;
    const beforeFollowers = state.participants.filter((p) => p.role === 'follower').map((p) => p.id);
    state = addPerson(state, 'Новый лидер 1', 'leader').state;
    state = addPerson(state, 'Новый лидер 2', 'leader').state;

    const result = simulate(state, 20, 2_000_000_000_000);
    summarize('g: 8×8 → 10×8', result);
    for (const m of result.metrics) {
      expect(m.spread.follower).toBeLessThanOrEqual(1);
    }
    const finalStats = computeStats(result.state);
    expect(finalStats.maxDances.leader - finalStats.minDances.leader).toBeLessThanOrEqual(1);
    expect(finalStats.maxDances.follower - finalStats.minDances.follower).toBeLessThanOrEqual(1);
    for (const round of result.state.history.slice(5)) {
      expect(round.skipIds).toHaveLength(2);
      for (const id of round.skipIds) {
        expect(beforeFollowers.includes(id)).toBe(false);
        expect(result.state.participants.find((p) => p.id === id)?.role).toBe('leader');
      }
      expect(round.pairs).toHaveLength(8);
    }
  });

  it('h) кодирование и декодирование состояния для ссылки', () => {
    let state = simulate(makeState(
      ['Аня', 'Борис', 'Вика', 'Глеб', 'Дина', 'Егор'],
      ['Жанна', 'Зоя', 'Иван', 'Кира', 'Лев', 'Мария'],
    ), 12).state;
    const pending = generateRound(state, 2_100_000_000_000);
    state = setPending(state, pending);

    const encoded = encodeState(state);
    expect(encoded).not.toContain('#');
    const decoded = decodeState(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.participants).toEqual(state.participants);
    expect(decoded!.history).toEqual(state.history);
    expect(decoded!.pending).toEqual(state.pending);
    expect(decoded!.circles).toEqual(state.circles);
    expect(decoded!.nextRoundNumber).toBe(state.nextRoundNumber);

    const url = buildSnapshotUrl('https://example.com/sub/folder/', state);
    expect(url.startsWith('https://example.com/sub/folder/#data=')).toBe(true);
    expect(url).not.toContain('#data=#');

    const json = exportStateJson(state);
    const imported = importStateJson(json);
    expect(imported).not.toBeNull();
    expect(imported!.participants).toEqual(state.participants);
    expect(imported!.history).toEqual(state.history);
    expect(decoded!.undo).toBeNull();

    console.log(`\n[h] длина закодированного состояния: ${encoded.length} символов, ссылка ${url.length}`);

    expect(decodeState('не-существует')).toBeNull();
    expect(importStateJson('{"bad":true}')).toBeNull();
  });
});

describe('краевые случаи', () => {
  it('нет лидеров / нет фоловеров — не падает и предупреждает', () => {
    const onlyFollowers = makeState([], ['Ф1', 'Ф2']);
    const round = generateRound(onlyFollowers, 1000);
    expect(round.pairs).toHaveLength(0);
    expect(round.skipIds).toHaveLength(2);
    expect(round.warnings.join(' ')).toMatch(/Нет активных лидеров/);

    const onlyLeaders = makeState(['Л1'], []);
    const round2 = generateRound(onlyLeaders, 1000);
    expect(round2.pairs).toHaveLength(0);
    expect(round2.warnings.join(' ')).toMatch(/Нет активных фоловеров/);

    const nobody = emptyAppState(1000);
    expect(generateRound(nobody, 1000).warnings.join(' ')).toMatch(/Нет активных участников/);
  });

  it('один лидер и один фоловер: пара повторяется, но всё корректно', () => {
    const state = makeState(['Л'], ['Ф']);
    const first = generateRound(state, 1);
    expect(first.pairs).toHaveLength(1);
    expect(first.skipIds).toHaveLength(0);
    const confirmed = confirmRound(state, first, 2).state;
    const second = generateRound(confirmed, 3);
    expect(second.pairs).toHaveLength(1);
    expect(second.warnings.join(' ')).toMatch(/повторяться каждый раунд/);
    expect(second.warnings.join(' ')).toMatch(/прошлом раунде/);
  });

  it('undo возвращает историю и состояние кругов', () => {
    let state = simulate(makeState(['Л1', 'Л2'], ['Ф1', 'Ф2']), 3).state;
    const beforeCircles = JSON.parse(JSON.stringify(state.circles));
    const beforeHistory = state.history.length;
    const round = generateRound(state, 5000);
    state = confirmRound(state, round, 5000).state;
    expect(state.history).toHaveLength(beforeHistory + 1);

    const undone = undoLastRound(state, 6000);
    expect(undone.history).toHaveLength(beforeHistory);
    expect(undone.circles).toEqual(beforeCircles);
    expect(undone.nextRoundNumber).toBe(round.number);
    expect(undone.undo).toBeNull();
  });

  it('ручная правка: обмен участников одной роли сохраняет корректность', () => {
    const state = makeState(['Л1', 'Л2', 'Л3'], ['Ф1', 'Ф2', 'Ф3']);
    const round = generateRound(state, 1000);
    const twoFollowers = round.pairs.slice(0, 2).map((p) => p.followerId);
    const swapped = swapInRound(state, round, twoFollowers[0], twoFollowers[1]);
    expect(validateRound(state, swapped)).toEqual([]);
    expect(swapped.pairs).toHaveLength(3);
    const ids = swapped.pairs.flatMap((p) => [p.leaderId, p.followerId]);
    expect(new Set(ids).size).toBe(6);
    const sameRoleSwap = swapInRound(state, swapped, twoFollowers[1], twoFollowers[0]);
    expect(sameRoleSwap.pairs).toEqual(round.pairs);
    expect(validateRound(state, round)).toEqual([]);
  });

  it('уход партнёра завершает круг оставшихся', () => {
    let state = makeState(['Л'], ['Ф1', 'Ф2']);
    const round = generateRound(state, 1000);
    state = confirmRound(state, round, 1000).state;
    const skipped = state.participants.find(
      (p) => p.role === 'follower' && round.skipIds.includes(p.id),
    )!;
    const leaving = setParticipantStatus(state, skipped.id, 'away');
    expect(leaving.completed.length).toBeGreaterThan(0);
    const leader = leaving.state.participants.find((p) => p.role === 'leader')!;
    expect(leaving.state.circles[leader.id].partners).toEqual([]);
    expect(leaving.state.circles[leader.id].number).toBe(2);
  });

  it('новый вечер очищает историю и круги, сохраняя людей', () => {
    const state = simulate(makeState(['Л1', 'Л2'], ['Ф1', 'Ф2']), 4).state;
    const people = state.participants.length;
    const fresh = startNewEvening(state, true, 9999);
    expect(fresh.participants).toHaveLength(people);
    expect(fresh.history).toHaveLength(0);
    expect(fresh.pending).toBeNull();
    expect(fresh.nextRoundNumber).toBe(1);
    expect(fresh.participants.every((p) => p.status === 'active')).toBe(true);
    expect(Object.values(fresh.circles).every((c) => c.partners.length === 0 && c.number === 1)).toBe(true);
  });

  it('reconcileCircles создаёт записи для новых участников', () => {
    let state = makeState(['Л1'], ['Ф1']);
    const added = addPerson(state, 'Ф2', 'follower');
    state = { ...added.state, circles: {} };
    const result = reconcileCircles(state, 100);
    expect(Object.keys(result.state.circles).sort()).toEqual(activeIds(state).sort());
    expect(circlePartnerSet(result.state, byName(result.state, 'Ф1').id).size).toBe(0);
  });
});

describe('первый танец вечера', () => {
  it('i) первый раунд: пары строго по порядку списков', () => {
    const state = makeState(['Иван', 'Семён', 'Георг'], ['Алёна', 'Марина', 'Женя']);
    const round = generateRound(state);
    expect(validateRound(state, round)).toEqual([]);
    const name = (id: string) => state.participants.find((p) => p.id === id)!.name;
    expect(round.pairs.map((p) => `${name(p.leaderId)} — ${name(p.followerId)}`)).toEqual([
      'Иван — Алёна',
      'Семён — Марина',
      'Георг — Женя',
    ]);
    expect(round.skipIds).toEqual([]);
  });

  it('j) первый раунд при перекосе ролей: лишние в конце списка пропускают', () => {
    const state = makeState(['Иван', 'Семён', 'Георг', 'Пётр'], ['Алёна', 'Марина']);
    const round = generateRound(state);
    const name = (id: string) => state.participants.find((p) => p.id === id)!.name;
    expect(round.pairs.map((p) => `${name(p.leaderId)} — ${name(p.followerId)}`)).toEqual([
      'Иван — Алёна',
      'Семён — Марина',
    ]);
    expect(round.skipIds.map(name).sort()).toEqual(['Георг', 'Пётр'].sort());
    expect(validateRound(state, round)).toEqual([]);
  });

  it('k) после первого раунда включается обычная ротация без повторов', () => {
    const result = simulate(
      makeState(['Иван', 'Семён', 'Георг'], ['Алёна', 'Марина', 'Женя']),
      4,
    );
    expect(result.metrics[0].skips.length).toBe(0);
    for (const m of result.metrics.slice(1)) {
      expect(m.bothRepeats).toBe(0);
      expect(m.prevRepeats).toBe(0);
    }
  });

  it('l) «Новый вечер» снова даёт детерминированный первый раунд', () => {
    const result = simulate(
      makeState(['Иван', 'Семён', 'Георг'], ['Алёна', 'Марина', 'Женя']),
      3,
    );
    const fresh = startNewEvening(result.state, true, 2_000_000_000_000);
    const round = generateRound(fresh);
    const name = (id: string) => fresh.participants.find((p) => p.id === id)!.name;
    expect(round.pairs.map((p) => `${name(p.leaderId)} — ${name(p.followerId)}`)).toEqual([
      'Иван — Алёна',
      'Семён — Марина',
      'Георг — Женя',
    ]);
  });
});

describe('отметки пар в черновике', () => {
  it('markPairs: отмечает выбранные пары, раунд остаётся черновиком', () => {
    const state = makeState(['Л1', 'Л2', 'Л3'], ['Ф1', 'Ф2', 'Ф3']);
    const round = generateRound(state, 1000);
    const next = markPairs(state, round, [0, 2], 1100);
    expect(next.pending).not.toBeNull();
    expect(next.history).toHaveLength(0);
    expect(next.pending!.pairs[0].confirmedAt).toBe(1100);
    expect(next.pending!.pairs[2].confirmedAt).toBe(1100);
    expect(next.pending!.pairs[1].confirmedAt == null).toBe(true);
    expect(next.pending!.confirmedAt).toBeNull();
  });

  it('отмеченные пары не меняют круги, пока раунд не подтверждён', () => {
    const state = makeState(['Л1', 'Л2'], ['Ф1', 'Ф2']);
    const round = generateRound(state, 1000);
    const draft = setPending(state, round, 1000);
    const marked = markPairs(state, round, [0], 1100);
    expect(deriveCircles(marked)).toEqual(deriveCircles(draft));
    expect(marked.history).toHaveLength(0);
  });

  it('все пары отмечены и подтверждены — раунд уходит в историю', () => {
    const state = makeState(['Л1', 'Л2'], ['Ф1', 'Ф2']);
    const round = generateRound(state, 1000);
    const first = markPairs(state, round, [0], 1100);
    const second = confirmRound(first, first.pending!, 1200).state;
    expect(second.pending).toBeNull();
    expect(second.history).toHaveLength(1);
    const saved = second.history[0];
    expect(saved.pairs[0].confirmedAt).toBe(1100);
    expect(saved.pairs[1].confirmedAt).toBe(1200);
  });
});

describe('«Добавить пары»: досрочное закрытие танца', () => {
  it('неотмеченные пары поднимаются наверх следующего черновика', () => {
    const state = makeState(['Л1', 'Л2', 'Л3', 'Л4'], ['Ф1', 'Ф2', 'Ф3', 'Ф4']);
    const round = generateRound(state, 1000);
    // Первая пара дотанцевала, остальные продолжают.
    const marked = markPairs(state, round, [0], 1100);
    const carry = marked.pending!.pairs.filter((p) => p.confirmedAt == null);
    const result = carryOverPairs(marked, marked.pending!, carry, 1200);

    expect(result.state.history).toHaveLength(1);
    const closed = result.state.history[0];
    expect(closed.pairs).toHaveLength(round.pairs.length);
    expect(closed.carryCount ?? 0).toBe(0);

    const next = result.state.pending!;
    expect(next.number).toBe(2);
    expect(next.carryCount).toBe(carry.length);
    // Порядок остатка сохранён и встать должен сверху.
    expect(next.pairs.slice(0, carry.length).map((p) => [p.leaderId, p.followerId])).toEqual(
      carry.map((p) => [p.leaderId, p.followerId]),
    );
    // Участники остатка не танцуют второй раз в этом же наборе.
    const freshIds = next.pairs.slice(carry.length).flatMap((p) => [p.leaderId, p.followerId]);
    for (const id of carry.flatMap((p) => [p.leaderId, p.followerId])) {
      expect(freshIds).not.toContain(id);
    }
    expect(validateRound(result.state, next)).toEqual([]);
  });

  it('перенесённая пара не создаёт новую встречу, но засчитывается как танец', () => {
    const state = makeState(['Л1', 'Л2', 'Л3', 'Л4'], ['Ф1', 'Ф2', 'Ф3', 'Ф4']);
    const round = generateRound(state, 1000);
    const marked = markPairs(state, round, [0], 1100);
    const carry = marked.pending!.pairs.filter((p) => p.confirmedAt == null);
    const carried = carryOverPairs(marked, marked.pending!, carry, 1200).state;
    const pair = carry[0];

    // Пока остаток только черновик — в истории один закрытый раунд, встреча уже в кругах.
    expect(carried.history).toHaveLength(1);
    expect(deriveCircles(carried)[pair.leaderId].partners.includes(pair.followerId)).toBe(true);

    // Закрываем второй набор целиком: остаток считается танцем, но не новой встречей.
    const done = confirmRound(carried, carried.pending!, 1300).state;
    expect(done.history[1].carryCount).toBe(carry.length);
    const stats = computeStats(done, deriveCircles(done));
    const leader = stats.byId.get(pair.leaderId)!;
    expect(leader.dances).toBe(2);
    expect(leader.partners.get(pair.followerId)).toBe(1);
  });

  it('перенести все пары нельзя — это не остаток', () => {
    const state = makeState(['Л1', 'Л2'], ['Ф1', 'Ф2']);
    const round = generateRound(state, 1000);
    const result = carryOverPairs(state, round, round.pairs, 1100);
    expect(result.state).toBe(state);
    expect(result.state.pending).toBeNull();
  });

  it('остаток снимается: его участники уходят в пропуск', () => {
    const state = makeState(['Л1', 'Л2', 'Л3', 'Л4'], ['Ф1', 'Ф2', 'Ф3', 'Ф4']);
    const round = generateRound(state, 1000);
    const marked = markPairs(state, round, [0], 1100);
    const carry = marked.pending!.pairs.filter((p) => p.confirmedAt == null);
    const carried = carryOverPairs(marked, marked.pending!, carry, 1200).state;
    const draft = carried.pending!;
    expect(draft.carryCount).toBe(carry.length);

    const cleared = clearCarry(carried, draft, 1300);
    expect(cleared.pending!.carryCount ?? 0).toBe(0);
    expect(cleared.pending!.pairs).toHaveLength(draft.pairs.length - carry.length);
    for (const pair of draft.pairs.slice(0, carry.length)) {
      expect(cleared.pending!.skipIds).toContain(pair.leaderId);
      expect(cleared.pending!.skipIds).toContain(pair.followerId);
    }
    expect(validateRound(cleared, cleared.pending!)).toEqual([]);
  });

  it('undo последнего раунда откатывает и остаток', () => {
    const state = makeState(['Л1', 'Л2', 'Л3', 'Л4'], ['Ф1', 'Ф2', 'Ф3', 'Ф4']);
    const round = generateRound(state, 1000);
    const marked = markPairs(state, round, [0], 1100);
    const carry = marked.pending!.pairs.filter((p) => p.confirmedAt == null);
    const carried = carryOverPairs(marked, marked.pending!, carry, 1200).state;
    const undone = undoLastRound(carried, 1400);
    expect(undone.history).toHaveLength(0);
    expect(undone.pending).toBeNull();
  });

  it('участники остатка не попадают в подбор и в пропуски нового набора', () => {
    const state = makeState(['Л1', 'Л2', 'Л3', 'Л4'], ['Ф1', 'Ф2', 'Ф3']);
    const round = generateRound(state, 1000);
    const locked = [round.pairs[0]];
    const next = generateRound(state, 1100, locked);
    expect(next.carryCount).toBe(1);
    expect(next.pairs[0]).toMatchObject({
      leaderId: locked[0].leaderId,
      followerId: locked[0].followerId,
    });
    const busyIds = new Set(locked.flatMap((p) => [p.leaderId, p.followerId]));
    for (const id of next.skipIds) expect(busyIds.has(id)).toBe(false);
    for (const pair of next.pairs.slice(1)) {
      expect(busyIds.has(pair.leaderId)).toBe(false);
      expect(busyIds.has(pair.followerId)).toBe(false);
    }
  });

  it('закрывающие прошлый танец не открывают следующий', () => {
    const state = makeState(['Л1', 'Л2', 'Л3'], ['Ф1', 'Ф2', 'Ф3']);
    const first = generateRound(state, 1000);
    const confirmed = confirmRound(state, first, 1000).state;
    const next = generateRound(confirmed, 2000);
    const tail = first.pairs[first.pairs.length - 1];
    const head = next.pairs[0];
    expect(head.leaderId).not.toBe(tail.leaderId);
    expect(head.followerId).not.toBe(tail.followerId);
  });
});

describe('правка черновика вручную', () => {
  it('movePairToSkip: неподтверждённая пара возвращается в пропуск', () => {
    const state = makeState(['Л1', 'Л2', 'Л3'], ['Ф1', 'Ф2']);
    const round = generateRound(state, 1000);
    const moved = movePairToSkip(round, 0);
    expect(moved.pairs).toHaveLength(round.pairs.length - 1);
    expect(moved.skipIds).toContain(round.pairs[0].leaderId);
    expect(moved.skipIds).toContain(round.pairs[0].followerId);
    const marked: Round = {
      ...round,
      pairs: round.pairs.map((p, i) => (i === 0 ? { ...p, confirmedAt: 5 } : p)),
    };
    expect(movePairToSkip(marked, 0)).toBe(marked);
  });

  it('обмен не трогает подтверждённые пары', () => {
    const state = makeState(['Л1', 'Л2'], ['Ф1', 'Ф2']);
    const round = generateRound(state, 1000);
    const marked: Round = {
      ...round,
      pairs: round.pairs.map((p, i) => (i === 0 ? { ...p, confirmedAt: 5 } : p)),
    };
    const swapped = swapInRound(state, marked, marked.pairs[0].leaderId, marked.pairs[1].leaderId);
    expect(swapped).toBe(marked);
  });

  it('обмен достаёт участника из пропуска в неподтверждённую пару', () => {
    const state = makeState(['Л1', 'Л2', 'Л3'], ['Ф1', 'Ф2']);
    const round = generateRound(state, 1000);
    expect(round.skipIds.length).toBeGreaterThan(0);
    const skipId = round.skipIds[0];
    const swapped = swapInRound(state, round, skipId, round.pairs[0].leaderId);
    expect(swapped.skipIds).toContain(round.pairs[0].leaderId);
    expect(swapped.pairs.some((p) => p.leaderId === skipId)).toBe(true);
    expect(validateRound(state, swapped)).toEqual([]);
  });
});

describe('согласованность кругов', () => {
  it('загрузка снимка пересчитывает круги и чинит уехавший номер', () => {
    const result = simulate(
      makeState(['Л1', 'Л2', 'Л3', 'Л4', 'Л5'], ['Ф1', 'Ф2', 'Ф3', 'Ф4', 'Ф5']),
      7,
    );
    const state = result.state;
    const victim = byName(state, 'Ф3');
    const broken: AppState = {
      ...state,
      circles: {
        ...state.circles,
        [victim.id]: {
          partners: [],
          number: Math.max(1, state.circles[victim.id].number - 1),
        },
      },
    };
    const restored = decodeState(encodeState(broken))!;
    expect(restored).not.toBeNull();
    const numbers = new Set(restored.participants.map((p) => restored.circles[p.id].number));
    expect(numbers.size).toBe(1);
    expect(restored.circles[victim.id].number).toBe(state.circles[victim.id].number);
  });

  it('после ухода и возврата круги равны deriveCircles', () => {
    let state = simulate(makeState(['Л1', 'Л2', 'Л3'], ['Ф1', 'Ф2', 'Ф3']), 3).state;
    const away = byName(state, 'Л2');
    state = setParticipantStatus(state, away.id, 'away').state;
    state = simulate(state, 2).state;
    state = setParticipantStatus(state, away.id, 'active').state;
    expect(state.circles).toEqual(deriveCircles(state));
  });
});

describe('справедливость пропусков', () => {
  it('никто не пропускает два раунда подряд, разница пропусков ≤ 1', () => {
    const result = simulate(
      makeState(['Л1', 'Л2', 'Л3', 'Л4', 'Л5', 'Л6'], ['Ф1', 'Ф2', 'Ф3', 'Ф4', 'Ф5']),
      12,
    );
    for (const m of result.metrics) {
      expect(m.consecutiveSkips).toBe(0);
    }
    const stats = computeStats(result.state);
    const values = result.state.participants
      .filter((p) => p.role === 'leader')
      .map((p) => stats.byId.get(p.id)!.skips);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });
});
