# GR Mod · Cahier des charges : développement, diptyque et grain

2 novembre 2026 · Victor Geier

## Contexte et objectifs

Ajouter à GR Mod trois briques liées : le développement de la pellicule dans l'appareil, le diptyque en demi-format, et un grain argentique réglable comme chez Fujifilm, propre à chacune des 20 simulations de films. Le grain s'inscrit dans le mode pellicule : il est fixé par le film chargé et appliqué au développement de la pellicule.

- **Rendu** : un grain organique en amas, visible surtout dans les tons moyens et les ombres, jamais un bruit numérique uniforme.
- **Réglage** : deux axes indépendants, intensité et taille, comme le Grain Effect de Fujifilm.
- **Identité par film** : chaque film a son profil de grain par défaut (un Tri-X n'a pas le grain d'un Portra).
- **Réactivité** : aucun coût de traitement à la prise de vue.
- **Indépendance** : implémentation propre. Aucun code, binaire ni texture extrait de GRLife ou d'un autre firmware tiers.

## Périmètre et hors périmètre

La V1 couvre le développement dans l'appareil, le diptyque et le grain, sur GR III et GR IIIx.

**Dans le périmètre**

- Développement de la pellicule dans l'appareil, avec choix de la date au tirage et planche contact.
- Diptyque automatique des vues en demi-format.
- Moteur de grain (bibliothèque C pure, sans dépendance au firmware).
- Profils de grain pour les 20 films de GR Mod.
- Réglages utilisateur intensité et taille au chargement de la pellicule.
- Application au développement, avec gestion des crops (35, 40, 50, 71 mm) et du demi-format.
- Traçabilité des paramètres dans l'EXIF.

**Hors périmètre V1**

- Grain en temps réel dans la visée.
- Grain appliqué au RAW (DNG non modifié).
- Fuites de lumière, halation et pellicule périmée : modules séparés, qui réutiliseront le même pipeline de développement.
- Modélisation push / pull (prévue en V2 via le profil).

## Développement dans l'appareil

Une pellicule terminée devient un « négatif » non consultable tant qu'elle n'est pas développée. Le développement produit les tirages et une planche contact, inspirés du Film Camera Mode du Fujifilm X half, mais entièrement dans le boîtier.

**États d'une pellicule**

1. **Chargée** : film, ratio et réglages de grain choisis, puis verrouillés.
2. **En cours** : vues enregistrées comme négatifs dans le dossier de la pellicule. La relecture est masquée ou limitée selon les règles du mode pellicule.
3. **Terminée** : dernière vue prise (36, ou 72 en demi-format) ou fin de rouleau forcée par l'utilisateur.
4. **En développement** : traitement vue par vue, interruptible et reprenable.
5. **Développée** : tirages et planche contact visibles en lecture.

**Options de tirage, choisies au lancement du développement**

| Option | Valeurs | Défaut |
| --- | --- | --- |
| Date | Aucune, Date de prise de vue, Date et heure | Aucune |
| Format demi-format | Vues seules, Diptyques | Diptyques |
| Négatifs après tirage | Conserver, Supprimer | Conserver |

Le film et le grain ne se choisissent pas ici : ils sont fixés par la pellicule. La date se décide au tirage, ce qui remplace l'incrustation à la prise de vue.

**Sorties dans le dossier de la pellicule**

- `NEG/` : les négatifs d'origine.
- `TIRAGES/` : un JPEG par vue ou par diptyque, nommé `R<pellicule>_<vue>.JPG` (diptyque : `R023_07-08.JPG`).
- `PLANCHE.JPG` : planche contact de toutes les vues sous forme de bandes de 6, sur fond noir, avec numéros de vue et nom du film en marge comme sur une bande réelle.
- `MANIFEST` : film, réglages, horodatage de chaque vue, état du développement.

**Déclenchement**

