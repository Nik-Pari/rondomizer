import {
  type AppState,
  type CircleMap,
  type Participant,
  type Pair,
  type Role,
  type Round,
  type Stats,
  oppositeRole,
  pairKey,
} from './types';
import { activeParticipants, circleOf, computeStats } from './stats';

/* ------------------------------------------------------------------------- */
/*  Веса стоимости                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Точная формула (все веса подобраны так, чтобы приоритеты были строгими).
 *
 * Стоимость пары «лидер L + фоловер F»:
 *   circleBoth  1_000_000  — оба уже танцевали друг с другом в текущем круге
 *   circleOne     250_000  — в текущем круге пара есть только у одного из двоих
 *   prevPartner   100_000  — танцевали друг с другом в предыдущем раунде
 *   together          50 × (сколько раз танцевали за вечер)
 *   recency        −1 × min(45, сколько раундов прошло с последнего совместного танца)
 *   jitter         0…9     — детерминированный «шум», чтобы одинаковые по цене
 *                            варианты не выбирались всегда по порядку в списке
 *
 * Стоимость «посадить участника P» (фиктивная колонка/строка в матрице):
 *   1_000_000_000 × max(0, (номер раунда − 1) − танцев у P)
 *   + 400, если P пропустил предыдущий раунд
 *   − 1 × min(45, сколько раундов прошло с последнего пропуска)
 *
 * 1e9 за один «недоданс» гарантированно больше суммы всех попарных штрафов
 * (даже 100 пар × ~1.1e6 ≈ 1.1e8). Поэтому равенство числа танцев — строго
 * главный приоритет, а повтор в круге — уже следующий.
 *
 * Вес recency (1 за раунд, максимум 45) меньше together (50 за танец),
 * поэтому «никогда не танцевали» всегда дешевле, чем «танцевали один раз
 * очень давно»: давность — только тай-брейк при равном числе танцев.
 */
export const COST = {
  fairPerDance: 1_000_000_000,
  circleBoth: 1_000_000,
  circleOne: 250_000,
  prevPartner: 100_000,
  together: 50,
  recencyPerRound: 1,
  recencyCap: 45,
  jitter: 10,
  skipConsecutive: 400,
  skipRecencyPerRound: 1,
  skipRecencyCap: 45,
} as const;

/* ------------------------------------------------------------------------- */
/*  Вспомогательные функции                                                   */
/* ------------------------------------------------------------------------- */

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pairJitter(roundNumber: number, leaderId: string, followerId: string): number {
  return hashString(`${roundNumber}:${leaderId}:${followerId}`) % COST.jitter;
}

function cloneCircles(circles: CircleMap): CircleMap {
  const result: CircleMap = {};
  for (const [id, value] of Object.entries(circles)) {
    result[id] = { partners: [...value.partners], number: value.number };
  }
  return result;
}

function participantMaps(participants: Participant[]) {
  return {
    byId: new Map(participants.map((p) => [p.id, p])),
    nameById: new Map(participants.map((p) => [p.id, p.name])),
  };
}

/** Минимальное паросочетание в полном двудольном графе (венгерский алгоритм). */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j += 1) {
    if (p[j] > 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

function circleSets(state: AppState): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const p of state.participants) {
    result.set(p.id, new Set(circleOf(state.circles, p.id).partners));
  }
  return result;
}

function pairCost(
  stats: Stats,
  circles: Map<string, Set<string>>,
  roundNumber: number,
  leader: Participant,
  follower: Participant,
): number {
  const inLeaderCircle = circles.get(leader.id)?.has(follower.id) ?? false;
  const inFollowerCircle = circles.get(follower.id)?.has(leader.id) ?? false;
  const both = inLeaderCircle && inFollowerCircle;
  const one = !both && (inLeaderCircle || inFollowerCircle);
  const key = pairKey(leader.id, follower.id);
  const together = stats.pairCounts.get(key) ?? 0;
  const last = stats.pairLast.get(key);
  const roundsSince = last == null ? COST.recencyCap : Math.min(COST.recencyCap, roundNumber - 1 - last);
  const prev = stats.byId.get(leader.id)?.previousPartner === follower.id;

  let cost = 0;
  if (both) cost += COST.circleBoth;
  else if (one) cost += COST.circleOne;
  if (prev) cost += COST.prevPartner;
  cost += COST.together * together;
  cost -= COST.recencyPerRound * roundsSince;
  cost += pairJitter(roundNumber, leader.id, follower.id);
  return cost;
}

