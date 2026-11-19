import { describe, expect, it } from 'vitest';
import { SPEECH_HINT, judgeMessages, lenientPass, numberToFrench, parseJudge, phoneticKey, scoreSpeech, soundSpelling } from './speech';

// Real lines from the bundle; transcripts are what Whisper plausibly returns for a kid.
// want: 'pass' | 'fail' | 'zero' (fails with score exactly 0).
type Case = [label: string, expected: string, heard: string, want: 'pass' | 'fail' | 'zero', kind?: 'line' | 'unit'];

const JETTERA = 'On jettera aux lions\nCeux qui fomentent les rébellions';
const IMPOSERA = "Et si tu n'aimes pas\nOn te l'imposera";
const MALADROIT = 'Tu es maladroit, Obélix !';
const SOUMETTRAI = 'Non ! Jamais je ne me soumettrai à un Gallo-Romain !';
const BANNI = "Obélix m'a banni du village juste avant le combat !";
const MARMITE = 'Tout ! Obélix est tombé dans la marmite de potion magique étant petit !';
const CHEF = "Je suis chef, je te nomme chef, tu es chef, c'est tout.";
const CHAMPIGNONS = 'Champignons à chapeau blanc et taches rouges, on ne touche.';
const TOUTATIS = 'Alors, rendons grâce à Toutatis avec ce banquet';
const SECRET = 'Eh bien, pour te remercier, Métadata, je vais te confier un secret';
const ABRA = 'Abraracourcix ! Je viens te défier au combat des chefs.';
const APLUS = 'Bonjour, Aplusbégalix.';
const GAULE = "- Ouais…\n- Aujourd'hui, toute la Gaule est occupée.";
const HUTTE = "J'y vais quand je veux, dans la hutte du druide. Et on ira ce soir, même !";
const NONNON = 'Non, non, non, non, je vous dis, il faut agrandir le stationnement.';
const TREFLE = 'Ton trèfle à 4 feuilles !';
const LIONS = "On va pas dire ça à César. Tu veux qu'il nous jette aux lions ou quoi ?";

