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
- `host/` : partie PC (recettes de textures, profils d'archétypes, tests, lecture et écriture
  d'images).

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