function skipCost(stats: Stats, participant: Participant, roundNumber: number): number {
  const st = stats.byId.get(participant.id);
  const dances = st?.dances ?? 0;
  const lastSkip = st?.lastSkipRound ?? null;
  const roundsSince =
    lastSkip == null ? COST.skipRecencyCap : Math.min(COST.skipRecencyCap, roundNumber - 1 - lastSkip);
  const behind = Math.max(0, roundNumber - 1 - dances);
  let cost = COST.fairPerDance * behind;
  if (lastSkip === roundNumber - 1) cost += COST.skipConsecutive;
  cost -= COST.skipRecencyPerRound * roundsSince;
  return cost;
}

/* ------------------------------------------------------------------------- */
/*  Генерация раунда                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Шаг 1 + шаг 2 одним венгерским алгоритмом.
 *
 * Строки — участники той роли, которой больше (или обеих при равенстве),
 * столбцы — участники меньшей роли + «фиктивные» столбцы для пропусков.
 * Стоимость фиктивного столбца — skipCost. Так как количество фиктивных
 * столбцов фиксировано, минимизация суммы автоматически:
 *   1) сначала выравнивает число танцев (вес 1e9 за танц),
 *   2) затем выбирает пары без повторов в круге/прошлом раунде,
 *   3) затем — самые «свежие» и редкие пары.
 * Перебор всех равноценных наборов пропусков не нужен: матрица учитывает
 * качество пар для каждого набора.
 */
