// Avatar items: what drops from loot boxes, what the shop sells, what achievements give.
// Ids are stored in inventories: never rename or remove one. Adding an item is adding an entry here
// and its art in web/src/avatar/art/ (a test checks every item has art).
//
// Prices fit what a kid earns (shared/rules.ts: about 5-13 sesterces a practice, more from chests):
// common 40-60, rare 100-150, epic 250-350, legendary 600+.
import type { ChestKind } from '../rules';
import type { Item, ItemSlot, ItemSource, Localized, Rarity } from './types';

const starter: ItemSource = { kind: 'starter' };
const shop: ItemSource = { kind: 'shop' };
const chest = (...chests: ChestKind[]): ItemSource => ({ kind: 'chest', chests });
const ach = (achievementId: string): ItemSource => ({ kind: 'achievement', achievementId });

/** Chests an item of a rarity can drop from, by default. */
const DROPS: Record<Rarity, ChestKind[]> = {
  common: ['wood', 'silver', 'gold'],
  rare: ['wood', 'silver', 'gold'],
  epic: ['silver', 'gold'],
  legendary: ['gold'],
};
const drop = (r: Rarity) => chest(...DROPS[r]);

function it(
  id: string,
  slot: ItemSlot,
  rarity: Rarity,
  sources: ItemSource[],
  price: number | null,
  name: [fr: string, en: string],
  joke: [fr: string, en: string],
): Item {
  const loc = ([fr, en]: [string, string]): Localized => ({ fr, en });
  return { id, slot, rarity, sources, price, name: loc(name), joke: loc(joke) };
}

