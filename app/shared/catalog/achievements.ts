// Achievements: conditions over the per-kid counters (StatKey). Ids are stored per kid: never rename
// or remove one. A reward item must exist in items.ts with an `achievement` source naming this id
// (a test checks it). `rewardName` is what the reward screen announces.
import type { Achievement, Localized, Reward, StatKey } from './types';

function a(
  id: string,
  stat: StatKey,
  gte: number,
  name: [fr: string, en: string],
  description: [fr: string, en: string],
  reward: Reward,
  rewardName?: [fr: string, en: string],
  secret?: boolean,
): Achievement {
  const loc = ([fr, en]: [string, string]): Localized => ({ fr, en });
  return {
    id,
    name: loc(name),
    description: loc(description),
    condition: { stat, gte },
    reward,
    ...(rewardName ? { rewardName: loc(rewardName) } : {}),
    ...(secret ? { secret } : {}),
  };
}

export const ACHIEVEMENTS: Achievement[] = [
  // --- Practices and quests (the ids are stored per kid: never rename one) ------------------------
  a('first-lesson', 'practicesFinished', 1, ['Premier pas', 'First step'], ['Finis ta première pratique.', 'Finish your first practice.'], { sesterces: 20 }, [
    '20 sesterces',
    '20 sesterces',
  ]),
  a('lessons-10', 'practicesFinished', 10, ['Apprenti druide', 'Apprentice druid'], ['Finis dix pratiques. Tu sens la potion ?', 'Finish ten practices. Can you smell the potion?'], { items: ['druid-hood'] }, [
    'une capuche de druide',
    'a druid’s hood',
  ]),
  a('lessons-50', 'practicesFinished', 50, ['Druide confirmé', 'Real druid'], ['Finis cinquante pratiques. Barbe blanche en option.', 'Finish fifty practices. White beard optional.'], { items: ['druid-robe'] }, [
    'une robe de druide',
    'a druid’s robe',
  ]),
  a('lessons-150', 'practicesFinished', 150, ['Grand druide', 'Great druid'], ['Finis cent cinquante pratiques. Le gui t’attend.', 'Finish 150 practices. The mistletoe awaits.'], { items: ['golden-sickle'] }, [
    'une serpe d’or',
    'a golden sickle',
  ]),
  a('quizzes-30', 'questsDone', 30, ['Chef de cuisine', 'Head chef'], ['Fais trente quêtes du jour. Bien mijotées.', 'Do thirty daily quests. Nicely simmered.'], { items: ['chef-toque'] }, [
    'une toque de chef',
    'a chef’s hat',
  ]),
  a('perfect-1', 'perfectPractices', 1, ['Sans une faute', 'Not one slip'], ['Finis une pratique sans erreur et sans aide.', 'Finish a practice with no mistakes and no help.'], { sesterces: 15 }, [
    '15 sesterces',
    '15 sesterces',
  ]),
  a('perfect-10', 'perfectPractices', 5, ['Œil de lynx', 'Eagle eye'], ['Cinq pratiques parfaites. Tu vois tout !', 'Five perfect practices. You see everything!'], { items: ['monocle'] }, [
    'un monocle',
    'a monocle',
  ]),
  a('perfect-50', 'perfectPractices', 15, ['Parfait comme un menhir', 'Perfect as a menhir'], ['Quinze pratiques parfaites. Solide !', 'Fifteen perfect practices. Rock solid!'], { chest: 'gold', sesterces: 100 }, [
    'un coffre en or',
    'a golden chest',
  ]),

  // --- Streaks ---------------------------------------------------------------------------------
  a('streak-3', 'streak', 3, ['Trois jours de suite', 'Three days in a row'], ['Joue trois jours de suite.', 'Play three days in a row.'], { items: ['polka-dot-toga'] }, [
    'une toge à pois',
    'a polka-dot toga',
  ]),
  a('streak-7', 'streak', 7, ['Une semaine de feu', 'A week on fire'], ['Joue sept jours de suite. Tes pieds volent !', 'Play seven days in a row. Your feet fly!'], { items: ['winged-sandals'] }, [
    'des sandales ailées',
    'winged sandals',
  ]),
  a('streak-14', 'streak', 14, ['Têtu comme un sanglier', 'Stubborn as a boar'], ['Joue quatorze jours de suite.', 'Play fourteen days in a row.'], { items: ['boar-hat'], potions: 1 }, [
    'un chapeau sanglier',
    'a boar hat',
  ]),
  a('streak-30', 'streak', 30, ['Préhistorique !', 'Prehistoric!'], ['Joue trente jours de suite. Tu es une légende ancienne.', 'Play thirty days in a row. You are an ancient legend.'], { items: ['dinosaur-suit', 'dino-hood'] }, [
    'un costume de dinosaure',
    'a dinosaur suit',
  ]),
  a('streak-60', 'streak', 60, ['Phénix gaulois', 'Gaulish phoenix'], ['Joue soixante jours de suite. Rien ne t’arrête.', 'Play sixty days in a row. Nothing stops you.'], { items: ['phoenix-wings'] }, [
    'des ailes de phénix',
    'phoenix wings',
  ]),

  // --- Unlocking scenes ------------------------------------------------------------------------
  a('unlock-1', 'scenesUnlocked', 1, ['La porte s’ouvre', 'The door opens'], ['Débloque ta première scène.', 'Unlock your first scene.'], { sesterces: 10 }, ['10 sesterces', '10 sesterces']),
  a('unlock-10', 'scenesUnlocked', 10, ['Explorateur gaulois', 'Gaulish explorer'], ['Débloque dix scènes.', 'Unlock ten scenes.'], { chest: 'silver', potions: 1 }, [
    'un coffre en argent',
    'a silver chest',
  ]),
  a('unlock-25', 'scenesUnlocked', 25, ['Grand voyageur', 'Great traveller'], ['Débloque vingt-cinq scènes. Tu as besoin d’une carte.', 'Unlock 25 scenes. You need a map.'], { items: ['roman-map'] }, [
    'une carte de l’Empire',
    'a map of the Empire',
  ]),
  a('unlock-50', 'scenesUnlocked', 50, ['Curieux comme une chouette', 'Curious as an owl'], ['Débloque cinquante scènes.', 'Unlock fifty scenes.'], { items: ['owl'] }, [
    'une chouette',
    'an owl',
  ]),
  a('unlock-100', 'scenesUnlocked', 100, ['Cent scènes !', 'A hundred scenes!'], ['Débloque cent scènes. La moitié de l’aventure !', 'Unlock a hundred scenes. Half the adventure!'], { chest: 'gold', sesterces: 100 }, [
    'un coffre en or',
    'a golden chest',
  ]),
  // Every scene of the release (app/data/release.json; a test checks the number against it).
  a('unlock-all', 'scenesUnlocked', 203, ['Tout vu, tout su', 'Seen it all'], ['Débloque toutes les scènes. César est jaloux.', 'Unlock every scene. Caesar is jealous.'], { items: ['golden-laurel'] }, [
    'un laurier d’or',
    'a golden laurel',
  ]),
  a('episode-1', 'episodesComplete', 1, ['Un épisode entier', 'A whole episode'], ['Débloque toutes les scènes d’un épisode.', 'Unlock every scene of one episode.'], { items: ['menhir-backpack'] }, [
    'un sac à menhir',
    'a menhir backpack',
  ]),
  a('episodes-5', 'episodesComplete', 5, ['Chef du village', 'Village chief'], ['Débloque les cinq épisodes en entier.', 'Unlock all five episodes completely.'], { items: ['chieftain-cape'] }, [
    'une cape de chef',
    'a chieftain’s cape',
  ]),

  // --- Levels ----------------------------------------------------------------------------------
  a('bronze-1', 'scenesBronze', 1, ['Premier bronze', 'First bronze'], ['Ta première scène en bronze.', 'Your first scene at bronze.'], { sesterces: 15 }, ['15 sesterces', '15 sesterces']),
  a('bronze-25', 'scenesBronze', 25, ['Collection de bronze', 'Bronze collection'], ['Vingt-cinq scènes en bronze ou mieux.', 'Twenty-five scenes at bronze or better.'], { items: ['round-shield'] }, [
    'un bouclier rond',
    'a round shield',
  ]),
  a('silver-1', 'scenesSilver', 1, ['Ça brille !', 'Shiny!'], ['Ta première scène en argent.', 'Your first scene at silver.'], { sesterces: 20 }, ['20 sesterces', '20 sesterces']),
  a('silver-20', 'scenesSilver', 20, ['Chevalier d’argent', 'Silver knight'], ['Vingt scènes en argent ou mieux.', 'Twenty scenes at silver or better.'], { items: ['chainmail'] }, [
    'une cotte de mailles',
    'a chainmail shirt',
  ]),
  a('gold-1', 'scenesGold', 1, ['De l’or !', 'Gold!'], ['Ta première scène en or.', 'Your first scene at gold.'], { sesterces: 30, chest: 'silver' }, [
    'un coffre en argent',
    'a silver chest',
  ]),
  a('gold-15', 'scenesGold', 15, ['Trésor gaulois', 'Gaulish treasure'], ['Quinze scènes en or ou mieux.', 'Fifteen scenes at gold or better.'], { items: ['golden-trousers'] }, [
    'des braies dorées',
    'golden trousers',
  ]),
  a('titanium-1', 'scenesTitanium', 1, ['Dur comme le titane', 'Tough as titanium'], ['Ta première scène en titane.', 'Your first scene at titanium.'], { potions: 1, sesterces: 30 }, [
    'une potion',
    'a potion',
  ]),
  a('titanium-10', 'scenesTitanium', 10, ['Roule, ma poule', 'On a roll'], ['Dix scènes en titane ou mieux.', 'Ten scenes at titanium or better.'], { items: ['roller-sandals'] }, [
    'des sandales à roulettes',
    'roller sandals',
  ]),
  a('diamond-1', 'scenesDiamond', 1, ['Une vraie star', 'A real star'], ['Ta première scène en diamant.', 'Your first scene at diamond.'], { items: ['star-glasses'] }, [
    'des lunettes étoiles',
    'star glasses',
  ]),
  a('plutonium-1', 'scenesPlutonium', 1, ['Ça brille dans le noir', 'Glows in the dark'], ['Ta première scène en plutonium.', 'Your first scene at plutonium.'], { items: ['plutonium-glow'] }, [
    'un fond qui brille',
    'a glowing background',
  ]),
  a('plutonium-10', 'scenesPlutonium', 10, ['Réacteur gaulois', 'Gaulish reactor'], ['Dix scènes en plutonium. Tu es incroyable.', 'Ten scenes at plutonium. You are amazing.'], { chest: 'gold', sesterces: 300 }, [
    '300 sesterces et un coffre en or',
    '300 sesterces and a golden chest',
  ]),

  // --- Speaking, listening, singing ------------------------------------------------------------
  a('spoken-10', 'linesSpoken', 10, ['Grande gueule', 'Big voice'], ['Dis dix répliques au micro.', 'Say ten lines into the microphone.'], { items: ['carnyx'] }, [
    'un carnyx',
    'a carnyx',
  ]),
  a('spoken-100', 'linesSpoken', 100, ['Orateur du forum', 'Forum speaker'], ['Dis cent répliques. Rome t’écoute !', 'Say a hundred lines. Rome is listening!'], { sesterces: 100 }, [
    '100 sesterces',
    '100 sesterces',
  ]),
  a('loops-50', 'loopsHeard', 50, ['Ver d’oreille', 'Earworm'], ['Écoute cinquante boucles. Ça tourne dans ta tête ?', 'Hear fifty loops. Is it stuck in your head?'], { items: ['earmuffs'] }, [
    'des cache-oreilles',
    'earmuffs',
  ]),
  a('loops-500', 'loopsHeard', 500, ['Disque rayé', 'Broken record'], ['Écoute cinq cents boucles. Encore une ? Encore une !', 'Hear five hundred loops. One more? One more!'], { items: ['starry-night'] }, [
    'une nuit étoilée',
    'a starry night',
  ]),
  a('loops-2000', 'loopsHeard', 2000, ['Perroquet de Lutèce', 'Parrot of Lutetia'], ['Écoute deux mille boucles. Tu pourrais doubler le film.', 'Hear two thousand loops. You could dub the film.'], { potions: 1, sesterces: 150 }, [
    'une potion et 150 sesterces',
    'a potion and 150 sesterces',
  ]),
  a('songs-1', 'songsSung', 1, ['Petit barde', 'Little bard'], ['Chante une chanson en karaoké.', 'Sing a song in karaoke.'], { items: ['pan-flute'] }, [
    'une flûte de Pan',
    'a pan flute',
  ]),
  a('songs-10', 'songsSung', 10, ['Barde officiel', 'Official bard'], ['Chante dix fois. Personne ne t’a attaché à un arbre !', 'Sing ten times. Nobody tied you to a tree!'], { items: ['bard-harp'] }, [
    'une harpe de barde',
    'a bard’s harp',
  ]),
  a('questions-100', 'questionsAnswered', 100, ['Je sais tout', 'Know-it-all'], ['Réponds à cent questions rigolotes.', 'Answer a hundred funny questions.'], { sesterces: 60 }, ['60 sesterces', '60 sesterces']),

  // --- Friends ---------------------------------------------------------------------------------
  a('follows-1', 'follows', 1, ['Un ami !', 'A friend!'], ['Suis un autre joueur.', 'Follow another player.'], { sesterces: 10 }, ['10 sesterces', '10 sesterces']),
  a('follows-5', 'follows', 5, ['Toute la bande', 'The whole gang'], ['Suis cinq joueurs.', 'Follow five players.'], { items: ['goose'] }, [
    'une oie',
    'a goose',
  ]),
  a('cheers-10', 'cheersSent', 10, ['Supporter numéro un', 'Number one fan'], ['Envoie dix encouragements.', 'Send ten cheers.'], { sesterces: 20 }, ['20 sesterces', '20 sesterces']),
  a('gifts-1', 'giftsSent', 1, ['Cœur d’or', 'Heart of gold'], ['Envoie ton premier cadeau.', 'Send your first gift.'], { sesterces: 15 }, ['15 sesterces', '15 sesterces']),
  a('gifts-10', 'giftsSent', 10, ['Père Noël gaulois', 'Gaulish Santa'], ['Envoie dix cadeaux.', 'Send ten gifts.'], { items: ['heart-glasses'] }, [
    'des lunettes cœur',
    'heart glasses',
  ]),
  a('friend-streak-7', 'bestFriendStreak', 7, ['Copains comme cochons', 'Thick as thieves'], ['Joue sept jours de suite avec un ami.', 'Play seven days in a row with a friend.'], { items: ['banquet'] }, [
    'un banquet',
    'a banquet',
  ]),

  // --- Chests ----------------------------------------------------------------------------------
  a('chests-1', 'chestsOpened', 1, ['Qu’y a-t-il dedans ?', 'What’s inside?'], ['Ouvre ton premier coffre.', 'Open your first chest.'], { sesterces: 10 }, ['10 sesterces', '10 sesterces']),
  a('chests-10', 'chestsOpened', 10, ['Chasseur de trésors', 'Treasure hunter'], ['Ouvre dix coffres.', 'Open ten chests.'], { items: ['cauldron-helmet'] }, [
    'un casque-marmite',
    'a cooking-pot helmet',
  ]),
  a('chests-50', 'chestsOpened', 50, ['Roi des coffres', 'Chest champion'], ['Ouvre cinquante coffres.', 'Open fifty chests.'], { chest: 'gold' }, ['un coffre en or', 'a golden chest']),

  // --- Secret ----------------------------------------------------------------------------------
  a('xp-1000', 'xp', 1000, ['Mille points !', 'A thousand points!'], ['Gagne 1000 points d’expérience.', 'Earn 1000 experience points.'], { potions: 1 }, ['une potion', 'a potion'], true),
];

export const ACHIEVEMENTS_BY_ID: ReadonlyMap<string, Achievement> = new Map(ACHIEVEMENTS.map((x) => [x.id, x]));