- En fin de pellicule, le boîtier propose « Développer maintenant / Plus tard ».
- L'action « Développer » du menu traite toute pellicule terminée non développée.
- Développement refusé sous 20 % de batterie. Une coupure reprend à la première vue non développée.

## Diptyque

En demi-format, le développement assemble les vues deux par deux comme elles reposent sur un négatif réel : 1-2, 3-4, et ainsi de suite. Rien ne change à la prise de vue.

**Géométrie (GR III, capteur 6000 × 4000)**

- Hypothèse : chaque vue demi-format est un cadre vertical 3:4 de 3000 × 4000 px (à confirmer dans GR Mod).
- Deux vues côte à côte forment un tirage de 6000 × 4000 px plus le séparateur, soit la définition native, sans perte.
- Séparateur : bande verticale de 0 à 3 % de la largeur, 2 % par défaut, noire (option blanche).
- Pas de crop en demi-format en V1.

**Orientation**

- Les vues sont placées comme sur le négatif, sans rotation individuelle.
- Le diptyque entier prend l'orientation EXIF de la première vue de la paire.
- Si les deux vues ont des orientations différentes, l'une apparaît couchée, comme sur un vrai négatif. C'est voulu.

**Options au développement**

| Option | Valeurs | Défaut |
| --- | --- | --- |
| Appariement | 1-2 / 3-4…, ou décalé d'une vue (2-3 / 4-5…) | 1-2 / 3-4… |
| Dernière vue impaire | Seule, avec une vue noire non exposée | Avec une vue noire |
| Couleur du séparateur | Noir, Blanc | Noir |

**Interaction avec les autres traitements**

- La date, si elle est choisie, s'incruste dans chaque vue, en bas à droite, avant l'assemblage.
- Le grain s'applique après l'assemblage, sur un champ continu qui couvre les deux vues et le séparateur. Comme pour les crops, la taille de grain par pixel est la même qu'en plein format. Une vue seule tirée au même format qu'une vue plein format montrera donc un grain plus gros, comme sur film.
- Les fuites de lumière (V2) pourront déborder d'une vue sur l'autre.

## Modèle de grain : principes à reproduire

Le grain argentique est une structure spatiale liée à la densité de l'image, pas un bruit additif uniforme. Le moteur doit reproduire six propriétés.

1. **Amas** : le grain se regroupe en taches irrégulières de plusieurs tailles. On le modélise par au moins deux octaves de bruit filtré (fin et grossier) mélangées.
2. **Dépendance tonale** : peu visible dans les hautes lumières, maximal dans les tons moyens, présent dans les ombres. Pour un négatif tiré sur papier, le grain est plus fort dans les tons moyens et clairs du tirage que pour une diapositive, où il apparaît surtout dans les ombres. La courbe est donc propre à chaque film.
3. **Taille liée à la sensibilité** : un film ISO 400 a un grain plus gros qu'un ISO 100. La taille fait partie du profil.
4. **Agrandissement** : sur film, recadrer revient à agrandir, donc à grossir le grain. Le grain est défini par pixel du capteur : un crop non rééchantillonné garde la même taille de grain par pixel et, à format de tirage égal, il paraît naturellement plus gros (×1,43 en 40 mm sur GR III). Seul un recadrage rééchantillonné vers une définition supérieure exige une correction.
5. **Couleur** : les films couleur ont un léger grain chromatique décorrélé par couche. Les films noir et blanc n'en ont aucun.
6. **Non-répétition** : aucun motif ne doit être perceptible, même sur un ciel uni agrandi à 100 %.

## Paramètres et profils de grain par film

Chaque film porte un profil de grain stocké avec sa simulation. L'utilisateur ne règle que deux curseurs relatifs à ce profil.

**Paramètres du profil (fixés par film)**

