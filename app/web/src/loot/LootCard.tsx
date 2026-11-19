// One piece of loot as a card: coins, XP, a potion, a chest, or an item shown on the kid's avatar.
import type { CSSProperties } from 'react';
import type { Avatar as AvatarData } from '../../../shared/catalog';
import { ITEMS_BY_ID } from '../../../shared/catalog';
import { getLanguage, t } from '../../../shared/i18n';
import { ItemIcon } from '../avatar';
import { colorVars, cx, Icon, type BlockColor } from '../ui';
import { ChestArt } from './ChestArt';
import { RARITY_COLOR, type LootPiece } from './pieces';
import s from './loot.module.css';

/** The kid's avatar wearing one more item (for previews in the chest and the shop). */
export function wearing(avatar: AvatarData, itemId: string): AvatarData {
  const item = ITEMS_BY_ID.get(itemId);
  if (!item) return avatar;
  return { ...avatar, worn: { ...avatar.worn, [item.slot]: itemId } };
}

export function pieceColor(p: LootPiece): BlockColor {
  switch (p.kind) {
    case 'sesterces':
      return 'yellow';
    case 'xp':
      return 'lime';
    case 'potions':
      return 'pink';
    case 'chest':
      return 'tomato';
    case 'item':
      return RARITY_COLOR[p.rarity];
  }
}

export function LootCard({ piece, avatar, big = false, className, style }: { piece: LootPiece; avatar: AvatarData; big?: boolean; className?: string; style?: CSSProperties }) {
  const color = pieceColor(piece);
  const iconSize = big ? 96 : 48;
  let art;
  let title: string;
  let sub: string | null = null;
  switch (piece.kind) {
    case 'sesterces':
      art = <Icon name="coin" size={iconSize} />;
      title = `+${piece.n}`;
      sub = t('common.sesterces');
      break;
    case 'xp':
      art = <Icon name="xp" size={iconSize} />;
      title = `+${piece.n}`;
      sub = 'XP';
      break;
    case 'potions':
      art = <Icon name="potion" size={iconSize} />;
      title = `+${piece.n}`;
      sub = t('chest.potion', { n: piece.n });
      break;
    case 'chest':
      art = <ChestArt kind={piece.chest} size={iconSize * 1.2} />;
      title = t(`chest.kind.${piece.chest}` as const);
      break;
    case 'item': {
      const item = ITEMS_BY_ID.get(piece.itemId);
      art = <ItemIcon itemId={piece.itemId} size={big ? 150 : 64} />;
      title = item ? item.name[getLanguage()] : piece.itemId;
      sub = item ? item.joke[getLanguage()] : null;
      break;
    }
  }
  return (
    <div className={cx(s.lootCard, big && s.lootBig, piece.kind === 'item' && s[`r_${piece.rarity}`], className)} style={{ ...colorVars(color), ...style }}>
      {piece.kind === 'item' && <span className={s.rarity}>{t(`chest.rarity.${piece.rarity}` as const)}</span>}
      <div className={s.lootArt}>{art}</div>
      <div className={s.lootTitle}>{title}</div>
      {sub && <div className={s.lootSub}>{sub}</div>}
    </div>
  );
}
