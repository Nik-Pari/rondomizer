import { useEffect, useMemo, useRef } from 'react';
import type { Participant, Round } from '../core/types';
import { useWakeLock } from '../hooks';
import { IconX } from './Icons';

interface PresentationProps {
  round: Round;
  participants: Participant[];
  onClose: () => void;
}

export function Presentation({ round, participants, onClose }: PresentationProps) {
  useWakeLock(true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
      if (previousFocus && document.body.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);
  const names = useMemo(
    () => new Map(participants.map((participant) => [participant.id, participant.name])),
    [participants],
  );

  return (
    <div className="presentation" role="dialog" aria-modal="true" aria-label={`Раунд ${round.number}`}>
      <div className="presentation-head">
        <div className="presentation-round">
          <span>Раунд</span>
          <strong>{round.number}</strong>
          {round.confirmedAt === null ? <em>черновик</em> : null}
        </div>
        <button
          type="button"
          className="presentation-close"
          ref={closeRef}
          onClick={onClose}
          aria-label="Закрыть экран"
        >
          <IconX size={28} />
        </button>
      </div>

      {round.pairs.length === 0 ? (
        <div className="presentation-empty">Пока нет пар</div>
      ) : (
        <div className={round.pairs.length > 12 ? 'presentation-list dense' : 'presentation-list'}>
          {round.pairs.map((pair, index) => (
            <div className="presentation-pair" key={`${pair.leaderId}-${pair.followerId}`}>
              <span className="presentation-num">{index + 1}</span>
              <span className="presentation-name leader">{names.get(pair.leaderId) ?? '—'}</span>
              <span className="presentation-x">×</span>
              <span className="presentation-name follower">{names.get(pair.followerId) ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {round.skipIds.length > 0 ? (
        <div className="presentation-skips">
          <span className="presentation-skips-label">Пропускают</span>
          <div className="presentation-skip-list">
            {round.skipIds.map((id) => (
              <span key={id}>{names.get(id) ?? '—'}</span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
