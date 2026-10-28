import {
  type AppState,
  type CircleMap,
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

function withCircles(state: AppState): CircleMap {
  const circles: CircleMap = {};
  for (const p of state.participants) {
    circles[p.id] = state.circles[p.id]
      ? { partners: [...state.circles[p.id].partners], number: state.circles[p.id].number }
      : { partners: [], number: 1 };
  }
  return circles;
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
  const circles = withCircles(state);
  circles[participant.id] = { partners: [], number: 1 };
  return finish(
    {
      ...state,
      participants: [...state.participants, participant],
      circles,
      pending: null,
      updatedAt: now,
    },
    state.pending !== null,
  );
}

export function addParticipants(
  state: AppState,
  names: string[],
  role: Role,
  now: number = Date.now(),
): RosterChange {
  const cleaned = names.map((n) => n.trim().slice(0, 80)).filter(Boolean);
  if (cleaned.length === 0) return finish(state, false);
  const circles = withCircles(state);
  const participants = [...state.participants];
  for (const name of cleaned) {
    const participant: Participant = {
      id: createId(),
      name,
      role,
      status: 'active',
      createdAt: now,
      joinedRound: state.nextRoundNumber,
    };
    participants.push(participant);
    circles[participant.id] = { partners: [], number: 1 };
  }
  return finish(
    {
      ...state,
      participants,
      circles,
      pending: null,
      updatedAt: now,
    },
    state.pending !== null,
  );
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

  const circles = withCircles(state);
  circles[id] = { partners: [], number: 1 };
  for (const [otherId, circle] of Object.entries(circles)) {
    if (otherId === id) continue;
    circle.partners = circle.partners.filter((p) => p !== id);
  }

  const participants = state.participants.map((p) => (p.id === id ? { ...p, role } : p));
  const next: AppState = { ...state, participants, circles, pending: null, updatedAt: now };
  const reconciled = reconcileCircles(next, now);
  return finish(reconciled.state, state.pending !== null, reconciled.completed);
}

export function deleteParticipant(state: AppState, id: string, now: number = Date.now()): RosterChange {
  if (!state.participants.some((p) => p.id === id)) return finish(state, false);

  const circles = withCircles(state);
  delete circles[id];
  for (const circle of Object.values(circles)) {
    circle.partners = circle.partners.filter((p) => p !== id);
  }

  const participants = state.participants.filter((p) => p.id !== id);
  const next: AppState = { ...state, participants, circles, pending: null, updatedAt: now };
  const reconciled = reconcileCircles(next, now);
  return finish(reconciled.state, state.pending !== null, reconciled.completed);
}
