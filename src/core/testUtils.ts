import { computeStats, activeOppositeSets } from './stats';
import {
  confirmRound,
  emptyAppState,
  generateRound,
  validateRound,
} from './rotation';
import type { AppState, Pair, Participant, Role, Round } from './types';

let idCounter = 0;

export function makeState(
  leaderNames: string[],
  followerNames: string[],
  now: number = 1_700_000_000_000,
): AppState {
  const participants: Participant[] = [];
  for (const name of leaderNames) {
    idCounter += 1;
    participants.push({
      id: `L${idCounter}`,
      name,
      role: 'leader',
      status: 'active',
      createdAt: now,
      joinedRound: 1,
    });
  }
  for (const name of followerNames) {
    idCounter += 1;
    participants.push({
      id: `F${idCounter}`,
      name,
      role: 'follower',
      status: 'active',
      createdAt: now,
      joinedRound: 1,
    });
  }
  const circles: AppState['circles'] = {};
  for (const p of participants) circles[p.id] = { partners: [], number: 1 };
  return {
    ...emptyAppState(now),
    participants,
    circles,
    nextRoundNumber: 1,
    eveningStartedAt: now,
    updatedAt: now,
  };
}

export function addPerson(
  state: AppState,
  name: string,
  role: Role,
  now: number = Date.now(),
): { state: AppState; id: string } {
  idCounter += 1;
  const id = `${role === 'leader' ? 'L' : 'F'}${idCounter}`;
  const participant: Participant = {
    id,
    name,
    role,
    status: 'active',
    createdAt: now,
    joinedRound: state.nextRoundNumber,
  };
  return {
    state: {
      ...state,
      participants: [...state.participants, participant],
      circles: { ...state.circles, [id]: { partners: [], number: 1 } },
      pending: null,
      updatedAt: now,
    },
    id,
  };
}

function pairStats(state: AppState, round: Round) {
  const circleSets = new Map<string, Set<string>>();
  for (const [id, circle] of Object.entries(state.circles)) circleSets.set(id, new Set(circle.partners));
  let both = 0;
  let one = 0;
  for (const pair of round.pairs) {
    const inL = circleSets.get(pair.leaderId)?.has(pair.followerId) ?? false;
    const inF = circleSets.get(pair.followerId)?.has(pair.leaderId) ?? false;
    if (inL && inF) both += 1;
    else if (inL || inF) one += 1;
  }
  return { both, one };
}

function previousPairs(state: AppState): Set<string> {
  const result = new Set<string>();
  const last = state.history[state.history.length - 1];
  if (!last) return result;
  for (const pair of last.pairs) result.add(`${pair.leaderId}|${pair.followerId}`);
  return result;
}

export interface RoundMetric {
  round: number;
  bothRepeats: number;
  oneRepeats: number;
  prevRepeats: number;
  consecutiveSkips: number;
  skips: string[];
  completed: string[];
  spread: Record<Role, number>;
}

export interface SimulationResult {
  state: AppState;
  metrics: RoundMetric[];
  completedCircles: number;
}

/** Прогоняет вечер: сгенерировать → проверить → подтвердить. */
export function simulate(state: AppState, rounds: number, startTime: number = 1_700_000_000_000): SimulationResult {
  let current = state;
  const metrics: RoundMetric[] = [];
  let previousSkips = new Set<string>();
  let completedCircles = 0;

  for (let i = 0; i < rounds; i += 1) {
    const now = startTime + i * 1000;
    const round = generateRound(current, now);
    const errors = validateRound(current, round);
    if (errors.length > 0) {
      throw new Error(`Некорректный раунд ${round.number}: ${errors.join('; ')}`);
    }
    const repeats = pairStats(current, round);
    const prev = previousPairs(current);
    let prevRepeats = 0;
    for (const pair of round.pairs) {
      if (prev.has(`${pair.leaderId}|${pair.followerId}`)) prevRepeats += 1;
    }
    const skips = new Set(round.skipIds);
    let consecutiveSkips = 0;
    for (const id of skips) if (previousSkips.has(id)) consecutiveSkips += 1;

    const result = confirmRound(current, round, now);
    current = result.state;
    completedCircles += result.completed.length;
    const stats = computeStats(current);
    metrics.push({
      round: round.number,
      bothRepeats: repeats.both,
      oneRepeats: repeats.one,
      prevRepeats,
      consecutiveSkips,
      skips: [...round.skipIds],
      completed: result.completed.map((p) => p.id),
      spread: {
        leader: stats.activeCounts.leader > 0 ? stats.maxDances.leader - stats.minDances.leader : 0,
        follower: stats.activeCounts.follower > 0 ? stats.maxDances.follower - stats.minDances.follower : 0,
      },
    });
    previousSkips = skips;
  }

  return { state: current, metrics, completedCircles };
}

export function summarize(label: string, result: SimulationResult): void {
  const stats = computeStats(result.state);
  const byRole = (role: Role) => {
    const values = result.state.participants
      .filter((p) => p.role === role && p.status === 'active')
      .map((p) => stats.byId.get(p.id)?.dances ?? 0);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    return `танцев ${min}…${max} (разброс ${max - min})`;
  };
  const both = result.metrics.reduce((sum, m) => sum + m.bothRepeats, 0);
  const one = result.metrics.reduce((sum, m) => sum + m.oneRepeats, 0);
  const prev = result.metrics.reduce((sum, m) => sum + m.prevRepeats, 0);
  const consecutive = result.metrics.reduce((sum, m) => sum + m.consecutiveSkips, 0);
  console.log(
    [
      `\n[${label}]`,
      `раундов: ${result.metrics.length}`,
      `кругов завершено (участий): ${result.completedCircles}`,
      `лидеры: ${byRole('leader')}`,
      `фоловеры: ${byRole('follower')}`,
      `повторов внутри круга (оба): ${both}`,
      `повторов внутри круга (один): ${one}`,
      `повторов с прошлым раундом: ${prev}`,
      `пропусков два подряд: ${consecutive}`,
    ].join('\n  '),
  );
}

export function byName(state: AppState, name: string): Participant {
  const found = state.participants.find((p) => p.name === name);
  if (!found) throw new Error(`Нет участника ${name}`);
  return found;
}

export function pairsOf(state: AppState): Set<string> {
  const result = new Set<string>();
  for (const round of state.history) {
    for (const pair of round.pairs) result.add(`${pair.leaderId}|${pair.followerId}`);
  }
  return result;
}

export function circlePartnerSet(state: AppState, id: string): Set<string> {
  return new Set(state.circles[id]?.partners ?? []);
}

export function currentPairs(state: AppState): Pair[] {
  return state.history[state.history.length - 1]?.pairs ?? [];
}

export function activeIds(state: AppState): string[] {
  return state.participants.filter((p) => p.status === 'active').map((p) => p.id);
}

export function oppositeActive(state: AppState, role: Role): Set<string> {
  return activeOppositeSets(state)[role === 'leader' ? 'follower' : 'leader'];
}
