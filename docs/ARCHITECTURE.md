# Architecture de GR Mod Film pour le développement, le diptyque et le grain

Étape 1 de `docs/SPEC-developpement-diptyque-grain.md` (spec du 2 novembre 2026) : cartographie
du dépôt et réponses aux questions ouvertes. Rien n'est modifié dans le code. Les références sont
données par rapport à `main` (`ae2170b`, version 0.9.1).

Niveaux de certitude employés :
- **lu** : lu dans le code ou le désassemblage, sans test sur le boîtier ;
- **testé** : confirmé sur le boîtier lors d'un build précédent (notes de `docs/film-mode-notes.md`) ;
- **inconnu** : rien dans le dépôt ne permet de répondre, une mesure sera nécessaire.

## 1. Vue d'ensemble du dépôt

| Partie | Rôle | Fichiers principaux |
| --- | --- | --- |
| `core/src/fw/gr3x/` | Moteur de patch du firmware GR III 2.10 / IIIx 1.60 (TypeScript qui assemble de l'ARM et l'ajoute au firmware officiel) | `adj.ts` (orchestration), `film-roll.ts` (mode pellicule), `jpeg-stage.ts`, `films-r10.ts`, `geometry.ts`, `guard.ts` |
| `core/src/fw/aspect/` | Code GR IV (partagé, non modifié par GR Mod Film) et utilitaires ARM | `arm.ts`, `halation.ts`, `datestamp.ts` |
| `core/src/app/engine.ts` | API de construction utilisée par l'application (`Engine.buildFirmware`, `inspect`) | |
| `tools/datestamp/`, `tools/halation/` | Modules C qui s'exécutent dans le boîtier, avec leur script de compilation | `datestamp.c`, `halation.c`, `gen.py` |
| `tools/gr3x/native/` | Autres modules C du GR III (paramètres des films, End Screen) | `slots3.c`, `films.c`, `endscreen.c`, compilés par `compile_slots.py` |
| `tools/gr3x/*_probe.py`, `film_roll_check.py` | Exécution du firmware construit dans l'émulateur Unicorn | `native_probe.py` (base commune) |
| `ui/` | Application (React), `shell/` le programme de bureau (Go) | |

