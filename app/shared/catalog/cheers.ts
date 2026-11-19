// Cheers: the fixed stickers friends send each other (no free text). Ids are stored in inboxes:
// never rename or remove one. `art` names a sticker drawn in web/src/avatar/CheerSticker.tsx.
import type { Cheer } from './types';

export const CHEERS: Cheer[] = [
  { id: 'bravo', name: { fr: 'Bravo !', en: 'Well done!' }, art: 'star', color: 'unit-5' },
  { id: 'par-toutatis', name: { fr: 'Par Toutatis !', en: 'By Toutatis!' }, art: 'lightning', color: 'unit-1' },
  { id: 'menhir', name: { fr: 'Solide comme un menhir', en: 'Solid as a menhir' }, art: 'menhir', color: 'unit-4' },
  { id: 'chef', name: { fr: 'Tu es un chef !', en: 'You are a chief!' }, art: 'crown', color: 'unit-6' },
  { id: 'reviens', name: { fr: 'Reviens jouer !', en: 'Come back and play!' }, art: 'wave', color: 'unit-5' },
  { id: 'super', name: { fr: 'Super !', en: 'Super!' }, art: 'thumb', color: 'unit-3' },
  { id: 'potion', name: { fr: 'Tu as bu la potion ?', en: 'Did you drink the potion?' }, art: 'cauldron', color: 'unit-4' },
  { id: 'sanglier', name: { fr: 'Un sanglier pour toi !', en: 'A roast boar for you!' }, art: 'boar', color: 'unit-5' },
  { id: 'courage', name: { fr: 'Courage !', en: 'Keep going!' }, art: 'muscle', color: 'unit-1' },
  { id: 'fous', name: { fr: 'Ils sont fous, ces Romains !', en: 'These Romans are crazy!' }, art: 'helmet', color: 'unit-2' },
  { id: 'merci', name: { fr: 'Merci !', en: 'Thank you!' }, art: 'heart', color: 'unit-6' },
  { id: 'a-demain', name: { fr: 'À demain !', en: 'See you tomorrow!' }, art: 'moon', color: 'unit-3' },
];

export const CHEERS_BY_ID: ReadonlyMap<string, Cheer> = new Map(CHEERS.map((c) => [c.id, c]));
