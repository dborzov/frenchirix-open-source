// Unit tests of the content-word helpers behind the rule that a wrong choice is never close in meaning
// to the right one (docs/app-games.md, "Choices").
import { describe, expect, it } from 'vitest';
import { enContentWords, frContentWords, frenchRelated, frLinesShareWords, linesShareMeaning, sharedEnWords, sharedFrWords } from './distinct';

describe('content words', () => {
  it('drops function words and treats plural and inflected forms as one word', () => {
    expect([...enContentWords('In this world')]).toEqual(['world']);
    expect(sharedEnWords('a world', 'wonderful worlds')).toEqual(['world']);
    expect(sharedEnWords('The dogs are running', 'a dog runs')).toEqual(['dog', 'run']);
    expect(sharedEnWords('He stopped', 'stop it')).toEqual(['stop']);
    expect(sharedEnWords('stories', 'a story')).toEqual(['story']);
    expect([...enContentWords("Oh my, it's the one")]).toEqual([]);
    expect([...enContentWords("Let's go! Don't touch")]).toEqual(['go', 'touch']);
  });

  it('folds French accents, plurals and feminines; skips articles, pronouns and the like', () => {
    expect(sharedFrWords('Un monde', 'Dans ce monde')).toEqual(['mond']);
    expect(sharedFrWords('les Romains', 'une Romaine')).toEqual(['romain']);
    expect(sharedFrWords('manger', 'Mangez !')).toEqual(['mang']);
    expect([...frContentWords("Oh là là, c'est à toi")]).toEqual([]);
    expect([...frContentWords("l'homme")]).toEqual(['homm']);
  });
});

describe('synonym families', () => {
  it('count words of one family as the same word between short choices', () => {
    expect(sharedEnWords('how good it is', 'wonderful')).toEqual(['good']);
    expect(sharedEnWords('there is nothing better', 'how good it is')).toEqual(['good']);
    expect(sharedEnWords('ah okay', 'very well')).toEqual(['okay']);
    expect(sharedEnWords('it is fine', 'okay, okay')).toEqual(['okay']);
    expect(sharedEnWords('oh, I am afraid', 'we fear')).toEqual(['afraid']);
    expect(sharedEnWords("well, I'm off", 'okay')).toEqual([]); // "well" alone is an interjection
    expect(sharedEnWords('wow, great', 'okay')).toEqual([]);
    expect(sharedEnWords('he made me hungry', 'crazy')).toEqual([]); // "made" is not "mad"
  });

  it('leave whole lines to their own threshold', () => {
    expect(linesShareMeaning('We feel good, it is hot / It is nice out', 'We feel good in the land of Panono, yes')).toBe(false);
  });
});

describe('frenchRelated', () => {
  it('relates French sharing a content word, and French without one to itself or what contains it', () => {
    expect(frenchRelated('Un monde', 'Dans ce monde romain')).toBe(true);
    expect(frenchRelated('Un monde', 'merveilleux')).toBe(false);
    expect(frenchRelated('Oh là là', 'oh là là !')).toBe(true);
    expect(frenchRelated('Et toi ?', 'Et toi, alors ?')).toBe(true);
    expect(frenchRelated('Oh là là', 'Et toi ?')).toBe(false);
  });
});

describe('whole lines', () => {
  it('lets lines share up to half of what they say, not more', () => {
    // 2 of 4 content words: told apart when heard in full (the Panono song).
    expect(linesShareMeaning('We feel good, it is hot / It is nice out', 'We feel good in the land of Panono, yes')).toBe(false);
    expect(linesShareMeaning('Ah yes, it is good, yes, it is good.', 'Yeah, yeah, it is good.')).toBe(true);
    expect(linesShareMeaning('Madame Arbre…', 'Madame Arbre, all is well')).toBe(true);
    expect(linesShareMeaning('Oh my', 'Oh my')).toBe(false); // no content word: left to nearlyEqual
  });

  it('finds French lines that say mostly the same words', () => {
    expect(frLinesShareWords('On est bien au pays de Panono', 'On est bien au pays de Panono, oui')).toBe(true);
    expect(frLinesShareWords('Madame Arbre, tout va bien', 'Allez, chante avec tes copains')).toBe(false);
  });
});
