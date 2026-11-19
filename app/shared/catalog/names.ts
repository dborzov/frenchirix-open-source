// Funny generated names for new kids: a French animal or object plus an adjective that agrees with it
// in gender ('sanglier-grognon', 'chèvre-grognonne'). Used by the server when it creates an account;
// the kid can pick their own name later. Every combination fits NAME_MAX and passes checkName.

import { NAME_MAX } from '../rules';

type Gender = 'm' | 'f';

/** [noun, gender]. Animals, food and objects from the show's world and a kid's sense of humour. */
export const NAME_NOUNS: readonly (readonly [string, Gender])[] = [
  ['sanglier', 'm'], ['menhir', 'm'], ['chinchilla', 'm'], ['druide', 'm'], ['barde', 'm'],
  ['poisson', 'm'], ['chaudron', 'm'], ['casque', 'm'], ['bouclier', 'm'], ['centurion', 'm'],
  ['cochon', 'm'], ['lapin', 'm'], ['hibou', 'm'], ['castor', 'm'], ['hérisson', 'm'],
  ['escargot', 'm'], ['crapaud', 'm'], ['poulet', 'm'], ['coq', 'm'], ['mouton', 'm'],
  ['chameau', 'm'], ['éléphant', 'm'], ['crocodile', 'm'], ['pingouin', 'm'], ['perroquet', 'm'],
  ['blaireau', 'm'], ['chat', 'm'], ['renard', 'm'], ['ours', 'm'], ['dauphin', 'm'],
  ['homard', 'm'], ['poireau', 'm'], ['navet', 'm'], ['fromage', 'm'], ['saucisson', 'm'],
  ['radis', 'm'], ['potiron', 'm'], ['cornichon', 'm'], ['tonneau', 'm'], ['parchemin', 'm'],
  ['chèvre', 'f'], ['vache', 'f'], ['poule', 'f'], ['grenouille', 'f'], ['souris', 'f'],
  ['tortue', 'f'], ['girafe', 'f'], ['baleine', 'f'], ['fourmi', 'f'], ['abeille', 'f'],
  ['chouette', 'f'], ['marmite', 'f'], ['potion', 'f'], ['catapulte', 'f'], ['amphore', 'f'],
  ['toge', 'f'], ['sandale', 'f'], ['galère', 'f'], ['lyre', 'f'], ['trompette', 'f'],
  ['saucisse', 'f'], ['carotte', 'f'], ['citrouille', 'f'], ['crêpe', 'f'], ['banane', 'f'],
  ['sardine', 'f'], ['licorne', 'f'], ['coccinelle', 'f'], ['autruche', 'f'], ['taupe', 'f'],
  ['mouette', 'f'], ['cigale', 'f'], ['belette', 'f'], ['pomme', 'f'], ['moule', 'f'],
];

/** [masculine, feminine]. */
export const NAME_ADJECTIVES: readonly (readonly [string, string])[] = [
  ['grognon', 'grognonne'], ['chatouilleux', 'chatouilleuse'], ['rigolo', 'rigolote'], ['farceur', 'farceuse'],
  ['distrait', 'distraite'], ['bavard', 'bavarde'], ['dansant', 'dansante'], ['rieur', 'rieuse'],
  ['gourmand', 'gourmande'], ['endormi', 'endormie'], ['ronchon', 'ronchonne'], ['joyeux', 'joyeuse'],
  ['timide', 'timide'], ['poilu', 'poilue'], ['volant', 'volante'], ['têtu', 'têtue'],
  ['malin', 'maligne'], ['magique', 'magique'], ['costaud', 'costaude'], ['minuscule', 'minuscule'],
  ['géant', 'géante'], ['pressé', 'pressée'], ['perdu', 'perdue'], ['curieux', 'curieuse'],
  ['peureux', 'peureuse'], ['courageux', 'courageuse'], ['frisé', 'frisée'], ['chantant', 'chantante'],
  ['sautillant', 'sautillante'], ['ébouriffé', 'ébouriffée'], ['enrhumé', 'enrhumée'], ['affamé', 'affamée'],
  ['étourdi', 'étourdie'], ['rêveur', 'rêveuse'], ['siffleur', 'siffleuse'], ['boudeur', 'boudeuse'],
  ['coquin', 'coquine'], ['gentil', 'gentille'], ['poli', 'polie'], ['rapide', 'rapide'],
  ['mouillé', 'mouillée'], ['pétillant', 'pétillante'], ['élégant', 'élégante'], ['fier', 'fière'],
  ['zinzin', 'zinzin'], ['loufoque', 'loufoque'], ['farfelu', 'farfelue'], ['toqué', 'toquée'],
  ['dodu', 'dodue'], ['moustachu', 'moustachue'], ['barbu', 'barbue'], ['chevelu', 'chevelue'],
  ['intrépide', 'intrépide'], ['espiègle', 'espiègle'], ['grincheux', 'grincheuse'], ['gaffeur', 'gaffeuse'],
  ['ronfleur', 'ronfleuse'], ['glouton', 'gloutonne'], ['frileux', 'frileuse'], ['radieux', 'radieuse'],
  ['hilare', 'hilare'], ['étonné', 'étonnée'], ['majestueux', 'majestueuse'], ['sonore', 'sonore'],
];

/** The name for noun i and adjective j, or null when it would be longer than NAME_MAX. */
export function nameAt(i: number, j: number): string | null {
  const noun = NAME_NOUNS[i];
  const adj = NAME_ADJECTIVES[j];
  if (!noun || !adj) return null;
  const name = `${noun[0]}-${noun[1] === 'm' ? adj[0] : adj[1]}`;
  return [...name].length <= NAME_MAX ? name : null;
}

/** A random funny name. `random` returns floats in [0, 1) (Math.random by default). */
export function randomName(random: () => number = Math.random): string {
  for (;;) {
    const name = nameAt(Math.floor(random() * NAME_NOUNS.length), Math.floor(random() * NAME_ADJECTIVES.length));
    if (name) return name;
  }
}
