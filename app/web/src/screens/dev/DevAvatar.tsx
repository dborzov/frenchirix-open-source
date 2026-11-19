// OWNER: the avatar step. /dev/avatar: every item on a neutral character, and random avatars at 32, 64 and 300 px.
import { AVATAR_BASE_OPTIONS, CHEERS, DEFAULT_AVATAR, ITEMS, randomAvatar, type Avatar as AvatarData } from '../../../../shared/catalog';
import { Avatar } from '../../avatar/Avatar';
import { CheerSticker } from '../../avatar/CheerSticker';
import { ItemIcon } from '../../avatar/ItemIcon';

const ALL = ITEMS.map((i) => i.id);
const NEUTRAL: AvatarData = { v: 1, base: { ...DEFAULT_AVATAR.base, bgColor: 'lime' }, worn: { top: 'red-tunic', bottom: 'brown-trousers', feet: 'sandals' } };

export default function DevAvatarScreen() {
  const q = new URLSearchParams(location.search);
  const part = q.get('part') ?? 'all';
  const ids = q.get('ids')?.split(',');
  if (ids) {
    const n = Number(q.get('size') ?? 300);
    return (
      <div style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 12, background: '#fff3d0' }}>
        {ids.map((id) => {
          const it = ITEMS.find((i) => i.id === id);
          return it ? <Avatar key={id} avatar={{ ...NEUTRAL, worn: { ...NEUTRAL.worn, [it.slot]: id } }} size={n} animate={false} /> : null;
        })}
      </div>
    );
  }
  const randoms = Array.from({ length: 20 }, (_, i) => randomAvatar(`dev${i}`, ALL));
  return (
    <div style={{ padding: 16, display: 'grid', gap: 24, background: '#fff3d0' }}>
      {(part === 'all' || part === 'items') && (
        <section>
          <h2>Items ({ITEMS.length})</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ITEMS.map((it) => (
              <figure key={it.id} style={{ margin: 0, width: 128, fontSize: 11, textAlign: 'center' }}>
                <Avatar avatar={{ ...NEUTRAL, worn: { ...NEUTRAL.worn, [it.slot]: it.id } }} size={128} animate={false} />
                <figcaption>{it.id}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      {(part === 'all' || part === 'icons') && (
        <section>
          <h2>Item icons (64 px, and locked)</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ITEMS.map((it) => (
              <div key={it.id} style={{ border: '3px solid #111', background: '#fff', lineHeight: 0 }} title={it.id}>
                <ItemIcon itemId={it.id} size={64} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {ITEMS.slice(0, 16).map((it) => (
              <ItemIcon key={it.id} itemId={it.id} size={40} silhouette />
            ))}
          </div>
          <h2>Cheers</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {CHEERS.map((c) => (
              <figure key={c.id} style={{ margin: 0, textAlign: 'center', width: 110 }}>
                <CheerSticker cheerId={c.id} size={96} />
                <figcaption style={{ fontWeight: 700 }}>{c.name.fr}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      {(part === 'all' || part === 'base') && (
        <section>
          <h2>Hair x headwear</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {AVATAR_BASE_OPTIONS.hair.flatMap((hair) =>
              [undefined, 'winged-helmet', 'legionary-helmet', 'woolly-hat'].map((hat) => (
                <Avatar key={hair + hat} avatar={{ ...NEUTRAL, base: { ...NEUTRAL.base, hair, hairColor: 'ginger' }, worn: { ...NEUTRAL.worn, ...(hat ? { hat } : {}) } }} size={110} animate={false} />
              )),
            )}
          </div>
          <h2>Faces</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {AVATAR_BASE_OPTIONS.facialHair.map((facialHair, i) => (
              <Avatar
                key={facialHair}
                avatar={{ ...NEUTRAL, base: { ...NEUTRAL.base, facialHair, eyes: AVATAR_BASE_OPTIONS.eyes[i % 6]!, mouth: AVATAR_BASE_OPTIONS.mouth[i % 6]!, brows: AVATAR_BASE_OPTIONS.brows[i % 5]!, skin: AVATAR_BASE_OPTIONS.skin[i]! } }}
                size={130}
                framing="bust"
                animate={false}
              />
            ))}
          </div>
        </section>
      )}
      {(part === 'all' || part === 'random') && (
        <section>
          <h2>Random avatars</h2>
          {[32, 64].map((n) => (
            <div key={n} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {randoms.map((a, i) => (
                <Avatar key={i} avatar={a} size={n} />
              ))}
            </div>
          ))}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {randoms.map((a, i) => (
              <Avatar key={i} avatar={a} size={300} animate={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
