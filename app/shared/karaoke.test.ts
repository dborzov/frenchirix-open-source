import { describe, expect, it } from 'vitest';
import { alignTake, captureStartMs, checkTake, heardAtMs, overlaySpan, takeOffsetMs } from './karaoke';

const ROMAN = [
  "C'est un monde romain\nPas un monde gaulois",
  'Tapez dans vos mains\nEt respectez nos lois',
  'Dans ce monde romain\nOh là là, que c’est bien',
  'Un monde merveilleux\nFranchement, y a rien de mieux',
  "On jettera aux lions\nCeux qui fomentent les rébellions",
];
const ARBRE = ['Madame Arbre, tout va bien', 'Allez, chante avec tes copains', 'On est bien, il fait chaud\nIl fait beau'];

describe('checkTake: profanity only, never what was sung', () => {
  // [what Whisper heard, ok?, the words that counted]
  const table: [string, boolean, string[]][] = [
    // The song itself, sung well or badly, with accents and Whisper's spellings.
    ["C'est un monde romain, pas un monde gaulois. Tapez dans vos mains et respectez nos lois.", true, []],
    ['Cé un monde romain pas un mon gaulois', true, []],
    ['Dans ce monde romain, oh là là, que c’est bien !', true, []],
    // Something else entirely: fine, mild insults the show uses too.
    ['Ils sont fous, ces Romains ! Par Toutatis !', true, []],
    ['La la la la la, je chante faux mais je chante fort', true, []],
    ['Obélix est un idiot, un crétin, un abruti, il mange trop de sangliers', true, []],
    ['Happy birthday to you', true, []],
    ['', true, []],
    ['...', true, []],
    // Whisper's stock phrases on music or silence never block a take.
    ["Sous-titres réalisés par la communauté d'Amara.org", true, []],
    ["Sous-titrage ST' 501", true, []],
    ['Sous-titrage Société Radio-Canada', true, []],
    ['Merci d’avoir regardé cette vidéo ! Abonnez-vous à la chaîne.', true, []],
    ['Musique', true, []],
    ['*Musique*', true, []],
    ['♪ ♪ ♪', true, []],
    ['* * *', true, []],
    // Innocent words that contain a listed one, or are rude elsewhere: hyphen splits, other languages, places.
    ['Je veux connaître le concombre et le second conte', true, []],
    ['Un calcul, une culture, il recule, ça bascule', true, []],
    ['Un assassin dans la classe, quelle technique !', true, []],
    ['On va faire un pique-nique, ils pique-niquent, on aime pique-niquer', true, []],
    ['Il nous fait la nique, faire la nique aux Romains', true, []],
    ['Le lion ouvre sa gueule, la gueule du loup, une grande gueule', true, []],
    ['Un pain bâtard et un chien bâtard', true, []],
    ['Le bateau est dans un cul-de-sac, un cul-de-jatte, le cul de la bouteille', true, []],
    ['Un chili con carne pour Obélix, con amor', true, []],
    ['The pros and the cons, a con', true, []],
    ['Moby Dick, Dick Rivers, a mosquito bite, the dog bites, my pussycat', true, []],
    ['Dans ta face, Captain Armorica !', true, []],
    ['Les pros et les cons', true, []],
    ['Le baiser de Falbala, un baiser', true, []],
    ['Tant pis, il fait beau, les cous des oies', true, []],
    ['Scunthorpe, cocktail, dickens, cocker, Pénélope', true, []],
    ['Il est en retard, la pédale du vélo, une tapette à mouches', true, []],
    ['Les Mongols, les nazaréens, un raton laveur, des fesses, des seins, pipi, caca', true, []],
    ['Il a mis son bonnet, cétautomatix fait des bêtises', true, []],
    // Rude, in French and English, with accents, plurals, elisions, spellings and capitals.
    ['Merde, je me suis trompé', false, ['merde']],
    ['Oh putain, c’est un monde romain', false, ['putain']],
    ["P'tain c'est nul, ptain", false, ['ptain']],
    ["T'es con ou quoi ?", false, ['con']],
    ['Les Romains sont des cons', false, ['cons']],
    ['Espèce de conard, quelle connerie, des conneries', false, ['conard', 'connerie', 'conneries']],
    ['Espèce d’enculé de Romain', false, ['encule']],
    ['Bande de BÂTARDS', false, ['batards']],
    ['Ferme ta gueule, Obélix', false, ['gueule']],
    ['Ferme ta grande gueule', false, ['gueule']],
    ['Fils de pute', false, ['pute']],
    ['Nique ta mère', false, ['nique']],
    ['Va te faire foutre', false, ['foutre']],
    ['Va te faire baiser, on baise', false, ['baiser', 'baise']],
    ['Il se branle', false, ['branle']],
    ['Les chiottes, tu fais chier, quel chieur', false, ['chiottes', 'chier', 'chieur']],
    ['Sale PD, sale négro, bougnoule', false, ['pd', 'negro', 'bougnoule']],
    ['Tarlouze, fiotte, les pédés', false, ['tarlouze', 'fiotte', 'pedes']],
    ['Un film porno', false, ['porno']],
    ['Mon cul, oui, ta grosse bite', false, ['cul', 'bite']],
    ['What the fuck is this shit', false, ['fuck', 'shit']],
    ["Fucking Romans, fuckin Romans, fuckin' Romans", false, ['fucking', 'fuckin']],
    ['Il a dit f*** les Romains', false, ['***']],
    ['f*ck, sh*t', false, ['***']],
    ['Les nazis, Heil Hitler, sieg heil', false, ['nazis', 'heil', 'hitler']],
    ['Sous-titrage merde putain', false, ['merde', 'putain']],
    ['merde merde merde', false, ['merde']],
  ];
  it.each(table)('%j', (heard, ok, words) => {
    const r = checkTake(heard, ROMAN);
    expect(r.ok).toBe(ok);
    expect([...r.words].sort()).toEqual([...words].sort());
  });

  it('never counts a word of the song’s own lyrics', () => {
    const lyrics = ['Oh merde, il pleut', 'Ferme ta gueule et chante'];
    expect(checkTake('Oh merde il pleut, ferme ta gueule et chante', lyrics)).toEqual({ ok: true, words: [] });
    // Other rude words still count with those lyrics.
    expect(checkTake('Oh merde, putain', lyrics)).toEqual({ ok: false, words: ['putain'] });
  });

  it('the karaoke songs’ lyrics pass as they are', () => {
    for (const lyrics of [ROMAN, ARBRE]) expect(checkTake(lyrics.join(' '), lyrics).ok).toBe(true);
    expect(checkTake(ARBRE.join(' '), ROMAN).ok).toBe(true);
  });

  it('refuses every word the account-name filter refuses, but those innocent in a sentence', () => {
    // The name filter's lists (shared/catalog/badwords.ts), each word alone as a transcript.
    const innocentInASentence = new Set(['pedale', 'tapette', 'sexe', 'sex', 'mongol', 'debile', 'abruti', 'idiot', 'idiote', 'cretin', 'cretine', 'tit', 'cock', 'cocks', 'crap', 'damn', 'hoe', 'poop', 'butt', 'retard', 'bite', 'bites']);
    const nameWords = [
      'merde', 'putain', 'connard', 'connasse', 'conasse', 'salope', 'salaud', 'encule', 'enfoire', 'batard', 'bordel', 'couille', 'branleur', 'branlette', 'pouffiasse', 'petasse', 'grognasse', 'chiasse', 'emmerde', 'foutre', 'niquer', 'tafiole', 'bougnoul', 'youpin', 'sodomie', 'zgeg', 'trouduc',
      'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'whore', 'wanker', 'bollocks', 'nigga', 'dickhead', 'motherfucker', 'penis', 'vagina', 'porn', 'sexy', 'boobs', 'pussy', 'blowjob', 'cumshot', 'jizz', 'twat', 'hitler', 'nazi',
      'con', 'cons', 'conne', 'cul', 'culs', 'pute', 'putes', 'bite', 'bites', 'pede', 'pedes', 'zob', 'chier', 'nique', 'pisse', 'pedale', 'tapette', 'sexe', 'gouine', 'mongol', 'debile', 'abruti', 'idiot', 'idiote', 'cretin', 'cretine', 'nichon', 'nichons',
      'ass', 'arse', 'cunt', 'dick', 'dicks', 'cock', 'cocks', 'tit', 'tits', 'fag', 'slut', 'cum', 'sex', 'crap', 'piss', 'damn', 'hoe', 'kkk', 'poop', 'butt', 'nigger', 'niggers', 'faggot', 'faggots', 'retard', 'rapist',
    ];
    for (const w of nameWords) expect(checkTake(w, []).ok, w).toBe(innocentInASentence.has(w));
  });
});

