# Show context

Background on the show for anyone who selects, transcribes, annotates or writes content for its scenes, and for the LLMs that do it ([content-steps.md](content-steps.md)). Read it before working on any episode's subtitles, transcript or scenes. It is the context file of the show this project was built on, and the worked example of the one you write for another show ([runbook.md](runbook.md), "Another show or your own video sources"): replace it, keeping its path and the character table's format. It covers the names, who is who, the running jokes and how some characters speak. Spellings come from the show's own French subtitle tracks (all five episodes); where the web disagreed, the subtitles won. Items marked (unconfirmed) were not verified.

`frenchirix/annotation.py` reads every Markdown table row in this file to find the English subtitle renames (French name in the first column, English subtitle name in the second). Keep the file's path and the character table's format, and add no other tables.

## What the show is

*Astérix & Obélix : Le Combat des chefs* (English: *Asterix & Obelix: The Big Fight*) is a French 3D animated miniseries of five episodes, released on Netflix on 30 April 2025. It was created by Alain Chabat (who also voices Astérix), Benoît Oullion and Pierre-Alain Bloch, and directed by Chabat and Fabrice Joubert. It reworks the 1966 Goscinny and Uderzo album *Le Combat des chefs*, adds an origin story (episode 1) and an original finale (episode 5), and invents several characters. (These facts are from the web, not checked against the show.)

Tone: fast, dry, modern-sounding comedy in a Roman-Gaul setting. Expect:

- **Name puns**: every Gaulish name ends in "-ix", Roman ones in "-us". Characters invent puns on the spot, and the Gauls even rename themselves with "-us" names in episode 2.
- **Anachronisms**: social media ("Dimilliondeclix", "Continsta"), Wikipédia, Netflix, stock indexes (CAC), a TV-style sports broadcast with two commentators, and Panoramix's dream styled like a show for little children (Panono).
- **Pop culture and parody**: Fast & Furious, Hanna-Barbera, Miley Cyrus, "Buona Sera", Yellow Submarine.
- **Political and office satire**: Caesar's court is a corporate-style management team, with campaign speeches, buzzwords, flattery and a chief who has to pick a first political decision.
- **Wordplay with Latin and Gaulish gods**: Toutatis, Bélénos, Taranis, Bélisama against Jupiter, Mars, Mercure, Junon, Vulcain.

## Plot

In 50 BC the one Gaulish village that resists Rome stays strong because of the druid Panoramix's magic potion. Caesar, advised by his young archivist Métadata, stages a "Combat des chefs" in a Roman arena: if the Gaulish chief Abraracourcix loses to the Gallo-Roman chief Aplusbégalix, the village falls under Roman control. Obélix accidentally knocks Panoramix out with a menhir, and the druid loses his memory and his mind, so the potion cannot be made. Astérix and Obélix try to cure him and keep the village in the fight.

## Episodes

- **S01E01.** Flashback: Astérix and Obélix as children; Obélix falls into the cauldron and keeps the strength for good. Then the village in the present.
- **S01E02.** Métadata proposes the Big Fight to Caesar and is told to organise it (he keeps getting her name wrong). Panoramix is kidnapped by the Romans and hit by Obélix's menhir; Aplusbégalix agrees to fight and the village goes "Gallo-Roman". The Gauls rename themselves with "-us" names.
- **S01E03.** Panoramix can now only brew unstable potions. They test them on the captured Roman Potus. Obélix's menhir also drives the druidess Apothika mad. The episode opens inside Panoramix's addled head: a dream styled like a show for little children, where he is Panono, "le gentil druide"; it ends with him standing in the village staring at the sun.
- **S01E04.** Opens with a song about the whole story. The arena is ready and Caesar arrives. Obélix is made interim chief, announces a wild-boar shop (a "sangliérie"), and banishes Astérix from the village. Commentators Annabarbera and Blackangus cover the fight. Obélix faints during the pre-fight speech and Aplusbégalix wins by default.
- **S01E05.** Astérix challenges Caesar, and a brawl starts. Aplusbégalix accidentally restores Panoramix's sanity. Métadata changes sides; the Romans steal a potion that Panoramix had sabotaged, and their troops float and glow. Caesar lets the village off.

(These summaries follow Wikipedia and a spot check of the subtitles, not a full reading of every episode.)

## Characters

The French name is the key. "EN subs" is the spelling in the untitled English subtitle track (a translation of the French subtitles). "EN dub" is given only where the British dub tracks differ. Names marked * are inventions of this series.