Le firmware n'est pas recompilé : GR Mod remplace des instructions du firmware officiel par des
sauts vers du code ajouté à la fin de la section RTOS (`Engine.buildFirmware` → `fixedGr3x` →
`buildGr3xTestFirmware`, `core/src/fw/gr3x/research-package.ts`). Chaque patch est vérifié
(instruction attendue à l'adresse) et listé dans le manifeste du build.

## 2. Briques existantes réutilisables

### 2.1 Le point d'accroche JPEG (testé)

`core/src/fw/gr3x/jpeg-stage.ts:1-30` : `JpegEncodeMacroProcess::Execute` (`0x535047d4`,
`GR3X_JPEG_EXECUTE`) reçoit la configuration de l'encodeur, qui liste les images que l'encodeur va
compresser : image principale, vignette d'écran 720 × 480 et miniature 160 × 120. Le premier mot
de la fonction devient un saut vers une chaîne de modules C, dans cet ordre : halation, puis date.

Format des images à ce point (`tools/datestamp/datestamp.c:24-34`, `struct picture`) :
- `format == 1` : **YCbCr 4:2:2**, un plan Y et un plan CbCr entrelacé ;
- `y`, `c`, `width`, `height`, `stride`, `c_height` : l'image est une fenêtre dans un tampon plus
  large ;
- les plans sont dans la RAM `0x40000000..0xc0000000` (en RAW+JPEG, l'image principale réduite est
  au-dessus de `0xa0000000`, `README.md:194`).

C'est le seul endroit identifié où le boîtier donne accès à l'image finale en mémoire.

### 2.2 Les modules C dans le boîtier (testé)

`tools/halation/gen.py:6-7`, `tools/datestamp/gen.py`, `tools/gr3x/compile_slots.py:27-40` :
- compilateur : `clang -target armv7-none-eabi -mcpu=cortex-a9 -marm -mfloat-abi=soft -Os`,
  `-fropi -ffreestanding -fno-builtin`, édition des liens par `ld.lld`, extraction par
  `llvm-objcopy` ; `python3 -m ziglang cc` en repli (`GRMOD_ZIG=1`, compilateur des octets
  committés) ;
- contraintes : code indépendant de la position, **aucune donnée globale**, **aucune division**
  (pas de bibliothèque d'exécution : `__aeabi_uidiv` absent), pas de flottant matériel ;
- toutes les fonctions du firmware arrivent par une structure `ctx` de pointeurs
  (`datestamp.c:36-60`) : cache, invalidation et nettoyage du cache, plateforme, horloge
  (`get_time`), allocation (`alloc`, `halation.c:72`) ;
- le module est appelé avec la configuration de l'encodeur, et une image qu'il ne reconnaît pas
  est laissée telle quelle.

Validation : les mêmes calculs entiers existent en TypeScript (`halateYcc`,
`core/src/fw/aspect/halation.ts:382`) pour l'aperçu de l'application, au bit près, et les modules
sont exécutés dans l'émulateur. Les modules ne sont pas compilés pour x86 aujourd'hui, mais rien ne
l'empêche : c'est du C sans dépendance.

### 2.3 Les films (testé)

- Un film est un look du boîtier numéroté 64 + k (k de 0 à 19), en plus des 12 looks d'origine
  11..22 (`films-r10.ts:1-60`, `GR3X_FIRST_FILM`). Le nombre de films est choisi par
  l'utilisateur (`filmCount`, de 0 à 20, `guard.ts:81`).
- Chaque film porte une matrice couleur en Q13 et trois courbes de 256 points (`preset`), saisis
  dans l'application. Ils sont **compilés dans le firmware** sous forme de tables (« tone record »
  copié à 84 entrées, `films-r10.ts:7-14`, `installGr3xR10Tables` ligne 107), et non stockés sur
  la carte SD.
- La recette du build (film par film, ratios, options) est rangée à la fin de la section RTOS
  (`ratio-recipe.ts:9`, magie `GR3X-RATIO-RECIPE`) pour que l'application reconnaisse ses
  firmwares.
- Le look est écrit dans la maker note (`0x8110 + k`, `films-r10.ts:60`).

### 2.4 Le mode pellicule actuel (testé)

`core/src/fw/gr3x/film-roll.ts` :
- état du rouleau dans des octets libres de l'enregistrement des réglages, propres à chaque BOX :
  `0x9b1` (bit 0 Film Roll Mode, bit 1 rouleau entamé, bits 2-3 poids fort du dossier), `0x9b2`
  (vue), `0x9b3` (dossier), `0x9c2` / `0x9c3` (film et format notés au début du rouleau)
  (`film-roll.ts:64`, `1459`) ;
- longueur du rouleau selon le ratio : `GR3X_ROLL_LENGTHS` (`film-roll.ts:106`) : 3:2 → 36,
  **3:4 → 72**, 65:24 → 21, 4:3 → 15, 1:1 → 12, 36 pour les autres ;
- un dossier DCF par rouleau, nommé `NNN` + 3 lettres du film + longueur (`174POR36`),
  `GR3X_FOLDER_NAME` (`film-roll.ts:770`) ;
- noms de fichiers : code du film sur 4 lettres + numérotation continue du boîtier
  (`PORT6857.JPG`), `installGr3xFilmFileNames` (`film-roll.ts:1241`), au point de nommage
  `0x535b6b28` ;
- fin de rouleau avec message, ligne Rembobiner (`installGr3xFilmRewind`, `film-roll.ts:1089`) ;
- multi-exposition forcée au rappel d'un U, revue après la prise de vue adaptée (vue simple).

### 2.5 Le développement RAW du boîtier (lu, en partie testé)

Le boîtier sait déjà développer un DNG en JPEG (menu de lecture, RAW Development). GR Mod l'étend :
- ratios personnalisés : `core/src/fw/gr3x/raw-development.ts:8-36` ;
- films dans la liste Image Control du développement RAW : `installGr3xR10Raw`
  (`films-r10.ts:255`, détails lignes 47-58) ;
- le DNG garde tout le capteur 6000 × 4000 (`raw-full-frame.ts:5-8`).

Le développement RAW passe par le même pipeline image, donc par le point d'accroche JPEG : la
halation s'y applique déjà (`README.md:220`, « the same on the in-camera RAW development
screens »).

### 2.6 Le grain natif du GR III (lu)

Le GR III a son propre Grain Effect (Off / 1 / 2 / 3) pour certains looks : paramètre de genre 15,
octet `0x795` des réglages, réglage par `SetParticle` (`0x532c1780`)
(`halation-rows.ts:6-7`, `21-24`, `films-r10.ts:153-154`). GR Mod Film emprunte son interface pour
la ligne Halation des films, sans changer ses valeurs. Ce grain est appliqué par le moteur d'image
à la prise de vue. Sa structure (amas, dépendance tonale) n'a pas été étudiée.

