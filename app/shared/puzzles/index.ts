// The one place puzzle type logic is registered. Import this module once (the composer, the checks and the
// client do) and every puzzle type below is in the registry. A new puzzle type adds one import and one
// registerPuzzleType line here; nothing else in the composer or the checks needs to change.

import { registerPuzzleType } from '../practice/registry';
import { fillBlanks } from './fill-blanks';
import { listenPick } from './listen-pick';
import { match } from './match';
import { question } from './question';
import { sayHidden } from './say-hidden';
import { sayLine } from './say-line';
import { actLine } from './act-line';
import { sayChain } from './say-chain';
import { sayChoice } from './say-choice';
import { watch } from './watch';
import { catapult } from './catapult';
import { comicOrder } from './comic-order';
import { memory } from './memory';
import { rebuild } from './rebuild';
import { vraiFaux } from './vrai-faux';
import { lineMeaning } from './line-meaning';
import { nextLine } from './next-line';
import { placeWords } from './place-words';

registerPuzzleType(watch);
registerPuzzleType(listenPick);
registerPuzzleType(match);
registerPuzzleType(fillBlanks);
registerPuzzleType(sayLine);
registerPuzzleType(sayHidden);
registerPuzzleType(actLine);
registerPuzzleType(sayChain);
registerPuzzleType(sayChoice);
registerPuzzleType(question);
registerPuzzleType(rebuild);
registerPuzzleType(comicOrder);
registerPuzzleType(catapult);
registerPuzzleType(vraiFaux);
registerPuzzleType(memory);
registerPuzzleType(placeWords);
registerPuzzleType(nextLine);
registerPuzzleType(lineMeaning);
