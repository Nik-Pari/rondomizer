import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { deriveCircles } from './rotation';
import {
  type AppState,
  type CircleMap,
  type Pair,
  type Participant,
  type ParticipantStatus,
  type Role,
  type Round,
} from './types';

export const SNAPSHOT_HASH_PREFIX = '#data=';
/** При большей длине ссылки QR-код получается слишком плотным для телефона. */
export const MAX_QR_URL_LENGTH = 1800;

export interface SnapshotPayload {
  v: 3;
  participants: Participant[];
  history: Round[];
  pending: Round | null;
  circles: CircleMap;
  nextRoundNumber: number;
  eveningStartedAt: number;
  savedAt: number;
}

export function toPayload(state: AppState, savedAt: number = Date.now()): SnapshotPayload {
  return {
    v: 3,
    participants: state.participants,
    history: state.history,
    pending: state.pending,
    circles: state.circles,
    nextRoundNumber: state.nextRoundNumber,
    eveningStartedAt: state.eveningStartedAt,
    savedAt,
  };
}

export function encodeState(state: AppState): string {
  return compressToEncodedURIComponent(JSON.stringify(toPayload(state)));
}

export function decodeState(encoded: string): AppState | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    return stateFromSnapshot(JSON.parse(json));
  } catch {
    return null;
  }
}

export function exportStateJson(state: AppState): string {
  return JSON.stringify(toPayload(state), null, 2);
}

export function importStateJson(text: string): AppState | null {
  try {
    return stateFromSnapshot(JSON.parse(text));
  } catch {
    return null;
  }
}

export function buildSnapshotUrl(baseUrl: string, state: AppState): string {
  return `${baseUrl}${SNAPSHOT_HASH_PREFIX}${encodeState(state)}`;
}

/* ------------------------------------------------------------------------- */
/*  Валидация импортированных данных                                          */
/* ------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRole(value: unknown): value is Role {
  return value === 'leader' || value === 'follower';
}

function isStatus(value: unknown): value is ParticipantStatus {
  return value === 'active' || value === 'away' || value === 'left';
}

function parseParticipant(value: unknown): Participant | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || !value.id) return null;
  if (typeof value.name !== 'string') return null;
  if (!isRole(value.role) || !isStatus(value.status)) return null;
  return {
    id: value.id,
    name: value.name.slice(0, 80),
    role: value.role,
    status: value.status,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
    joinedRound: typeof value.joinedRound === 'number' ? value.joinedRound : 1,
    circleResetRound:
      typeof value.circleResetRound === 'number' && value.circleResetRound >= 1
        ? Math.round(value.circleResetRound)
        : undefined,
  };
}

function parsePair(value: unknown, defaultConfirmedAt: number | null): Pair | null {
  if (!isRecord(value)) return null;
  if (typeof value.leaderId !== 'string' || typeof value.followerId !== 'string') return null;
  const confirmedAt =
    'confirmedAt' in value && value.confirmedAt != null
      ? typeof value.confirmedAt === 'number'
        ? value.confirmedAt
        : null
      : defaultConfirmedAt;
  const pair: Pair = { leaderId: value.leaderId, followerId: value.followerId };
  if (confirmedAt != null) pair.confirmedAt = confirmedAt;
  return pair;
}

function parseRound(value: unknown): Round | null {
  if (!isRecord(value)) return null;
  if (typeof value.number !== 'number' || !Number.isFinite(value.number)) return null;
  const roundConfirmedAt = typeof value.confirmedAt === 'number' ? value.confirmedAt : null;
  const pairsRaw = Array.isArray(value.pairs) ? value.pairs : [];
  const pairs: Pair[] = [];
  for (const item of pairsRaw) {
    const pair = parsePair(item, roundConfirmedAt);
    if (pair) pairs.push(pair);
  }
  const stringArray = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : [];
  return {
    number: Math.max(1, Math.round(value.number)),
    pairs,
    skipIds: stringArray(value.skipIds),
    activeIds: stringArray(value.activeIds),
    generatedAt: typeof value.generatedAt === 'number' ? value.generatedAt : 0,
    confirmedAt: roundConfirmedAt,
    warnings: stringArray(value.warnings),
  };
}

function parseCircles(value: unknown, participantIds: Set<string>): CircleMap {
  const result: CircleMap = {};
  if (!isRecord(value)) return result;
  for (const [id, circle] of Object.entries(value)) {
    if (!participantIds.has(id) || !isRecord(circle)) continue;
    const partners = Array.isArray(circle.partners)
      ? circle.partners.filter((p): p is string => typeof p === 'string' && participantIds.has(p))
      : [];
    result[id] = {
      partners: [...new Set(partners)],
      number: typeof circle.number === 'number' && circle.number >= 1 ? Math.round(circle.number) : 1,
    };
  }
  return result;
}

/**
 * Принимает снимок (payload) или полный AppState. Возвращает нормализованное
 * состояние без undo — импорт всегда начинает «с чистого» блока отмены.
 */
export function stateFromSnapshot(raw: unknown): AppState | null {
  if (!isRecord(raw)) return null;

  const participantsRaw = Array.isArray(raw.participants) ? raw.participants : null;
  if (!participantsRaw) return null;

  const participants: Participant[] = [];
  for (const item of participantsRaw) {
    const p = parseParticipant(item);
    if (!p) continue;
    participants.push(p);
  }
  if (participants.length === 0 && participantsRaw.length > 0) return null;

  const ids = new Set(participants.map((p) => p.id));
  if (ids.size !== participants.length) return null;

  const historyRaw = Array.isArray(raw.history) ? raw.history : [];
  const history: Round[] = [];
  for (const item of historyRaw) {
    const round = parseRound(item);
    if (round) history.push(round);
  }
  history.sort((a, b) => a.number - b.number);

  const pending = raw.pending == null ? null : parseRound(raw.pending);
  const circles = parseCircles(raw.circles, ids);
  for (const p of participants) {
    if (!circles[p.id]) circles[p.id] = { partners: [], number: 1 };
  }

  const maxHistory = history.reduce((max, r) => Math.max(max, r.number), 0);
  const nextFromRaw = typeof raw.nextRoundNumber === 'number' ? Math.round(raw.nextRoundNumber) : 0;

  const state: AppState = {
    version: 2,
    participants,
    history,
    pending,
    circles,
    nextRoundNumber: Math.max(1, maxHistory + 1, pending ? pending.number : 0, nextFromRaw),
    undo: null,
    eveningStartedAt: typeof raw.eveningStartedAt === 'number' ? raw.eveningStartedAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
  // Круги всегда пересчитываем из истории — снимок мог быть сохранён со «съехавшим» прогрессом.
  return { ...state, circles: deriveCircles(state) };
}