## 3. Réponses aux questions ouvertes de la spec

### 3.1 Décodeur et encodeur JPEG réutilisables ?

- **Encodeur : oui, mais en tant qu'étape du pipeline** (lu, testé pour l'accroche). On ne connaît
  pas d'appel « encode ce tampon » isolé. On sait s'insérer juste avant la compression
  (`JpegEncodeMacroProcess::Execute`, §2.1), à la prise de vue comme au développement RAW.
- **Décodeur : aucun point d'appel identifié sur GR III** (inconnu). La lecture décode forcément
  les JPEG (le GR IV a un décodage en lecture que GR Mod a corrigé, `README.md:178`), mais rien
  n'est cartographié côté GR III.
- **Bibliothèque embarquée** : possible dans le cadre des modules C (§2.2), sous les contraintes
  « pas de division, pas de données globales, pas de bibliothèque d'exécution ». Un décodeur JPEG
  logiciel par bandes est faisable, mais aucun n'existe dans le dépôt.
- **Piste à étudier en priorité** : faire du DNG le « négatif » et du développement RAW natif le
  « développement » (§5). Cela évite le décodage et le réencodage JPEG : le boîtier refait toute
  l'image, et nos modules (date, diptyque, grain) s'insèrent au point d'accroche JPEG.

### 3.2 Buffers en YCbCr 4:2:0 ou RGB ?

**Ni l'un ni l'autre : YCbCr 4:2:2** au point d'accroche JPEG (lu dans `datestamp.c:27`, et le
module de date dessine dans ces plans à chaque prise de vue : testé). Le plan CbCr a la même
hauteur que Y et une demi-résolution horizontale, entrelacée.

### 3.3 Mémoire libre pendant une tâche de fond ?

**Inconnu en valeur.** Repères :
- au point d'accroche JPEG, le module de halation alloue plusieurs mégaoctets par l'allocateur du
  firmware (`halation.c:179-183` et `280-284` : deux à cinq tampons d'au plus 1024 × 1024 × 2
  octets) et fonctionne sur le boîtier (testé) ;
- `operator new` (`0x536af2a8`) a son propre pool à `0x59600000`, le tas principal commence à
  `0x558043c0` (`round10.ts:9-11`) ;
- aucune tâche de fond n'existe aujourd'hui dans GR Mod : tout s'exécute dans les tâches du
  boîtier.

### 3.4 Les simulations : à la prise de vue ou en post-traitement ?

