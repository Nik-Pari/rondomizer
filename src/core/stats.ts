import {
  type AppState,
  type CircleMap,
  type Participant,
  type ParticipantStats,
  type Role,
  type Stats,
  oppositeRole,
  pairKey,
} from './types';

export function activeParticipants(state: AppState): Participant[] {
  return state.participants.filter((p) => p.status === 'active');
}

export function activeByRole(state: AppState, role: Role): Participant[] {
  return state.participants.filter((p) => p.status === 'active' && p.role === role);
}

export function circleOf(circles: CircleMap, participantId: string): { partners: string[]; number: number } {
  const c = circles[participantId];
  if (!c) return { partners: [], number: 1 };
  return c;
}

/** Индексы активных партнёров противоположной роли: id → набор id. */
export function activeOppositeSets(state: AppState): Record<Role, Set<string>> {
  const leaders = new Set<string>();
  const followers = new Set<string>();
  for (const p of state.participants) {
    if (p.status !== 'active') continue;
    if (p.role === 'leader') leaders.add(p.id);
    else followers.add(p.id);
  }
  return { leader: leaders, follower: followers };
}

export function circleProgress(
  state: AppState,
  participant: Participant,
  circles: CircleMap = state.circles,
): { met: number; total: number; number: number } {
  const opposite = activeOppositeSets(state)[oppositeRole(participant.role)];
  const partners = new Set(circleOf(circles, participant.id).partners);
  let met = 0;
  for (const id of opposite) if (partners.has(id)) met += 1;
  return { met, total: opposite.size, number: circleOf(circles, participant.id).number };
}

/**
 * Считает статистику по подтверждённой истории. Ничего не хранится в счётчиках,
 * поэтому статистика всегда согласована с историей.
 */
export function computeStats(state: AppState, circles: CircleMap = state.circles): Stats {
  const byId = new Map<string, ParticipantStats>();
  for (const p of state.participants) {
    byId.set(p.id, {
      dances: 0,
      skips: 0,
      lastDancedRound: null,
      lastSkipRound: null,
      partners: new Map(),
      lastTogether: new Map(),
      previousPartner: null,
      circleMet: 0,
      circleTotal: 0,
      circleNumber: circleOf(circles, p.id).number,
    });
  }

  const pairCounts = new Map<string, number>();
  const pairLast = new Map<string, number>();

  for (const round of state.history) {
    // Первые `carryCount` пар — остаток с прошлого танца: это та же встреча, что уже учтена
    // в предыдущем раунде, поэтому для статистики «сколько раз танцевали вместе» не удваиваем.
    const carried = round.carryCount ?? 0;
    for (const pair of round.pairs.slice(carried)) {
      const leader = byId.get(pair.leaderId);
      const follower = byId.get(pair.followerId);
      if (leader) {
        leader.dances += 1;
        leader.lastDancedRound = round.number;
        leader.partners.set(pair.followerId, (leader.partners.get(pair.followerId) ?? 0) + 1);
        leader.lastTogether.set(pair.followerId, round.number);
      }
      if (follower) {
        follower.dances += 1;
        follower.lastDancedRound = round.number;
        follower.partners.set(pair.leaderId, (follower.partners.get(pair.leaderId) ?? 0) + 1);
        follower.lastTogether.set(pair.leaderId, round.number);
      }
      const key = pairKey(pair.leaderId, pair.followerId);
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      pairLast.set(key, round.number);
    }
    for (const pair of round.pairs.slice(0, carried)) {
      const leader = byId.get(pair.leaderId);
      const follower = byId.get(pair.followerId);
      if (leader) {
        leader.dances += 1;
        leader.lastDancedRound = round.number;
      }
      if (follower) {
        follower.dances += 1;
        follower.lastDancedRound = round.number;
      }
    }
    for (const id of round.skipIds) {
      const p = byId.get(id);
      if (!p) continue;
      p.skips += 1;
      p.lastSkipRound = round.number;
    }
  }

  // Партнёр в последнем подтверждённом раунде — для приоритета 3.
  const lastRound = state.history[state.history.length - 1];
  if (lastRound) {
    for (const pair of lastRound.pairs) {
      const l = byId.get(pair.leaderId);
      const f = byId.get(pair.followerId);
      if (l) l.previousPartner = pair.followerId;
      if (f) f.previousPartner = pair.leaderId;
    }
  }

  const opposite = activeOppositeSets(state);
  const maxDances: Record<Role, number> = { leader: 0, follower: 0 };
  const minDances: Record<Role, number> = { leader: Infinity, follower: Infinity };
  const activeCounts: Record<Role, number> = { leader: 0, follower: 0 };
  let hasLeader = false;
  let hasFollower = false;

  for (const p of state.participants) {
    if (p.status !== 'active') continue;
    const st = byId.get(p.id);
    if (!st) continue;
    activeCounts[p.role] += 1;
    if (p.role === 'leader') hasLeader = true;
    else hasFollower = true;
    maxDances[p.role] = Math.max(maxDances[p.role], st.dances);
    minDances[p.role] = Math.min(minDances[p.role], st.dances);

    const opp = opposite[oppositeRole(p.role)];
    let met = 0;
    const partners = new Set(circleOf(circles, p.id).partners);
    for (const id of opp) if (partners.has(id)) met += 1;
    st.circleMet = met;
    st.circleTotal = opp.size;
    st.circleNumber = circleOf(circles, p.id).number;
  }

  if (!hasLeader) minDances.leader = 0;
  if (!hasFollower) minDances.follower = 0;

  return {
    byId,
    pairCounts,
    pairLast,
    maxDances,
    minDances,
    activeCounts,
    rounds: state.history.length,
  };
}

/** Участники, отстающие по числу танцев от максимума в своей роли на 2+. */
export function laggingIds(state: AppState, stats: Stats): Set<string> {
  const result = new Set<string>();
  for (const p of state.participants) {
    if (p.status !== 'active') continue;
    const st = stats.byId.get(p.id);
    if (!st) continue;
    if (stats.maxDances[p.role] - st.dances >= 2) result.add(p.id);
  }
  return result;
}
