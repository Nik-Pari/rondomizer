import {
  type AppState,
  type Participant,
  type ParticipantStatus,
  type Role,
} from './types';
import { reconcileCircles } from './rotation';

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface RosterChange {
  state: AppState;
  pendingDiscarded: boolean;
  completed: Participant[];
}

function finish(state: AppState, pendingDiscarded: boolean, completed: Participant[] = []): RosterChange {
  return { state, pendingDiscarded, completed };
}

export function addParticipant(
  state: AppState,
  name: string,
  role: Role,
  now: number = Date.now(),
): RosterChange {
  const clean = name.trim().slice(0, 80);
  if (!clean) return finish(state, false);
  const participant: Participant = {
    id: createId(),
    name: clean,
    role,
    status: 'active',
    createdAt: now,
    joinedRound: state.nextRoundNumber,
  };
  const next: AppState = {
    ...state,
    participants: [...state.participants, participant],
    pending: null,
    updatedAt: now,
  };
  const reconciled = reconcileCircles(next, now);
  return finish(reconciled.state, state.pending !== null, reconciled.completed);
}

export function addParticipants(
  state: AppState,
  names: string[],
  role: Role,
  now: number = Date.now(),
): RosterChange {
  const cleaned = names.map((n) => n.trim().slice(0, 80)).filter(Boolean);
  if (cleaned.length === 0) return finish(state, false);
  const participants = [...state.participants];
  for (const name of cleaned) {
    participants.push({
      id: createId(),
      name,
      role,
      status: 'active',
      createdAt: now,
      joinedRound: state.nextRoundNumber,
    });
  }
  const next: AppState = { ...state, participants, pending: null, updatedAt: now };
  const reconciled = reconcileCircles(next, now);
  return finish(reconciled.state, state.pending !== null, reconciled.completed);
}

export function renameParticipant(state: AppState, id: string, name: string, now: number = Date.now()): AppState {
  const clean = name.trim().slice(0, 80);
  if (!clean) return state;
  return {
    ...state,
    participants: state.participants.map((p) => (p.id === id ? { ...p, name: clean } : p)),
    updatedAt: now,
  };
}

export function setParticipantStatus(
  state: AppState,
  id: string,
  status: ParticipantStatus,
  now: number = Date.now(),
): RosterChange {
  const target = state.participants.find((p) => p.id === id);
  if (!target || target.status === status) return finish(state, false);

  const pendingDiscarded = state.pending !== null;
  const participants = state.participants.map((p) => (p.id === id ? { ...p, status } : p));
  const next: AppState = { ...state, participants, pending: null, updatedAt: now };
  const reconciled = reconcileCircles(next, now);
  return finish(reconciled.state, pendingDiscarded, reconciled.completed);
}

export function setParticipantRole(state: AppState, id: string, role: Role, now: number = Date.now()): RosterChange {
  const target = state.participants.find((p) => p.id === id);
  if (!target || target.role === role) return finish(state, false);

  // Круг после смены роли считается заново, начиная с текущего раунда.
  const participants = state.participants.map((p) =>
    p.id === id ? { ...p, role, circleResetRound: state.nextRoundNumber } : p,
  );
  const next: AppState = { ...state, participants, pending: null, updatedAt: now };
  const reconciled = reconcileCircles(next, now);
  return finish(reconciled.state, state.pending !== null, reconciled.completed);
}

export function deleteParticipant(state: AppState, id: string, now: number = Date.now()): RosterChange {
  if (!state.participants.some((p) => p.id === id)) return finish(state, false);

  const participants = state.participants.filter((p) => p.id !== id);
  const next: AppState = { ...state, participants, pending: null, updatedAt: now };
  const reconciled = reconcileCircles(next, now);
  return finish(reconciled.state, state.pending !== null, reconciled.completed);
}