export function generateRound(state: AppState, now: number = Date.now()): Round {
  const leaders = activeParticipants(state).filter((p) => p.role === 'leader');
  const followers = activeParticipants(state).filter((p) => p.role === 'follower');
  const roundNumber = state.nextRoundNumber;
  const stats = computeStats(state);
  const circles = circleSets(state);
  const warnings: string[] = [];
  const activeIds = [...leaders, ...followers].map((p) => p.id);

  const empty = (reason: string[]): Round => ({
    number: roundNumber,
    pairs: [],
    skipIds: [...leaders, ...followers].map((p) => p.id),
    activeIds,
    generatedAt: now,
    confirmedAt: null,
    warnings: [...reason, ...warnings],
  });

  if (leaders.length === 0 && followers.length === 0) {
    return empty(['Нет активных участников — добавьте людей на вкладке «Люди».']);
  }
  if (leaders.length === 0) {
    return empty(['Нет активных лидеров — танцевать не с кем.']);
  }
  if (followers.length === 0) {
    return empty(['Нет активных фоловеров — танцевать не с кем.']);
  }

  let pairs: Pair[] = [];
  const skipIds: string[] = [];

  if (state.history.length === 0) {
    // Первый танец вечера — детерминированный: i-й лидер с i-m фоловером
    // в порядке списков (как добавлены/загружены). Лишающиеся роли пропускают.
    const k = Math.min(leaders.length, followers.length);
    for (let i = 0; i < k; i += 1) {
      pairs.push({ leaderId: leaders[i].id, followerId: followers[i].id });
    }
    for (let i = k; i < leaders.length; i += 1) skipIds.push(leaders[i].id);
    for (let i = k; i < followers.length; i += 1) skipIds.push(followers[i].id);
  } else {
    const largerIsLeader = leaders.length >= followers.length;
    const rows = largerIsLeader ? leaders : followers;
    const smaller = largerIsLeader ? followers : leaders;
    const n = rows.length;
    const dummyCount = n - smaller.length;
    const matrix: number[][] = [];

    for (let i = 0; i < n; i += 1) {
      const rowPerson = rows[i];
      const row: number[] = [];
      for (let j = 0; j < smaller.length; j += 1) {
        const leader = largerIsLeader ? rowPerson : smaller[j];
        const follower = largerIsLeader ? smaller[j] : rowPerson;
        row.push(pairCost(stats, circles, roundNumber, leader, follower));
      }
      for (let d = 0; d < dummyCount; d += 1) {
        row.push(skipCost(stats, rowPerson, roundNumber));
      }
      matrix.push(row);
    }

    const assignment = hungarian(matrix);
    pairs = [];

    for (let i = 0; i < n; i += 1) {
      const col = assignment[i];
      if (col < 0) {
        // Теоретически недостижимо для квадратной матрицы, но не роняем вечер.
        skipIds.push(rows[i].id);
        continue;
      }
      if (col < smaller.length) {
        const leader = largerIsLeader ? rows[i] : smaller[col];
        const follower = largerIsLeader ? smaller[col] : rows[i];
        pairs.push({ leaderId: leader.id, followerId: follower.id });
      } else {
        skipIds.push(rows[i].id);
      }
    }

    // Сортируем для предсказуемого отображения и тестов.
    pairs.sort((a, b) => a.leaderId.localeCompare(b.leaderId));
  }
  const { nameById } = participantMaps(state.participants);
  const name = (id: string) => nameById.get(id) ?? 'неизвестный';

  if (leaders.length === 1 && followers.length === 1) {
    warnings.push('В каждой роли по одному участнику — пара будет повторяться каждый раунд.');
  }

  let bothRepeats = 0;
  let oneRepeats = 0;
  let prevRepeats = 0;
  const bothExamples: string[] = [];
  for (const pair of pairs) {
    const l = stats.byId.get(pair.leaderId);
    const f = stats.byId.get(pair.followerId);
    const lSet = circles.get(pair.leaderId);
    const fSet = circles.get(pair.followerId);
    const inL = lSet?.has(pair.followerId) ?? false;
    const inF = fSet?.has(pair.leaderId) ?? false;
    if (inL && inF) {
      bothRepeats += 1;
      if (bothExamples.length < 4) bothExamples.push(`${name(pair.leaderId)} — ${name(pair.followerId)}`);
    } else if (inL || inF) {
      oneRepeats += 1;
    }
    if (l?.previousPartner === pair.followerId || f?.previousPartner === pair.leaderId) {
      prevRepeats += 1;
    }
  }
  if (bothRepeats > 0) {
    warnings.push(
      `Повтор внутри круга неизбежен: ${bothExamples.join(', ')}${bothRepeats > bothExamples.length ? '…' : ''}.`,
    );
  } else if (oneRepeats > 0) {
    warnings.push(`Повтор у одного из партнёров внутри круга: ${oneRepeats} пар(ы).`);
  }
  if (prevRepeats > 0) {
    warnings.push(`С тем же партнёром, что и в прошлом раунде: ${prevRepeats} пар(ы).`);
  }

  const skippedNames = skipIds.map(name);
  if (skipIds.length > 0 && skippedNames.length <= 8) {
    warnings.push(`Пропускают: ${skippedNames.join(', ')}.`);
  }

  return {
    number: roundNumber,
    pairs,
    skipIds,
    activeIds,
    generatedAt: now,
    confirmedAt: null,
    warnings,
  };
}

/* ------------------------------------------------------------------------- */
/*  Подтверждение, круги, undo                                                */
/* ------------------------------------------------------------------------- */

export interface ConfirmResult {
  state: AppState;
  /** Участники, у которых после этого раунда завершился круг. */
  completed: Participant[];
}

