// OWNER: the shop step (meta agent). Route /shop: items for sesterces by category, potions; try before you buy.
import { useState, type CSSProperties } from 'react';
import { useLocation } from 'wouter';
import type { ShopOffer } from '../../../shared/api';
import { ITEM_SLOTS, ITEMS_BY_ID, type ItemSlot } from '../../../shared/catalog';
import { getLanguage, t } from '../../../shared/i18n';
import { MAX_STREAK_FREEZES } from '../../../shared/rules';
import { api, kindOf } from '../api';
import { Avatar, ItemIcon } from '../avatar';
import { fx } from '../fx';
import { Burst, Caption, CoverTag } from '../home/comic';
import { useAsync } from '../home/hooks';
import { Loading, LoadError, ScreenTitle } from '../home/parts';
import { wearing } from '../loot/LootCard';
import { RARITY_COLOR } from '../loot/pieces';
import { usePlayer, usePlayerState } from '../state/player';
import { actionFailed } from '../state/recover';
import { Button, Chip, cx, Icon, Sheet, toast, useLayout } from '../ui';
import s from './Shop.module.css';

export default function ShopScreen() {
  const st = usePlayerState();
  const layout = useLayout();
  const [, navigate] = useLocation();
  const shop = useAsync(() => api.shop());
  const [slot, setSlot] = useState<ItemSlot | 'all'>('all');
  const [open, setOpen] = useState<ShopOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const money = st.currencies.sesterces;

  if (shop.error) return <LoadError error={shop.error} onRetry={shop.reload} />;
  if (!shop.data) return <Loading />;
  const offers = shop.data.offers.filter((o) => ITEMS_BY_ID.has(o.itemId));
  const slots = ITEM_SLOTS.filter((sl) => offers.some((o) => ITEMS_BY_ID.get(o.itemId)!.slot === sl));
  const shown = offers.filter((o) => slot === 'all' || ITEMS_BY_ID.get(o.itemId)!.slot === slot).sort((a, b) => Number(b.featured) - Number(a.featured) || a.price - b.price);

  const buy = async (req: { itemId: string } | { potion: true }) => {
    setBusy(true);
    try {
      const res = await api.buy(req);
      usePlayer.getState().apply(res.patch);
      fx.sfx('coin');
      fx.confetti({ count: 60 });
      toast(t('shop.bought'), { color: 'green', icon: 'check', tag: 'bought' });
      setOpen(null);
      shop.reload();
    } catch (e) {
      fx.sfx('wrong');
      actionFailed(e);
      // Already owned, not enough sesterces, potions full: the shop as the server sees it now.
      if (kindOf(e) === 'stale') {
        setOpen(null);
        shop.reload();
      }
    } finally {
      setBusy(false);
    }
  };

  const potions = st.currencies.potions;
  const potionPrice = shop.data.potionPrice;

  return (
    <div className={cx(s.page, layout === 'tablet' && s.tablet)} data-testid="shop">
      <ScreenTitle icon="shop" color="accent" right={<CoverTag color="yellow"><Icon name="coin" size={22} /> {money}</CoverTag>}>
        {t('shop.title')}
      </ScreenTitle>

      <section className={s.potion}>
        <div className={s.potionArt}>
          <Icon name="potion" size={64} />
        </div>
        <div className={s.potionText}>
          <Caption as="h2" color="white">
            {t('shop.potion.title')}
          </Caption>
          <p>{t('shop.potion.text')}</p>
          <div className={s.potionHeld}>
            {Array.from({ length: MAX_STREAK_FREEZES }, (_, i) => (
              <span key={i} className={cx(s.potionSlot, i < potions && s.potionFull)}>
                <Icon name="potion" size={22} />
              </span>
            ))}
            <span>{t('shop.potion.held', { n: potions, max: MAX_STREAK_FREEZES })}</span>
          </div>
        </div>
        {potionPrice === null ? (
          <span className={s.full}>{t('shop.potion.full')}</span>
        ) : (
          <Button color="yellow" icon="coin" onClick={() => void buy({ potion: true })} disabled={busy || money < potionPrice} className={s.potionBuy}>
            {potionPrice}
          </Button>
        )}
      </section>

      <div className={s.chips} role="tablist">
        <Chip selected={slot === 'all'} onClick={() => setSlot('all')}>
          {t('shop.slot.all')}
        </Chip>
        {slots.map((sl) => (
          <Chip key={sl} selected={slot === sl} onClick={() => setSlot(sl)} style={{ whiteSpace: 'nowrap', flex: 'none' }}>
            {t(`shop.slot.${sl}` as const)}
          </Chip>
        ))}
      </div>

      <div className={s.grid}>
        {shown.map((o, i) => {
          const item = ITEMS_BY_ID.get(o.itemId)!;
          return (
            <button key={o.itemId} type="button" className={s.tile} style={{ '--i': i, '--rar': `var(--${RARITY_COLOR[item.rarity]})` } as CSSProperties} onClick={() => setOpen(o)} data-item={o.itemId}>
              {o.featured && (
                <span className={s.featured}>
                  <Burst word={t('shop.special')} size={74} color="yellow" seed={i + 3} animate={false} />
                </span>
              )}
              <span className={s.tileArt}>
                <ItemIcon itemId={o.itemId} size={layout === 'tablet' ? 104 : 90} />
              </span>
              <span className={s.tileName}>{item.name[getLanguage()]}</span>
              {o.owned > 0 ? (
                <span className={s.owned}>{t('shop.owned')}</span>
              ) : (
                <span className={cx(s.price, money < o.price && s.priceShort)}>
                  <Icon name="coin" size={18} /> {o.price}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className={s.refresh}>{t('shop.refresh')}</p>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? ITEMS_BY_ID.get(open.itemId)?.name[getLanguage()] : undefined} color="yellow">
        {open && (() => {
          const item = ITEMS_BY_ID.get(open.itemId)!;
          const short = money < open.price;
          return (
            <div className={s.sheet}>
              <div className={s.preview}>
                <Avatar avatar={wearing(st.profile.avatar, open.itemId)} size={180} />
                <CoverTag className={s.rarity} color={RARITY_COLOR[item.rarity]} tilt={-5}>
                  {t(`chest.rarity.${item.rarity}` as const)}
                </CoverTag>
              </div>
              <p className={s.joke}>{item.joke[getLanguage()]}</p>
              {open.owned > 0 ? (
                <Button color="purple" size="lg" icon="profile" onClick={() => navigate('/avatar')}>
                  {t('chest.wear')}
                </Button>
              ) : (
                <>
                  <Button color="green" size="lg" icon="coin" onClick={() => void buy({ itemId: open.itemId })} disabled={short || busy} loading={busy} data-buy>
                    {t('shop.buy', { n: open.price })}
                  </Button>
                  {short && <p className={s.short}>{t('shop.short', { n: open.price - money })}</p>}
                </>
              )}
            </div>
          );
        })()}
      </Sheet>
    </div>
  );
}
