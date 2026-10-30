import {
  type AppState,
  type CircleMap,
  type Participant,
  type Pair,
  type Role,
  type Round,
  type Stats,
  pairKey,
} from './types';
import { activeOppositeSets, activeParticipants, computeStats } from './stats';

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
 *   + 60_000, если P пропустил предыдущий раунд (пропуск два подряд — крайне плохо)
 *   − 1_000 × min(45, сколько раундов прошло с последнего пропуска)
 *   − 40_000 за каждый пропуск в текущем круге
 *
 * Вес 1e9 за один «недоданс» гарантированно больше суммы всех попарных штрафов
 * (даже 100 пар × ~1.1e6 ≈ 1.1e8). Поэтому равенство числа танцев — строго
 * главный приоритет, а повтор в круге — уже следующий.
 *
 * Вес «ожидания» (1_000 за раунд с последнего пропуска, плюс штраф за пропуски
 * в текущем круге) заметно больше попарных тай-брейков (together 50, recency 45),
 * но меньше prevPartner (100_000) и повтора в круге (250_000): при равном числе
 * танцев в пропуск всегда уйдёт тот, кто ждёт дольше всех, а тот, кто пропускал
 * в этом круге недавно, — в последнюю очередь. Это выполняет правило
 * «минимальный промежуток между выступлениями».
 *
 * Вес recency пар (1 за раунд, максимум 45) меньше together (50 за танец),
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
  skipConsecutive: 60_000,
  skipRecencyPerRound: 1_000,
  skipRecencyCap: 45,
  skipCirclePenalty: 40_000,
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

interface CircleReplay {
  circles: CircleMap;
  /** Сколько раз участник пропускал в текущем (ещё не завершённом) круге. */
  skipsInCircle: Map<string, number>;
}

/**
 * Пересчитывает круги из истории раундов — единый источник правды.
 *
 * Круг считается по ТЕКУЩЕМУ активному составу противоположной роли:
 * после ухода/возвращения людей номера и прогресс пересчитываются заново,
 * поэтому у всех участников с одинаковым числом танцев всегда согласованный
 * прогресс круга (это чинит баг «у всех 3/7, а у одного 2/7»).
 *
 * Для участников с circleResetRound (смена роли) история до этого раунда не учитывается.
 */
export function replayCircles(state: AppState, withSkips: boolean): CircleReplay {
  const opposite = activeOppositeSets(state);
  const required: Record<Role, Set<string>> = { leader: opposite.follower, follower: opposite.leader };
  const byId = new Map(state.participants.map((p) => [p.id, p]));

  interface Acc {
    partners: Set<string>;
    number: number;
    skips: number;
  }
  const acc = new Map<string, Acc>();
  for (const p of state.participants) {
    acc.set(p.id, { partners: new Set(), number: 1, skips: 0 });
  }

  for (const round of state.history) {
    // Первые `carryCount` пар — остаток с прошлого танца: они продолжают уже учтённую встречу,
    // поэтому в круг добавляем только новые пары.
    const carried = round.carryCount ?? 0;
    for (const pair of round.pairs.slice(carried)) {
      const l = acc.get(pair.leaderId);
      const f = acc.get(pair.followerId);
      const lPerson = byId.get(pair.leaderId);
      const fPerson = byId.get(pair.followerId);
      if (l && lPerson && round.number >= (lPerson.circleResetRound ?? 1)) {
        l.partners.add(pair.followerId);
      }
      if (f && fPerson && round.number >= (fPerson.circleResetRound ?? 1)) {
        f.partners.add(pair.leaderId);
      }
    }
    if (withSkips) {
      for (const id of round.skipIds) {
        const person = byId.get(id);
        const a = acc.get(id);
        if (a && person && round.number >= (person.circleResetRound ?? 1)) a.skips += 1;
      }
    }
    for (const p of state.participants) {
      const a = acc.get(p.id);
      const need = required[p.role];
      if (!a || need.size === 0) continue;
      let done = a.partners.size >= need.size;
      if (done) {
        for (const id of need) {
          if (!a.partners.has(id)) {
            done = false;
            break;
          }
        }
      }
      if (done) {
        a.partners = new Set();
        a.number += 1;
        a.skips = 0;
      }
    }
  }

  const circles: CircleMap = {};
  const skipsInCircle = new Map<string, number>();
  for (const [id, a] of acc) {
    circles[id] = { partners: [...a.partners], number: a.number };
    skipsInCircle.set(id, a.skips);
  }
  return { circles, skipsInCircle };
}