describe('timing', () => {
  it('captureStartMs: the context time of the first sample mapped onto performance time, less the input latency', () => {
    // The first sample was processed 0.25 s before the context's clock read 10.5 s at perf 5000 ms.
    expect(captureStartMs(5000, 10.5, 10.25)).toBe(4750);
    expect(captureStartMs(5000, 10.5, 10.25, 0.02)).toBe(4730);
  });

  it('heardAtMs: when a clip position of an iteration reaches the ear', () => {
    const clock = { perfNowMs: 1000, ctxNowS: 2, outputLatencyS: 0.05, whenS: 2.02, offsetS: 0, rate: 1 };
    // Position 0 starts 20 ms after now on the context clock and is heard 50 ms after it is rendered.
    expect(heardAtMs(clock, 0)).toBeCloseTo(1070, 6);
    expect(heardAtMs(clock, 1500)).toBeCloseTo(2570, 6);
    // An iteration that starts later in the clip (a seek), at another rate.
    expect(heardAtMs({ ...clock, offsetS: 10, rate: 2 }, 12_000)).toBeCloseTo(1000 + (0.02 + 1 + 0.05) * 1000, 6);
  });

  it('takeOffsetMs and alignTake: a microphone opened before the song loses its head; one opened after sits later', () => {
    // The microphone opened 340 ms before the kid heard the song's first sample.
    const capture = captureStartMs(5000, 10.5, 10.25, 0.01); // 4740
    const songZero = heardAtMs({ perfNowMs: 4900, ctxNowS: 3, outputLatencyS: 0.06, whenS: 3.12, offsetS: 0, rate: 1 }, 0); // 5080
    expect(takeOffsetMs(capture, songZero)).toBe(-340);
    expect(alignTake(-340)).toEqual({ dropSamples: 5440, offsetMs: 0 });
    expect(alignTake(-340, 48000)).toEqual({ dropSamples: 16320, offsetMs: 0 });
    expect(alignTake(120)).toEqual({ dropSamples: 0, offsetMs: 120 });
    expect(alignTake(0)).toEqual({ dropSamples: 0, offsetMs: 0 });
  });

  it('overlaySpan: the voice follows the song through a start from 0, a seek, a loop and a take that starts later', () => {
    // The whole song (30 s) from context time 5; the take covers the song's 0..28 s.
    expect(overlaySpan(5, 0, 30, 1, 0, 28)).toEqual({ atS: 5, overlayFromS: 0, durS: 28 });
    // A seek to 12 s: the voice starts 12 s in.
    expect(overlaySpan(5, 12, 18, 1, 0, 28)).toEqual({ atS: 5, overlayFromS: 12, durS: 16 });
    // A take placed at 1.5 s on the song: it starts 1.5 s after the iteration.
    const late = overlaySpan(5, 0, 30, 1, 1.5, 20)!;
    expect(late.atS).toBeCloseTo(6.5, 9);
    expect(late.overlayFromS).toBe(0);
    expect(late.durS).toBe(20);
    // A seek past the voice's end: nothing to play.
    expect(overlaySpan(5, 25, 5, 1, 1.5, 20)).toBeNull();
    // At another rate the start moves with it.
    expect(overlaySpan(5, 0, 30, 2, 4, 10)!.atS).toBeCloseTo(7, 9);
  });
});
