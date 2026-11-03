# Bibliothèque de développement (GR Mod Film)

Étape 2 de `docs/SPEC-developpement-diptyque-grain.md` (voir `docs/ARCHITECTURE.md`).

Du C sans dépendance, compilé pour le PC (tests, images de référence) et pour le boîtier, avec les
règles des modules existants (`tools/datestamp/gen.py`) : aucune donnée globale ni constante (les
tables arrivent en arguments, calculées par GR Mod sur le PC), aucune division, aucun flottant,
aucune bibliothèque. Images en YCbCr 4:2:2, comme au point d'accroche JPEG.

    python3 tools/develop/build.py [DOSSIER_IMAGES]

lance les tests sur PC, écrit les images de référence si un dossier est donné, puis vérifie la
compilation pour le boîtier (pas de section de données, pas d'appel externe, code indépendant de
l'adresse).

## Contenu

- `develop.h` : types et fonctions publiques.
- `grain.c` : grain argentique (textures, courbe tonale, graine par vue, cases sans répétition).
- `diptych.c` : appariement des vues demi-format et assemblage côte à côte avec séparateur.
- `date.c` : date au tirage, à partir de la date de la vue (et non de l'horloge).
- `text.c`, `text.h` : dessin en segments, repris de `tools/datestamp/datestamp.c` (non modifié).
- `sheet.c` : mise en page de la planche contact (bandes de 6, numéros, nom du film), réduction
  des vues.
- `host/` : partie PC (recettes de textures, profils d'archétypes, tests, lecture et écriture
  d'images).

## Vérifications faites par `build.py`

- Tous les critères de la spec qui relèvent de la bibliothèque, sur PC : déterminisme,
  neutralité (Off), bandes et fenêtres identiques à l'image entière, courbe tonale à ±10 %,
  hautes lumières (255 ne descend pas sous 250), non-répétition horizontale et verticale, coutures
  invisibles, même taille de grain en plein format, en crop et en demi-format, réglage Taille,
  noir et blanc sans grain chromatique, appariements, géométrie du diptyque (72 vues : 36 tirages
  de 6000 px plus le séparateur), date dans les 4 orientations, planche contact.
- Version boîtier : compilée avec les drapeaux des modules, sans données, sans division, sans
  appel externe, indépendante de l'adresse (environ 16 Ko).
- Dans l'émulateur Unicorn : textures et grain de la version ARM **identiques au PC au bit près**.

## Performances (mesurées dans l'émulateur, en instructions)

| Étape | Coût |
| --- | --- |
| Fabrication des 4 textures | 199 millions d'instructions, 650 Ko de textures et 513 Ko de travail temporaire |
| Grain | 275 instructions par pixel, soit 6,6 milliards pour une vue de 24 Mpx |

La cible de la spec (passe de grain ≤ 1 s pour 24 Mpx) n'est pas tenue en C simple : à un
milliard d'instructions par seconde, ce serait de l'ordre de 6 s. La fréquence réelle du
processeur du GR III n'est pas connue ; elle sera mesurée à l'étape 6. Pistes si besoin : les
instructions NEON du Cortex-A9 (4 à 8 pixels à la fois), une boucle sans test de bouclage de
texture, une voie rapide pour les lignes de couture.

## Grain : écarts avec l'algorithme de référence de la spec

- **Cases de 128 pixels.** Lue d'une seule traite, une texture de 512 se répète tous les
  512 × taille pixels (717 pixels pour une taille de 1,4) : autocorrélation de 0,74 à cette
  distance sur un ciel uni, critère « Non-répétition » non tenu. Chaque case de 128 pixels lit la
  texture à son propre décalage (tiré de la graine de la vue), les coutures sont fondues sur
  32 pixels avec un gain qui garde l'intensité. Autocorrélation maximale mesurée : 0,02.
- **4:2:2.** Le grain chromatique est lu sur la grille de chrominance du 4:2:2 (un couple Cb, Cr
  pour deux pixels), pas en 4:2:0.
- **Normalisation et pas de lecture précalculés.** L'écart-type des textures et l'inverse de la
  taille du grain demandent une division ou une racine : ils sont calculés sur PC et passés au
  boîtier (`dv_tex_recipe.scale_q16`, `dv_grain_profile.step_q16`).
