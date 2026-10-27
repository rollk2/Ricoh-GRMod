# Mode pellicule : notes de cartographie

Journal des découvertes pour GR III 2.10 (fwdc239b.bin) et GR IIIx 1.60 (fwdc243b.bin).
Chaque entrée donne l'adresse, la fonction, la preuve et le niveau de certitude.

Niveaux de certitude :
- **Testé** : vérifié sur le boîtier.
- **Émulé** : code officiel exécuté dans Unicorn, résultat observé.
- **Statique** : lu dans le code désassemblé, pas exécuté.
- **Supposé** : déduction plausible, à vérifier.

## Phase 2.1 : octets de stockage du rouleau (2026-10-27)

### Résultat

**0x9b1, 0x9b2, 0x9b3** de l'enregistrement des réglages sont libres. Ce sont les trois octets de
bourrage entre le drapeau 0x9b0 (champ mot de 0x9ac) et le champ octet 0x9b4. Leur situation est la
même que celle de 0x9a9 à 0x9ab (après le drapeau 0x9a8 du champ mot 0x9a4), que GR Mod utilise
pour l'image d'extinction et qui sont testés sur boîtier.

Certitude : **statique et émulé**, identique sur GR III 2.10 et GR IIIx 1.60. **À confirmer sur le
boîtier** (persistance après extinction).

Proposition d'usage, à décider en phase 4 :
- 0x9b1 : bit 7 = rouleau chargé, bits 0 à 6 = numéro de la vue à prendre (1 à 72).
- 0x9b2 et 0x9b3 : numéro du dossier du rouleau (100 à 999), demi-mot petit-boutiste, aligné.

Réserve, moins examinée : 0x905 à 0x907 (après le drapeau 0x904 du champ mot 0x900).

### Méthode et preuves

Outil : `tools/gr3x/settings_layout_probe.py --rtos <rtos> --report <json>` (environ 1 min 30).
Le RTOS s'extrait avec `node tools/gr3x/inspect.mjs <firmware.bin> --rtos <sortie>`.