| French | EN subs | EN dub | Who | Pun or note |
|---|---|---|---|---|
| Astérix | Asterix | | Clever small Gaulish warrior | astérisque |
| Obélix | Obelix | | His huge friend, menhir deliveryman, fell into the potion as a child | obélisque |
| Idéfix | Dogmatix | | Obélix's small dog | idée fixe |
| Panoramix | Panoramix (kept in subs) | Getafix | The village druid; the plot's amnesiac | |
| Abraracourcix | Vitalstatistix | | Village chief | "à bras raccourcis" (fists out) |
| Bonemine | Impedimenta | | His wife | "bonne mine" |
| Mimine | Peddy | Pidiped | Abraracourcix's pet name for Bonemine | |
| Cochonnet | Piggywiggy | | Her pet name for him | "little piglet" |
| Agecanonix | Geriatrix | | The village elder, becomes a chief candidate | "âge canonique" |
| Cétautomatix | Fulliautomatix | | The blacksmith | "c'est automatique" |
| Assurancetourix | Cacofonix | | The bard | "assurance tous risques" |
| Ordralfabétix | Unhygienix | | The fishmonger | "ordre alphabétique" |
| Iélosubmarine | Bacteria | | His wife | "yellow submarine" |
| Barbix | Beardix | | Panoramix's own beard, which he holds up and voices like a puppet in a high voice (episodes 2 and 4) | "barbe" (beard) |
| Toutétobofix | Copacetix | | A chief greeted in episode 1 | "tout est beau" (unconfirmed) |
| Aplusbégalix | Cassius Ceramix | | Gallo-Roman chief who fights Abraracourcix | |
| Sucettalanix | Sycophantix | | His flatterer | |
| Dimilliondeclix / Dimilliondevus | Tenmillionclix / Tenmillionviews | | A follower renamed in episode 2 | "dix millions de clics" |
| César (Jules César) | Caesar (Julius Caesar) | | Roman dictator | |
| Métadata* | Metadata | | Caesar's young archivist | |
| Fastanefurius* | Fastanfurius | | Roman officer | Fast & Furious |
| Potus* | Potus | | A Roman, captured and used for potion tests | |
| Apothika* | Apothika | | A Goth druidess and Panoramix's friend, a healer | |
| Annabarbera* | Hannabarbera | | Arena TV commentator | Hanna-Barbera |
| Blackangus* | Blackangus | | The other commentator, southern accent | Black Angus beef |
| Touinepix* | Twinpix | | Referee at the weigh-in | |
| Panono* | Panono | | Panoramix as he sees himself in his dream since the menhir hit him: the "gentil druide" of a world styled like a show for little children (episodes 3 and 5; nobody else watches it) | |
| Madame Arbre*, Groin-Groin* | Mrs. Tree, Oink-Oink | | Characters of Panoramix's Panono dream: Groin-Groin is a pig; Madame Arbre means Mrs. Tree (what she looks like: unconfirmed) | |
| Bibus | Bibus | | Labelled in the SDH track, episode 3; unknown (unconfirmed) | |
| Vercingétorix, Brennus, Pompée, Cléopâtre | same | | Historical names mentioned in passing | |

Places: Lutèce = Lutetia (Paris), Armorique = Armorica, Lugdunum, Pompéi, Venise. Gods in speech are always French forms (Toutatis, Bélénos, Taranis, Jupiter).

## Caesar and Métadata: the name gag

Caesar never gets his archivist's name right. The subtitles show him calling her Continsta (Manygiga in the English subs, Insta in the dub), Bigfarma and Wikipédia. She corrects him ("Je m'appelle Métadata"). Treat each as a spoken name, not a different character. Other nicknames from Caesar: Fabrice, Sylvain, Jules (what the crowd calls him). "Netflix" is not one of her names: in episode 5's last scene, at the chief's home, someone says « Alors, Netflix, on en était où ? » the way one talks to a streaming service, and it answers « Précédemment » and « Tou doum ! ».

## Gags and terms

- **"Noms en -us"**: Gallo-Roman renaming in episode 2 ("Nous sommes gallo-romains, par Jupiter et Toutatis").
- **The sangliérie**: Obélix's first political decision as chief, a wild-boar shop. The sangliérie jokes recur in episode 4.
- **The potion**: "la potion magique", Obélix "tombé dedans quand il était petit"; Obélix can never have any.
- **The menhir**: Obélix's menhir hits keep causing trouble.
- **"Ave"** / "Ave César": Roman greeting. "Les Romains", "les Gaulois", "Gallo-Romains" appear in nearly every episode.
- **Songs**: episode 4 opens with the story song, and Bonemine and Obélix sing in other places. The Panono song runs "Panono, Panini, Panonino, Panini".

## How characters speak

- **Lisp ("zozote")**: legionnaires, labelled `[zozote]` in the SDH track (episodes 2, 4, 5). Words with s/ch come out as "z". Trust the French subtitle over the recognition output.
- **Southern French accent**: Blackangus (`[accent du Sud]`).
- **German accent**: Apothika and one other speaker (`[accent allemand]`), unconfirmed which.
- **Sound effects**: Idéfix only barks and whimpers; Potus mostly whimpers and groans.
- **Speech recognition**: expect "Astérix" fine but "Obélix", "Aplusbégalix", "Abraracourcix", "Fastanefurius", "Iélosubmarine" and the "-ix" and "-us" puns mangled. The French SDH track has the speaker label in square brackets.
