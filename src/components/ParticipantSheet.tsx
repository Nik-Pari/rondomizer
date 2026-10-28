import { useEffect, useState } from 'react';
import type { Participant, ParticipantStats, ParticipantStatus, Role } from '../core/types';
import { ROLE_LABEL, ROLE_LABEL_PLURAL, STATUS_LABEL } from '../core/types';
import { plural } from '../utils';
import { useUi } from '../ui';
import { Modal } from './Modal';
import { IconTrash } from './Icons';

interface ParticipantSheetProps {
  participant: Participant;
  stats: ParticipantStats | undefined;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onStatus: (id: string, status: ParticipantStatus) => void;
  onRole: (id: string, role: Role) => void;
  onDelete: (id: string) => void;
}

export function ParticipantSheet({
  participant,
  stats,
  onClose,
  onRename,
  onStatus,
  onRole,
  onDelete,
}: ParticipantSheetProps) {
  const { confirm } = useUi();
  const [name, setName] = useState(participant.name);

  useEffect(() => {
    setName(participant.name);
  }, [participant.id, participant.name]);

  const progress = stats && stats.circleTotal > 0 ? Math.round((stats.circleMet / stats.circleTotal) * 100) : 0;
  const dirty = name.trim() !== participant.name && name.trim().length > 0;

  const changeRole = async (role: Role) => {
    if (role === participant.role) return;
    const ok = await confirm({
      title: `Сменить роль на «${ROLE_LABEL[role]}»?`,
      text: `У участника «${participant.name}» будет сброшен текущий круг. Прошлые танцы останутся в истории, но матрица пар может смешаться по ролям.`,
      confirmLabel: 'Сменить роль',
    });
    if (!ok) return;
    onRole(participant.id, role);
    onClose();
  };

  const changeStatus = async (status: ParticipantStatus) => {
    if (status === participant.status) return;
    if (status === 'left') {
      const ok = await confirm({
        title: 'Убрать из активного состава?',
        text: 'Участник перейдёт в «Ушли». История танцев и статистика сохранятся, участника можно вернуть.',
        confirmLabel: 'Убрать',
      });
      if (!ok) return;
    }
    onStatus(participant.id, status);
    onClose();
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Удалить ${participant.name}?`,
      text: 'Участник исчезнет из списка. История раундов останется, но его имя в прошлых раундах больше не будет отображаться. Лучше использовать статус «Ушёл».',
      confirmLabel: 'Удалить навсегда',
      danger: true,
    });
    if (!ok) return;
    onDelete(participant.id);
    onClose();
  };

  return (
    <Modal
      title={participant.name}
      subtitle={`${ROLE_LABEL[participant.role]} · ${STATUS_LABEL[participant.status]}`}
      onClose={onClose}
    >
      <div className="sheet-stats">
        <div>
          <strong>{stats?.dances ?? 0}</strong>
          <span>{plural(stats?.dances ?? 0, 'танец', 'танца', 'танцев')}</span>
        </div>
        <div>
          <strong>{stats?.skips ?? 0}</strong>
          <span>{plural(stats?.skips ?? 0, 'пропуск', 'пропуска', 'пропусков')}</span>
        </div>
        <div>
          <strong>{stats?.circleNumber ?? 1}-й</strong>
          <span>круг</span>
        </div>
        <div>
          <strong>
            {stats?.circleMet ?? 0}/{stats?.circleTotal ?? 0}
          </strong>
          <span>партнёров</span>
        </div>
      </div>

      <div className="circle-mini">
        <div className="circle-mini-head">
          <span>Круг: встречено партнёров</span>
          <strong>{progress}%</strong>
        </div>
        <div className="progress">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <label className="field">
        <span className="field-label">Имя</span>
        <input
          className="input"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && dirty) {
              onRename(participant.id, name);
            }
          }}
        />
      </label>
      <button
        type="button"
        className="btn btn-block"
        disabled={!dirty}
        onClick={() => onRename(participant.id, name)}
      >
        Сохранить имя
      </button>

      <div className="field">
        <span className="field-label">Роль</span>
        <div className="segmented">
          {(['leader', 'follower'] as Role[]).map((role) => (
            <button
              type="button"
              key={role}
              className={participant.role === role ? 'segment active' : 'segment'}
              onClick={() => void changeRole(role)}
            >
              {ROLE_LABEL_PLURAL[role]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Статус</span>
        <div className="segmented segmented-3">
          {(['active', 'away', 'left'] as ParticipantStatus[]).map((status) => (
            <button
              type="button"
              key={status}
              className={participant.status === status ? 'segment active' : 'segment'}
              onClick={() => void changeStatus(status)}
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="btn btn-danger btn-block" onClick={() => void remove()}>
        <IconTrash size={18} />
        Удалить участника
      </button>
    </Modal>
  );
}
