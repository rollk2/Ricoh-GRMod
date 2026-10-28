# Mode pellicule pour Ricoh GR III / GR IIIx

Fork de [GR Mod](https://github.com/Maxwooow/Ricoh-GRMod) (GPL-2.0-only).
Cibles : GR III firmware 2.10, GR IIIx firmware 1.60. Selon l'auteur de GR Mod, c'est le même programme avec les mêmes adresses : tout ce qui est développé fonctionne sur les deux boîtiers.

## Objectif

Retrouver la discipline de l'argentique sur un GR : on charge une pellicule (un film et un format), puis on ne peut plus y toucher jusqu'à la fin du rouleau. Chaque vue s'arme en avançant le film. Sans avance, les déclenchements se superposent sur la même vue.

## Principes de conception

- Réutiliser au maximum les fonctions natives du GR plutôt que de créer de nouvelles interfaces.
- Le choix du film et du format se fait avec les menus normaux, puis s'enregistre dans une BOX avec Save Settings (natif).
- **Une BOX = un rouleau.** Une ligne de menu « Film Roll Mode : On / Off » (Customize Settings, sous Save Settings ; nom traduit dans les 21 langues du boîtier) est enregistrée dans la BOX avec les autres réglages.
- Le verrou s'appuie sur celui que le GR applique déjà pendant une multi-exposition.
- Chaque mode U (U1, U2, U3) rappelle sa BOX : si elle a le mode pellicule sur On, c'est un boîtier indépendant avec sa propre pellicule ; sinon, une BOX normale.
- P, Av, Tv, M (et les autres positions de la molette) restent toujours en mode libre : jamais de pellicule, aucun effet du mod sur leurs dossiers.

## Cycle de vie d'un rouleau

1. **Préparer** : régler l'Image Control (le film), le ratio (le format) et le reste avec les menus natifs, mettre « Film Roll Mode » sur On (menu Customize Settings, sous Save Settings), puis faire Save Settings dans une BOX. La ligne n'apparaît pas en P, Av, Tv, M (masquée ; grisée si le mécanisme est trouvé).
2. **Démarrer** : le rouleau démarre à la **première vue** prise dans un mode U dont la BOX a le mode pellicule sur On. Aucune action de menu. Le firmware crée alors le dossier du rouleau, force Save Interim Images à Off et le mode d'entraînement en multi-exposition (au rappel du mode U), et verrouille les réglages.
3. **Photographier** : le GR reste en multi-exposition pendant tout le rouleau.
   - Déclencheur : prend la photo. Si la vue n'a pas été avancée, la photo se superpose à la précédente (équivaut à « Next shot »).
   - ADJ vers la droite : avance le film (équivaut à « Complete »). La vue est enregistrée, le compteur passe à la vue suivante.
4. **Fin du rouleau** : à la dernière vue avancée, le rouleau est terminé. Idéal visé : un **message de fin de rouleau** qui propose de changer de pellicule (réglages de la BOX). À défaut, la vue suivante démarre **automatiquement un nouveau rouleau** (nouveau dossier, compteur à 1), avec les mêmes réglages de BOX.
5. **Rembobiner** : mettre « Film Roll Mode » sur Off termine le rouleau en cours. Faire Save Settings par-dessus la BOX d'un rouleau entamé a le même effet : le rouleau est terminé, et si la nouvelle BOX a le mode pellicule sur On, un nouveau rouleau démarre à la première vue.

Pour des photos normales, on passe en P, Av, Tv ou M, jamais touchés par le mod.

## Règles

### Compteur
- Il affiche le numéro de la vue à prendre, comme sur un argentique : 1 après le chargement, puis 2, 3...
- Il s'incrémente à chaque avance du film (« Complete »), pas au déclenchement.
- Éteindre l'appareil en cours de surimpression enregistre la vue (comportement natif) : cela compte comme une avance.
- Affichage à l'écran : on réutilise le compteur de vues restantes de la carte (en haut à droite), qui affiche **vue / total** pendant un rouleau (exemple : `12/36`), le total selon le format.
- Rien n'est incrusté sur la photo (décision du 2026-10-28).

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
Réglages bloqués : Image Control, ratio, recadrage, format de fichier (JPEG seul ; **à étudier** : imposer le JPEG au démarrage du rouleau, comme Save Interim Images, sachant que la multi-exposition native accepte le RAW : superposition finale en DNG constatée le 2026-10-27), taille JPEG, balance des blancs, mode de déclenchement (multi-exposition), Save Interim Images (forcé à Off au chargement).
C'est exactement la liste que le GR bloque nativement pendant une multi-exposition (manuel p. 78). Le verrou consiste à étendre cette condition native : « multi-exposition en cours OU rouleau chargé ». **Constat (2026-10-27) :** ouvrir le MENU pendant une multi-exposition termine la séquence (comme Complete) ; le menu principal n'a donc pas de verrou natif et devra être verrouillé par le mod pendant un rouleau.

### Stockage
- Un dossier par rouleau, créé au démarrage du rouleau (première vue). Méthode testée : nom sur 5 caractères puis demande de nouveau dossier, ou numéro imposé à `SetFilePath` (un dossier imposé qui n'existe pas est créé).
- L'état du rouleau (mode pellicule, rouleau entamé, numéro de vue, numéro de dossier) est rangé dans des octets libres de l'enregistrement des réglages : il suit la BOX (Save Settings, rappel par U1 à U3).
- Nom du dossier : numéro + code du film sur 5 caractères (exemples : `101CCHRM`, `102LEICA`, `103XPAN_`). Version 1 : nom natif, code du film ensuite.
- Chaque mode U mémorise le numéro de son dossier. En revenant sur un mode U, ses photos repartent dans son dossier.

### Modes U
- Seuls U1, U2 et U3 peuvent porter un rouleau, quand leur BOX a le mode pellicule sur On. Chacun a sa pellicule, son compteur et son dossier.
- P, Av, Tv, M restent libres : le boîtier y gère ses dossiers comme d'origine.
- Passer d'un mode U à l'autre ne perd rien : chaque rouleau reprend où il en était.

### Cas particuliers
- Carte changée ou dossier supprimé en cours de rouleau : on crée un nouveau dossier et le rouleau continue, compteur intact. C'est l'équivalent d'une pellicule sortie puis rechargée.

## Réglages natifs recommandés
- Multi-exposition, mode de composition **Additif** (accumulation de lumière, comme le film). Comme en argentique, sous-exposer d'environ 1 IL pour une double exposition.
- **Save Interim Images : Off**, imposé par le mod au chargement (décision du 2026-10-27). Seule l'image finale est enregistrée, au moment de « Complete » (vérifié sur le boîtier). Avec On, le boîtier isole nativement la séquence dans un nouveau dossier, avant et après (testé) : avec un dossier de rouleau imposé, la photo suivante dans un mode libre partirait dans un nouveau dossier.

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
| Condition de verrou en multi-exposition | État testé, sites à trier | Octet d'état `+0x6c0` de l'enregistrement de prise de vue en direct (lecture `0x535493ac`, écriture `0x5354700c`). Testé (`T10-FILMPROBE3`) : 2 pendant une multi-exposition, 0 sinon. Le verrou natif teste « état == 2 » (18 sites `cmp r0,#2`, dont la disponibilité des fonctions ADJ `0x531a4d38`). À trier : sites d'interface et de traitement. |
| Dialogue Next shot / Retake shot / Complete et ses touches | En grande partie connu (statique) | Événements d'interface 0xb8 (fin) et 0xb7 (Retake) ; actions `0x532270f4` / `0x532270d4` ; modèle `0x5323a080` / `0x5323a1a4` (si état 2) ; commandes `0x42411c16` / `0x42411817` (`CMD_SHOOTING_MULTI_EXPOSURE_END` / `RETAKE`). Le dialogue est l'aperçu après la vue (`QuickViewController`, table de touches `0x53b41344`). Reste : identifier les touches et les neuf émetteurs de 0xb8. |
| Événement « Complete » | Testé sur le boîtier | `0x5346a910` (message `0x42411c16`) : une fois par fin de séquence, que ce soit Complete, une extinction ou un changement de mode (testé). Après l'encodage de l'image finale pour Complete. Retake : `0x5346a8d8` (message `0x42411817`, testé). |
| Fonction du compteur de vues restantes | Testée sur le boîtier | Getter `0x53239e34` (`+0x3c` du modèle de prise de vue), un seul appelant : texte `0x532aa1d4` → `0x532aa140` (`%d`, tampon de 6 caractères), affiché par `LiveViewController`. Substitution en `0x532aa1f4` testée (`T10-FILMPROBE5` : l'écran affiche le nombre choisi, le déclenchement n'est pas gêné). |
| Fonction de création de dossier et nom sur 5 caractères | Testées sur le boîtier | **Nom natif de 5 caractères** dans les réglages : `+0x936` (setter `0x5326caa0`, global), type de nom `+0x934` (setter `0x53258604`, 1 = nom libre). « Create New Folder » = drapeau : `0x5358515c(0x53584c74(), 1)` ; le dossier `NNNXXXXX` est créé à l'enregistrement suivant, image superposée comprise (testé, `T10-FILMPROBE5`). |
| Variable du dossier en cours et écriture dans un ancien dossier | Lecture et écriture testées (`T10-FILMPROBE6` à `8`) ; effet de bord expliqué (vues intermédiaires, réglé par Save Interim Images Off) | Pas de variable « dossier en cours » : le boîtier vise toujours le plus grand dossier. Mais `SetFilePath` `0x535b2e8c` prend le numéro de dossier fourni dans son argument chemin (demi-mot `+4`) s'il n'est pas 0, sans rien créer si le dossier existe. Base des dossiers `[[service+8]+8]` : table `+0x10`, plus petit `+0x28`, plus grand `+0x2a`. |
| Save Interim Images | Trouvé (statique, libellés relevés) | Octet `+0x482` de l'enregistrement (champ de BOX) : 0 Off, 1 Unblended, 2 Blended, 3 Unblended + Blended. Getter `0x532451d0`, setter `0x53262990(UserDataModel, valeur)`. |
| État du rouleau, compteur, sauvegarde immédiate | Testés sur le boîtier (`T11-ROLL1`) | `film-roll.ts` : démarrage à la première vue en U, avance à chaque fin de séquence, écriture immédiate des fichiers `APData` (`0x53826c54`, index 1 et mode + 2 ; survit au retrait de la batterie), Save Settings rembobine, Save Interim Images à Off au rappel. |
| Dossier du rouleau | Testé sur le boîtier (`T11-ROLL2D`) | Crochet de `SetFilePath` : premier fichier d'un rouleau dans le prochain nouveau dossier (`0x535b742c`), mémorisé dans la BOX, puis retour dans ce dossier ; P ouvre son propre dossier quand le plus grand est celui d'un rouleau. |
| Compteur vue/total à l'écran, multi-exposition imposée | Testés sur le boîtier (`T11-ROLL3`) | Le crochet du compteur écrit `vue/total` par `snprintf` (`0x53141100`, format `"%d/%d"` du firmware `0x53c0ca59`) ; mode d'entraînement `+0x472` mis à 3 (multi-exposition) au rappel d'un mode U. |

### Points de vigilance (conseils de l'auteur de GR Mod)
- **Compter les captures, pas les encodages.** L'encodeur JPEG tourne aussi pour le développement RAW intégré.
- **Les réglages ne sont sauvegardés qu'à l'extinction.** Retirer la batterie sans éteindre fait perdre l'état depuis l'allumage.
- **Rouleau par mode U.** Le rappel d'un mode U recopie son enregistrement stocké dans l'enregistrement en cours. Il faut donc réécrire le compteur et l'état du rouleau aussi dans l'enregistrement stocké du mode actif, sinon ils repartent à zéro à chaque rappel.

## Plan de développement

1. **Chaîne d'outils** : compiler GR Mod, flasher un firmware maison. **Fait** : firmware maison flashé et validé sur le GR III, démarrage aussi rapide qu'avec le firmware officiel.
2. **Cartographie** : trouver les éléments « À trouver » ci-dessus. **Faite (2026-10-27)** : toutes les briques nécessaires sont trouvées, la plupart testées sur le boîtier. Restent, non bloquants : chemin exact du Complete du dialogue, verrou du menu (étape 5), 20 BOX (évolution).
3. **Cœur du rouleau sans menu** : état et sauvegarde immédiate, compteur `vue/total` à l'écran, dossier du rouleau, multi-exposition et Save Interim Images imposés au rappel. **Fait et testé (2026-10-28, `T11-ROLL1` à `T11-ROLL3`)**.
4. **Ligne de menu « Mode pellicule » On / Off**, enregistrée dans la BOX ; Off ou Save Settings sur une BOX entamée = rembobiner. État persistant.
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