/** Состояние кругов, вычисленное из истории (согласовано с текущим составом). */
export function deriveCircles(state: AppState): CircleMap {
  return replayCircles(state, false).circles;
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

function skipCost(
  stats: Stats,
  participant: Participant,
  roundNumber: number,
  skippedThisCircle = 0,
): number {
  const st = stats.byId.get(participant.id);
  const dances = st?.dances ?? 0;
  const lastSkip = st?.lastSkipRound ?? null;
  const roundsSince =
    lastSkip == null ? COST.skipRecencyCap : Math.min(COST.skipRecencyCap, roundNumber - 1 - lastSkip);
  const behind = Math.max(0, roundNumber - 1 - dances);
  let cost = COST.fairPerDance * behind;
  if (lastSkip === roundNumber - 1) cost += COST.skipConsecutive;
  cost -= COST.skipRecencyPerRound * roundsSince;
  cost -= COST.skipCirclePenalty * skippedThisCircle;
  return cost;
}

/* ------------------------------------------------------------------------- */
/*  Генерация раунда                                                          */
/* ------------------------------------------------------------------------- */

/** id участников последней пары предыдущего раунда — «закрывающие» этот танец. */
function lastRoundTail(state: AppState): Set<string> {
  const ids = new Set<string>();
  const last = state.history[state.history.length - 1];
  const tail = last?.pairs[last.pairs.length - 1];
  if (tail) {
    ids.add(tail.leaderId);
    ids.add(tail.followerId);
  }
  return ids;
}

/**
 * Порядок пар внутри раунда — это порядок танцев: первая пара начинает, последняя заканчивает.
 * Поэтому «закрывающих» предыдущий танец не ставим в начало следующего — уводим в конец,
 * чтобы промежуток между выступлениями был ровным. Ручной override здесь не нужен:
 * «Добавить пары» переносит пару наверх намеренно, когда так решил организатор.
 */
function orderByRoundBoundary(pairs: Pair[], tailIds: Set<string>): Pair[] {
  if (tailIds.size === 0) return pairs;
  const head: Pair[] = [];
  const tail: Pair[] = [];
  for (const pair of pairs) {
    if (tailIds.has(pair.leaderId) || tailIds.has(pair.followerId)) tail.push(pair);
    else head.push(pair);
  }
  return [...head, ...tail];
}

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
 *
 * `locked` — пары, перенесённые из предыдущего танца («остаток»). Они уже танцуют этот
 * танец, поэтому их участники не участвуют в подборе и не могут попасть в пропуск:
 * матрица строится только на свободных, а сверху результата встают зафиксированные пары.
 */
export function generateRound(
  state: AppState,
  now: number = Date.now(),
  locked: Pair[] = [],
): Round {
  const active = activeParticipants(state);
  const lockedIds = new Set<string>();
  for (const pair of locked) {
    lockedIds.add(pair.leaderId);
    lockedIds.add(pair.followerId);
  }
  const leaders = active.filter((p) => p.role === 'leader' && !lockedIds.has(p.id));
  const followers = active.filter((p) => p.role === 'follower' && !lockedIds.has(p.id));
  const available = active.filter((p) => !lockedIds.has(p.id));
  const roundNumber = state.nextRoundNumber;
  const stats = computeStats(state);
  const replay = replayCircles(state, true);
  const circles = new Map<string, Set<string>>(
    Object.entries(replay.circles).map(([id, c]) => [id, new Set(c.partners)]),
  );
  const warnings: string[] = [];
  const activeIds = active.map((p) => p.id);

  const empty = (reason: string[]): Round => ({
    number: roundNumber,
    pairs: [...locked],
    skipIds: available.map((p) => p.id),
    activeIds,
    generatedAt: now,
    confirmedAt: null,
    warnings: [...reason, ...warnings],
    ...(locked.length > 0 ? { carryCount: locked.length } : {}),
  });

  if (active.length === 0) {
    return empty(['Нет активных участников — добавьте людей на вкладке «Люди».']);
  }
  // Перенос занял всю роль — подбирать не из чего, но остаток танцует.
  if (locked.length > 0 && (leaders.length === 0 || followers.length === 0)) {
    return empty([]);
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
        row.push(skipCost(stats, rowPerson, roundNumber, replay.skipsInCircle.get(rowPerson.id) ?? 0));
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
    pairs: [...locked, ...orderByRoundBoundary(pairs, lastRoundTail(state))],
    skipIds,
    activeIds,
    generatedAt: now,
    confirmedAt: null,
    warnings,
    ...(locked.length > 0 ? { carryCount: locked.length } : {}),
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

/**
 * Закрывает раунд: все его пары считаются станцованными. Если в раунде есть `carryCount`
 * перенесённых сверху пар — они попадают в историю, но новую встречу не создают
 * (это тот же танец, уже учтённый предыдущим раундом), см. `replayCircles` и `computeStats`.
 */
export function confirmRound(state: AppState, round: Round, now: number = Date.now()): ConfirmResult {
  const before = cloneCircles(state.circles);
  const confirmed: Round = {
    ...round,
    pairs: round.pairs.map((p) => ({ ...p, confirmedAt: p.confirmedAt ?? now })),
    skipIds: [...round.skipIds],
    activeIds: [...round.activeIds],
    warnings: [...round.warnings],
    confirmedAt: now,
  };

  const next: AppState = {
    ...state,
    history: [...state.history, confirmed],
    pending: null,
    nextRoundNumber: round.number + 1,
    updatedAt: now,
  };
  const circles = deriveCircles(next);

  const completed: Participant[] = [];
  for (const p of next.participants) {
    if (p.status !== 'active') continue;
    if ((circles[p.id]?.number ?? 1) > (before[p.id]?.number ?? 1)) completed.push(p);
  }

  return {
    state: { ...next, circles, undo: { round: confirmed, circles: before } },
    completed,
  };
}

/** Отмечает выбранные пары черновика станцованными (в историю ещё ничего не уходит). */
export function markPairs(
  state: AppState,
  round: Round,
  indices: number[],
  now: number = Date.now(),
): AppState {
  const selected = new Set(indices);
  const pairs = round.pairs.map((p, i) =>
    selected.has(i) && p.confirmedAt == null ? { ...p, confirmedAt: now } : { ...p },
  );
  return setPending(state, { ...round, pairs }, now);
}

/**
 * Досрочное завершение танца кнопкой «Добавить пары».
 *
 * `carry` — пары, которые продолжают танцевать (не отмечены станцованными). Раунд уходит
 * в историю целиком, будто прошёл полностью: счётчики танцев и круги обновляются для всех.
 * Сверху нового черновика встают перенесённые пары, ниже — обычный подбор на свободных.
 * Возвращает без изменений, если переносить нечего или переносить не остаток, а всё сразу.
 */
export function carryOverPairs(
  state: AppState,
  round: Round,
  carry: Pair[],
  now: number = Date.now(),
): ConfirmResult {
  const inRound = new Set(round.pairs.map((p) => pairKey(p.leaderId, p.followerId)));
  const wanted = new Set(
    carry
      .filter((p) => inRound.has(pairKey(p.leaderId, p.followerId)))
      .map((p) => pairKey(p.leaderId, p.followerId)),
  );
  if (wanted.size === 0 || wanted.size >= round.pairs.length) return { state, completed: [] };

  // Порядок остатка сохраняем тот, что был в черновике: перенесённые пары идут сверху.
  const carried = round.pairs.filter((p) => wanted.has(pairKey(p.leaderId, p.followerId)));
  const result = confirmRound(state, round, now);
  const next = generateRound(result.state, now, carried.map((p) => ({ leaderId: p.leaderId, followerId: p.followerId })));
  return { state: setPending(result.state, next, now), completed: result.completed };
}

/** Снимает остаток: перенесённые пары вычёркиваются из танца, оба участника идут в пропуск. */
export function clearCarry(state: AppState, round: Round, now: number = Date.now()): AppState {
  const carried = round.carryCount ?? 0;
  if (carried === 0) return state;
  const pairs = round.pairs.slice(carried).map((p) => ({ ...p }));
  const skipIds = [...round.skipIds];
  for (const p of round.pairs.slice(0, carried)) {
    for (const id of [p.leaderId, p.followerId]) {
      if (!skipIds.includes(id)) skipIds.push(id);
    }
  }
  const next: Round = { ...round, pairs, skipIds, confirmedAt: null };
  delete next.carryCount;
  return setPending(state, next, now);
}

/** Убирает неподтверждённую пару из раунда: оба участника идут в пропуск. */
export function movePairToSkip(round: Round, index: number): Round {
  const pair = round.pairs[index];
  if (!pair || pair.confirmedAt != null || index < (round.carryCount ?? 0)) return round;
  const pairs = round.pairs.filter((_, i) => i !== index).map((p) => ({ ...p }));
  const skipIds = [...round.skipIds];
  for (const id of [pair.leaderId, pair.followerId]) {
    if (!skipIds.includes(id)) skipIds.push(id);
  }
  return { ...round, pairs, skipIds, confirmedAt: null };
}

export function undoLastRound(state: AppState, now: number = Date.now()): AppState {
  if (!state.undo) return state;
  const last = state.history[state.history.length - 1];
  if (!last || last.number !== state.undo.round.number) return state;
  const next: AppState = {
    ...state,
    history: state.history.slice(0, -1),
    circles: {},
    pending: null,
    undo: null,
    nextRoundNumber: state.undo.round.number,
    updatedAt: now,
  };
  return { ...next, circles: deriveCircles(next) };
}

/**
 * Пересчитывает круги по текущему активному составу (функция истории — deriveCircles).
 * Вызывается после смены статуса/роли/удаления участника и при загрузке состояния.
 */
export function reconcileCircles(
  state: AppState,
  now: number = Date.now(),
): { state: AppState; completed: Participant[] } {
  const circles = deriveCircles(state);
  const completed: Participant[] = [];
  for (const p of state.participants) {
    if (p.status !== 'active') continue;
    if ((circles[p.id]?.number ?? 1) > (state.circles[p.id]?.number ?? 1)) completed.push(p);
  }
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
  const carried = round.carryCount ?? 0;
  const pairLocked = (slot: Slot): boolean =>
    slot.kind !== 'skip' && (slot.index < carried || pairs[slot.index].confirmedAt != null);
  if (pairLocked(sa) || pairLocked(sb)) return round;

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
    circleResetRound: undefined,
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
  const pairs = round.pairs.map((p) => ({ ...p }));
  const pending: Round = { ...round, pairs, confirmedAt: null, warnings: [...round.warnings] };
  // Черновик помнит, сколько первых пар — остаток с прошлого танца, но не больше, чем пар в списке.
  const carried = Math.min(pending.carryCount ?? 0, pairs.length);
  if (carried > 0) pending.carryCount = carried;
  else delete pending.carryCount;
  return { ...state, pending, updatedAt: now };
}
