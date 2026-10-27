# Mode pellicule pour Ricoh GR III / GR IIIx

Fork de [GR Mod](https://github.com/Maxwooow/Ricoh-GRMod) (GPL-2.0-only).
Cibles : GR III firmware 2.10, GR IIIx firmware 1.60. Selon l'auteur de GR Mod, c'est le même programme avec les mêmes adresses : tout ce qui est développé fonctionne sur les deux boîtiers.

## Objectif

Retrouver la discipline de l'argentique sur un GR : on charge une pellicule (un film et un format), puis on ne peut plus y toucher jusqu'à la fin du rouleau. Chaque vue s'arme en avançant le film. Sans avance, les déclenchements se superposent sur la même vue.

## Principes de conception

- Réutiliser au maximum les fonctions natives du GR plutôt que de créer de nouvelles interfaces.
- Le choix du film et du format se fait avec les menus normaux, avant le chargement.
- Le verrou s'appuie sur celui que le GR applique déjà pendant une multi-exposition.
- Chaque mode U (U1, U2, U3) est un boîtier indépendant avec sa propre pellicule.

## Cycle de vie d'un rouleau

1. **Préparer** : choisir l'Image Control (le film) et le ratio (le format) avec les menus natifs.
2. **Charger** : ligne de menu « Pellicule : Charger ». Le firmware crée un dossier dédié, fige les réglages et affiche la vue 1.
3. **Photographier** : le GR reste en multi-exposition pendant tout le rouleau.
   - Déclencheur : prend la photo. Si la vue n'a pas été avancée, la photo se superpose à la précédente (équivaut à « Next shot »).
   - ADJ vers la droite : avance le film (équivaut à « Complete »). La vue est enregistrée, le compteur passe à la vue suivante.
4. **Fin du rouleau** : à la dernière vue avancée, le rouleau est terminé et les réglages se déverrouillent.
5. **Rembobiner** (issue de secours) : ligne de menu « Rembobiner », avec confirmation. Termine le rouleau avant la fin.

## Règles

### Compteur
- Il affiche le numéro de la vue à prendre, comme sur un argentique : 1 après le chargement, puis 2, 3...
- Il s'incrémente à chaque avance du film (« Complete »), pas au déclenchement.
- Éteindre l'appareil en cours de surimpression enregistre la vue (comportement natif) : cela compte comme une avance.
- Affichage à l'écran : on réutilise le compteur de vues restantes de la carte, qui affiche le numéro de vue pendant un rouleau.
- Le numéro de vue est aussi incrusté sur la photo, à côté de la date (style dos dateur).

### Longueur du rouleau selon le format
| Ratio | Équivalent | Vues |
|---|---|---|
| 3:2 | 35 mm plein format | 36 |
| 3:4 vertical | Demi-format (18 x 24 mm, cadrage environ 40 mm) | 72 |
| 65:24 | XPan | 21 |
| 4:3 | Moyen format 6x4,5 | 15 |
| 1:1 | Moyen format 6x6 | 12 |

La longueur se déduit du ratio mémorisé : aucune donnée supplémentaire à stocker.
Le ratio 3:4 vertical (3000 x 4000, recadrage central) est à ajouter.

### Verrou pendant un rouleau
Réglages bloqués : Image Control, ratio, recadrage, format de fichier (JPEG seul), taille JPEG, balance des blancs, mode de déclenchement (multi-exposition).
C'est exactement la liste que le GR bloque nativement pendant une multi-exposition (manuel p. 78). Le verrou consiste à étendre cette condition native : « multi-exposition en cours OU rouleau chargé ».

### Stockage
- Un dossier par rouleau, créé au chargement par la fonction native « Create New Folder ».
- Nom du dossier : numéro + code du film sur 5 caractères (exemples : `101CCHRM`, `102LEICA`, `103XPAN_`). Version 1 : nom natif, code du film ensuite.
- Chaque mode U mémorise le numéro de son dossier. En revenant sur un mode U, ses photos repartent dans son dossier.

### Modes U
- U1, U2 et U3 ont chacun leur pellicule, leur compteur et leur dossier.
- Passer d'un mode U à l'autre ne perd rien : chaque rouleau reprend où il en était.

### Cas particuliers
- Carte changée ou dossier supprimé en cours de rouleau : on crée un nouveau dossier et le rouleau continue, compteur intact. C'est l'équivalent d'une pellicule sortie puis rechargée.

## Réglages natifs recommandés
- Multi-exposition, mode de composition **Additif** (accumulation de lumière, comme le film). Comme en argentique, sous-exposer d'environ 1 IL pour une double exposition.
- **Save Interim Images : Off**. Seule l'image finale est enregistrée, au moment de « Complete » (vérifié sur le boîtier).

## Briques techniques

Sources : code de GR Mod (`core/src/fw/gr3x`) et réponse de son auteur, Maxwooow, sur l'issue GitHub. Adresses valables pour GR III 2.10 et GR IIIx 1.60.

| Brique | État | Détails |
|---|---|---|
| Hook à chaque image encodée | Connu, testé | Début de `JpegEncodeMacroProcess::Execute` (`0x535047d4`). `jpeg-stage.ts` y enchaîne les modules (halation puis date). |
| Incrustation sur la photo | Connue, testée | `datestamp.ts` (module C de `tools/datestamp/datestamp.c`, compilé pour GR III) |
| Objet des réglages | Connu | `UserDataModel` à `0x55063f30`. Enregistrement en cours à +4 (`*0x55063f34`), enregistrements stockés (modes, U1 à U3) de +8 à +0x20, chacun de `0xb28` octets, sauvegardés et chargés en bloc. |
| Sauvegarde des réglages | Connue, testée | Uniquement à l'extinction (`0x5323f274`, appelée en fin de `0x5322b0a8`). **La veille automatique ne sauvegarde pas**, le retrait de batterie non plus : le mode pellicule devra sauvegarder lui-même. |
| Rappel d'un mode U | Connu | Copie de l'enregistrement stocké vers celui en cours (memcpy à `0x5327a004`, `0xb26` octets) |
| Film du réglage photo n | Connu | Offset `+0x1c2 + 2n`. Fonctions de modification : `0x5327b394`, `0x5327b3b4`, `0x5327b3d4` (vidéo à partir de `0x5327b54c`, voir `films-r10.ts`) |
| Ratio | Connu | Offset `+0x4c2`. Lecture `0x53245260`, modification `0x532525a4` (voir `experimental.ts`) |
| Garde-fou des réglages | Connu | `guard.ts` s'accroche au chargement, à la sauvegarde et au rappel de mode. Bon endroit pour garder un rouleau verrouillé cohérent. |
| Ligne de menu ajoutée | Méthode connue | `datestamp.ts` documente l'ajout de la ligne Date Imprint et de son sous-menu (identifiants de contrôleurs, listes, textes, icônes). « Charger la pellicule » suivra le même modèle. |
| Octet de stockage du rouleau | Testé sur le boîtier | Persistants après extinction, propres à chaque mode (build `T10-FILMPROBE`, 2026-10-27). `0x9b1`, `0x9b2`, `0x9b3` : bourrage après le drapeau `0x9b0`, même situation que `0x9a9` à `0x9ab` (GR Mod, testés). Aucun accès du firmware officiel, mis à 0 par les valeurs d'usine, copiés en bloc (chargement, sauvegarde, modes U). Identique sur GR IIIx. Preuves : `docs/film-mode-notes.md`, sonde `tools/gr3x/settings_layout_probe.py`. Réserve : `0x905` à `0x907`. |
| Carte des champs de l'enregistrement | Connue (émulée) | Fusion avec les valeurs d'usine `0x53246df8` : 1043 champs { valeur ; drapeau }, 253 octets de bourrage. Valeurs d'usine `0x5323f424`. |
| Mode U actif, enregistrer dans un mode U | Connus (statique) | Numéro du mode actif : octet pointé par `*UserDataModel`. Enregistrer dans le mode n : `0x5324b760`. Le rappel (`0x53279fa8`) ne sauvegarde que le mode 0 avant de changer. |
| BOX de réglages (Save Settings, BOX1 à BOX6) | Comprises (testé) | Copies stockées 1 à 6 de l'objet des réglages = BOX1 à BOX6 ; copie 0 = réglages du boîtier. U1, U2, U3 rappellent chacune une BOX (testé : U1 = BOX3, U2 = BOX2, U3 = BOX5). Octet du mode actif = numéro de BOX. Le rappel d'une BOX par le menu la recopie dans les réglages du boîtier, état du rouleau compris. Demande : un rouleau par BOX, et passer à 20 BOX (chantier important : objet, stockage, menus). |
| Détection d'une prise de vue | Testée sur le boîtier | `SetShootingInfoResultBeforeExpose` (`0x534322d8`), appelée par `StartStillExpopsureProcess` uniquement pour une exposition de type 1 (photo) : pas pour la dark frame de la réduction du bruit, ni pour la calibration, ni pour le développement RAW. Déjà accrochée par GR Mod (orientation). Testé (`T10-FILMPROBE2`) : +1 par photo, +3 pour une multi-exposition de 3 vues, +0 au développement RAW, +1 pour une pose longue. Encodeur exclu (testé : développement RAW +1, multi-exposition 2 encodages par vue). Détails : `docs/film-mode-notes.md`. |
| Condition de verrou en multi-exposition | À trouver | |
| Dialogue Next shot / Retake shot / Complete et ses touches | À trouver | |
| Événement « Complete » | À trouver | |
| Fonction du compteur de vues restantes | À trouver | |
| Fonction de création de dossier et nom sur 5 caractères | À trouver | |
| Variable du dossier en cours et écriture dans un ancien dossier | À trouver et tester | |

### Points de vigilance (conseils de l'auteur de GR Mod)
- **Compter les captures, pas les encodages.** L'encodeur JPEG tourne aussi pour le développement RAW intégré.
- **Les réglages ne sont sauvegardés qu'à l'extinction.** Retirer la batterie sans éteindre fait perdre l'état depuis l'allumage.
- **Rouleau par mode U.** Le rappel d'un mode U recopie son enregistrement stocké dans l'enregistrement en cours. Il faut donc réécrire le compteur et l'état du rouleau aussi dans l'enregistrement stocké du mode actif, sinon ils repartent à zéro à chaque rappel.

## Plan de développement

1. **Chaîne d'outils** : compiler GR Mod, flasher un firmware maison. **Fait** : firmware maison flashé et validé sur le GR III, démarrage aussi rapide qu'avec le firmware officiel.
2. **Cartographie** : trouver les éléments « À trouver » ci-dessus. Priorité : octet de stockage, détection d'une prise de vue, condition de verrou en multi-exposition, événement « Complete ».
3. **Compteur provisoire** dans le hook JPEG, incrusté avec la date, en ne comptant que les captures (pas le développement RAW intégré).
4. **Ligne de menu « Pellicule »** : Charger, numéro de vue, Rembobiner. État persistant.
5. **Verrou** : extension de la condition native.
6. **Multi-exposition** : déclencheur pour Next shot, ADJ droite pour Complete, compteur sur Complete.
7. **Dossiers** par rouleau et par mode U, compteur à l'écran.

Chaque étape suit le même cycle : test en émulateur, flash, essai sur le boîtier, retour au firmware officiel si besoin.

## Évolutions envisagées
- Reprendre une surimpression après extinction et rallumage (réinjection de l'image, probablement via le développement RAW intégré).
- Une ou deux vues bonus en fin de rouleau, comme sur une vraie 36 poses.
- Vue de sécurité sautée après une pellicule « rechargée ».
- Liste blanche des entrées du menu principal.

## Licence
GPL-2.0-only, comme GR Mod. Tout firmware partagé s'accompagne de son code source (ce dépôt).