**À la prise de vue, par le moteur d'image natif** (testé). Un film est un look du boîtier : sa
matrice et ses courbes passent par le constructeur de descripteur (`0x536dc0f4`,
`films-r10.ts:7-14`) et par les crochets de `image-control.ts`. Le JPEG enregistré contient donc
déjà le film. La halation est elle aussi appliquée à la prise de vue (point d'accroche JPEG). Le
DNG ne contient pas le film : le développement RAW du boîtier peut le réappliquer (§2.5).

### 3.5 Format de stockage des profils de films ?

**Tables compilées dans le firmware**, construites par l'application à partir du projet de
l'utilisateur (§2.3). Pas de fichier sur la carte. Les réglages modifiables dans le boîtier
(paramètres d'un film, Halation) sont dans l'enregistrement des réglages, par film et par jeu de
réglages (`tools/gr3x/native/slots3.c`, `films.c`). Un profil de grain par film devrait donc,
naturellement, être ajouté aux tables du film à la construction (comme la halation de GR IV,
`halation.ts`, paramètres par look) et ses réglages utilisateur rangés dans l'enregistrement.

### 3.6 Comment la date incrustée est-elle implémentée ?

Module C `tools/datestamp/datestamp.c`, appelé au point d'accroche JPEG, après la halation
(`jpeg-stage.ts:8-11`). Il dessine en bas à droite de chaque image (principale, vignette,
miniature) en tenant compte de l'orientation EXIF, avec le nom du look en option
(`datestamp.c:1-18`). Réglage : octet de l'enregistrement lu par `SETTING_RECORD`
(`datestamp.c:43-48`). En mode pellicule, la ligne du menu est masquée quand la date ne sert qu'au
mode pellicule (`dateHidden`, `adj.ts`).

**Déplacement vers le développement : possible si le développement passe par le pipeline du
boîtier**, puisque le module agit au même point. Une limite : la date vient de l'horloge au moment
de l'encodage (`get_time`, `datestamp.c:733`). Développée plus tard, la vue porterait la date du
développement, pas celle de la prise de vue. Il faudra lire la date de la vue (EXIF ou manifeste).

### 3.7 Temps de décodage et réencodage d'une vue 24 Mpx ?

**Inconnu.** Aucune mesure dans le dépôt. Le développement RAW natif donne un ordre de grandeur à
mesurer sur le boîtier (temps par vue, avec et sans nos modules).

### 3.8 Géométrie du demi-format ?

Le demi-format de GR Mod Film est le **ratio personnalisé 3:4** (72 vues, `film-roll.ts:106`). Sa
taille, calculée par `planGr3xRatio` (`geometry.ts:29-46`) : **3000 × 4000** en L, puis
2400 × 3200, 1680 × 2240 et 960 × 1280. L'hypothèse de la spec est confirmée pour la taille L. Le
3:4 fait partie du menu testé sur le boîtier (`GFX_RATIOS`, `geometry.ts:12`).

### 3.9 Masquage de la relecture en mode pellicule ?

**Il n'existe pas.** Le mode pellicule ne touche qu'à la revue juste après la prise de vue (une
vue simple au lieu de la revue de multi-exposition, minuterie, `film-roll.ts:831-924`). La lecture
du boîtier montre toutes les vues normalement (testé, `CAHIER_DES_CHARGES.md:122`, « lecture
normale »). Masquer la lecture par rouleau est un chantier entièrement nouveau.

### 3.10 Crops : définition réduite ou rééchantillonnés vers 24 Mpx ?

**Lu, non mesuré dans le dépôt.** Les crops sont des facteurs de zoom du redimensionneur, en Q13 :
10240 (× 1,25) et 14629 (× 1,786) (`tools/gr3x/chroma_alignment_probe.py:93-99`), soit 35 mm et
50 mm sur le GR III (28 mm de base). Les tailles de sortie connues du boîtier
(`GR3X_BASE_SIZES`, `geometry.ts:15` : 6000 × 4000, 4800 × 3200, 3360 × 2240, 1920 × 1280) et la
documentation de Ricoh indiquent une définition réduite (35 mm en 4800 × 3200, 50 mm en
3360 × 2240), sans rééchantillonnage vers 24 Mpx. À confirmer sur un fichier réel. Le DNG, lui,
garde toujours le capteur entier (`raw-full-frame.ts:8`).

## 4. Points de la spec qui contredisent le code

1. **« Les 20 films de GR Mod » / profils pour 20 simulations** : GR Mod n'a pas 20 simulations
   fixes. L'utilisateur crée de 0 à 20 films (looks 64..83, matrice et courbes de son choix), en plus
   des 12 looks du boîtier (§2.3). Un profil de grain ne peut pas être calibré une fois pour toutes
   « par film » : il faut l'attacher au film choisi par l'utilisateur, par exemple via un archétype
   à choisir dans l'application.
2. **Crops 35, 40, 50, 71 mm et « × 1,43 en 40 mm sur GR III »** : le GR III n'a que 28 mm (plein),
   35 mm et 50 mm ; le GR IIIx a 40 mm (plein), 50 mm et 71 mm (§3.10). Le 40 mm sur GR III est
   une idée de la liste v2, pas une fonction existante.
3. **Buffers YCbCr 4:2:0** (mémoire des textures « chroma en 4:2:0 ») : le pipeline fournit du
   4:2:2 (§3.2). Le grain chromatique devra être appliqué à demi-résolution horizontale seulement.
4. **« La relecture est masquée ou limitée selon les règles du mode pellicule »** : aucune règle de
   ce type n'existe (§3.9).
5. **« Chargée : film, ratio et réglages de grain choisis, puis verrouillés »** : le verrouillage des
   réglages pendant un rouleau n'est pas fait. C'est un point resté ouvert dans le cahier des
   charges (étape 5, « verrou du menu »).
6. **« Terminée : dernière vue prise (36, ou 72 en demi-format) »** : les longueurs dépendent du
   ratio : 36, 72, 21, 15 ou 12 (§2.4).
7. **Dossiers `NEG/`, `TIRAGES/` et noms `R023_07-08.JPG`** : la lecture du boîtier suit la norme
   DCF : des dossiers `NNNxxxxx` directement dans `DCIM`, sans sous-dossier, et des fichiers de
   4 caractères suivis de 4 chiffres. Des sous-dossiers ou des noms comme `R023_07-08.JPG` ne
   seraient pas visibles en lecture, ce qui contredit « Développée : tirages et planche contact
   visibles en lecture ». Le mode pellicule actuel respecte la norme (`174POR36`, `PORT6857.JPG`).
8. **Date « de prise de vue » au tirage** : le module actuel imprime l'heure de l'encodage
   (§3.6). Et la date est aujourd'hui incrustée à la prise de vue : la spec, qui la déplace au
   tirage, change le comportement de la 0.9.1.
9. **Halation « hors périmètre, module séparé » et placée au développement (V2)** : la halation
   existe déjà dans GR Mod, appliquée à la prise de vue (§2.1).
10. **« Aucun coût de traitement à la prise de vue »** : déjà faux aujourd'hui pour la halation et
    la date, et le Grain Effect natif du GR III est lui aussi appliqué à la prise de vue (§2.6).
    La spec ne mentionne pas ce grain natif.
11. **« Bibliothèque C pure… même code compilé pour x86 et ARM »** : compatible, mais sous les
    contraintes des modules (pas de division, pas de globales, pas de bibliothèque, §2.2). Un
    décodeur et un encodeur JPEG dans ces conditions sont un travail conséquent.
12. **Manifeste écrit sur la carte, contrôle de la batterie, tâche de fond, écriture atomique** :
    aucune de ces fonctions du firmware (écriture de fichiers arbitraires, niveau de batterie,
    création de tâche) n'est cartographiée dans le dépôt. L'état du rouleau est aujourd'hui dans
    les réglages, pas dans un fichier.

## 5. Pistes d'architecture pour les étapes suivantes

Deux voies pour le « développement » :

**A. Négatif JPEG, développement par nos soins** (la voie de la spec) : décodage du JPEG, date,
diptyque, grain, réencodage, écriture, dans un module C. Il faut un décodeur et un encodeur JPEG
embarqués, un accès aux fichiers et une tâche de fond, tous inconnus aujourd'hui.

**B. Négatif DNG, développement par le pipeline du boîtier** : la vue est prise en RAW (le DNG
garde le capteur entier) et le développement RAW natif, déjà étendu aux films et aux ratios,
produit le JPEG. Date, diptyque et grain deviennent des modules au point d'accroche JPEG, qui
savent qu'ils sont en développement. Avantages : pas de codec à écrire, film appliqué par le
boîtier, coût nul à la prise de vue. Inconnues : piloter le développement RAW pour un rouleau
entier sans action de l'utilisateur, distinguer développement et prise de vue dans le module,
assembler deux vues (diptyque) alors que le pipeline traite une vue à la fois.

Dans les deux cas, le moteur de grain lui-même (textures, LUT, application en 4:2:2) peut être
écrit et validé sur PC en C, puis appelé au point d'accroche JPEG comme la halation.

## 6. Décisions prises (2 novembre 2026)

**D1. Le négatif est le DNG, le développement passe par le développement RAW du boîtier** (voie B
du §5). Conséquences :
- **la qualité d'image n'est pas imposée** : JPEG, RAW ou RAW+JPEG reste le choix du photographe
  (décision de l'utilisateur). Seules les vues qui ont un DNG peuvent être développées par le
  boîtier. La multi-exposition enregistre bien un DNG de la superposition quand la BOX est en RAW
  (testé, `docs/film-mode-notes.md`, essai F1 : `.DNG` « superposition, qualité de la BOX ») ;
- un rouleau pris en JPEG seul a son grain dès la prise de vue (D2), mais ni diptyque, ni date au
  tirage, ni planche contact sans décodeur JPEG (voie A du §5), voir D3 ;
- la spec suppose un négatif JPEG décodé par bandes (« Lecture du négatif et décodage JPEG par
  bandes ») : ce n'est plus le cas, le boîtier refait l'image depuis le DNG.

**D2. Le grain s'applique aussi au JPEG de la prise de vue** (validé par l'utilisateur, avec
l'écart de performance ci-dessous). Le même module de grain, au point
d'accroche JPEG (§2.1), traite :
- à la prise de vue, le JPEG de chaque vue (image principale, vignette d'écran, miniature), avec le
  profil du film du rouleau et les réglages de grain de l'utilisateur ;
- au développement RAW, le tirage produit depuis le DNG, qui n'a pas de grain.

Conséquences :
- **écart assumé avec la spec** : « Réactivité : aucun coût de traitement à la prise de vue » et
  « Coût à la prise de vue : 0 ms ajouté » ne tiennent plus. La passe de grain (cible ≤ 1 s pour
  24 Mpx) s'ajoute au temps d'enregistrement de chaque vue, comme la halation aujourd'hui. À
  mesurer ;
- le JPEG de la prise de vue montre le rendu final pendant le rouleau, ce qui va dans le sens de la
  lecture non masquée d'aujourd'hui (§3.9) ;
- le grain doit être identique au bit près entre le JPEG de la prise de vue et le tirage de la même
  vue (même graine, même profil) quand la géométrie est la même, ce qui renforce l'exigence de
  déterminisme de la spec ;
- en demi-format, le JPEG de la prise de vue reçoit le grain vue par vue ; au tirage en diptyque, le
  grain est appliqué sur le cadre assemblé (spec, « Diptyque »). Les deux ne coïncident donc pas pour
  les diptyques, ce qui est conforme à la spec ;
- le module doit savoir s'il traite une prise de vue ou un développement RAW (pour le diptyque et la
  date au tirage), point déjà listé dans les inconnues de la voie B.

**D3. Rouleau pris en JPEG seul** (décision de l'utilisateur) : en V1, pas de développement. Le
rouleau a son grain dès la prise de vue (D2) ; diptyque, date au tirage et planche contact sont
réservés aux vues avec DNG. En V2, un décodeur et un encodeur JPEG embarqués (voie A du §5)
permettront de développer aussi ces rouleaux. Le moteur de grain et l'assemblage du diptyque
doivent donc rester indépendants de la source (DNG développé par le boîtier ou JPEG décodé).

## 7. Mesures à prévoir (sans flash à ce stade)

À lister pour l'étape 6, chacune par un build de sonde dédié, le moment venu :
- temps d'un développement RAW natif d'une vue 24 Mpx ;
- mémoire disponible à l'allocateur au point d'accroche JPEG et hors prise de vue ;
- taille réelle des JPEG en crop 35 mm et 50 mm ;
- temps ajouté à la prise de vue par une passe de grain 24 Mpx au point d'accroche JPEG (D2) ;
- moyen de distinguer, au point d'accroche JPEG, une prise de vue d'un développement RAW (D1, D2) ;
- fonctions du firmware pour lire un fichier, écrire un fichier, lire le niveau de batterie et
  lancer une tâche (recherche statique d'abord).

## 8. Étape 2 : bibliothèque `tools/develop/` (2 novembre 2026)

Livrée et vérifiée sur PC et dans l'émulateur, sans aucun changement du firmware : grain,
diptyque, date au tirage, mise en page de la planche contact. Détails et chiffres dans
`tools/develop/README.md`. Écarts avec l'algorithme de référence de la spec :
- **Répétition des textures** : lue d'une seule traite, une texture de 512 se répète tous les
  512 × taille pixels (autocorrélation de 0,74 à 717 px pour une taille de 1,4). La spec ne tient
  donc pas son propre critère « Non-répétition ». Correction : cases de 128 pixels lisant chacune
  la texture à un décalage tiré de la graine, coutures fondues sur 16 pixels avec un gain qui garde
  l'intensité (autocorrélation résiduelle de 0,02).
- **4:2:2** au lieu de 4:2:0 (§3.2).
- **Normalisation des textures et inverse de la taille** calculés sur PC et passés au boîtier (pas
  de division ni de racine dans le boîtier).
- **Performance** : 275 instructions par pixel, environ 6,6 milliards pour 24 Mpx ; la cible de
  1 s n'est pas tenue en C simple. À mesurer sur le boîtier (étape 6) avant toute décision ; NEON
  est la piste principale. Avec D2 (grain au déclenchement), ce temps s'ajoute à chaque prise de
  vue.
- **Textures** : 199 millions d'instructions à fabriquer, 650 Ko à garder en mémoire. Avec D2, il
  faut les fabriquer avant la première vue d'un rouleau (au démarrage ou au premier
  déclenchement), puis les garder.
- **Planche contact** : mise en page seulement ; l'écriture en JPEG dépend du pipeline (étape 6).
- **Écriture des fichiers, tâche de fond, batterie** : hors bibliothèque, inchangé (§4, point 12).
