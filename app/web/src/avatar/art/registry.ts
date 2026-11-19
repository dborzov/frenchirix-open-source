// Every item's art, by item id (or Item.art). Adding an item: add its entry to the file of its slot.
import type { ItemArtDef } from './kit';
import { BACK_ART } from './items/back';
import { BACKGROUND_ART } from './items/backgrounds';
import { BOTTOM_ART } from './items/bottoms';
import { FACE_ART } from './items/face';
import { FEET_ART } from './items/feet';
import { HAIR_ART } from './items/hair';
import { HAT_ART } from './items/hats';
import { HELD_ART } from './items/held';
import { PET_ART } from './items/pets';
import { TOP_ART } from './items/tops';

export const ITEM_ART: Readonly<Record<string, ItemArtDef>> = {
  ...HAT_ART,
  ...HAIR_ART,
  ...FACE_ART,
  ...TOP_ART,
  ...BOTTOM_ART,
  ...FEET_ART,
  ...HELD_ART,
  ...BACK_ART,
  ...PET_ART,
  ...BACKGROUND_ART,
};
