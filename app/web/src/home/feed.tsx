// A friend's milestone as one short line, shared by Home's news strip and the Friends screen.
import type { FeedItem } from '../../../shared/api';
import { ACHIEVEMENTS_BY_ID } from '../../../shared/catalog';
import { getLanguage, t } from '../../../shared/i18n';
import type { IconName } from '../ui';

export function feedText(item: FeedItem): string {
  const name = item.user.name;
  switch (item.kind) {
    case 'level':
      return t('social.feed.level', { name, level: t(`common.level.${item.level ?? 1}` as const) });
    case 'streak':
      return t('social.feed.streak', { name, n: item.count ?? 0 });
    case 'achievement': {
      const a = item.achievementId ? ACHIEVEMENTS_BY_ID.get(item.achievementId) : undefined;
      return t('social.feed.achievement', { name, what: a ? a.name[getLanguage()] : '?' });
    }
    case 'rank':
      return t('social.feed.rank', { name, n: item.count ?? 0 });
    case 'unlock':
      return t('social.feed.unlock', { name, n: item.count ?? 1 });
  }
}

export function feedIcon(item: FeedItem): IconName {
  switch (item.kind) {
    case 'level':
      return 'star';
    case 'streak':
      return 'flame';
    case 'achievement':
      return 'trophy';
    case 'rank':
      return 'xp';
    case 'unlock':
      return 'unlock';
  }
}
