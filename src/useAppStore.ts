import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  confirmRound,
  emptyAppState,
  generateRound,
  startNewEvening,
  undoLastRound,
  validateRound,
  setPending,
  discardPending,
} from './core/rotation';
import { computeStats } from './core/stats';
import { toPayload, stateFromSnapshot } from './core/codec';
import {
  addParticipant,
  addParticipants,
  deleteParticipant,
  renameParticipant,
  setParticipantRole,
  setParticipantStatus,
  type RosterChange,
} from './core/state';
import type {
  AppState,
  Participant,
  ParticipantStatus,
  Role,
  Round,
} from './core/types';
import type { Stats } from './core/types';
import type { Notify } from './ui';

const STORAGE_KEY = 'rondomizer.state.v2';

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyAppState();
    const parsed: unknown = JSON.parse(raw);
    return stateFromSnapshot(parsed) ?? emptyAppState();
  } catch {
    return emptyAppState();
  }
}

function namesLabel(people: Participant[]): string {
  const names = people.slice(0, 4).map((p) => p.name);
  return `${names.join(', ')}${people.length > 4 ? ` и ещё ${people.length - 4}` : ''}`;
}

export interface AppStore {
  state: AppState;
  stats: Stats;
  leaders: Participant[];
  followers: Participant[];
  activePeople: Participant[];
  pendingErrors: string[];
  generate: () => void;
  confirm: () => void;
  undo: () => void;
  discard: () => void;
  editPending: (round: Round) => void;
  addPerson: (name: string, role: Role) => boolean;
  addPeople: (names: string[], role: Role) => number;
  renamePerson: (id: string, name: string) => void;
  setStatus: (id: string, status: ParticipantStatus) => void;
  setRole: (id: string, role: Role) => void;
  removePerson: (id: string) => void;
  replaceState: (next: AppState, message?: string) => void;
  newEvening: (allActive: boolean) => void;
  clearAll: () => void;
}

export function useAppStore(notify: Notify): AppStore {
  const [state, setState] = useState<AppState>(loadState);
  const storageFailedRef = useRef(false);

  const stats = useMemo(() => computeStats(state), [state]);

  const leaders = useMemo(
    () => state.participants.filter((p) => p.status === 'active' && p.role === 'leader'),
    [state.participants],
  );
  const followers = useMemo(
    () => state.participants.filter((p) => p.status === 'active' && p.role === 'follower'),
    [state.participants],
  );
  const activePeople = useMemo(
    () => state.participants.filter((p) => p.status === 'active'),
    [state.participants],
  );
  const pendingErrors = useMemo(
    () => (state.pending ? validateRound(state, state.pending) : []),
    [state],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPayload(state)));
      storageFailedRef.current = false;
    } catch (error) {
      if (!storageFailedRef.current) {
        storageFailedRef.current = true;
        notify('Не удалось сохранить данные на устройстве. Проверьте свободное место.', 'error');
      }
      console.warn('Не удалось сохранить состояние', error);
    }
  }, [state, notify]);

  const announceRoster = useCallback(
    (result: RosterChange) => {
      setState(result.state);
      if (result.pendingDiscarded) {
        notify('Черновик раунда отменён: изменился состав', 'warn');
      }
      if (result.completed.length > 0) {
        notify(`Круг завершён: ${namesLabel(result.completed)}`, 'info');
      }
    },
    [notify],
  );

  const generate = useCallback(() => {
    const round = generateRound(state);
    setState(setPending(state, round));
    if (round.pairs.length === 0) {
      notify(round.warnings[0] ?? 'Не удалось составить пары', 'warn');
    }
  }, [state, notify]);

  const confirm = useCallback(() => {
    const pending = state.pending;
    if (!pending) return;
    if (pending.pairs.length === 0) {
      notify('В раунде нет пар — добавьте участников или верните их в состав.', 'warn');
      return;
    }
    const errors = validateRound(state, pending);
    if (errors.length > 0) {
      notify(errors[0], 'error');
      return;
    }
    const result = confirmRound(state, pending);
    setState(result.state);
    notify(`Раунд ${pending.number} подтверждён`, 'success');
    if (result.completed.length > 0) {
      notify(`Круг завершён: ${namesLabel(result.completed)}`, 'info');
    }
  }, [state, notify]);

  const undo = useCallback(() => {
    if (!state.undo) {
      notify('Пока нечего отменять', 'info');
      return;
    }
    setState(undoLastRound(state));
    notify('Последний раунд отменён', 'info');
  }, [state, notify]);

  const discard = useCallback(() => {
    if (!state.pending) return;
    setState(discardPending(state));
  }, [state]);

  const editPending = useCallback(
    (round: Round) => {
      setState(setPending(state, { ...round, confirmedAt: null }));
    },
    [state],
  );

  const addPerson = useCallback(
    (name: string, role: Role): boolean => {
      if (!name.trim()) {
        notify('Введите имя участника', 'warn');
        return false;
      }
      const result = addParticipant(state, name, role);
      if (result.state === state) return false;
      announceRoster(result);
      return true;
    },
    [state, notify, announceRoster],
  );

  const addPeople = useCallback(
    (names: string[], role: Role): number => {
      const cleaned = names.map((name) => name.trim()).filter(Boolean);
      if (cleaned.length === 0) {
        notify('Добавьте хотя бы одно имя', 'warn');
        return 0;
      }
      const result = addParticipants(state, cleaned, role);
      announceRoster(result);
      return cleaned.length;
    },
    [state, notify, announceRoster],
  );

  const renamePerson = useCallback(
    (id: string, name: string) => {
      if (!name.trim()) {
        notify('Имя не может быть пустым', 'warn');
        return;
      }
      setState(renameParticipant(state, id, name));
    },
    [state, notify],
  );

  const setStatus = useCallback(
    (id: string, status: ParticipantStatus) => {
      const result = setParticipantStatus(state, id, status);
      if (result.state !== state) announceRoster(result);
    },
    [state, announceRoster],
  );

  const setRole = useCallback(
    (id: string, role: Role) => {
      const person = state.participants.find((p) => p.id === id);
      if (!person || person.role === role) return;
      const result = setParticipantRole(state, id, role);
      announceRoster(result);
      notify(`Роль изменена, круг участника сброшен.`, 'info');
    },
    [state, announceRoster, notify],
  );

  const removePerson = useCallback(
    (id: string) => {
      const person = state.participants.find((p) => p.id === id);
      if (!person) return;
      const result = deleteParticipant(state, id);
      announceRoster(result);
      notify(`Удалён(а): ${person.name}`, 'info');
    },
    [state, announceRoster, notify],
  );

  const replaceState = useCallback(
    (next: AppState, message?: string) => {
      setState(next);
      notify(message ?? 'Данные загружены', 'success');
    },
    [notify],
  );

  const newEvening = useCallback(
    (allActive: boolean) => {
      setState(startNewEvening(state, allActive));
      notify('Новый вечер начат', 'success');
    },
    [state, notify],
  );

  const clearAll = useCallback(() => {
    setState(emptyAppState());
    notify('Все данные удалены', 'info');
  }, [notify]);

  return {
    state,
    stats,
    leaders,
    followers,
    activePeople,
    pendingErrors,
    generate,
    confirm,
    undo,
    discard,
    editPending,
    addPerson,
    addPeople,
    renamePerson,
    setStatus,
    setRole,
    removePerson,
    replaceState,
    newEvening,
    clearAll,
  };
}