| Paramètre | Type | Plage | Rôle |
| --- | --- | --- | --- |
| `amount` | entier | 0 à 100 | Intensité de base du grain luminance |
| `size` | virgule fixe | 0,5 à 3,0 | Taille de base du grain, en pixels à 24 Mpx et 35 mm |
| `octave_mix` | entier | 0 à 100 | Part du grain grossier par rapport au grain fin |
| `chroma` | entier | 0 à 100 | Grain chromatique (0 pour le noir et blanc) |
| `tone_lut` | 17 points | 0 à 255 | Pondération du grain selon la luminance, interpolée en LUT 256 |
| `seed_mode` | énuméré | frame / fixed | Graine tirée du numéro de vue (défaut) ou fixe pour les tests |

**Réglages utilisateur (au chargement de la pellicule)**

| Réglage | Valeurs | Effet |
| --- | --- | --- |
| Intensité | Off, Faible, Profil, Fort | Multiplie `amount` par 0, 0,6, 1,0, 1,5 |
| Taille | Petit, Profil, Gros | Multiplie `size` par 0,75, 1,0, 1,4 |

**Profils indicatifs, à calibrer à l'œil**

| Archétype | amount | size | chroma | Courbe tonale |
| --- | --- | --- | --- | --- |
| Noir et blanc 400 poussable (type Tri-X) | 70 | 1,8 | 0 | Pic dans les tons moyens, ombres soutenues |
| Noir et blanc 100 fin | 30 | 1,0 | 0 | Pic dans les tons moyens |
| Négatif couleur 400 | 45 | 1,4 | 25 | Pic dans les tons moyens et clairs |
| Négatif couleur 160 portrait | 25 | 1,0 | 15 | Pic doux, hautes lumières très propres |
| Diapositive 100 | 20 | 0,9 | 10 | Pic dans les ombres |
| Film cinéma 500T | 55 | 1,6 | 35 | Ombres et tons moyens |

Le format de stockage reprend celui des profils de films existants de GR Mod (à confirmer, voir questions ouvertes).

## Algorithme de référence

Le moteur applique, en virgule fixe et directement en YCbCr, des textures de grain précalculées pondérées par une LUT tonale.

**Textures**

1. Deux textures toriques (bords raccordables) en int8 : une fine de 512 × 512 et une grossière de 509 × 509. Des tailles premières entre elles évitent qu'un motif se répète à une période visible.
2. Génération : bruit blanc gaussien, flou gaussien circulaire (sigma 0,6 px pour la fine, 1,8 px pour la grossière), puis normalisation à écart-type constant.
3. Génération déterministe au démarrage du développement à partir d'une graine fixe, ou en fichier sur la carte SD si le temps de calcul est trop long. Pas de texture issue d'un tiers.
4. Deux textures supplémentaires pour Cb et Cr, à partir de graines différentes, pour un grain chromatique décorrélé.

**Taille effective**

La texture est lue avec un pas de 1 / taille effective (interpolation bilinéaire en virgule fixe Q16). La taille effective combine la taille du profil, le multiplicateur utilisateur, et le facteur de rééchantillonnage (largeur de sortie divisée par la largeur de capteur réellement lue). Un crop ou une vue demi-format sans rééchantillonnage a un facteur de 1.

**Application, pour chaque pixel**

```latex
Y' = \mathrm{clamp}\left(Y + \frac{A \cdot W[Y] \cdot \big((100-m)\,g_f + m\,g_c\big)}{2^{k}}\right)
```

A est l'intensité effective, W la LUT tonale (256 entrées), m le `octave_mix`, g\_f et g\_c les échantillons des textures fine et grossière, et k le décalage de normalisation. Cb et Cr reçoivent le même traitement avec `chroma` à la place de A et leurs propres textures, pondérés par W\[Y\].

**Graine et décalages**

La graine de la vue est un hash du numéro de pellicule et du numéro de vue. Elle fixe un décalage x, y dans chaque texture et une orientation (8 combinaisons de miroir et de transposition). Deux développements d'une même vue donnent donc un résultat identique, au bit près.

## Pipeline de développement : ordre des traitements

Le grain s'applique au développement de la pellicule, en dernier traitement avant l'encodage, sur des « négatifs » sans grain enregistrés à la prise de vue.