1. **Carte des champs (émulé).** La fusion avec les valeurs d'usine, `0x53246df8` (elle se termine
   par un saut vers `0x5324075c`), copie la valeur d'usine d'un champ quand son drapeau est
   non nul. Chaque champ est une paire { valeur ; u8 drapeau }. Exécutée dans Unicorn avec un seul
   octet à 1 à la fois (et des valeurs d'usine 0xff puis 0x5a), elle donne tous les champs :
   **1043 champs**, et **253 octets** qui ne sont ni valeur ni drapeau (bourrage). Voisinage :

   | Offset | Contenu |
   |---|---|
   | 0x99f / 0x9a0 | champ octet, drapeau (SetupMovieTransmit) |
   | 0x9a1 à 0x9a3 | bourrage, pris par GR Mod (flou, date, image d'extinction) |
   | 0x9a4 à 0x9a7 / 0x9a8 | champ mot (SetupAutoPowerOff), drapeau |
   | 0x9a9 à 0x9ab | bourrage, pris par GR Mod (image d'extinction) |
   | 0x9ac à 0x9af / 0x9b0 | champ mot, drapeau |
   | **0x9b1 à 0x9b3** | **bourrage, libre** |
   | 0x9b4 / 0x9b5 | champ octet, drapeau |

   La fin de la fusion (`0x5324075c`) recopie 23 autres champs selon des drapeaux de
   l'enregistrement en cours (0xaee, 0xaf0...). Elle ne touche pas 0x9b1 à 0x9b3.

2. **Accès dans tout le programme (statique).** Balayage linéaire de 0x53000000 à 0x53b00000 :
   chaque accès mémoire à offset immédiat (toutes tailles, y compris les offsets obtenus par `add`
   ou par une constante dans un registre). Un accès est dit « par pointeur d'enregistrement »
   quand sa base a été lue à [objet, #4 à #0x20] (enregistrement en cours ou copies stockées) ou
   à `*0x55063f34`. Contrôles : le ratio (0x4c2), le film (0x1c2) et les touches ADJ (0x918) ont
   bien des accès par pointeur d'enregistrement.
   - 0x9b1 à 0x9b3 : **aucun accès exact par pointeur d'enregistrement**. Seulement deux
     lectures de mot à +0x9b0 (`0x53520d0c`, `0x53738148`), exactement le profil de 0x9a1 à 0x9a3
     et 0x9a9 à 0x9ab (lectures de mot à +0x9a0 et +0x9a8 par `0x534524b0`, `0x53693edc`,
     `0x53738130`).
   - Les 40 instructions qui touchent 0x9b1 à 0x9b3 quelle que soit leur base ont été revues à la
     main. Ce sont des données lues comme du code (0x530ff20c, 0x5391..., 0x5395..., 0x5399...,
     0x539c..., 0x539d..., 0x539e..., 0x53a1..., 0x53a2...) ou d'autres objets, reconnaissables à
     une forme incompatible avec l'enregistrement : mots écrits à 0x9a0, 0x9a4, 0x9a8, 0x9ac,
     0x9b0 (`0x5343b490`, `0x5350ebbc`, `0x5350f5a8`, `0x53645188`, `0x53816634`), qui
     écraseraient aussi les octets de GR Mod testés sur boîtier ; demi-mots à 0x9ae, 0x9b0, 0x9b2
     (`0x5364b14c`, `0x5364b164`) ; octets à 0x9ac, 0x9ad (`0x535156bc`) ; pointeur membre à
     +0x9b0 d'un objet du pipeline d'image (`0x53520d0c`, lu par `0x535159cc`, `0x53516c84`,
     `0x53519894`...) ; champ de bits dans un mot à +0x9b0 (`0x537da83c`, `0x537da85c`).
   - Limite connue : un pointeur d'enregistrement reçu en paramètre n'est pas suivi. Ces accès
     tombent dans la revue manuelle ci-dessus, puisqu'elle couvre toutes les bases.

3. **Opérations en bloc (statique, et émulé pour le constructeur).**

   | Adresse | Fonction | Effet sur 0x9b1 à 0x9b3 | Certitude |
   |---|---|---|---|
   | `0x5323f424` | constructeur des valeurs d'usine : memset 0 de 0xb28 octets, puis champ par champ, puis memcpy de 0xb26 octets (`0x532406b4`) et post-traitement `0x5323f328` | mis à 0 | émulé jusqu'au post-traitement |
   | `0x532406fc` | renvoie l'enregistrement d'usine (construit une fois, gardé à +0x24 de l'objet) | | statique |
   | `0x5324b284` | chargement : enregistrements du stockage (enregistrements 9 et 10 de `0x53828014`), sinon valeurs d'usine | copiés en bloc | statique |
   | `0x5323f274` | sauvegarde (à l'extinction) | copiés en bloc | statique |
   | `0x5324b760` | enregistrer les réglages en cours dans le mode n (1 à 6) : memcpy de 0xb26 octets, puis fusion | copiés vers le mode n | statique |
   | `0x53279fa8` | rappel du mode n : si le mode actif est 0, copie l'enregistrement en cours vers la copie 0 ; puis copie le mode n vers l'enregistrement en cours (`0x5327a004`) | copiés depuis le mode n | statique |
   | `0x5327a134` | remise de la copie 0 aux valeurs d'usine | mis à 0 | statique |
   | `0x5327b35c` | autre copie entière (après recopie de 0xb12 à 0xb24) | copiés | statique, rôle à préciser |

   Les copies de 0xb26 octets laissent 0xb26 et 0xb27 de côté. 0x9b1 à 0x9b3 sont bien copiés.

### Conséquences pour la conception

- **Le numéro du mode actif** est l'octet pointé par le premier mot de `UserDataModel`
  (`ldr r3,[r0]; ldrb r3,[r3]` dans `0x53279fa8`). Statique.
- **Quitter un mode U pour un autre ne sauvegarde pas l'état du mode quitté.** Seul le mode 0 est
  recopié avant un rappel. Il faut donc écrire l'état du rouleau à la fois dans l'enregistrement en
  cours (+4) et dans la copie stockée du mode actif (+8 + 4n). Confirme le conseil de Maxwooow.
- « Enregistrer dans U » (`0x5324b760`) copiera le rouleau en cours dans le mode choisi. Cas à
  traiter en phase 4 : interdire l'enregistrement pendant un rouleau, ou remettre l'état du
  mode cible.
- Le garde-fou (`guard.ts`) ne touche pas ces octets. Il pourra valider l'état du rouleau (vue
  au plus égale à la longueur du rouleau, sinon rouleau déchargé).
- Sauvegarde à l'extinction seulement : retirer la batterie fait perdre l'état depuis l'allumage.

## Phase 2.2 : build de test des octets du rouleau (2026-10-27)

But : confirmer sur le boîtier que 0x9b1 à 0x9b3 survivent à l'extinction, et observer ce que
font les modes U et les BOX de réglages. Build de test uniquement, jamais une version publiée.

- Module : `core/src/fw/gr3x/film-probe.ts` (option `filmProbe` de `buildGr3xAdjResearch`, round 10
  avec date incrustée obligatoire, révision `T10-FILMPROBE`).
- Construction : `node --experimental-transform-types tools/gr3x/build-film-probe.mjs <fwdc239b.bin officiel> <nouveau dossier>`
  (round 10, date incrustée, sans film, un ratio ajouté XPan 65:24 car le constructeur en exige un).
- Vérification : `core/test/gr3x-film-probe.test.ts` et `tools/gr3x/film_probe_check.py`.

Fonctionnement, dans l'enregistrement en cours seulement :

| Octet | Compteur | Incrémenté |
|---|---|---|
| 0x9b1 | démarrages | après le chargement des réglages (crochet sous le garde-fou) |
| 0x9b2 | photos | chaque fois que l'incrustation demande l'heure (une fois par JPEG encodé) |
| 0x9b3 | extinctions | juste avant la sauvegarde des réglages |

L'incrustation affiche, au style long, `20SS.MM.01 OO:PP` : SS démarrages (modulo 100), MM numéro
du mode actif + 1 (01 pour les réglages du boîtier, 02 à 07 pour un mode rappelé), OO extinctions
(modulo 24), PP photos (modulo 60). L'horloge de remplacement est passée au module de date par son
contexte (`get_time`) ; sans enregistrement chargé, c'est l'horloge du boîtier.

Vérifié en émulateur (certitude : émulé) : le chargement et la sauvegarde passent par toute la
chaîne de crochets du build (garde-fou à l'extérieur, sonde dessous, chargement et sauvegarde
natifs remplacés), +1 au bon octet de l'enregistrement en cours, rien d'autre ne change, rien
n'est écrit sans enregistrement ; la sauvegarde native voit bien le compteur déjà incrémenté.
L'horloge : 2304 cas (toutes les valeurs d'octet, modes 0 à 200 et absent), valeurs toujours dans
les bornes du module de date. Contre-épreuves : la sonde échoue si on attend le mauvais octet.
Non vérifié : le module de date lui-même avec cette horloge (inchangé, testé sur boîtier), le
démarrage réel, les menus.

Questions que le test doit trancher sur le boîtier :
1. Les trois octets survivent-ils à une extinction normale ? (attendu : oui)
2. Le compteur de photos avance-t-il de 1 par déclenchement, ou plus (encodages multiples) ?
   Avance-t-il au développement RAW intégré ? (utile pour la phase 3 : compter les captures)
3. Que deviennent les compteurs en passant sur une BOX / un mode U, puis en revenant ?
4. Retrait de la batterie sans éteindre : perte depuis l'allumage ? (attendu : oui)

### Résultats sur le boîtier (GR III 2.10, build T10-FILMPROBE, 2026-10-27)

Certitude : **testé**, relevés de l'utilisateur.

| Cas | Observation | Conclusion |
|---|---|---|
| A1, A2 | `2001.01.01 00:01` puis PP = 02 | conforme |
| A3 | pas de rafale ; 3e et 4e photos : PP +1 chacune | un encodage par photo simple |
| B1, B2 | SS +1, OO +1, PP continue | **0x9b1 à 0x9b3 survivent à l'extinction : octets validés** |
| B3 | extinction automatique puis réveil : SS et OO inchangés, PP +1 | la mise en veille n'est pas une extinction : **aucune sauvegarde** |
| B4 | batterie retirée boîtier allumé : SS, OO et PP identiques à la photo d'avant | pas de sauvegarde ; l'état depuis l'allumage est perdu |
| C1 | RAW+JPEG : PP +1 | un encodage |
| C2 | développement RAW intégré : PP +1, puis +1 à la photo suivante | **le développement compte comme un encodage** (conseil de Maxwooow confirmé) |
| C3 | lecture et zoom : PP +1 à la photo suivante seulement | la lecture n'encode pas |
| C4 | multi-exposition, 3 vues superposées : PP +6 | **2 encodages par vue en multi-exposition** : l'encodeur ne peut pas servir de compteur |
| D1 | U1 : MM = 04 | U1 rappelle la copie 3 |
| D2 | retour sur P : compteurs de P retrouvés | la copie 0 est restaurée au retour (comme lu dans `0x53279fa8`) |
| D3 | U1 : PP repart de la valeur de U1, MM = 04 ; U2 : MM = 03 | U2 rappelle la copie 2 ; chaque mode a ses propres octets |
| D4 | sur U1, extinction puis rallumage : PP +1 | l'état de U1 tient après extinction (SS, OO à préciser) |
| D5 | sur P (`2001.04.01 01:02` avant), enregistrement dans BOX5 puis rappel de BOX5 par le menu : `2005.01.01 04:33` | le rappel par le menu recopie la BOX dans les réglages du boîtier (mode 0) avec nos octets ; MM reste 01 |
| U3 | `2006.06.01 05:35` | U3 rappelle la copie 5, qui contient les compteurs enregistrés dans BOX5 à l'étape D5 (puis +1 démarrage, +1 extinction, +2 photos) |

Conséquences :
- **Brique « octet de stockage » validée.** 0x9b1 à 0x9b3 sont persistants et propres à chaque mode.
- **Sauvegarde :** la veille automatique ne sauvegarde pas. Le mode pellicule devra déclencher
  lui-même une sauvegarde (au moins à chaque avance du film), sinon une batterie qui se vide en
  veille fait perdre le rouleau.
- **Détection d'une prise de vue :** ni le nombre d'encodages (développement RAW, 2 par vue en
  multi-exposition) ni l'encodeur ne conviennent. Il faut un point propre à la capture (phase 2.3).
- **Modes et BOX (testé, interprétation forte) :** les 7 copies stockées de l'objet des réglages
  sont la copie 0 (réglages du boîtier, sauvegardés avant un rappel) et **BOX1 à BOX6** (copies 1
  à 6, `0x5324b760` « enregistrer dans la BOX n »). Les positions U1, U2, U3 de la molette
  rappellent chacune une BOX choisie par l'utilisateur : ici U1 = BOX3, U2 = BOX2, U3 = BOX5.
  L'octet « mode actif » contient le numéro de la BOX rappelée (0 sur P, Av, Tv, M...).
- **Rappel d'une BOX par le menu :** recopie la BOX dans les réglages du boîtier (mode 0), état du
  rouleau compris. À traiter en phase 4 (rouleau dupliqué entre la BOX et le mode 0).

## Phase 2.3 : détection d'une prise de vue, étape 1 (recherche statique, 2026-10-27)

### Résultat

Candidat : **`SetShootingInfoResultBeforeExpose` (`0x534322d8`)**, au début de chaque exposition
d'une photo. GR Mod s'y accroche déjà (orientation de la date incrustée, `datestamp.ts`, testé sur
boîtier depuis le round 8). Certitude : **statique** ; à confirmer par un build de test.

### Chaîne d'appels (fichier source d'après les assertions : `src/FECaptureProcess.cpp`)

| Adresse | Rôle | Preuve |
|---|---|---|
| `0x5342da08` | méthode virtuelle de réception des messages du processus de capture (table `0x53c1a1dc`, précédée des noms `OnRelease`, `OnReleaseContinuous`) ; aiguille selon l'identifiant du message | table de méthodes, `switch` sur r3 |
| `0x5342ac64` | préparation d'une photo : appelle `0x53434200(exposition, 0)` | appel depuis `0x5342dce4` |
| `0x53434200` | fixe le **type d'exposition** : `[[exposition + 0x20] + 0x24] = 1 - argument` | `eor r0,r1,#1 ; str r0,[r4,#0x24]` |
| `0x5342adb4` | lance l'exposition : `0x534323d0(objet + 0x48)` | appel depuis `0x5342dbe0` |
| `0x534323d0` | `StartStillExpopsureProcess` (sic) | chaîne d'assertion |
| `0x534324f4` | n'appelle `BeforeExpose` **que si le type vaut 1** | `cmp r3,#1 ; bne` avant `bl 0x534322d8` |

Les autres chemins vers `StartStillExpopsureProcess` mettent le type à 0, donc n'appellent pas
`BeforeExpose` :
- `0x534325e8`, **`SlowShutterNrProcess`** (seconde exposition, obturateur fermé, de la réduction
  du bruit en pose longue) : `str r2(0),[ip,#0x24]` ;
- `0x53430cd8`, calibration du bruit : `0x53434200(…, 1)`, donc type 0 ;
- `0x5342fa80`, calibration liée au Pixel Mapping (`IsPixelMappingProcessView`) : ne fixe pas le
  type lui-même (il garde la valeur précédente). Fonction de menu, hors prise de vue normale.

Le développement RAW intégré ne passe pas par une exposition : il n'appelle pas `BeforeExpose`.

### Ce qui reste à confirmer sur le boîtier

Photo simple (+1), développement RAW (+0), multi-exposition 3 vues (+3), pose longue avec
réduction du bruit (+1), et facultativement Pixel Mapping (attendu +0, à vérifier).

## Phase 2.3 : étapes 2 et 3, build de test des expositions (2026-10-27)

- Variante `filmProbe: 'exposures'` (révision `T10-FILMPROBE2`, `--exposures` pour
  `tools/gr3x/build-film-probe.mjs`). PP (0x9b2) compte les expositions : +1 au début du crochet
  déjà posé par la date incrustée sur `SetShootingInfoResultBeforeExpose` (`0x534322d8`), avant
  son code d'orientation. L'horloge de remplacement ne fait plus que lire PP. SS et OO inchangés.
- Le build `T10-FILMPROBE` ressort identique octet pour octet (SHA-256 `46ca299f…`).
- Émulé (`tools/gr3x/film_probe_check.py`) : du crochet jusqu'à la deuxième instruction de la
  fonction d'origine, PP +1 (rien sans enregistrement), r0 à r3, lr, sp intacts, ip = sp,
  mots d'orientation et de film du cadre écrits comme sans la sonde. Contre-épreuves : la sonde
  échoue si l'on intervertit les deux variantes.

### Résultats sur le boîtier (GR III 2.10, build T10-FILMPROBE2, 2026-10-27)

Certitude : **testé**, relevés de l'utilisateur (sur U3, MM = 06).

| Cas | Observation | Conclusion |
|---|---|---|
| P1 | 2 photos JPEG : PP 36 puis 37 | +1 par photo |
| P2 | RAW+JPEG : PP 38 | +1 |
| P3 | JPEG développé depuis le RAW : PP 38 | **le développement RAW ne compte plus** |
| P4 | multi-exposition 3 vues puis Complete : PP 41 | **+3, une par vue** (l'encodeur donnait +6) |
| P5 | poses de 1,3 s puis 5 s : PP 42 puis 43 ; pose longue à ISO 128000 avec réduction du bruit (temps de traitement constaté) : PP 44 | **+1 par pose longue, la dark frame ne compte pas** |
| P6 | non fait (Pixel Mapping) | facultatif |

**Brique « détection d'une prise de vue » validée** : `SetShootingInfoResultBeforeExpose`
(`0x534322d8`) compte une fois par vue, multi-exposition comprise, et ignore le développement RAW.

## Phase 2.4 : verrou et « Complete », étape 1 (recherche statique, 2026-10-27)

Certitude : **statique** pour tout ce qui suit.

### État de la multi-exposition (la condition du verrou)

- **Octet d'état : `+0x6c0` de l'enregistrement de prise de vue en direct** (objet unique
  `0x553458b0`, getter `0x53525d5c`, puis `+0x518`, puis `[0]` ; le même enregistrement dont GR Mod
  lit l'orientation à `+0xc8`). Lecture : `0x535493ac(objet)` (sous mutex, via `0x535512e0`
  `ldrb r0,[r3,#0x6c0]`). Écriture : `0x5354700c(objet, état)` (via `0x53555e68`, qui notifie au
  changement).
- **Valeurs** (`0x5346a850`, au déclenchement, d'après le mode de déclenchement `+0x799`) :
  0 normal ; 1 intervalle (modes 4, 5) ; **2 multi-exposition** (mode 3) ; 3 bracketing (mode 2).
- **Le verrou natif teste « état == 2 »** : 33 appels à `0x535493ac`, dont 18 suivis de
  `cmp r0,#2` et 5 de `sub r0,r0,#2`. Exemples : la disponibilité de 8 fonctions du levier ADJ
  (`0x531a4d38`, fonctions 3, 4, 5, 10, 12, 16, 18, 19 de la table `0x53b39a14`, dont Image Control
  12 et Crop 16) ; la commande distante de multi-exposition (`0x5328eca8`). Étendre le verrou =
  traiter « rouleau chargé » comme l'état 2 **dans les seuls sites d'interface** (à trier : certains
  sites peuvent servir au traitement d'image). Phase 5.

### Phase de la multi-exposition et fin de séquence (« Complete »)

Petite classe (compteur de phase à `+4`), appelée par la machine à états de prise de vue
`ExecuteMessageEvent` (`0x534639d4`) :

| Fonction | Rôle (déduit) | Déclencheur |
|---|---|---|
| `0x5346a850` | déclenchement : phase 1 puis 2, état 2 en multi-exposition | appels `0x534686b4`, `0x53468f50` |
| `0x5346a8d8` | **Retake** : phase 1 → état 0, sinon état 2 | message `0x42411817` |
| `0x5346a910` | **fin de séquence** : phase 0, état 0 | message `0x42411c16` |
| `0x5346a96c` | remise à zéro de l'état | `0x53463190` |

- **Identifiants des messages** : la commande de débogage n° 6 (`MSG_ID_CMD_SHOOTING_MULTI_EXPOSURE_END`)
  envoie `0x42411c16`, la n° 7 (`..._RETAKE`) envoie `0x42411817` (`0x5301f83c`, `0x5301f954`, par
  `0x535157b4`).
- **Côté traitement d'image** (`BEStillImageProcess.cpp`) : `0x535186e0(this, 0)` termine la
  multi-exposition (journal « Multi Exposure End »), `(this, 1)` la reprend (« Multi Exposure
  Retake ») ; répartiteur `0x5351b9e8` (cas 0xb et 0xc) ; il renvoie `0x42411c16` à la fin
  (`0x5351bc8c`). D'autres récepteurs écoutent `0x42411c16` (`HTControl.cpp`, `0x533b0fe8`).
- Candidat pour l'événement « Complete » : **`0x5346a910`** (une fois par séquence terminée).
  À vérifier : extinction en cours de surimpression, changement de mode.
- Non trouvé : le dialogue Next shot / Retake / Complete et ses touches. Piste : la table de
  touches de `QuickViewController` (`0x53b41324`, touches 0x2b4 à 0x2b6 et 0x2c5, 0x2c6 ; la
  fonction `0x531ca7d8` publie l'événement 0xb7).

## Phase 2.4 : étapes 2 et 3, build de test de la séquence (2026-10-27)

- Variante `filmProbe: 'sequence'` (révision `T10-FILMPROBE3`, `--sequence`). Aucun crochet sur
  le chargement ni la sauvegarde. Deux crochets d'entrée : `0x5346a910` (fin de séquence, 0x9b1
  +1) et `0x5346a8d8` (Retake, 0x9b3 +1). Au début de chaque exposition : 0x9b2 +1, et l'état de
  la multi-exposition (`+0x6c0` de l'enregistrement de prise de vue en direct) copié dans l'octet
  `0x55804388` (mot réservé de GR Mod, inutilisé ; builds de test seulement).
- Affichage : `20SS.MM.01 OO:PP` = SS fins de séquence, MM état + 1 à la dernière exposition,
  OO Retake, PP expositions.
- Les builds `T10-FILMPROBE` et `T10-FILMPROBE2` ressortent identiques.
- Émulé : les deux crochets exécutés depuis l'entrée réelle des fonctions (compteur +1, rien
  sans enregistrement, registres intacts, reprise à la deuxième instruction) ; le crochet
  d'exposition avec une chaîne de pointeurs simulée (état et orientation lus, 0 si un pointeur
  manque). Contre-épreuves : la sonde échoue si l'on inverse fin et Retake, ou les variantes.

### Résultats sur le boîtier (GR III 2.10, build T10-FILMPROBE3, 2026-10-27)

Certitude : **testé**, relevés de l'utilisateur (`20SS.MM.01 OO:PP`, SS fins de séquence, MM état
+ 1, OO Retake, PP expositions).

| Cas | Relevé | Lecture |
|---|---|---|
| S1 photo normale | `2005.01.01 04:34` | référence ; MM 01 (état 0) |
| S2 multi-exposition 2 vues + Complete | `2005.03.01 04:36` | PP +2 ; **MM 03 (état 2)** ; SS inchangé sur l'image finale |
| S3 1 vue, Retake, 1 vue, Complete | `2006.03.01 05:38` | **OO +1** ; PP +2 ; SS +1 = la fin de S2, comptée **après** l'encodage de son image finale |
| S4 2 vues puis extinction ; après rallumage, photo normale | `2008.03.01 05:40` puis `2008.01.01 05:41` | l'image superposée est enregistrée à l'extinction ; SS +2 = la fin de S3, puis la fin par extinction (comptée avant l'encodage de l'image) ; rien de plus au rallumage |
| S5 2 vues puis changement de mode ; photo normale | `2009.01.01 05:44` | SS +1 : **le changement de mode termine aussi la séquence**, et l'image superposée est enregistrée (confirmé) ; PP +3 |
| S6 bracketing, intervalle | non fait | facultatif |

Conclusions :
- **État de la multi-exposition validé** : 2 pendant une multi-exposition (MM 03), 0 sinon.
- **`0x5346a910` = une fois par fin de séquence**, quelle qu'en soit la cause : Complete,
  extinction, changement de mode. Pour Complete, il passe après l'encodage de l'image finale.
  C'est l'événement « avance du film » du cahier des charges (l'extinction compte comme une
  avance, comportement voulu).
- **`0x5346a8d8` = Retake** (une fois par Retake).
- Le verrou lui-même (grisé des menus) n'a pas été testé : le build ne le modifie pas.

## Phase 2.5 : tri des lecteurs de l'état de multi-exposition (2026-10-27)

Certitude : **statique**. Deux familles de lecteurs de l'octet d'état `+0x6c0`.

### 1. Par le getter `0x535493ac` (33 appels)

| Catégorie | Fonctions | Rôle (indice) |
|---|---|---|
| Interface : levier ADJ | `0x531a4d38`, `0x531a4d80` | disponibilité de fonctions ADJ (table `0x53b39a14` : 3, 4, 5, 10, 12 Image Control, 16 Crop, 18, 19) |
| Interface : liste Fn | `0x531a6ecc` ← `0x531a6ef4` | `FnListController` |
| Interface : mode de déclenchement | `0x531b307c` (8 appelants) | « does not DriveMode ID », `OnStart` |
| Interface : ratio par touche | `0x5323a080`, `0x5323a1a4` | `ChangeAspectRatio` (`AppEventFunctionModel.cpp`) |
| Interface : fonctions de commutation | `0x53296694` et 12 fonctions `0x53298024` à `0x53299314` | `CaptureReadySwitchFunctionModel` (`GetEventSwitchForAppControl`) |
| Commandes distantes (app, câble) | `0x5328c25c`, `0x5328eca8`, `0x5328edd0`, `0x5328fc1c` | `RemoteCommandModel.cpp`, `DevelopmentCommandModel.cpp` |
| Contrôle à distance (HT) | `0x533b70c8`, `0x533d702c`, `0x533d7054`, `0x533eea8c` | `HTPropertyFactory`, `HTCamEventMonitor`, `RemoteLvBuffer` ; surtout « état == 1 » (intervalle) |
| Affichage | `0x532d5a84` | `LiveViewController::UpdateViewHistogram` |
| Affichage | `0x532a328c` (état == 0) | `CaptureReadyModel` (`DispMediaFatalError`) |
| **Prise de vue et traitement : ne pas toucher** | `0x5346a850` (calcul de l'état), `0x53515900`, `0x53515928`, `0x53517f0c` (`BEStillImageProcess`), `0x535a4ef0` (paramètres de fichier) | |

### 2. Lectures directes `ldrb [x,#0x6c0]`

- **Couche CommonProperty** (`0x53553a58` à `0x535545e0`) : une quarantaine de petites
  fonctions « autorisé = état ≠ 2 », souvent pour certaines valeurs seulement (0, 1, parfois 2) :
  disponibilité **valeur par valeur** d'options de réglages, par paires (réglage en cours / copie
  en `+4`). Elles sont appelées par des fonctions rangées dans une table à `0x540927e8` (deux
  tables de 265 entrées, entrée par défaut `0x5353ed9c` = toujours disponible) ; 65 entrées
  dépendent de l'état. **Les réglages correspondants ne sont pas encore identifiés** (l'index n'est
  pas l'ordre des champs de l'enregistrement ; le film et le ratio n'y figurent pas).
- **Prise de vue et traitement : ne pas toucher** : `0x5342a690`, `0x5343ba60` et `0x5343e670`
  (`LiveViewProcess`, `SelectSensorDriveMode`), `0x5346192c`, `0x5346b514` (28 appelants),
  `0x535141fc` (`IsMaxFolderCheck`), `0x535168f4`, `0x536dc0f4`, `0x536dc860`.

### Conséquence pour la phase 5

Le verrou natif n'est pas un seul test mais **une vingtaine de points d'interface**, plus la
couche CommonProperty. Étendre le verrou = faire voir « état 2 » à ces seuls points quand un
rouleau est chargé, jamais au code de prise de vue.

### Outil annexe

`0x5334688c` et `0x53386230` : réglage par nom pour le débogage (« StillAspectRatio » appelle le
setter du ratio `0x532525a4`, etc.). Permettra de nommer les champs de l'enregistrement.

## Phase 2.6 : le dialogue Next shot / Retake / Complete (2026-10-27)

### Observation sur le boîtier (utilisateur)

**Ouvrir le MENU pendant une multi-exposition revient à faire Complete** : rien n'y est grisé,
la séquence se termine. Le verrou natif ne concerne donc que ce qui reste accessible pendant la
séquence (levier ADJ, Fn, molettes, touches), pas le menu principal. Conséquence pour la phase 5 :
pendant un rouleau, le menu devra être verrouillé par nos soins (lignes grisées ou entrée
bloquée) ; l'hypothèse « étendre la condition native » du cahier des charges ne suffit pas.

### Chaîne Complete / Retake (statique)

| Étage | Complete (fin) | Retake | Preuve |
|---|---|---|---|
| Événement d'interface | **0xb8** | **0xb7** | table de sauts de `0x53227830` (index = événement - 0x34, table `0x53227850`) |
| Action | `0x532270f4` | `0x532270d4` | récupèrent le modèle (`0x5320b19c`) |
| Modèle | `0x5323a080` | `0x5323a1a4` | **seulement si l'état vaut 2** ; écrivent `+0x2e = 1`, `+0x8a3 = 0` |
| Commande vers la capture | `0x42411c16` | `0x42411817` | envoyée par `0x532286dc` |
| Nom de la commande | `CMD_SHOOTING_MULTI_EXPOSURE_END` (index 21) | `..._RETAKE` (index 22) | table de noms `0x540b4444` ; identifiant = `0x4241` + taille + (index + 1) |
| Machine à états | `0x5346a910` | `0x5346a8d8` | testé (`T10-FILMPROBE3`) |

- Qui publie l'événement 0xb7 (Retake) : la commande distante (`0x5328edc4`) et
  `QuickViewController` (`0x531ca7d8`, dans sa table de touches `0x53b41344` : touches 0x2b4,
  0x2b5, 0x2b6 ; la deuxième mène à `0x531ca7d8`). Le dialogue est donc l'**aperçu après la vue**.
- Qui publie l'événement 0xb8 (fin) : la commande distante (`0x5328ed48`) et neuf autres endroits
  (`0x531a4d80`, `0x531a6ef4`, `0x531cb5f4`, `0x531b3838`, `0x532a7c84`, `0x532a7cb0`,
  `0x532a7cdc`, `0x532a7d08`, `0x532a7f6c`) : vraisemblablement les sorties de la prise de vue
  (menu, lecture, levier ADJ, mode de déclenchement...). À identifier une par une.
- **Pour la phase 6** : avancer le film = publier l'événement 0xb8 (ou appeler `0x5323a080`) ;
  surimpression = ne rien faire (le déclencheur reste en multi-exposition).

### Les choix du dialogue (statique)

Table de `QuickViewController` à `0x53b41344` : trois lignes, désignées par leurs **identifiants
de texte** (vérifiés dans la table des textes anglais `0x55002bac`) :

| Texte | Ligne | Fonction | Effet |
|---|---|---|---|
| 0x2b4 | « Next shot » | `0x531ca804` | ferme l'aperçu, rien d'autre |
| 0x2b5 | « Retake shot » | `0x531ca7d8` | publie l'événement 0xb7 |
| 0x2b6 | « Complete » | `0x531cb6a0` | `0x531cb5f4` (drapeau `+0x182`, publie 0xb8), puis ferme |

La table voisine `0x53b41324` (0x2c5 « Cancel », 0x2c6 « Delete ») est le dialogue de suppression.
Publier l'événement 0xb8 : `0x532288b0(0x5320aefc(0x5320ad88()), 0xb8, 0, 0)`.

### Les émetteurs de l'événement 0xb8 (statique, à identifier sur le boîtier)

| N° | Fonction | Indice |
|---|---|---|
| 1 | `0x531a4d80` | si `0x531a4d38` (état 2) ; près des fonctions ADJ |
| 2 | `0x531a6ef4` | liste Fn (`FnListController`) |
| 3 | `0x531b3838` | si `0x531b307c` (état 2) ; mode de déclenchement |
| 4 | `0x531cb5f4` | « Complete » de l'aperçu |
| 5 à 9 | `0x532a7c84`, `0x532a7cb0`, `0x532a7cdc`, `0x532a7d08`, `0x532a7f6c` | `CaptureReadyModel`, notifications 0xaa, 0x89, 0x8b à 0x8d, 0x35, 0x19a (méthode `0x532a8c4c`, table de sauts `0x532a8c70`) |

Build de test `T10-FILMPROBE4` (`--emitters`) : chaque émetteur note son numéro ; la fin côté
modèle (`0x5323a080`, avant l'encodage de l'image finale) le recopie pour l'affichage (10 si aucun
des neuf). Émulé : chaque émetteur et la fin côté modèle exécutés depuis leur entrée réelle
(registres intacts, numéro écrit, reprise normale) ; contre-épreuves : la sonde échoue si l'on
inverse deux émetteurs ou les variantes. Les builds précédents ressortent identiques.

## Phase 2.7 : compteur de vues restantes à l'écran (statique, 2026-10-27)

Chaîne, du calcul à l'écran :

| Étage | Adresse | Rôle |
|---|---|---|
| Calcul | `StillControl/src/AvailableCounter.cpp` (côté traitement) | nombre de vues restantes |
| Message | `0x22080621` = `EVT_SHOOTING_UPDATE_AVAILABLE_COUNT_STILL` (index 32 de la table `0x540b4aa0`, octet bas = index + 1) | vers le modèle de prise de vue |
| Réception | `0x5323a878` (répartiteur du modèle) → `0x53236838` | range le résultat (8 octets) à `+0x3c` du modèle (`0x5320b19c`) |
| Getter | `0x53239e34` : `ldr r0,[r0,#0x3c]; bx lr` | **un seul appelant** |
| Texte | `0x532aa1d4` → `0x532aa140` | « ----- » (texte `0x5407118c`) si `0x5354867c` ou (état du modèle `0x53236f28` == 2 et nombre 0) ; sinon `snprintf(%d)` du nombre plafonné à 99999, tampon de 6 caractères |
| Écran | `LiveViewController` (`0x531714c8`, appel `0x531715b4`) | |

**Point d'accroche pour la phase 7** : `0x532aa1f4`, juste après le getter (r0 = nombre de vues
restantes) : y substituer le numéro de vue quand un rouleau est chargé. Ce chemin ne sert qu'à
l'affichage ; le nombre réel (`+0x3c`) reste intact pour le reste du firmware (carte pleine,
déclenchement). Le tampon de 6 caractères permet aussi « 12/36 ». Certitude : statique ; à
vérifier par un build de test (afficher par exemple le nombre d'expositions).

## Phase 2.8 : dossiers (statique, 2026-10-27)

### Nom de dossier sur 5 caractères : natif

- **Le GR III stocke un nom de dossier de 5 caractères dans ses réglages : `+0x936` à `+0x93a`**
  (champ de 5 octets de la carte, drapeau `0x93c`). Setter `0x5326ca50` (copie dans les huit
  enregistrements, donc réglage global), appelé par `0x5326caa0`, qui transmet ensuite le nom à
  l'enregistrement de prise de vue en direct (`0x5354d138`). Réglage de débogage par nom :
  `SetupFolderName` (`0x53330ba0`, 6 octets copiés).
- **Type de nom : octet `+0x934`** (huit enregistrements), setter `0x53258604`, réglage de
  débogage `SetupFolderNameType` (`0x53330b1c`, chaînes « Date » et « Any » ; valeurs à
  confirmer). Textes du menu : « Folder Name » (0x235, 0x236), contrôleur `FolderNameController`
  (`0x531de4b0`, `UpdateFolderName`).
- Pour le mode pellicule : nom = code du film (`CCHRM`, `LEICA`...), type = nom libre. À vérifier :
  quelle valeur de type utilise le nom libre, et si le menu natif le propose.

### « Create New Folder » : un drapeau

- Texte d'aide 0x2ab : « le dossier est créé à l'enregistrement de la prochaine image ».
- Dialogue : `FolderCreateController` (table de méthodes `0x53b475d8`) ; préparation `0x531e5ec8`
  (contrôleur 0x02000128) ; **validation `0x531e65b0`** : `0x5358515c(0x53584c74(), 1)`, puis le
  message de confirmation (contrôleur 0x02000129).
- `0x53584c74` renvoie l'objet d'informations fichiers (`0x55349808`, initialisé une fois) ;
  `0x5358515c(objet, v)` écrit `v` aux octets `+0x116` et `+0x117` de la structure pointée par
  `[objet + 0x248]`.

### Numéro de dossier en cours (brique 5, candidat)

Même structure (`[objet + 0x248]`) : `0x5358516c` lit un mot à `+0x118` et un demi-mot à
`+0x11c` ; `0x53585188` les écrit ; `0x5358519c` les remet à (−1, 0). Probablement le numéro de
dossier et le numéro de fichier en cours. Certitude : supposé ; à vérifier par un build de test.

### Résultats sur le boîtier (build T10-FILMPROBE4, 2026-10-27)

Certitude : **testé** (2 vues en multi-exposition avant chaque cas ; MM = émetteur + 1).

| Cas | Relevé | Lecture |
|---|---|---|
| E1 « Complete » du dialogue | `2012.01.01 05:51` | MM 01 : la fin **ne passe pas** par la fin du modèle (`0x5323a080`) avant l'encodage ; autre chemin, à trouver |
| E2 MENU | `2014.05.01 05:53` | MM 05 : émetteur 4, **`0x531cb5f4` (aperçu)** |
| E3 Lecture | rien | la séquence continue, le dialogue reste |
| E4 molette de mode | `2015.05.01 05:57` | MM 05 : émetteur 4 |
| E5 Fn | rien | la séquence continue |
| E6 levier ADJ | rien | la séquence continue |
| E7 mode de déclenchement | non fait | |
| E8 extinction | `2019.05.01 05:03` | MM 05 : émetteur 4 |
| E9 retrait de la carte | photo non enregistrée | la surimpression est perdue |

Conclusions : MENU, molette de mode et extinction terminent la séquence par l'aperçu
(`0x531cb5f4` → événement 0xb8 → `0x5323a080`). Lecture, Fn et ADJ ne la terminent pas. « Complete »
dans le dialogue la termine par un autre chemin.

### Build de test T10-FILMPROBE5 (briques 3, 4, 5)

`filmProbe: 'folders'` (`--folders`) :
- compteur à l'écran = nombre d'expositions (crochet `0x532aa1f4`, juste après le getter) ;
- à la fin du modèle (`0x5323a080` : MENU, molette, extinction), nom de dossier `TEST` + lettre
  (`'A' + fins % 26`) par `0x5326caa0`, type « nom libre » (1) par `0x53258604`, drapeau de nouveau
  dossier par `0x5358515c(0x53584c74(), 1)` ;
- incrustation `20YY.MM.01 HH:mm` : YY numéro de dossier candidat (`+0x118`) % 100, MM 1 + drapeau
  `+0x116` + 2 × drapeau `+0x117`, HH fins de séquence % 24, mm numéro de fichier candidat
  (`+0x11c`) % 60.

Émulé : chaque crochet exécuté depuis son site, avec bouchons pour les fonctions appelées (ordre et
arguments vérifiés : nom, type 1, drapeau 1 ; rien sans réglages chargés), compteur à l'écran,
400 cas d'horloge. Contre-épreuves : la sonde échoue si l'on inverse l'ordre des appels.

Attention : le nom et le type de dossier sont des **réglages sauvegardés** ; après le test, les
remettre depuis le menu (nom saisi au clavier virtuel, `SoftwareKeyboardController` `0x531dbce0` ;
type dans la liste `0x531b76c4`).