export const ITEMS: Item[] = [
  // --- Hats and helmets ------------------------------------------------------------------------
  it('winged-helmet', 'hat', 'common', [starter], null, ['Casque à ailes', 'Winged helmet'], [
    'Les ailes ne font pas voler. On a essayé. Trois fois.',
    'The wings do not make you fly. We tried. Three times.',
  ]),
  it('woolly-hat', 'hat', 'common', [starter], null, ['Bonnet de laine', 'Woolly hat'], [
    'Tricoté par mamie avec la laine d’un mouton très fâché.',
    'Knitted by grandma with wool from a very grumpy sheep.',
  ]),
  it('horned-helmet', 'hat', 'common', [drop('common'), shop], 50, ['Casque à cornes', 'Horned helmet'], [
    'Attention aux portes basses.',
    'Mind the low doorways.',
  ]),
  it('flower-crown', 'hat', 'common', [shop, drop('common')], 40, ['Couronne de fleurs', 'Flower crown'], [
    'Sent bon le printemps. Attire aussi les abeilles.',
    'Smells like spring. Also attracts bees.',
  ]),
  it('cauldron-helmet', 'hat', 'common', [ach('chests-10')], null, ['Casque-marmite', 'Cooking-pot helmet'], [
    'Le soir, on fait la soupe dedans.',
    'In the evening, it makes soup.',
  ]),
  it('legionary-helmet', 'hat', 'rare', [drop('rare')], null, ['Casque de légionnaire', 'Legionary’s helmet'], [
    'Un seul propriétaire, très soigneux. Quelques bosses.',
    'One careful owner. A few dents.',
  ]),
  it('laurel-wreath', 'hat', 'rare', [shop], 120, ['Couronne de laurier', 'Laurel wreath'], [
    'Pour les champions. Ou pour assaisonner le ragoût.',
    'For champions. Or for seasoning the stew.',
  ]),
  it('druid-hood', 'hat', 'rare', [ach('lessons-10')], null, ['Capuche de druide', 'Druid’s hood'], [
    'Te donne l’air très sage. Même quand tu manges.',
    'Makes you look very wise. Even while eating.',
  ]),
  it('chef-toque', 'hat', 'rare', [ach('quizzes-30')], null, ['Toque de chef', 'Chef’s hat'], [
    'Spécialité de la maison : le sanglier, le sanglier ou le sanglier.',
    'House special: boar, boar, or boar.',
  ]),
  it('pirate-hat', 'hat', 'rare', [drop('rare'), shop], 140, ['Chapeau de pirate', 'Pirate hat'], [
    'Le bateau, lui, a coulé. Encore.',
    'The ship sank. Again.',
  ]),
  it('earmuffs', 'hat', 'rare', [ach('loops-50')], null, ['Cache-oreilles', 'Earmuffs'], [
    'N’arrête pas la chanson qui tourne dans ta tête.',
    'Does not stop the song stuck in your head.',
  ]),
  it('centurion-helmet', 'hat', 'epic', [drop('epic'), shop], 300, ['Casque de centurion', 'Centurion’s helmet'], [
    'La brosse sur le dessus sert aussi à balayer le camp.',
    'The brush on top also sweeps the camp.',
  ]),
  it('boar-hat', 'hat', 'epic', [ach('streak-14')], null, ['Chapeau sanglier', 'Boar hat'], [
    'Un sanglier en peluche. Personne n’a été mangé.',
    'A plush boar. Nobody got eaten.',
  ]),
  it('propeller-cap', 'hat', 'epic', [shop], 280, ['Casquette à hélice', 'Propeller cap'], [
    'Inventée par un ingénieur romain. Ne marche pas encore.',
    'Invented by a Roman engineer. Does not work yet.',
  ]),
  it('dino-hood', 'hat', 'legendary', [ach('streak-30')], null, ['Capuche de dinosaure', 'Dinosaur hood'], [
    'Les dinosaures ont disparu. Sauf celui-ci.',
    'Dinosaurs died out. Except this one.',
  ]),
  it('golden-laurel', 'hat', 'legendary', [ach('unlock-all')], null, ['Laurier d’or', 'Golden laurel'], [
    'César en voudrait bien une. Trop tard, elle est à toi.',
    'Caesar would love one. Too late, it is yours.',
  ]),

  // --- Hair pieces -----------------------------------------------------------------------------
  it('hair-ribbon', 'hair', 'common', [starter], null, ['Ruban', 'Ribbon'], [
    'Un nœud tout simple. Très chic au banquet.',
    'A simple bow. Very smart at a banquet.',
  ]),
  it('feather-clip', 'hair', 'common', [starter], null, ['Plume', 'Feather'], [
    'Elle vient d’une oie qui ne l’a pas encore remarqué.',
    'It comes from a goose who has not noticed yet.',
  ]),
  it('mistletoe-sprig', 'hair', 'rare', [shop, drop('rare')], 100, ['Brin de gui', 'Sprig of mistletoe'], [
    'Cueilli avec une serpe d’or. Enfin, une serpe jaune.',
    'Picked with a golden sickle. Well, a yellow one.',
  ]),
  it('rainbow-wig', 'hair', 'epic', [drop('epic'), shop], 320, ['Perruque arc-en-ciel', 'Rainbow wig'], [
    'Le druide a mélangé les mauvaises potions.',
    'The druid mixed up the wrong potions.',
  ]),
  it('golden-braids', 'hair', 'epic', [drop('epic')], null, ['Tresses dorées', 'Golden braids'], [
    'Si longues qu’on peut s’en servir comme corde.',
    'So long you can use them as a rope.',
  ]),

  // --- Face: glasses and paint -----------------------------------------------------------------
  it('round-glasses', 'face', 'common', [starter], null, ['Lunettes rondes', 'Round glasses'], [
    'Pour lire les parchemins écrits tout petit.',
    'For reading scrolls with tiny writing.',
  ]),
  it('woad-paint', 'face', 'common', [drop('common')], null, ['Peinture bleue', 'Blue face paint'], [
    'Ça part au lavage. Dans trois semaines.',
    'It washes off. In three weeks.',
  ]),
  it('diving-goggles', 'face', 'common', [drop('common'), shop], 50, ['Lunettes de plongée', 'Diving goggles'], [
    'Pour chercher les pièces au fond de la fontaine.',
    'For finding coins at the bottom of the fountain.',
  ]),
  it('sunglasses', 'face', 'rare', [shop], 110, ['Lunettes de soleil', 'Sunglasses'], [
    'Le soleil de Rome tape fort. Et tu as la classe.',
    'The Roman sun is strong. And you look cool.',
  ]),
  it('monocle', 'face', 'rare', [ach('perfect-10')], null, ['Monocle', 'Monocle'], [
    'Pour avoir l’air très sérieux. Ça ne marche pas.',
    'To look very serious. It does not work.',
  ]),
  it('heart-glasses', 'face', 'rare', [ach('gifts-10')], null, ['Lunettes cœur', 'Heart glasses'], [
    'Tout est plus joli à travers. Même les légionnaires.',
    'Everything looks nicer through them. Even legionaries.',
  ]),
  it('star-glasses', 'face', 'epic', [ach('diamond-1')], null, ['Lunettes étoiles', 'Star glasses'], [
    'Pour les stars du village. Signe des autographes.',
    'For village stars. Sign autographs.',
  ]),
  it('disguise-nose', 'face', 'epic', [drop('epic')], null, ['Faux nez', 'Fake nose'], [
    'Le déguisement parfait pour entrer dans le camp romain.',
    'The perfect disguise to sneak into the Roman camp.',
  ]),

  // --- Tops ------------------------------------------------------------------------------------
  it('red-tunic', 'top', 'common', [starter], null, ['Tunique rouge', 'Red tunic'], [
    'Classique. Cache bien les taches de sauce.',
    'A classic. Hides gravy stains well.',
  ]),
  it('green-tunic', 'top', 'common', [starter], null, ['Tunique verte', 'Green tunic'], [
    'Parfaite pour se cacher dans la forêt.',
    'Perfect for hiding in the forest.',
  ]),
  it('striped-tunic', 'top', 'common', [starter], null, ['Tunique à rayures', 'Striped tunic'], [
    'Les rayures font aller plus vite. C’est prouvé. Par personne.',
    'Stripes make you faster. Proven. By nobody.',
  ]),
  it('banquet-bib', 'top', 'common', [drop('common')], null, ['Bavoir de banquet', 'Banquet bib'], [
    'Indispensable quand on mange trois sangliers.',
    'A must when eating three boars.',
  ]),
  it('sailor-shirt', 'top', 'common', [shop], 50, ['Marinière', 'Sailor shirt'], [
    'Le mal de mer est vendu séparément.',
    'Seasickness sold separately.',
  ]),
  it('fur-vest', 'top', 'common', [drop('common')], null, ['Gilet en fourrure', 'Fur vest'], [
    'Fausse fourrure. Aucun ours n’a été vexé.',
    'Fake fur. No bear was offended.',
  ]),
  it('white-toga', 'top', 'rare', [shop], 120, ['Toge blanche', 'White toga'], [
    'Très romaine. Très difficile à garder propre.',
    'Very Roman. Very hard to keep clean.',
  ]),
  it('chainmail', 'top', 'rare', [ach('silver-20')], null, ['Cotte de mailles', 'Chainmail'], [
    'Fait un bruit de clés à chaque pas.',
    'Jingles like keys with every step.',
  ]),
  it('druid-robe', 'top', 'rare', [ach('lessons-50')], null, ['Robe de druide', 'Druid’s robe'], [
    'Avec une poche secrète pour les recettes.',
    'With a secret pocket for recipes.',
  ]),
  it('hockey-jersey', 'top', 'rare', [drop('rare')], null, ['Maillot de hockey', 'Hockey jersey'], [
    'Numéro 1. Comme le nombre de buts marqués cette saison.',
    'Number 1. Like the goals scored this season.',
  ]),
  it('polka-dot-toga', 'top', 'epic', [ach('streak-3')], null, ['Toge à pois', 'Polka-dot toga'], [
    'Très à la mode à Rome. Enfin, c’est ce que dit le vendeur.',
    'Very trendy in Rome. Or so says the seller.',
  ]),
  it('legionary-armour', 'top', 'epic', [drop('epic'), shop], 340, ['Armure de légionnaire', 'Legionary armour'], [
    'Brillante, solide, et elle gratte un peu.',
    'Shiny, sturdy, and a bit itchy.',
  ]),
  it('dinosaur-suit', 'top', 'legendary', [ach('streak-30')], null, ['Costume de dinosaure', 'Dinosaur suit'], [
    'Trente jours de suite ! Même les dinosaures sont jaloux.',
    'Thirty days in a row! Even dinosaurs are jealous.',
  ]),
  it('gold-armour', 'top', 'legendary', [drop('legendary')], null, ['Armure en or', 'Golden armour'], [
    'Trop brillante pour se battre. Parfaite pour poser.',
    'Too shiny to fight in. Perfect for posing.',
  ]),

  // --- Bottoms ---------------------------------------------------------------------------------
  it('brown-trousers', 'bottom', 'common', [starter], null, ['Braies marron', 'Brown trousers'], [
    'Le pantalon gaulois. Les Romains n’en portent pas, ils ont froid.',
    'Gaulish trousers. Romans do not wear them, so they get cold.',
  ]),
  it('striped-trousers', 'bottom', 'common', [starter], null, ['Braies à rayures', 'Striped trousers'], [
    'Vertes et blanches, pour aller avec l’herbe.',
    'Green and white, to match the grass.',
  ]),
  it('shorts', 'bottom', 'common', [shop], 40, ['Short', 'Shorts'], [
    'Même en hiver. Surtout en hiver.',
    'Even in winter. Especially in winter.',
  ]),
  it('patched-trousers', 'bottom', 'common', [drop('common')], null, ['Braies rapiécées', 'Patched trousers'], [
    'Réparées après un petit accident de menhir.',
    'Mended after a small menhir accident.',
  ]),
  it('roman-skirt', 'bottom', 'rare', [drop('rare'), shop], 100, ['Jupette romaine', 'Roman kilt'], [
    'Les légionnaires disent que c’est très pratique pour courir.',
    'Legionaries say it is very handy for running.',
  ]),
  it('rainbow-trousers', 'bottom', 'rare', [drop('rare')], null, ['Braies arc-en-ciel', 'Rainbow trousers'], [
    'On te voit arriver de très loin.',
    'People see you coming from miles away.',
  ]),
  it('golden-trousers', 'bottom', 'epic', [ach('gold-15')], null, ['Braies dorées', 'Golden trousers'], [
    'Quinze scènes en or. Tout cet or, il fallait bien le porter.',
    'Fifteen scenes at gold. All that gold had to go somewhere.',
  ]),

  // --- Feet ------------------------------------------------------------------------------------
  it('sandals', 'feet', 'common', [starter], null, ['Sandales', 'Sandals'], [
    'Laissent passer l’air. Et les cailloux.',
    'Let the air in. And the pebbles.',
  ]),
  it('leather-boots', 'feet', 'common', [starter], null, ['Bottes en cuir', 'Leather boots'], [
    'Pour les flaques de boue du village.',
    'For the village’s mud puddles.',
  ]),
  it('boar-slippers', 'feet', 'common', [drop('common'), shop], 50, ['Chaussons sanglier', 'Boar slippers'], [
    'Ils grognent un peu quand on marche.',
    'They grunt a little when you walk.',
  ]),
  it('caligae', 'feet', 'rare', [drop('rare'), shop], 110, ['Sandales de soldat', 'Soldier sandals'], [
    'Avec des clous dessous. On t’entend arriver.',
    'Nails underneath. Everyone hears you coming.',
  ]),
  it('winged-sandals', 'feet', 'epic', [ach('streak-7')], null, ['Sandales ailées', 'Winged sandals'], [
    'Une semaine sans t’arrêter. Elles t’ont poussé des ailes.',
    'A week without stopping. You grew wings.',
  ]),
  it('roller-sandals', 'feet', 'legendary', [ach('titanium-10')], null, ['Sandales à roulettes', 'Roller sandals'], [
    'Venues du futur. Les voies romaines n’étaient pas prêtes.',
    'From the future. Roman roads were not ready.',
  ]),

  // --- In the hand: sports gear and instruments ------------------------------------------------
  it('wooden-sword', 'held', 'common', [starter], null, ['Épée en bois', 'Wooden sword'], [
    'Ne fait peur qu’aux escargots.',
    'Only scares snails.',
  ]),
  it('ladle', 'held', 'common', [drop('common')], null, ['Louche', 'Ladle'], [
    'Pour goûter la potion. Juste un peu.',
    'For tasting the potion. Just a little.',
  ]),
  it('drum', 'held', 'common', [drop('common'), shop], 50, ['Tambour', 'Drum'], [
    'Tes voisins l’adorent. Non.',
    'Your neighbours love it. No.',
  ]),
  it('leather-ball', 'held', 'common', [shop], 40, ['Ballon en cuir', 'Leather ball'], [
    'Le premier match de foot ? Gaulois contre Romains, 12 à 0.',
    'The first football match? Gauls versus Romans, 12-0.',
  ]),
  it('fishing-rod', 'held', 'common', [drop('common')], null, ['Canne à pêche', 'Fishing rod'], [
    'Avec un poisson. Pas très frais, le poisson.',
    'Comes with a fish. Not a very fresh fish.',
  ]),
  it('pan-flute', 'held', 'common', [ach('songs-1')], null, ['Flûte de Pan', 'Pan flute'], [
    'Sept tuyaux, sept fausses notes.',
    'Seven pipes, seven wrong notes.',
  ]),
  it('squeaky-lyre', 'held', 'rare', [drop('rare'), shop], 120, ['Lyre qui grince', 'Squeaky lyre'], [
    'Le barde du village en a une. Personne ne veut qu’il en joue.',
    'The village bard has one. Nobody wants him to play it.',
  ]),
  it('hockey-stick', 'held', 'rare', [drop('rare'), shop], 130, ['Crosse de hockey', 'Hockey stick'], [
    'Venue des tribus d’Hibernie. La glace, elle, a fondu.',
    'From the tribes of Hibernia. The ice melted.',
  ]),
  it('carnyx', 'held', 'rare', [ach('spoken-10')], null, ['Carnyx', 'Carnyx'], [
    'La trompette gauloise. On l’entend jusqu’à Rome.',
    'The Gaulish war trumpet. They hear it all the way to Rome.',
  ]),
  it('roman-map', 'held', 'rare', [ach('unlock-25')], null, ['Carte de l’Empire', 'Map of the Empire'], [
    'Toute la Gaule est occupée. Toute ? Regarde bien le coin.',
    'All of Gaul is occupied. All of it? Look at the corner.',
  ]),
  it('golden-sickle', 'held', 'epic', [ach('lessons-150')], null, ['Serpe d’or', 'Golden sickle'], [
    'Pour cueillir le gui. Pas pour couper le gâteau.',
    'For picking mistletoe. Not for cutting cake.',
  ]),
  it('bard-harp', 'held', 'epic', [ach('songs-10')], null, ['Harpe de barde', 'Bard’s harp'], [
    'Dix chansons ! Le village va peut-être t’attacher à un arbre.',
    'Ten songs! The village may tie you to a tree.',
  ]),
  it('bagpipes', 'held', 'epic', [drop('epic'), shop], 300, ['Cornemuse', 'Bagpipes'], [
    'Venue de Calédonie. Fait fuir les loups et les cousins.',
    'From Caledonia. Scares off wolves and cousins.',
  ]),
  it('electric-lyre', 'held', 'legendary', [drop('legendary')], null, ['Lyre électrique', 'Electric lyre'], [
    'Interdite au village après un seul concert.',
    'Banned by the village after one concert.',
  ]),

  // --- On the back -----------------------------------------------------------------------------
  it('small-cape', 'back', 'common', [starter], null, ['Petite cape', 'Little cape'], [
    'Pas de super-pouvoirs, mais elle tient chaud.',
    'No superpowers, but it keeps you warm.',
  ]),
  it('red-cape', 'back', 'common', [shop], 50, ['Cape rouge', 'Red cape'], [
    'Flotte au vent. Même quand il n’y a pas de vent.',
    'Flaps in the wind. Even with no wind.',
  ]),
  it('butterfly-wings', 'back', 'rare', [drop('rare'), shop], 120, ['Ailes de papillon', 'Butterfly wings'], [
    'Battent très vite quand tu es content.',
    'Flap very fast when you are happy.',
  ]),
  it('cauldron-backpack', 'back', 'rare', [drop('rare')], null, ['Sac-chaudron', 'Cauldron backpack'], [
    'Pour transporter la potion. Il est vide, désolé.',
    'For carrying potion. It is empty, sorry.',
  ]),
  it('round-shield', 'back', 'rare', [ach('bronze-25')], null, ['Bouclier rond', 'Round shield'], [
    'Sert aussi de plateau, de luge et de parapluie.',
    'Also works as a tray, a sledge and an umbrella.',
  ]),
  it('menhir-backpack', 'back', 'epic', [ach('episode-1')], null, ['Sac à menhir', 'Menhir backpack'], [
    'Livraison de menhirs à domicile. Pas de retour possible.',
    'Menhir home delivery. No returns.',
  ]),
  it('phoenix-wings', 'back', 'legendary', [ach('streak-60')], null, ['Ailes de phénix', 'Phoenix wings'], [
    'Soixante jours ! Tu es en feu. Pas pour de vrai.',
    'Sixty days! You are on fire. Not really.',
  ]),
  it('chieftain-cape', 'back', 'legendary', [ach('episodes-5')], null, ['Cape de chef', 'Chieftain’s cape'], [
    'Pour les chefs. Le bouclier pour te porter est en option.',
    'For chiefs. The shield to carry you around is extra.',
  ]),

  // --- Companions ------------------------------------------------------------------------------
  it('puppy', 'pet', 'common', [starter], null, ['Chiot', 'Puppy'], [
    'Il aboie sur les Romains. Et sur les feuilles.',
    'Barks at Romans. And at leaves.',
  ]),
  it('piglet', 'pet', 'common', [drop('common')], null, ['Marcassin', 'Boar piglet'], [
    'Ton meilleur ami. Promis, on ne le mange pas.',
    'Your best friend. We promise not to eat it.',
  ]),
  it('snail', 'pet', 'common', [drop('common')], null, ['Escargot', 'Snail'], [
    'Le plus rapide de Gaule. Selon lui.',
    'The fastest in Gaul. According to him.',
  ]),
  it('rooster', 'pet', 'common', [shop], 60, ['Coq', 'Rooster'], [
    'Te réveille à l’aube. Et à minuit. Et à midi.',
    'Wakes you at dawn. And midnight. And noon.',
  ]),
  it('cat', 'pet', 'rare', [drop('rare'), shop], 130, ['Chat', 'Cat'], [
    'Il fait semblant de ne pas te connaître.',
    'Pretends not to know you.',
  ]),
  it('owl', 'pet', 'rare', [ach('unlock-50')], null, ['Chouette', 'Owl'], [
    'Elle connaît toutes les potions. Elle ne dit rien.',
    'Knows every potion. Says nothing.',
  ]),
  it('goose', 'pet', 'rare', [ach('follows-5')], null, ['Oie', 'Goose'], [
    'Une oie du Capitole. Elle crie quand quelqu’un arrive.',
    'A goose from the Capitol. Honks when anyone comes.',
  ]),
  it('mini-dino', 'pet', 'legendary', [drop('legendary')], null, ['Mini-dinosaure', 'Mini dinosaur'], [
    'Trouvé dans un coffre. Le druide ne sait pas comment.',
    'Found in a chest. The druid has no idea how.',
  ]),

  // --- Backgrounds -----------------------------------------------------------------------------
  it('meadow', 'background', 'common', [starter], null, ['Prairie', 'Meadow'], [
    'De l’herbe, du ciel, et un mouton quelque part.',
    'Grass, sky, and a sheep somewhere.',
  ]),
  it('village', 'background', 'common', [shop], 60, ['Village gaulois', 'Gaulish village'], [
    'Des huttes, une palissade et beaucoup de bruit.',
    'Huts, a fence and lots of noise.',
  ]),
  it('forest', 'background', 'common', [drop('common')], null, ['Forêt', 'Forest'], [
    'Les sangliers y vivent. Pour l’instant.',
    'The boars live here. For now.',
  ]),
  it('menhir-field', 'background', 'common', [drop('common'), shop], 60, ['Champ de menhirs', 'Menhir field'], [
    'Chaque menhir a un nom. Celui-là, c’est Gérard.',
    'Every menhir has a name. That one is Gerard.',
  ]),
  it('roman-columns', 'background', 'rare', [drop('rare'), shop], 150, ['Temple romain', 'Roman temple'], [
    'Toutes les routes mènent ici. Même celle de ta maison.',
    'All roads lead here. Even the one to your house.',
  ]),
  it('seaside', 'background', 'rare', [drop('rare')], null, ['Bord de mer', 'Seaside'], [
    'Au loin, un bateau pirate. Il va bientôt couler.',
    'In the distance, a pirate ship. It will sink soon.',
  ]),
  it('arena', 'background', 'epic', [drop('epic')], null, ['Arène', 'Arena'], [
    'Le public t’applaudit. Il applaudit tout le monde.',
    'The crowd cheers for you. It cheers for everyone.',
  ]),
  it('starry-night', 'background', 'epic', [ach('loops-500')], null, ['Nuit étoilée', 'Starry night'], [
    'Le ciel ne te tombe pas sur la tête. Pas ce soir.',
    'The sky is not falling on your head. Not tonight.',
  ]),
  it('banquet', 'background', 'epic', [ach('friend-streak-7')], null, ['Banquet', 'Banquet'], [
    'La fête de fin d’aventure. Le barde n’est pas invité.',
    'The end-of-adventure feast. The bard is not invited.',
  ]),
  it('plutonium-glow', 'background', 'legendary', [ach('plutonium-1')], null, ['Lueur plutonium', 'Plutonium glow'], [
    'Ça brille dans le noir. Ne le lèche pas.',
    'It glows in the dark. Do not lick it.',
  ]),
];

export const ITEMS_BY_ID: ReadonlyMap<string, Item> = new Map(ITEMS.map((i) => [i.id, i]));

/**
 * The chance of each rarity when a chest drops an item (sums to 1 per chest). The server draws the
 * rarity first, then an item of that rarity whose sources include that chest.
 */
export const CHEST_RARITY_ODDS: Record<ChestKind, Record<Rarity, number>> = {
  wood: { common: 0.9, rare: 0.1, epic: 0, legendary: 0 },
  silver: { common: 0.55, rare: 0.38, epic: 0.07, legendary: 0 },
  gold: { common: 0.3, rare: 0.4, epic: 0.24, legendary: 0.06 },
};

/** Items a chest can drop. */
export function chestItems(kind: ChestKind, rarity?: Rarity): Item[] {
  return ITEMS.filter((i) => (!rarity || i.rarity === rarity) && i.sources.some((s) => s.kind === 'chest' && s.chests.includes(kind)));
}