**À la prise de vue**

- Le boîtier enregistre la vue avec la simulation du film, sans grain, dans le dossier de la pellicule.
- Les paramètres de grain (profil, réglages utilisateur, numéro de vue) sont écrits dans un fichier manifeste de la pellicule, pas recalculés au développement.

**Au développement, pour chaque vue**

1. Lecture du négatif et décodage JPEG par bandes de lignes (pas d'image entière en RAM).
2. Par vue : crop éventuel, puis halation (V2) et date incrustée si elle est choisie au tirage. Sur film, la date est exposée sur l'émulsion, donc elle recevra le grain.
3. Assemblage du diptyque en demi-format, avec séparateur.
4. Fuites de lumière (V2), qui peuvent traverser les deux vues.
5. Grain luminance et chrominance, en dernier, sur le cadre final.
6. Encodage JPEG (qualité identique au négatif), copie de l'EXIF de la première vue, ajout des paramètres de développement dans le UserComment (version du moteur, film, grain, graine, date, appariement).
7. Écriture dans un fichier temporaire puis renommage : une coupure de courant ne laisse jamais de tirage corrompu.
8. Vignette de la vue ajoutée à la planche contact, écrite en fin de pellicule.

## Contraintes de performance et mémoire

Ces cibles sont des hypothèses de départ, à confirmer par mesure sur le boîtier.

| Contrainte | Cible |
| --- | --- |
| Coût à la prise de vue et au démarrage | 0 ms ajouté |
| Passe de grain seule, vue 24 Mpx | ≤ 1 s |
| Développement complet d'une vue (décodage, traitements, encodage) | ≤ 5 s |
| Pellicule de 36 vues | ≤ 3 min |
| Mémoire des textures | ≤ 1 Mo (luma 512² + 509², chroma en 4:2:0 à 256²) |
| Mémoire de travail | Bandes de 16 lignes, pas d'image entière |
| Arithmétique | Entiers et virgule fixe uniquement, aucune allocation dans la boucle pixel |
| Batterie | Développement refusé sous 20 % de batterie, avec message |

## Interface utilisateur

Le grain se règle une seule fois, au chargement de la pellicule, puis reste verrouillé jusqu'au développement.

- **Chargement** : après le choix du film et du ratio, deux écrans courts, Intensité (Off, Faible, Profil, Fort) et Taille (Petit, Profil, Gros). « Profil » est présélectionné.
- **Pendant la pellicule** : aucun réglage de grain accessible, conformément au verrouillage du rouleau. L'écran d'information peut afficher un pictogramme de grain.
- **Développement** : barre de progression vue par vue, annulation possible, reprise automatique.
- **Aperçu de calibration (mode développeur)** : un écran qui applique le profil d'un film à une mire en gris dégradé, pour régler les courbes tonales sans faire une pellicule entière.

## Tests et critères d'acceptation

Le moteur est validé sur PC avant tout flash, avec le même code C compilé pour x86 et pour ARM.

- [ ] **Déterminisme** : même négatif, même manifeste, même tirage au bit près, sur PC et sur boîtier.
- [ ] **Neutralité** : intensité Off, le tirage est identique au négatif réencodé.
- [ ] **Courbe tonale** : sur une mire de 17 paliers de gris, l'écart-type du grain mesuré par palier suit la LUT du profil à ±10 %.
- [ ] **Hautes lumières** : aucun pixel à 255 dans le négatif ne descend sous 250 dans le tirage pour les profils couleur.
- [ ] **Non-répétition** : l'autocorrélation d'un ciel uni ne montre aucun pic à la période des textures.
- [ ] **Crop** : sans rééchantillonnage, la taille de grain mesurée par pixel en crop 40 mm et en demi-format est identique à la pleine image (±5 %).
- [ ] **Noir et blanc** : chroma nulle, Cb et Cr inchangés.
- [ ] **Robustesse** : coupure simulée pendant un développement, aucun fichier corrompu, reprise correcte.
- [ ] **Performance** : cibles de la section précédente tenues sur GR III et GR IIIx.
- [ ] **Validation visuelle** : comparaison en aveugle avec des scans de films réels de l'archétype, à 100 % et en tirage 20 × 30 cm.
- [ ] **Diptyque** : sur une pellicule de 72 vues, 36 diptyques de 6000 px de large plus le séparateur, appariement correct, vue impaire gérée selon l'option.
- [ ] **Date au tirage** : présente sur chaque vue d'un diptyque quand elle est choisie, absente sinon, et toujours sous le grain.
- [ ] **États** : une pellicule non développée n'affiche aucune vue en lecture ; une pellicule développée affiche tirages et planche contact.
- [ ] **Planche contact** : toutes les vues présentes, dans l'ordre, avec leur numéro.

## Plan par étapes pour Claude Code

Sept étapes, chacune livrable et testable seule, du PC vers le boîtier.

1. **Exploration du dépôt** : cartographier GR Mod (format des profils de films, dossiers de pellicule, géométrie du demi-format, date incrustée actuelle, points d'accroche JPEG, chaîne de compilation ARM) et répondre aux questions ouvertes ci-dessous. Livrable : une note d'architecture dans le dépôt.
2. **Bibliothèque `develop/` en C pur**, sans dépendance au firmware : décodage et encodage par bandes, assemblage du diptyque, date incrustée, grain (textures, LUT tonale), planche contact. Livrable : la bibliothèque et ses tests unitaires.
3. **Outil PC de référence** : un exécutable qui prend un dossier de négatifs et un manifeste, et produit tirages, diptyques et planche contact. Livrable : l'outil, les mires et les images de référence (golden).
4. **Calibration des 20 profils de grain** sur PC, à partir de scans de films réels. Livrable : les fichiers de profils.
5. **Manifeste et états de la pellicule** dans le boîtier : écriture au chargement et à chaque vue, verrouillage de la relecture, passage à « Terminée ».
6. **Développement dans le boîtier** : branchement de la bibliothèque, écriture atomique, reprise, contrôle batterie. Livrable : un firmware de test, puis les mesures de performance.
7. **Interface** : écrans de chargement (film, ratio, grain), proposition de développement en fin de pellicule, options de tirage, progression, lecture des tirages et de la planche contact.

## Questions ouvertes à lever dans le code GR Mod

Ces points conditionnent l'étape 6 et sont à trancher pendant l'étape 1.

- [ ] Le firmware expose-t-il un décodeur et un encodeur JPEG réutilisables (matériels ou logiciels), ou faut-il embarquer une bibliothèque légère ?
- [ ] Les buffers sont-ils accessibles en YCbCr 4:2:0, ou seulement en RGB ?
- [ ] Quelle mémoire libre reste disponible pendant une tâche de fond de développement ?
- [ ] Les 20 simulations sont-elles appliquées à la prise de vue (Image Control natif) ou en post-traitement ? Cela fixe ce que contient le négatif.
- [ ] Quel format de stockage utilisent les profils de films actuels (fichier sur carte SD, table compilée) ?
- [ ] Comment la date incrustée est-elle déjà implémentée, et peut-elle être déplacée dans le pipeline de développement ?
- [ ] Combien de temps prend un décodage puis réencodage d'une vue 24 Mpx sur le boîtier ? Si c'est trop long, prévoir un mode « développement à la demande » par vue.
- [ ] Quelle géométrie GR Mod utilise-t-il pour le demi-format (3:4 vertical de 3000 × 4000 px, ou autre) ?
- [ ] Comment la relecture est-elle déjà masquée ou limitée dans le mode pellicule, et peut-on la débloquer par pellicule une fois développée ?
- [ ] Les crops du GR III sont-ils enregistrés à définition réduite, ou rééchantillonnés vers 24 Mpx ?
