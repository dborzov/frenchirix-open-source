"""Splitting French text into words.

One definition shared by annotation import (which creates the `words` rows) and
forced alignment (which gives them timings). Both must agree on what word N of a
line is, so neither may tokenise on its own.
"""

from __future__ import annotations

import re

_TOKEN = re.compile(r"\S+")


def split_words(text: str) -> list[tuple[str, int, int]]:
    """The words of `text`, in order, as (word, char_start, char_end).

    A word is a whitespace-delimited token containing at least one letter or digit,
    with punctuation stripped from both ends. Elided and hyphenated forms stay one
    word ("J'en", "peut-être", "re-renomme"), and so do numbers ("49.3"). Tokens made
    only of punctuation ("?", "-", "…") are not words. `text[char_start:char_end]`
    is the word.
    """
    words = []
    for match in _TOKEN.finditer(text):
        token = match.group()
        start, end = 0, len(token)
        while start < end and not token[start].isalnum():
            start += 1
        while end > start and not token[end - 1].isalnum():
            end -= 1
        if start < end:
            words.append((token[start:end], match.start() + start, match.start() + end))
    return words
