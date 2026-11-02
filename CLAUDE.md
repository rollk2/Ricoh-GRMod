# CLAUDE.md

Fork de GR Mod pour développer un « mode pellicule » sur Ricoh GR III, firmware 2.10
(le GR IIIx 1.60 partage les mêmes adresses).

**Lire d'abord `CAHIER_DES_CHARGES.md` à la racine** : projet, règles décidées, briques techniques
(dont les adresses fournies par Maxwooow), plan par phases. Les découvertes sont consignées dans
`docs/film-mode-notes.md`.

Code de référence : `core/src/fw/gr3x`, en particulier `jpeg-stage.ts`, `datestamp.ts`, `guard.ts`,
`adj-softfocus.ts`, `experimental.ts`, `films-r10.ts`. Les sondes d'émulation (Unicorn) sont dans
`tools/gr3x/*_probe.py`.

## Profil de l'utilisateur

Architecte data, à l'aise avec la technique, débutant en reverse engineering et en embarqué ARM.
Expliquer la démarche, les termes nouveaux et ce qui est fait, sans noyer.

## Règles de travail

1. Ce fichier reprend les règles et pointe vers le cahier des charges ; le tenir à jour.
2. Travailler sur une branche dédiée au mode pellicule, jamais directement sur `main`.
   Ne pousser sur GitHub qu'après accord explicite de l'utilisateur.
3. Avancer étape par étape : proposer un plan, attendre le feu vert avant chaque étape importante.
4. Consigner chaque découverte (adresse, fonction, preuve, niveau de certitude) dans
   `docs/film-mode-notes.md`, et mettre à jour le tableau des briques du cahier des charges.
5. Tout changement doit être vérifié par les tests et l'émulateur avant que l'utilisateur flashe.
   Dire clairement quand un build est prêt à être testé sur le boîtier, et ce qu'il faut vérifier.
6. Répondre en français. Ne jamais utiliser de tiret cadratin ni de tiret demi-cadratin.

## Environnement

- Firmwares officiels : `core/testdata/private`, variables `GRMOD_GR3_FIRMWARE` (fwdc239b.bin, 2.10)
  et `GRMOD_GR3X_FIRMWARE` (fwdc243b.bin, 1.60). Ils ne sont pas dans le dépôt : les tests qui en
  dépendent sont sautés sans eux.
- Tests : `npm test`. Application : `shell/build.sh mac`.
