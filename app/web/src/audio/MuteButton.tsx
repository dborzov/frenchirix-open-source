// The mute switch: one tap silences everything the app plays, another brings it back.
// Remembered on the device. In the shell's top bar (ShellCounters) and in the practice header.
import { t } from '../../../shared/i18n';
import { fx } from '../fx';
import { IconButton } from '../ui';
import { audio, useMuted } from './index';

export function MuteButton({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const muted = useMuted();
  return (
    <IconButton
      icon={muted ? 'mute' : 'speaker'}
      label={muted ? t('scene.sound.unmute') : t('scene.sound.mute')}
      color={muted ? 'tomato' : 'white'}
      size={size}
      aria-pressed={muted}
      data-mute={muted ? 'on' : 'off'}
      onClick={(e) => {
        fx.pop(e.currentTarget);
        audio.setMuted(!muted);
        if (muted) audio.sfx('pop'); // a little "I'm back"
      }}
    />
  );
}
