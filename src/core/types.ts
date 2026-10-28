/** Роли в паре. */
export type Role = 'leader' | 'follower';

/**
 * active — участвует в танцах;
 * away — отсутствует (вышел на время, но вернётся);
 * left — ушёл с вечера (история сохраняется, можно вернуть).
 */
export type ParticipantStatus = 'active' | 'away' | 'left';

export interface Participant {
  id: string;
  name: string;
  role: Role;
  status: ParticipantStatus;
  /** Когда участник появился в списке (мс). */
  createdAt: number;
  /** Номер раунда, с которого участник впервые стал активен. */
  joinedRound: number;
}

export interface Pair {
  leaderId: string;
  followerId: string;
}

export interface Round {
  number: number;
  pairs: Pair[];
  skipIds: string[];
  /** Снимок активных участников на момент генерации раунда. */
  activeIds: string[];
  generatedAt: number;
  /** null — раунд ещё не подтверждён (черновик). */
  confirmedAt: number | null;
  warnings: string[];
}

export interface CircleState {
  /** Партнёры, с которыми участник уже танцевал в текущем круге. */
  partners: string[];
  /** Номер текущего круга, начиная с 1. */
  number: number;
}

export type CircleMap = Record<string, CircleState>;

export interface UndoSnapshot {
  round: Round;
  /** Состояние кругов до подтверждения этого раунда. */
  circles: CircleMap;
}

export interface AppState {
  version: 2;
  participants: Participant[];
  history: Round[];
  pending: Round | null;
  circles: CircleMap;
  nextRoundNumber: number;
  undo: UndoSnapshot | null;
  eveningStartedAt: number;
  updatedAt: number;
}

export interface ParticipantStats {
  dances: number;
  skips: number;
  lastDancedRound: number | null;
  lastSkipRound: number | null;
  /** partnerId → сколько раз танцевали за вечер. */
  partners: Map<string, number>;
  /** partnerId → номер последнего совместного раунда. */
  lastTogether: Map<string, number>;
  /** Партнёр в последнем протанцованном раунде (для штрафа «два подряд»). */
  previousPartner: string | null;
  circleMet: number;
  circleTotal: number;
  circleNumber: number;
}

export interface Stats {
  byId: Map<string, ParticipantStats>;
  /** Ключ `leaderId|followerId` → сколько раз танцевали. */
  pairCounts: Map<string, number>;
  /** Ключ `leaderId|followerId` → последний раунд. */
  pairLast: Map<string, number>;
  maxDances: Record<Role, number>;
  minDances: Record<Role, number>;
  activeCounts: Record<Role, number>;
  rounds: number;
}

export const ROLE_LABEL: Record<Role, string> = {
  leader: 'Лидер',
  follower: 'Фоловер',
};

export const ROLE_LABEL_PLURAL: Record<Role, string> = {
  leader: 'Лидеры',
  follower: 'Фоловеры',
};

export const STATUS_LABEL: Record<ParticipantStatus, string> = {
  active: 'Активен',
  away: 'Отсутствует',
  left: 'Ушёл',
};

export function oppositeRole(role: Role): Role {
  return role === 'leader' ? 'follower' : 'leader';
}

export function pairKey(leaderId: string, followerId: string): string {
  return `${leaderId}|${followerId}`;
}