export function confirmRound(state: AppState, round: Round, now: number = Date.now()): ConfirmResult {
  const circles = cloneCircles(state.circles);
  const before = cloneCircles(state.circles);
  const byId = new Map(state.participants.map((p) => [p.id, p]));

  for (const pair of round.pairs) {
    const leader = byId.get(pair.leaderId);
    const follower = byId.get(pair.followerId);
    if (!leader || !follower) continue;
    circles[leader.id] ??= { partners: [], number: 1 };
    circles[follower.id] ??= { partners: [], number: 1 };
    if (!circles[leader.id].partners.includes(follower.id)) circles[leader.id].partners.push(follower.id);
    if (!circles[follower.id].partners.includes(leader.id)) circles[follower.id].partners.push(leader.id);
  }

  const active = activeParticipants(state);
  const activeOpposite: Record<Role, Set<string>> = { leader: new Set(), follower: new Set() };
  for (const p of active) {
    if (p.role === 'leader') activeOpposite.leader.add(p.id);
    else activeOpposite.follower.add(p.id);
  }

  const completed: Participant[] = [];
  for (const p of active) {
    const st = circles[p.id] ?? (circles[p.id] = { partners: [], number: 1 });
    const required = activeOpposite[oppositeRole(p.role)];
    if (required.size === 0) continue;
    const danced = new Set(st.partners);
    let done = true;
    for (const id of required) {
      if (!danced.has(id)) {
        done = false;
        break;
      }
    }
    if (done) {
      st.partners = [];
      st.number += 1;
      completed.push(p);
    }
  }

  const confirmed: Round = {
    ...round,
    pairs: round.pairs.map((p) => ({ ...p })),
    skipIds: [...round.skipIds],
    activeIds: [...round.activeIds],
    warnings: [...round.warnings],
    confirmedAt: now,
  };

  return {
    state: {
      ...state,
      history: [...state.history, confirmed],
      pending: null,
      circles,
      undo: { round: confirmed, circles: before },
      nextRoundNumber: round.number + 1,
      updatedAt: now,
    },
    completed,
  };
}

export function undoLastRound(state: AppState, now: number = Date.now()): AppState {
  if (!state.undo) return state;
  const last = state.history[state.history.length - 1];
  if (!last || last.number !== state.undo.round.number) return state;
  return {
    ...state,
    history: state.history.slice(0, -1),
    circles: cloneCircles(state.undo.circles),
    pending: null,
    undo: null,
    nextRoundNumber: state.undo.round.number,
    updatedAt: now,
  };
}

/**
 * Пересчитывает завершённость кругов по текущему активному составу.
 * Вызывается после смены статуса/роли/удаления участника.
 */
export function reconcileCircles(
  state: AppState,
  now: number = Date.now(),
): { state: AppState; completed: Participant[] } {
  const circles = cloneCircles(state.circles);
  let changed = false;
  for (const p of state.participants) {
    if (!circles[p.id]) {
      circles[p.id] = { partners: [], number: 1 };
      changed = true;
    }
  }

  const active = activeParticipants(state);
  const activeOpposite: Record<Role, Set<string>> = { leader: new Set(), follower: new Set() };
  for (const p of active) {
    if (p.role === 'leader') activeOpposite.leader.add(p.id);
    else activeOpposite.follower.add(p.id);
  }

  const completed: Participant[] = [];
  for (const p of active) {
    const st = circles[p.id];
    const required = activeOpposite[oppositeRole(p.role)];
    if (!st || required.size === 0) continue;
    const danced = new Set(st.partners);
    let done = true;
    for (const id of required) {
      if (!danced.has(id)) {
        done = false;
        break;
      }
    }
    if (done) {
      st.partners = [];
      st.number += 1;
      completed.push(p);
      changed = true;
    }
  }

  if (!changed) return { state, completed: [] };
  return { state: { ...state, circles, updatedAt: now }, completed };
}

/* ------------------------------------------------------------------------- */
/*  Ручная правка раунда                                                      */
/* ------------------------------------------------------------------------- */