const CASES: Case[] = [
  // Perfect and near-perfect.
  ['perfect long line', JETTERA, 'On jettera aux lions ceux qui fomentent les rébellions.', 'pass'],
  ['perfect with elision', IMPOSERA, "Et si tu n'aimes pas, on te l'imposera.", 'pass'],
  ['perfect short', MALADROIT, 'Tu es maladroit, Obélix !', 'pass'],
  ['perfect with hyphen', SOUMETTRAI, 'Non, jamais je ne me soumettrai à un gallo-romain.', 'pass'],
  ['no accents at all', BANNI, 'obelix ma banni du village juste avant le combat', 'pass'],
  ['no punctuation, lower case', CHEF, 'je suis chef je te nomme chef tu es chef cest tout', 'pass'],
  ['trailing filler', TOUTATIS, 'Euh, alors, rendons grâce à Toutatis avec ce banquet, euh.', 'pass'],
  // Kid-like partial.
  ['kid partial (brief)', JETTERA, 'on jettera lion rebellion', 'pass'],
  ['kid half of a long line', MARMITE, 'Obélix est tombé dans la marmite de potion', 'pass'],
  ['kid drops the little words', CHAMPIGNONS, 'champignons chapeau blanc taches rouges touche', 'pass'],
  ['kid says only the start of a long line', MARMITE, 'Tout, Obélix est tombé', 'fail'],
  ['kid says one word of a long line', SECRET, 'secret', 'fail'],
  ['kid mumbles the first two words', IMPOSERA, 'et si', 'fail'],
  // Homophones and mis-hearings.
  ['homophones: jetterait, lyon', JETTERA, "On jetterait au lyon ceux qui fomente les rébellion", 'pass'],
  ['homophones: es/est, maladrois', MALADROIT, 'Tu est maladrois Obélix', 'pass'],
  ['homophone: vais/vé, veux/veut', HUTTE, "J'y vé quand je veut dans la hutte du druide et on ira ce soir même", 'pass'],
  ['near words: soumetrai', SOUMETTRAI, 'non jamais je ne me soumetrai a un gallo romain', 'pass'],
  ['numbers as digits vs words', TREFLE, 'Ton trèfle à quatre feuilles !', 'pass'],
  ['numbers: kid says digits the other way', 'Le CAC 40 a perdu 100 points hier.', 'le cac quarante a perdu cent points hier', 'pass'],
  // Joins and splits.
  ['split elision (j ai)', HUTTE, 'j y vais quand je veux dans la hutte du druide et on ira ce soir même', 'pass'],
  ['joined elision (jai, limposera)', IMPOSERA, 'et si tu naimes pas on te limposera', 'pass'],
  ['aujourd hui split', GAULE, 'ouais aujourd hui toute la gaule est occupée', 'pass'],
  ['gallo romain joined', SOUMETTRAI, 'non jamais je ne me soumettrai à un galloromain', 'pass'],
  // Names mangled.
  ['name mangled: Obélisque', MALADROIT, 'Tu es maladroit, Aubélix', 'pass'],
  ['name split: Abra ra courcix', ABRA, 'Abra ra courcix, je viens te défier au combat des chefs', 'pass'],
  ['name mangled: a plus bégalix', APLUS, 'Bonjour à plus bégalix', 'pass'],
  ['name mangled: Metadatta', SECRET, 'eh bien pour te remercier métadatta je vais te confier un secret', 'pass'],
  ['name mangled without accents', APLUS, 'bonjour aplubegalix', 'pass'],
  ['name only, greeting missing', APLUS, 'Aplusbégalix', 'fail'],
  // Wrong sentence (French).
  ['different French sentence', MALADROIT, 'Je suis chef, je te nomme chef.', 'zero'],
  ['different sentence sharing little words', BANNI, 'Je ne sais pas du tout, le chef.', 'zero'],
  ['different sentence sharing a name', MARMITE, 'Obélix a mangé trois sangliers ce soir', 'fail'],
  ['right words, scrambled order', CHAMPIGNONS, 'touche ne on rouges taches et blanc chapeau à champignons', 'fail'],
  ['another line of the same scene', JETTERA, IMPOSERA, 'zero'],
  // English.
  ['English translation', MALADROIT, "You're clumsy, Obelix!", 'fail'],
  ['English sentence', JETTERA, 'We will throw them to the lions', 'zero'],
  ['English filler', CHEF, "I don't know", 'zero'],
  // Silence and noise hallucinations.
  ['hallucination: Amara', JETTERA, "Sous-titres réalisés par la communauté d'Amara.org", 'zero'],
  ['hallucination: merci d avoir regardé', BANNI, "Merci d'avoir regardé cette vidéo !", 'zero'],
  ['hallucination: ST 501', TOUTATIS, "Sous-titrage ST' 501", 'zero'],
  ['hallucination appended to real speech', MALADROIT, "Tu es maladroit Obélix. Sous-titres réalisés par la communauté d'Amara.org", 'pass'],
  ['repeated single token', SOUMETTRAI, 'non non non non non non non non non non', 'zero'],
  ['repeated little word', CHEF, 'je je je je je je je je', 'zero'],
  ['silence', JETTERA, '', 'zero'],
  ['punctuation only', JETTERA, '...', 'zero'],
  ['one syllable', CHEF, 'Ah.', 'zero'],
  ['one syllable that is in the line', CHEF, 'chef', 'zero'],
  ['noise words', SECRET, 'hmm euh bah mmh', 'zero'],
  ['word salad of common words', CHAMPIGNONS, 'le la les de du un une et à on ne je tu il elle nous vous', 'zero'],
  ['real repeats are allowed', NONNON, 'non non non non je vous dis il faut agrandir le stationnement', 'pass'],
  // Units (single words and short expressions).
  ['unit exact', 'aux lions', 'aux lions', 'pass', 'unit'],
  ['unit content word only', 'aux lions', 'lion', 'pass', 'unit'],
  ['unit wrong word', 'aux lions', 'au lit', 'fail', 'unit'],
  ['unit single word with accent missing', 'maladroit', 'maladroit', 'pass', 'unit'],
  ['unit homophone', 'On jettera', 'on jetterait', 'pass', 'unit'],
  ['unit half of the content', 'potion magique', 'potion', 'fail', 'unit'],
  ['unit hallucination', 'potion magique', "Merci d'avoir regardé", 'zero', 'unit'],
  ['unit expression said in full', "Et si tu n'aimes pas", 'et si tu aimes pas', 'pass', 'unit'],
  ['unit name mangled', 'Abraracourcix', 'abracourcix', 'pass', 'unit'],
  ['unit pas vs content', 'faut pas trop compter dessus', 'compter dessus', 'fail', 'unit'],
  ['line with the question form', LIONS, "on va pas dire ça à césar tu veux qu'il nous jette aux lions", 'pass'],
];

describe('scoreSpeech table', () => {
  for (const [label, expected, heard, want, kind] of CASES) {
    it(`${label}: ${want}`, () => {
      const r = scoreSpeech(expected, heard, { kind });
      const detail = `score ${r.score}, heard [${r.heardWords.join(' ')}], matched ${r.matched.map((m) => (m ? 1 : 0)).join('')}`;
      if (want === 'pass') expect(r.pass, detail).toBe(true);
      else expect(r.pass, detail).toBe(false);
      if (want === 'zero') expect(r.score, detail).toBe(0);
    });
  }
  it('has at least 40 cases', () => expect(CASES.length).toBeGreaterThanOrEqual(40));
});

describe('scoreSpeech details', () => {
  it('lights the words that were heard', () => {
    const r = scoreSpeech(JETTERA, 'on jettera lion rebellion');
    expect(r.expectedWords).toEqual(['On', 'jettera', 'aux', 'lions', 'Ceux', 'qui', 'fomentent', 'les', 'rébellions']);
    expect(r.matched).toEqual([true, true, false, true, false, false, false, false, true]);
  });

  it('gives a perfect transcript a full score', () => {
    expect(scoreSpeech(IMPOSERA, "Et si tu n'aimes pas, on te l'imposera").score).toBe(1);
  });

  it('counts little words less than content words', () => {
    const little = scoreSpeech(MALADROIT, 'tu es maladroit').score;
    const content = scoreSpeech(MALADROIT, 'maladroit obélix').score;
    expect(content).toBeGreaterThan(little);
  });

  it('writes numbers in French', () => {
    expect(numberToFrench(4)).toBe('quatre');
    expect(numberToFrench(21)).toBe('vingt et un');
    expect(numberToFrench(71)).toBe('soixante et onze');
    expect(numberToFrench(80)).toBe('quatre-vingts');
    expect(numberToFrench(97)).toBe('quatre-vingt-dix-sept');
    expect(numberToFrench(200)).toBe('deux cents');
    expect(numberToFrench(1999)).toBe('mille neuf cent quatre-vingt-dix-neuf');
  });

  it('gives homophones one phonetic key', () => {
    const same = [
      ['lions', 'lion'], ['vais', 'vé'], ['es', 'est'], ['photo', 'foto'],
      ['chapeau', 'chapo'], ['ça', 'sa'], ['quand', 'kan'], ['veux', 'veut'], ['mais', 'mes'],
    ];
    for (const [a, b] of same) expect(phoneticKey(a!), `${a} ~ ${b}`).toBe(phoneticKey(b!));
    expect(phoneticKey('lion')).not.toBe(phoneticKey('lit'));
  });

  it('has a vocabulary hint with the main names', () => {
    for (const n of ['Astérix', 'Obélix', 'Panoramix', 'Abraracourcix', 'Aplusbégalix', 'Métadata']) expect(SPEECH_HINT).toContain(n);
  });
});


describe('the judge helpers', () => {
  it('soundSpelling writes homophones alike', () => {
    expect(soundSpelling('du pain')).toBe(soundSpelling('du pin'));
    expect(soundSpelling('tout vert')).toBe(soundSpelling('tout vers'));
    expect(soundSpelling('Ils sont fous, ces Romains')).toBe(soundSpelling('Il son fou ses romain'));
    expect(phoneticKey('pain')).toBe(phoneticKey('pin'));
  });

  it('judgeMessages lists the candidates with their sounds, numbered', () => {
    const [sys, user] = judgeMessages(['Il a faim.', '- Toute la Gaule\n- est libre.'], 'tout la gole');
    expect(sys!.role).toBe('system');
    expect(user!.content).toContain('0: "Il a faim." (sounds: ');
    expect(user!.content).toContain('1: "Toute la Gaule est libre."');
    expect(user!.content).toContain('Heard: "tout la gole" (sounds: ');
    expect(judgeMessages(['x'], 'y', { sounds: false })[1]!.content).not.toContain('sounds');
  });

  it('parseJudge reads strict JSON, fenced JSON or an object, and refuses the rest', () => {
    expect(parseJudge('{"attempt": true, "candidate": 0}', 1)).toEqual({ attempt: true, candidate: 0 });
    expect(parseJudge('```json\n{"attempt": false, "candidate": -1}\n```', 1)).toEqual({ attempt: false, candidate: -1 });
    expect(parseJudge({ attempt: true, candidate: 2 }, 3)).toEqual({ attempt: true, candidate: 2 });
    expect(parseJudge({ attempt: 'true' }, 1)).toEqual({ attempt: true, candidate: 0 });
    expect(parseJudge('{"attempt": true, "candidate": 7}', 3)).toBeNull(); // which one?
    expect(parseJudge('yes', 1)).toBeNull();
    expect(parseJudge('{"attempt": maybe}', 1)).toBeNull();
    expect(parseJudge(null, 1)).toBeNull();
  });

  it('lenientPass needs a content word heard and refuses English, silence and credits', () => {
    expect(lenientPass(scoreSpeech('Ils sont fous, ces Romains !', 'Il est fou le roi'))).toBe(true);
    expect(lenientPass(scoreSpeech('Ils sont fous, ces Romains !', 'They are crazy, these Romans.'))).toBe(false);
    expect(lenientPass(scoreSpeech('du pain', "Sous-titrage ST' 501"))).toBe(false);
    expect(lenientPass(scoreSpeech('du pain', ''))).toBe(false);
  });
});