export function validateRound(state: AppState, round: Round): string[] {
  const errors: string[] = [];
  const byId = new Map(state.participants.map((p) => [p.id, p]));
  const seen = new Set<string>();

  for (const pair of round.pairs) {
    const leader = byId.get(pair.leaderId);
    const follower = byId.get(pair.followerId);
    if (!leader || leader.role !== 'leader') errors.push('В паре нет корректного лидера.');
    if (!follower || follower.role !== 'follower') errors.push('В паре нет корректного фоловера.');
    if (leader && leader.status !== 'active') errors.push(`${leader.name} сейчас не активен(на).`);
    if (follower && follower.status !== 'active') errors.push(`${follower.name} сейчас не активен(на).`);
    for (const id of [pair.leaderId, pair.followerId]) {
      if (seen.has(id)) errors.push('Один участник встречается в раунде дважды.');
      seen.add(id);
    }
  }
  for (const id of round.skipIds) {
    const p = byId.get(id);
    if (!p || p.status !== 'active') errors.push('В пропусках есть неактивный участник.');
    if (seen.has(id)) errors.push('Один участник встречается в раунде дважды.');
    seen.add(id);
  }
  for (const id of round.activeIds) {
    if (!seen.has(id)) {
      const p = byId.get(id);
      errors.push(`${p?.name ?? 'Участник'} не поставлен(а) ни в пару, ни в пропуск.`);
    }
  }
  if (seen.size !== round.activeIds.length) {
    errors.push('Состав раунда не совпадает с активным составом.');
  }
  return errors;
}

/**
 * Меняет местами двух участников одной роли: пары ↔ пары или пара ↔ пропуск.
 * Такой обмен всегда сохраняет корректность раунда.
 */
export function swapInRound(state: AppState, round: Round, aId: string, bId: string): Round {
  if (aId === bId) return round;
  const byId = new Map(state.participants.map((p) => [p.id, p]));
  const a = byId.get(aId);
  const b = byId.get(bId);
  if (!a || !b || a.role !== b.role) return round;

  const pairs = round.pairs.map((p) => ({ ...p }));
  const skipIds = [...round.skipIds];

  type Slot = { kind: 'leader' | 'follower'; index: number } | { kind: 'skip'; index: number };
  const find = (id: string): Slot | null => {
    for (let i = 0; i < pairs.length; i += 1) {
      if (pairs[i].leaderId === id) return { kind: 'leader', index: i };
      if (pairs[i].followerId === id) return { kind: 'follower', index: i };
    }
    const si = skipIds.indexOf(id);
    if (si >= 0) return { kind: 'skip', index: si };
    return null;
  };

  const sa = find(aId);
  const sb = find(bId);
  if (!sa || !sb) return round;
  if (sa.kind === 'skip' && sb.kind === 'skip') return round;

  const put = (slot: Slot, id: string) => {
    if (slot.kind === 'leader') pairs[slot.index].leaderId = id;
    else if (slot.kind === 'follower') pairs[slot.index].followerId = id;
    else skipIds[slot.index] = id;
  };

  put(sa, bId);
  put(sb, aId);

  return { ...round, pairs, skipIds };
}

/* ------------------------------------------------------------------------- */
/*  Новый вечер, пустое состояние                                             */
/* ------------------------------------------------------------------------- */

export function emptyAppState(now: number = Date.now()): AppState {
  return {
    version: 2,
    participants: [],
    history: [],
    pending: null,
    circles: {},
    nextRoundNumber: 1,
    undo: null,
    eveningStartedAt: now,
    updatedAt: now,
  };
}

export function startNewEvening(state: AppState, allActive: boolean, now: number = Date.now()): AppState {
  const participants = state.participants.map((p) => ({
    ...p,
    status: allActive ? ('active' as const) : p.status,
    joinedRound: 1,
  }));
  const circles: CircleMap = {};
  for (const p of participants) circles[p.id] = { partners: [], number: 1 };
  return {
    ...state,
    participants,
    history: [],
    pending: null,
    circles,
    nextRoundNumber: 1,
    undo: null,
    eveningStartedAt: now,
    updatedAt: now,
  };
}

export function discardPending(state: AppState, now: number = Date.now()): AppState {
  if (!state.pending) return state;
  return { ...state, pending: null, updatedAt: now };
}

export function setPending(state: AppState, round: Round, now: number = Date.now()): AppState {
  return { ...state, pending: { ...round, confirmedAt: null }, updatedAt: now };
}
