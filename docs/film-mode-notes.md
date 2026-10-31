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

### Résultats sur le boîtier (build T10-FILMPROBE5, 2026-10-27, en cours)

Arborescence de la carte après le test : `105RICOH` (avant le test), puis `106TESTT` (6823, 6824 :
F1), `107TESTT` (6825, 6826 : F2), `108TESTU` (6827, 6828 : F3), `109TESTV` (6829, 6830 : F4),
`110TESTW` (6831 : F5).

- **Nom de dossier natif et drapeau de nouveau dossier : testés.** Chaque passage par la fin du
  modèle a ouvert un nouveau dossier `NNNTESTx` à l'enregistrement suivant ; **l'image
  superposée est enregistrée dans le nouveau dossier** (drapeau pris en compte avant son
  enregistrement). La numérotation des dossiers continue (106 à 110).
- La lettre retarde d'un cran : le crochet lit le compteur de fins avant `0x5346a910`.
- La fin du modèle (`0x5323a080`) est appelée **aussi hors multi-exposition** (dossier `106TESTT`
  créé avant F1) ; le test de l'état 2 est fait par la fonction d'origine, après le crochet. Le mode
  pellicule devra tester l'état lui-même.
- F4 (Complete du dialogue) a aussi créé un dossier : ce chemin passe par la fin du modèle avant
  l'enregistrement (E1 avait laissé penser le contraire).
- Candidat brique 5 : incrustations de F1 `2099.04.01 19:00` (6823 : mot `+0x118` > 999, deux
  drapeaux levés) et `2001.01.01 19:46` (6824 : `+0x118` = 1, `+0x11c` % 60 = 46, alors que 6824 % 60
  = 44).
- Incrustations de F2 à F5 (photo : YY, MM, mm) : 6825 (107, superposée) 01, 04, 46 ; 6826 (107)
  01, 01, 47 ; 6827 (108, superposée) 01, 04, 47 ; 6828 (108) 01, 01, 48 ; 6829 (109, superposée)
  01, 04, 48 ; 6830 (109) 01, 01, 49 ; 6831 (110, après extinction) 01, 04, 49.
- **Brique 5, lecture : testée.** Le demi-mot `[0x53584c74() + 0x248] + 0x11c` est le **numéro du
  dossier en cours** (106 % 60 = 46, etc.) ; il garde l'ancien dossier tant que la demande de
  nouveau dossier est en attente, et change à l'enregistrement qui crée le nouveau dossier. Les
  octets `+0x116` et `+0x117` sont la **demande de nouveau dossier en attente** (levés au moment de
  l'image superposée, à 0 ensuite). Le mot `+0x118` vaut 1 (−1 juste après le flash, photo 6823) :
  rôle à préciser. Reste à tester : **écrire** un ancien numéro pour y revenir.
- **Brique 3 : testée.** Compteur à l'écran pendant `T10-FILMPROBE5` : 81, 82, 83, 84, une photo
  à chaque fois. Le crochet `0x532aa1f4` remplace bien l'affichage des vues restantes, sans gêner
  le déclenchement.

### Brique 5, écriture : le candidat n'est pas la commande (statique, 2026-10-27)

- `0x53585188` (écriture de `+0x118` et `+0x11c`) a **un seul appelant**, `0x535b2ac4`, dans le
  service de création DCF (`ContentsControl/Camera/DCF/src/DcfContentsCreateService.cpp`, appelé
  par `0x535b2cbc` et `0x535b2e8c`, « namingInfo »). Il calcule d'abord le nom de l'objet à créer
  (`0x535b6858`), puis, si une condition (`0x53585150`) est vraie, **recopie** dans `+0x118` /
  `+0x11c` le résultat (mot `[service + 0x38]`, numéro de dossier) ; sinon il les remet à
  (−1, 0) (`0x5358519c`). S'il faut créer un dossier, il le crée (heure par `0x536b6510`) puis
  baisse les drapeaux (`0x5358513c(info, 0)`, `0x5358515c(info, 0)`).
- Conclusion : `+0x11c` est un **compte rendu** du dossier du dernier objet créé, pas la variable
  qui choisit le dossier du suivant. L'écrire ne ferait probablement rien.
- Le choix du dossier se fait dans le calcul du nom DCF : `0x535b6858` aiguille entre trois
  stratégies (`0x535b6678`, `0x535b66e0`, `0x535b67dc`) selon deux octets de la description de
  nommage (`+0x15`, `+0x0`) ; chaînes voisines « GetDirectoryType », « dataCreationTime » ;
  `0x535b6964` compare des noms de dossiers (préfixe « _ », numéro sur deux chiffres). À étudier.
- Correction (phase 2.9) : `0x535b6858` ne choisit rien, elle **met en forme** le nom à partir d'un
  numéro reçu en `r2` (voir ci-dessous).

## Phase 2.9 : choix du dossier d'une photo (statique, 2026-10-27)

Chaîne de création d'un fichier, toutes dans `DcfContentsCreateService.cpp` :

- `CreateContents` `0x535b3070` (et `CreateVirtualContents` `0x535b32d8`, 4e argument 1) appelle
  `SetFilePath` `0x535b2e8c(service, nommage, chemin, ...)` avec `chemin` = requête + `0xc`. Dans
  `chemin` : demi-mot `+4` = **numéro de dossier**, demi-mot `+6` = numéro de fichier. Certitude :
  forte (lecture du code).
- `SetFilePath` : si `chemin+4` vaut **0**, le numéro est choisi par `GetTargetDirectoryNumber`
  `0x535b21c8` (chaîne de log), le dossier est créé s'il diffère du dossier visé
  (`0x535b2ac4`), puis le numéro est écrit dans `chemin+4`. Si `chemin+4` **n'est pas 0**, il est
  pris tel quel : contrôle de plage (100 à 999), recherche dans la base des dossiers
  (`0x535b7480`) ; **s'il existe, rien n'est créé**, sinon il est créé avec le nom en cours.
- Base des dossiers : objet `X = [[service + 8] + 8]`. `X + 0x10` : table de 900 pointeurs
  (dossiers 100 à 999, index = numéro − 100). `X + 0x28` : index du **plus petit** dossier,
  `X + 0x2a` : index du **plus grand** (accesseurs `0x535b5bc4`, `0x535b5b98` ; « suivant » /
  « précédent » `0x535b5bd4` / `0x535b5c5c` bouclent de l'un à l'autre). `X + 0x4a` : numéro
  réservé par une demande de nouveau dossier.
- Dossier visé (`0x535b5ba8`) : le **plus grand** dossier existant, ou 0 si `X + 0x4a` l'a
  dépassé (on crée alors `max(plus grand, X + 0x4a) + 1`, `0x535b5ce0`). C'est la règle DCF
  habituelle : **il n'existe pas de variable « dossier en cours »** à réécrire.
- Le chemin vers un dossier existant est construit à partir de **son propre nom** dans la base
  (`0x535b756c` → `0x535b74c0`, nom par la méthode `+8` de l'entrée), qui charge aussi la liste de
  ses fichiers dans `[service + 0xc]`.
- Numéro de fichier (`0x535b1efc`) : si `chemin+6` vaut 0, compteur continu des réglages
  (`0x53584db8`) + 1, au moins le suivant libre du dossier (`0x535b7184`). Il continue donc la
  numérotation même dans un ancien dossier.
- `0x535b6858` : mise en forme du nom (3 chiffres + suffixe) ; `0x535b6678` nom fourni par la
  description, `0x535b66e0` forme date `NNN_MMDD`, `0x535b67dc` nom libre des réglages
  (`0x53585200`).
- Conséquence pour la brique 5 : pour revenir dans un ancien dossier, il suffit d'écrire son
  numéro dans `chemin+4` à l'entrée de `SetFilePath` quand il vaut 0. Octets identiques sur IIIx
  1.60 à cet endroit.

### Build de test T10-FILMPROBE6 (brique 5, écriture)

- Crochet à l'entrée de `SetFilePath` (`mov ip,sp` remplacé). Si `chemin+4` vaut 0 **et** qu'un
  mode U est rappelé (octet de mode `*(u8*)*(0x55063f30)` non nul), il écrit le **plus petit**
  dossier existant (`X + 0x28` + 100), seulement si son entrée de table n'est pas vide. Tous les
  registres sont conservés. Pas de compteur, horloge normale.
- Vérifié en émulateur (`tools/gr3x/film_probe_check.py`, 36 cas : modes 1 à 255, index 0 à 899 ;
  aucun effet si dossier déjà fourni, mode 0, pas de modèle, pointeur nul ou mal aligné, index
  hors plage, entrée vide) ; contre-épreuves (mauvais dossier attendu, mode 0) détectées. La
  fonction native elle-même n'est pas exécutée en émulateur.
- Attendu sur le boîtier : en P, Av, etc., les photos vont dans le dossier le plus élevé ; en U1,
  U2, U3, dans le plus ancien dossier, avec la numérotation continue.

### Résultats sur le boîtier (build T10-FILMPROBE6, 2026-10-27)

Dossiers au départ : `100RICOH`, `101RICOH`. Contenu à la fin (capture de l'utilisateur) :
`100RICOH` : `_R016838.DNG`, `_R016839.DNG`, `_R016840.DNG` + `.JPG`, `_R016841.JPG`,
`_R016842.JPG`, `R0016844.JPG` ; `101RICOH` : `R0016837.JPG` ; `102RICOH` (créé à 22:10) :
`R0016843.JPG`, `R0016845.JPG`. (`_R` : espace couleur Adobe RGB de la BOX de U1.)

- R1 (P) : 6837 dans `101`, le plus élevé. Conforme.
- R2 à R4 (U1 : RAW, RAW+JPEG, multi-exposition) : 6838 à 6842 dans `100`, le plus ancien,
  numérotation continue, DNG et JPEG ensemble. Conforme. R6 (U2, après extinction) : 6844 dans
  `100`. Conforme.
- **Brique 5, écriture : testée.** Imposer le numéro de dossier à l'entrée de `SetFilePath` fait
  enregistrer dans un ancien dossier existant, sans erreur, nom du dossier respecté.
- **Effet de bord** : R5 (retour en P après U1) a **créé `102RICOH`** au lieu d'écrire dans
  `101`. R6 (P après la photo U2) va dans `102` sans nouveau dossier. Pistes statiques : dans
  `GetTargetDirectoryNumber`, un nouveau dossier est pris si la demande `+0x116` est levée ou si
  le bit du dossier visé est mis dans la table de bits `[info + 0x248] + 0x10 + emplacement * 0x80`
  (`0x535853a4`) ; ces deux marques sont posées par `0x535a83a4` (« GetDcfInformationService »,
  appelée par `0x535a84f8`) selon les drapeaux de l'entrée du dossier visé (octet `+0xe`, bits 1
  et 2) et une analyse de ses fichiers (`0x535a81b8`). Cause exacte non établie.
- **Suppression** : en lecture, la suppression de 2 photos anciennes a laissé « Data being
  processed » affiché sans fin, alors que les photos ont bien été supprimées
  (`DcfContentsDeleteService`, `0x535b3810`, touche aussi `+0x116` / `+0x117`). Lien avec le
  crochet non établi.

### Effet de bord : d'où vient le nouveau dossier (statique, 2026-10-27)

- `GetTargetDirectoryNumber` (`0x535b21c8`), dossier visé = le plus grand. Pour un dossier au nom
  libre identique au nom en cours (`GetDirectoryType` `0x535b6a48` rend 1 ; 0 = dossier date du
  jour, 2 = autre), il prend un **nouveau dossier** (numéro + 1, `0x535b2148`) si : la description
  de nommage demande la forme date (octet `+0`), ou la demande `+0x116` est levée, ou (octet `+0x16`
  de la description) le bit du dossier est mis dans la table de bits `[info + 0x248] + 0x14 +
  emplacement * 0x80` (lecture `0x535853a4`, écriture `0x5358533c(info, emplacement, dossier, 0/1)`).
- `0x535a83a4` (préparation, appelée par `0x535a84f8`) lève `+0x116` pour le dossier visé si
  l'entrée a le drapeau `+0xe` bit 2, ou, au premier contrôle (bit 1 absent), si son bit est mis
  dans la table ou si l'analyse du **dernier fichier** du dossier (`0x535a81b8` : lecture de ses
  métadonnées, étiquettes `0x6b`, `0xc`, `0x86`, `0x55`) le demande.
- **Piste principale** : à la fermeture d'un fichier créé (`EventCloseCreateContents`,
  `0x535a6b28`), si l'octet `+0x21` de la requête est non nul, le firmware met le bit du **plus
  grand dossier** (`0x535b7424`) et non du dossier où le fichier a été écrit. Une photo écrite dans
  `100` avec ce drapeau marque donc `101`, et la photo suivante en P part dans un nouveau dossier.
  Qui pose `+0x21` (RAW ? multi-exposition ?) : non trouvé (la requête est remise à zéro en
  `0x5359c4e4`). Certitude : moyenne.
- La suppression (`DcfContentsDeleteService`, `0x535b3810`) écrit aussi dans cette table et dans
  `+0x116` / `+0x117`.

### Isolement du déclencheur (build T10-FILMPROBE6, 2026-10-27)

Tests D1 à D4 (plus grand dossier au départ : `102`). Résultat (capture de l'utilisateur) :

- D1 : P 6846 (supprimée ensuite en D4), U1 JPEG 6847 dans `100`, P 6848 dans `102`. Pas de
  nouveau dossier.
- D2 : U1 DNG 6849 dans `100`, P 6850 dans `102`. Pas de nouveau dossier.
- D3 : U1 multi-exposition, 6851 et 6852 dans `100`, puis P 6853 dans **`103RICOH`, nouveau**.
- D4 : suppression en P de 6846 (dossier `102`) sans blocage. D5 (suppression dans `100`) non
  fait.
- **Testé : la multi-exposition est le déclencheur**, en accord avec la piste statique (fin d'une
  multi-exposition : le bit du plus grand dossier est mis à la fermeture du fichier, drapeau
  `+0x21` de la requête). Le RAW et le JPEG seul ne déclenchent rien. R4 puis R5 (même suite) avaient
  créé `102`.
- Correction envisagée, un seul mot : en `0x535a6dac`, `mov r2,r7` (plus grand dossier) devient
  `ldrh r2,[r6,#0x10]` (dossier où le fichier a été écrit : chemin de la requête, `+0xc + 4`). En
  usage normal les deux sont égaux, donc rien ne change ; avec un dossier imposé, la marque va sur
  le bon dossier. `r6` est la requête dans toute la fonction ; octets identiques sur IIIx 1.60.

### Build de test T10-FILMPROBE7 (correction de la marque)

- T10-FILMPROBE6 + le mot `0x535a6dac` : `mov r2,r7` (`e1a02007`) devient `ldrh r2,[r6,#0x10]`
  (`e1d621b0`). Aucun code ajouté.
- Vérifié en émulateur : 48 cas (les 36 du crochet, plus 12 sur la marque : r2 = dossier de la
  requête quel que soit le plus grand, autres registres intacts) ; contre-épreuve sur le build
  sans correction détectée. 321 tests passent (5 échecs habituels, fichiers privés GR IV absents).
- Attendu sur le boîtier : une multi-exposition en U puis une photo en P ne crée plus de dossier.

### Résultats sur le boîtier (build T10-FILMPROBE7, 2026-10-27)

Plus grand dossier au départ : `103`. Contenu à la fin (capture de l'utilisateur) :

- E1 : P 6854 dans `103` ; U1 multi-exposition, 6855 et 6856 (`_R`, Adobe RGB) dans `100` ; P 6857
  dans **`104RICOH`, nouveau**. La correction de `0x535a6dac` **ne suffit pas**.
- E2 : P 6858 dans `104` ; U2 multi-exposition, un seul fichier 6859 dans `100` ; P 6860 dans `104`.
  Pas de nouveau dossier.
- E3 / E4 : suppressions dans `100` (6847, 6849) et `101` (6837, dossier `101` disparu, vide)
  sans blocage. Le blocage de la première fois ne se reproduit pas.
- Observation : la multi-exposition en U1 donne toujours **deux fichiers** (R4, D3, E1), en U2 un
  seul. Réglage de la BOX de U1 à identifier.
- Autres poseurs de marques trouvés : `0x535aa224` (dans `0x535a9e18`, dossier lu dans un chemin,
  `0x535b9788`), la suppression `0x535b3908` ; demande `+0x116` / `+0x117` posée par `0x535a5268`
  selon un type de paramètre (2 : `+0x116` seul ; 3 : les deux, si rien n'est en attente).

### Comportement natif de la multi-exposition avec vues intermédiaires (testé, 2026-10-27)

- La BOX de U1 est en multi-exposition « Blended » **avec sauvegarde des vues intermédiaires** :
  d'où deux fichiers par séquence de 2 vues (`_R016855` vue 1, `_R016856` superposition). U2 ne
  sauvegarde pas : un seul fichier.
- T1 (en P, crochet inactif) : séquence avec vues intermédiaires, 6861 et 6862 dans **`105RICOH`,
  nouveau**. T2 (photo simple en P) : 6863 dans **`106RICOH`, nouveau**.
- **Natif** : une séquence qui garde ses vues intermédiaires est isolée dans son propre dossier ;
  le boîtier demande un nouveau dossier avant son premier fichier, et ferme ce dossier après
  (marque à la fermeture, `0x535a6d60`). Le dossier imposé par le crochet laissait la première
  demande en attente : la photo suivante en P la consommait (`102`, `103`, `104`). La correction
  de la marque (T10-FILMPROBE7) traite le second point.

### Build de test T10-FILMPROBE8 (annulation de la demande)

- T10-FILMPROBE7 + : quand le crochet impose le dossier, il annule la demande de nouveau dossier
  en attente (`0x5358513c(0x53584c74(), 0)`, `+0x116` et `+0x117` à 0).
- Vérifié en émulateur (appel fait une fois à chaque dossier imposé, jamais sinon, registres
  intacts) ; contre-épreuve sur le build sans annulation détectée. 322 tests passent (5 échecs
  habituels).
- Effet assumé pour le test : en mode U, « Create New Folder » est annulé par la photo suivante.

### Résultats sur le boîtier (build T10-FILMPROBE8, 2026-10-27)

Plus grand dossier au départ : `106`.

- F1 : P 6864 dans `106` ; U1 (vues intermédiaires) 6865 `.JPG` (vue 1) et 6866 `.DNG`
  (superposition, qualité de la BOX) dans `100` ; P 6867 dans **`107RICOH`, nouveau**. L'annulation
  dans le crochet **ne suffit pas**.
- F2 : U2 6868 dans `100` ; P 6869 dans `107`. Pas de nouveau dossier. Conforme.
- F3 (P, natif) : séquence 6870 à 6872 dans **`108`, nouveau** ; photo simple 6873 dans **`109`,
  nouveau**. Conforme au comportement d'origine : rien de cassé hors des modes U.
- Lecture : la demande qui crée le dossier après la séquence est posée **après** le dernier
  fichier de la séquence (le crochet ne repasse pas ensuite), ou par un autre mécanisme que la
  marque de `0x535a6dac`. Candidat principal : `0x535a5268` (type 2 : `0x5358513c(info, 1)` puis
  `0x5358515c(info, 0)` ; type 3 : les deux à 1), encore en mode U à la fin de la séquence.

### Décision (2026-10-27)

- Seuls U1, U2, U3 portent un rouleau ; P, Av, Tv, M restent libres (cahier des charges mis à jour).
- Voie A : au chargement, le mod force **Save Interim Images à Off** et le verrouille pendant le
  rouleau. Le dossier en trop après une séquence n'apparaît qu'avec ce réglage à On (R4, D3, E1,
  F1 contre R6, E2, F2) : il disparaît à la source. Pas de build T10-FILMPROBE9 (blocage des
  demandes de nouveau dossier abandonné). La correction de la marque (`0x535a6dac`) est gardée.
- Prochaine étape : trouver le champ Save Interim Images dans l'enregistrement des réglages.

### Champ Save Interim Images (statique, 2026-10-27)

- Nom interne (table des propriétés, commande de débogage) : `StillMultiExposureSaveProcess`,
  voisin de `StillMultiExposureCompositeType`. Analyseurs `0x53306c78` (texte vers valeur) et
  `0x533668a0` (valeur vers texte).
- **Octet `+0x482` de l'enregistrement des réglages** ; getter `0x532451d0(UserDataModel)`,
  setter `0x53262990(UserDataModel, valeur)` (écrit l'octet puis prévient la prise de vue,
  `0x5354c744`). La carte des champs le classe comme champ de BOX (drapeau `+0x483`) : chaque
  mode U a le sien.
- Valeurs : **0 `Off`**, 1 `Original`, 2 `Composite`, 3 `OriginalComposite`. Libellés du menu
  (relevés sur le boîtier) : 1 **Unblended** (chaque vue seule), 2 **Blended** (superpositions
  intermédiaires), 3 **Unblended + Blended**, 0 **Off**. U1 est en Blended (2) : après la vue 1, la
  superposition intermédiaire est la vue 1 seule (`_R016855`, « photo normale »), puis la
  superposition finale (`_R016856`). Certitude : forte.
- Pour le chargement : `0x53262990(0x5320b31c(0x5320ad88()), 0)`.

### Décision : une BOX = un rouleau (2026-10-27)

- Ligne de menu « Mode pellicule : On / Off » enregistrée dans la BOX (octet libre de
  l'enregistrement). Démarrage du rouleau à la première vue dans un mode U dont la BOX est sur On ;
  fin de rouleau : nouveau rouleau automatique (nouveau dossier, vue 1) ; Off ou Save Settings sur
  une BOX entamée = rembobiner. Plus de ligne « Charger » ni de chargement provisoire.

## Phase 3.1 : état du rouleau et compteur de vues (2026-10-27)

### Sauvegarde immédiate (statique)

- `0x5323f274` (sauvegarde à l'extinction) écrit chaque copie des réglages dans un **fichier** de la
  mémoire interne : `0x53826c54(stockage, index, taille, données)`, stockage =
  `[0x53828014() + 8]`, nom `APData%02d` (`0x53826bdc`, « src/AppData.cpp »), lecteur interne
  `H:\DOMDTBK`. Index : 0 l'octet de mode (1 octet), **1 l'enregistrement en cours**, **2 + k la
  copie k** (table `0x53b59200` : 2..8), 9 et 10 les propriétés communes. On peut donc écrire un
  seul enregistrement. Certitude : forte (lecture du code), non testé sur le boîtier.
- Save Settings dans la BOX n : `0x5324b760(objet, n)` (memcpy de l'enregistrement en cours vers la
  copie n, puis fusion `0x53246df8`), appelé par `UserModeBoxSelectController`.
- Rappel d'un mode : dans `0x53279fa8`, `r6` garde le mode rappelé de `0x53279fb8` à `0x5327a00c` ;
  l'enregistrement va aux valeurs actives en `0x5327a018`, après la copie (crochet du garde-fou).

### Build de test T11-ROLL1 (`core/src/fw/gr3x/film-roll.ts`)

- Mode pellicule forcé dans U1 à U3 (octet de mode 1 à 6), en attendant la ligne de menu.
- État : `0x9b1` bit 1 rouleau entamé, `0x9b2` vue à prendre ; écrit dans l'enregistrement en cours
  et dans la copie de la BOX active.
- Première exposition (préfixe du crochet d'exposition) : démarre le rouleau, vue 1.
- Fin du modèle `0x5323a080` (état de multi-exposition 2) : vue + 1 ; au-delà de la longueur (ratio
  `+0x4c2` : 3:2 36, 1:1 12, XPan 21, sinon 36) le rouleau se termine ; puis écriture immédiate des
  fichiers 1 et mode + 2.
- Compteur à l'écran : vue à prendre en U (1 avant le démarrage), compte normal ailleurs.
- Save Settings dans la BOX n : rouleau de la BOX n terminé (et celui en cours si n est le mode actif).
- Rappel de U1 à U3 : Save Interim Images (`+0x482`) à Off dans l'enregistrement en cours, par le
  crochet de rappel du garde-fou (option `recallAfter`).
- Vérifié en émulateur (`tools/gr3x/film_roll_check.py`) : 1372 cas (exposition 48, fin 960 dont
  108 avances et 72 fins de rouleau, compteur 192, Save Settings 72, rappel natif 28) ; trois
  contre-épreuves détectées ; sonde du garde-fou adaptée et repassée. 324 tests passent.
- Limites : seules les séquences de multi-exposition font avancer le film (la BOX doit être en
  multi-exposition) ; pas encore de dossier de rouleau, ni de numéro de vue incrusté.

### Résultats sur le boîtier (build T11-ROLL1, 2026-10-28)

- G2 : U1, 2 vues + Complete : **un seul fichier** (6877), compteur 2. Save Interim Images forcé à
  Off au rappel : **testé**.
- G3 : une vue + Complete : 3 (6878) ; MENU sans vue : reste à 3. G4 : P montre le compteur normal,
  retour sur U1 : 3.
- G5 : **retrait de la batterie sans éteindre : 3 retrouvé** ; extinction normale : 3. L'écriture
  immédiate des fichiers `APData` (index 1 et mode + 2) marche : **testée**.
- G6 : U2 a son propre rouleau (1, puis 2), U1 garde 3. G7 : Save Settings dans BOX2 depuis U2 :
  U2 revient à 1 (rembobinage : **testé**).
- G7 suite : Save Settings dans BOX2 **depuis U1** a recopié les réglages en cours (ceux de la BOX3
  rappelée par U1) dans la BOX2 : comportement natif (`0x5324b760` copie l'enregistrement en cours),
  pas un effet du mod. La consigne de test était ambiguë ; l'utilisateur a perdu le monochrome de
  la BOX2.
- G8 : aucun message inhabituel ; les autres BOX intactes.

## Phase 3.2.1 : dossier du rouleau (2026-10-28)

### Conception

- Numéro du dossier du rouleau : `0x9b3` (bits bas) + bits 2 et 3 de `0x9b1` (bits hauts), 10 bits.
  Effacé au démarrage d'un rouleau, à sa fin et au rembobinage.
- Crochet à l'entrée de `SetFilePath` (`0x535b2e8c`), quand le chemin n'a pas déjà un numéro :
  - mode U avec rouleau entamé : le dossier du rouleau s'il existe dans la base des dossiers ; sinon
    le numéro du prochain nouveau dossier donné par le boîtier (`0x535b742c` →
    `max(plus grand, réservé) + 1`, 100 au minimum, 0 au-delà de 999), aussitôt mémorisé comme
    dossier du rouleau (enregistrement en cours et BOX). `SetFilePath` crée un dossier imposé
    absent par le même appel que pour un nouveau dossier natif (`0x535b2ac4(service, numéro,
    nommage, 0)`, en `0x535b3060` au lieu de `0x535b2f2c`) : aucune demande de nouveau dossier
    (`+0x116` / `+0x117`) n'est utilisée. Certitude : forte pour le chemin (lecture du code), non
    testé sur le boîtier ;
  - modes libres (et tout autre cas) : si le plus grand dossier (celui que le boîtier viserait) est
    le dossier d'un rouleau entamé d'une BOX 1 à 6, le prochain nouveau dossier est imposé : les
    photos libres ne vont jamais dans le dossier d'un rouleau (elles ouvrent leur propre dossier,
    qui redevient le plus grand). Sinon rien ne change.
- La marque de dossier de la multi-exposition va sur le dossier écrit (`0x535a6dac`, comme
  T10-FILMPROBE7).
- Le dossier est mémorisé en RAM tout de suite et écrit dans les fichiers à la fin de séquence
  suivante ; un retrait de batterie avant la première fin de séquence d'un rouleau en perd le
  dossier : la photo suivante en ouvre un autre.

### Build de test T11-ROLL2

- T11-ROLL1 + le dossier du rouleau. Vérifié en émulateur (`tools/gr3x/film_roll_check.py`) : 2028
  cas, dont 584 sur `SetFilePath` (modes 0 à 7, rouleau entamé ou non, dossier mémorisé absent,
  hors plage ou existant, prochain numéro 0 ou non, numéro déjà fourni) et 72 sur les modes libres
  face au dossier d'un rouleau ; quatre contre-épreuves détectées ; sonde du garde-fou repassée.

### Résultats sur le boîtier (build T11-ROLL2, 2026-10-28)

Plus grand dossier au départ : `109RICOH`. Toutes les photos de H1 à H9 (6884 à 6893 : P en JPEG
`R00`, U1 en DNG `_R`, U2 en JPEG) sont dans **`109RICOH`** : **aucun dossier créé**, ni pour les
rouleaux (H2, H6, H9) ni pour P (H4). Compteur conforme (H9 : rembobinage puis 2).

- Le code présent dans le build est conforme (désassemblé). Le crochet de `SetFilePath` n'a donc pas
  pris le chemin prévu, ou `SetFilePath` n'a pas utilisé le numéro imposé. Hypothèses : numéro déjà
  fourni à l'entrée pour ces photos, prochain numéro (`0x535b742c`) à 0, ou création refusée puis
  repli. Non tranché statiquement : build de diagnostic proposé (T11-ROLL2D).
- Remarque : les rouleaux de U1 et U2 démarrés sous T11-ROLL1 gardaient dans `0x9b3` et `0x9b1`
  des restes des builds de sonde (compteurs) : leur « dossier » pouvait valoir n'importe quoi. Le
  rouleau de U2 redémarré en H9 avait, lui, un dossier effacé.

### Build de diagnostic T11-ROLL2D

- T11-ROLL2 + enregistrement de ce que voit le crochet de `SetFilePath`, dans des mots libres
  (zone `sbrk` remise à zéro du round 10) : `0x55804390` demi-mot numéro reçu, `+2` chemin
  (1 mode libre inchangé, 2 dossier du rouleau, 3 nouveau dossier imposé, 4 pas de prochain numéro,
  5 numéro déjà fourni, 6 mode libre déplacé hors d'un dossier de rouleau), `+3` résultat de
  `SetFilePath` (la fonction est appelée, adresse de retour gardée en `0x5580438c`), `+4` nombre
  d'appels, `+6` demi-mot prochain numéro demandé.
- Date incrustée : `20YY.MM.DD HH:mm` = YY numéro reçu % 100, MM chemin (+ 6 si réussite),
  DD 1 + appels % 28, HH dossier du rouleau en cours % 24, mm prochain numéro % 60.
- Vérifié en émulateur : 2620 cas (dont 512 de diagnostic et 864 de l'horloge), deux
  contre-épreuves détectées, sonde du garde-fou repassée.

### Résultats sur le boîtier (build T11-ROLL2D, 2026-10-28)

Plus grand dossier au départ : `109`.

| Test | Fichier | Dossier | Date incrustée |
|---|---|---|---|
| I1 P | 6894 | 109 | 2000.01.01 21:00 |
| I2 U1 | 6895 | **110, nouveau** | 2000.11.03 00:00 |
| I3 U1 | 6896 | 110 | 2010.01.05 14:00 |
| I4 P | 6897 | **111, nouveau** | 2010.11.07 21:00 |
| I5 U2 | 6898 | **112, nouveau** | 2011.11.09 20:00 |

- **Les dossiers marchent comme prévu** : nouveau dossier au premier fichier d'un rouleau (U1 110,
  U2 112), retour dans le dossier du rouleau (I3), P déplacé hors du dossier d'un rouleau (I4 : 111).
- Lecture du diagnostic : DD = 1, 3, 5, 7, 9 : **deux appels de `SetFilePath` par photo**, et la date
  est lue **avant** les appels de la photo (I1 : aucun appel encore) ; chaque photo montre donc le
  dernier appel de la photo précédente. Ce dernier appel reçoit un numéro déjà fourni et réussit
  (MM 11 = chemin 5 + 6) ; I3 (MM 01 avec un numéro reçu de 110) reste inexpliqué. HH 14 en I3 = 110
  mémorisé par le rouleau de U1 (110 % 24).
- Pourquoi T11-ROLL2 n'a rien créé : non établi. Le code du dossier est identique dans les deux
  builds (le diagnostic ajoute l'enregistrement et l'appel de la fonction) ; à vérifier que la mise
  à jour T11-ROLL2 a bien été appliquée.

## Phase 3.2.2 : compteur « vue/total » et multi-exposition imposée (2026-10-28)

### Décisions

- Rien n'est incrusté sur la photo. À l'écran, à la place du compteur de vues restantes (en haut à
  droite) : `12/36`, le total selon le format.
- Au rappel d'un mode U, le mode d'entraînement est mis en multi-exposition (comme Save Interim
  Images à Off) : chaque vue passe par une fin de séquence, la prise de vue simple n'a pas à être
  comptée à part.

### Briques (statique)

- Texte du compteur : `0x532aa140(objet, tampon, valeur)` = `snprintf(tampon, 6, "%d", min(valeur,
  99999))` (`0x53141100`, format `0x53d52d54`), ou `-----` dans certains états. « 72/72 » tient en
  5 caractères. Le firmware contient `"%d/%d"` (fin de `"%f, %d/%d"`, `0x53c0ca59`).
- Mode d'entraînement : octet **`+0x472`** (`StillDriveMode`, getter `0x53245190`) : 0 Single,
  1 Continuous, 2 Bracket, **3 MultiExposure**, 4 Interval, 5 IntervalMultiExposure. Setter
  `0x5327b744(UserDataModel, mode)` : écrit l'octet puis applique l'enregistrement
  (`0x532750f8`, comme le rappel) et publie l'événement `0x17b`.

### Build de test T11-ROLL3

- T11-ROLL2 + compteur `vue/total` (le crochet écrit le texte par `snprintf` puis rend la main à
  l'appelant de `0x532aa1d4` ; hors mode U, compte normal) + multi-exposition au rappel ; le
  crochet de `SetFilePath` appelle la fonction comme dans le diagnostic qui a marché (adresse de
  retour en `0x5580438c`).
- Limite : en mode U, le compteur ne montre plus `-----` (carte absente ou pleine).
- Vérifié en émulateur : 2700 cas (dont 768 du compteur), quatre contre-épreuves détectées ;
  sonde du garde-fou adaptée (multi-exposition au rappel) et repassée.

### Résultats sur le boîtier (build T11-ROLL3, 2026-10-28)

- J1 : U1 affiche `3/36`, mode d'entraînement en multi-exposition au rappel : **testé**.
- J2 : 1 vue + Complete : compteur + 1, photo dans `110` (dossier du rouleau de U1).
- J3 : P : compteur normal ; photo dans un nouveau dossier `113` (le plus grand, `112`, est celui
  du rouleau de U2).
- J4 : format 1:1 en U2 : `vue/12`, retour au format d'origine : `vue/36`.
- J5 : mode d'entraînement mis en vue par vue en U1, passage en P puis retour : multi-exposition.
- J6 : le texte `vue/total` tient à l'écran, « calé entre RAW et SD ».
- **Phase 3 (cœur du rouleau sans menu) : testée sur le boîtier.** Demande de l'utilisateur pour la
  suite : l'option « mode pellicule » par BOX (phase 4).

## Phase 4 : ligne de menu « Film Roll Mode » (2026-10-28)

### Emplacement (statique)

- Le constructeur du menu (`0x5319a778`) recopie chaque onglet dans un emplacement fixe de l'objet
  du menu (`0x384` octets, 38 lignes au plus par onglet). L'onglet Still Image Settings
  (`0x53b36dec`) a 38 lignes ; seules ND (13) et HDF (25) dépendent du modèle, et GR Mod a déjà pris
  la place de celle qui manque pour Date Imprint : **plus aucune place**. Onglets : vidéo 18 lignes,
  lecture 16, **Customize Settings (C) 22** (`0x53b3649c`, Save Settings `0x020000e1` en premier,
  pages `[0, 4, 13]`), Setup 30.
- Décision de l'utilisateur : **sous Save Settings, dans Customize Settings**.
- Le contrôleur du menu est construit à chaque ouverture (la fabrique `0x5316f3bc` appelle son
  constructeur `0x5319aa68`) : la fonction de visibilité d'une ligne (comme ND / HDF, appelée par
  `0x5319a720`) est réévaluée à chaque ouverture.
- Griser une ligne : mécanisme non trouvé (les identifiants servent d'index dans des tables). La
  ligne est **masquée** en P, Av, Tv, M par sa fonction de visibilité ; griser reste à étudier.

### Mise en œuvre (`film-roll.ts`, forme 'menu' ; `datestamp.ts`)

- Bit 0 de `0x9b1` = Film Roll Mode de la BOX. Tout le mode pellicule (démarrage, avance, compteur
  `vue/total`, dossier, multi-exposition et Save Interim Images au rappel) ne s'applique qu'aux
  modes U dont l'enregistrement en cours a ce bit.
- Menu C recopié avec la ligne en position 1 (23 lignes, pages `[0, 5, 14]`) ; l'entrée du menu C
  dans la table des onglets (`0x55001ec4`, initialisée depuis `0x5407d404`) pointe la copie.
  Identifiant `0x020001b0` (contrôleur de liste de Horizon Correction, comme les listes de GR Mod).
- Liste Off / On (textes et icônes encadrées du boîtier). Choisir On (en mode U) : bit 0 dans
  l'enregistrement en cours, puis Save Interim Images à Off et multi-exposition par les setters du
  boîtier (`0x53262990`, `0x5327b744`). Choisir Off : bit 0 effacé et rembobinage (rouleau terminé
  dans l'enregistrement en cours et dans la BOX active). La BOX garde sa propre valeur jusqu'à Save
  Settings (qui rembobine aussi).
- Nom en 21 langues ; chaque caractère existe dans les textes du boîtier pour la langue, sauf le
  chinois simplifié : 胶卷 n'existe dans aucun texte, remplacé par 底片模式 (底 et 片 existent dans
  les textes en chinois traditionnel) ; à vérifier à l'écran.

### Build de test T12-MENU1

- Vérifié en émulateur (`tools/gr3x/film_roll_check.py`) : 2900 cas, dont 12 avec Film Roll Mode
  à Off, 16 de visibilité, 32 de valeur courante, 96 de choix de valeur, la ligne et la liste ;
  quatre contre-épreuves détectées ; sonde du garde-fou adaptée et repassée ; menu C recopié vérifié
  (21 lignes officielles dans l'ordre, en-tête inchangé) ; T11-ROLL3 reconstruit identique.

### Résultats sur le boîtier (build T12-MENU1, 2026-10-28)

- K1 : en P, la ligne n'apparaît pas dans Customize Settings. K2 : en U1, la ligne est sous Save
  Settings (U1 Off, U2 On au départ : restes des builds de sonde).
- K3 : Off donne le compteur normal ; On donne `1/36`, multi-exposition et Save Interim Images Off.
- K4, K5 : Save Settings dans la BOX3 puis 1 vue + Complete : nouveau dossier, `2/36`.
- K6 : U3 sur Off : compteur normal, pas de rouleau (la BOX5 est elle-même en multi-exposition).
- K7 : U1, P, U1 : `2/36`. K8 : Off sans Save Settings, puis P et retour : `1/36` (BOX sur On,
  rouleau rembobiné).
- K9 : nom affiché correctement en français, en chinois simplifié (底片模式) et en allemand.
- **Phase 4 : testée sur le boîtier.** Reste : griser la ligne au lieu de la masquer (mécanisme à
  trouver).

### Décision : Off suspend, il ne rembobine plus (2026-10-28)

- Off sans Save Settings ne fait qu'effacer le bit 0 de l'enregistrement en cours : le mode
  pellicule est suspendu dans ce mode U, le rouleau est gardé ; au retour sur la BOX (toujours sur
  On), le même rouleau reprend. Save Settings rembobine toujours. Il faut un moyen de rembobiner à
  la main (proposition à faire). Build `T12-MENU2` (forme 'menu').

## Phase 6 : avance du film par le levier ADJ (statique, 2026-10-28)

- Avancer = l'émetteur 1 (`0x531a4d80`) : si l'état de multi-exposition est 2 (une vue prise), il
  publie l'événement 0xb8 (fin de séquence, comme Complete) ; sinon rien. Pas d'avance sans vue.
- Menu ADJ : `AdjModeController` (table de méthodes `0x53b394e0`, `OnEvent` `0x531a4db8`) ; les
  événements 0x35, 0x89, 0xaa (déclencheur, etc.) y terminent la séquence par l'émetteur 1 ;
  0xce à 0xd8 y font la sélection (`0x531a2a14(this, 0/1)`, `0x531a3bcc(this, 0/1)`, ...).
- `LiveViewController` : table de méthodes `0x53b2f9e8`, `OnEvent` `0x531771c0` (traite quelques
  événements puis transmet aux modèles `0x5320b61c` et `0x5320b25c`, méthode `+8`).
- Touches : `ActionModel::OnEvent` (`0x53221a1c`) reçoit un code de touche (1 à 0x40) et le
  traduit selon l'identifiant du contrôleur courant (`0x53228c4c`) : branchement sur 67
  identifiants vers une fonction de traduction par contrôleur (exemple : `0x53212c38`, touche 4 vers
  l'événement 0xaa, 0x40 vers 0x8f ; table de 64 touches de `0x53212c9c` : 1 à 3 vers 0x35, 4 vers
  0xaa, 5, 7, 0x13 vers 0x86, 0xe, 0x32, 0x39 vers 0xa2, 0x3e vers 0x34, 0x40 vers 0x8f).
  Publier un événement : `0x532288b0(modèle, événement, 0, 0)`.
- Code de la touche du levier ADJ et événement produit en visée : non trouvés statiquement. Build de
  sonde `T12-KEYS` : touche (hors 1 à 4) et événement suivant, affichés par la date incrustée
  (YY touche % 100, MM 1 + touches comptées % 12, HH:mm événement en minutes).
- Émulation : `rear_dial_probe.py` remplace `0x532288b0` par un bouchon ; la sonde du rouleau le
  laisse passer pour vérifier le crochet. 3047 cas, deux contre-épreuves détectées.

### Résultats sur le boîtier (build T12-KEYS, 2026-10-28)

- L1 à L5 (ADJ droite, gauche, enfoncé ; pavé droite ; OK) : année **06** partout, minutes 49 (heure
  cachée par l'écran du dialogue) : la dernière touche notée avant chaque photo est toujours la
  touche 6, quel que soit le geste. Mois : 11, 10, 4, 0, 2 touches notées entre deux lectures (0 pour
  une photo refaite sans toucher à rien : cohérent).
- Lecture : soit une touche 6 arrive juste avant chaque prise de vue, soit les gestes ont des codes
  1 à 4, que la sonde excluait (supposés être le déclencheur). Sonde mal conçue pour isoler un geste.
- Observé : en visée, le levier ADJ à droite / à gauche règle directement la correction
  d'exposition (+0.3 / -0.3) ; enfoncé, il ouvre le menu ADJ ; OK déplace le point de mise au
  point.
- M : Off puis P puis retour sur U1 : `8/36` retrouvé. **Suspension par Off : testée.**

### Build de sonde T12-KEYS2

- Table de quatre touches { code, nombre, premier événement après elle } à `0x55804390`, aucune
  touche exclue, remise à zéro à la fin de séquence ; la date montre la touche la plus pressée. Le
  geste testé est répété 5 fois. Vérifié en émulateur ; deux contre-épreuves détectées.

### Résultats sur le boîtier (build T12-KEYS2, 2026-10-28)

| Geste | Touche | Pressions | Événement |
|---|---|---|---|
| ADJ droite | 10 | 11 ou plus | 229 (0xe5, traité par la visée) |
| ADJ gauche | 11 | 5 | 360 à 419 |
| ADJ enfoncé | 14 | 5 | 360 à 419 |
| pavé droite | 35 | 5 | 360 à 419 |
| OK | 50 | 8 | 360 à 419 |
| aucun (référence) | 57 | 1 | 120 à 179 (0xa2 attendu) |

- La touche 57 arrive à chaque prise de vue (parasite). Visée : contrôleur `LiveViewController`,
  identifiants 0x08000000 à 0x08000002 (fabrique `0x5316f3bc`, constructeur `0x53173204`).
- Décision : la touche droite (Drive) avance le film ; puis demande de l'utilisateur : en faire une
  fonction choisissable dans Fn Button Settings. Version « touche en dur » (T13-ADV1, non vérifiée)
  mise de côté (stash).

### Fn Button Settings (statique, 2026-10-28)

- Champs de la BOX (un octet tous les deux) : `0x922` Fn Button, `0x924` ISO Button, **`0x926` Drive
  Button (touche droite)**, `0x928` Movie/Wireless Button, `0x92a` Hold Movie/Wireless Btn., `0x92c`
  Focus Settings. Getters `0x53246378` + 0xc × n, setters `0x532435f8` + 0x10 × n.
- Listes : enregistrements 70 à 75 de la table des listes (`0x53b3c6c0`) ; 70 à 74 partagent le
  vecteur de fonctions du contrôleur (`+0x1a4` début, `+0x1a8` fin), rempli à la construction
  (`0x531be67c`) depuis la table de **36 numéros de fonction** `0x53b4eb7c` (boucle `add r6,r4,#0x24`),
  filtrée par `0x531b9410` (seules ND 0x16 et 0x28 dépendent du modèle). Dessin d'une ligne :
  icône `0x53293e6c(modèle, f)`, texte `0x53292ed0(modèle, f)` (chaînes de comparaisons qui
  commencent par `cmp r1,#0`). Choix : setter du champ avec `[contrôleur + 0x1a4][ligne]`.
- Fonctions 0 à 41 ; **0 = Off** ; 42 libre. Noms : 1 Focus, 2 Set MF, 3 Set Snap, ... 23 Drive Mode,
  24 Drive, 27 Image Control, 30 4-way Controller Action, 31 Outdoor View Setting.
- Exécution : `CaptureReadySwitchFunctionModel` ; Fn, ISO et Drive passent par
  `GetEventCustomize` (`0x5329bcc8(this, out, f, ...)`, table de sauts de 42, assertion sinon) ;
  Movie/Wireless et Hold passent par `GetEventSwitchWlan` (`0x53299f08`, `cmp r6,#0x29` en
  `0x5329a0a0`, assertion sinon). Autres lecteurs des champs : texte d'aide (`0x53172280`, par la
  fonction de texte), tests des fonctions 5 et 6 (AF) : sans risque pour 42.

### Build de test T13-FN1 : Film Advance dans Fn Button Settings

- Fonction 42 « Film Advance » : table des fonctions recopiée avec 37 entrées (42 à la fin), boucle
  du constructeur des listes adaptée ; texte (21 langues ; japonais フィルム送り, 巻 et げ absents du
  firmware) et icône (celle de Drive Mode, 0x121) par les fonctions de texte et d'icône ; à
  l'exécution (`GetEventCustomize` pour Fn, ISO, Drive ; `GetEventSwitchWlan` pour Movie/Wireless et
  Hold), 42 fait avancer le film (émetteur `0x531a4d80`, seulement en mode U avec Film Roll Mode et
  une vue prise), puis le boîtier continue comme pour Off.
- Vérifié en émulateur : la boucle native du constructeur remplit la liste avec 42 à la fin pour
  les trois modèles (ND, HDF, autre) ; texte, icône, exécution sur les deux chemins ; trois
  contre-épreuves détectées ; sonde du garde-fou repassée.

### Résultats sur le boîtier (build T13-FN1, 2026-10-30)

- B3 : Film Advance en dernière ligne de la liste de Drive Button. B5 : ouvrir le menu sans vue ne
  fait pas avancer (1 reste 1).
- C4 : vue, Next shot, touche droite : séquence terminée, compteur 1 → 2, pas de mode snap.
- D2 : touche droite sans vue : rien (2 reste 2). E4 : deux vues superposées puis touche droite :
  un seul fichier, compteur 3.
- F1 : « Avance du film » en français. G1 : en P, la touche droite garde son action.
- H2, H3 : Save Settings dans la BOX3 (rembobinage, 1/36), réglage gardé après P et retour, avance
  confirmée.
- **Phase 6 (avance du film par une touche réglable) : testée sur le boîtier.**
- Demande suivante : éviter l'écran Next / Retake / Complete après chaque vue (revenir directement
  en visée) ; Complete = la touche Film Advance ; Retake = appui long sur cette touche.

### Écran Next / Retake / Complete (analyse statique, 2026-10-30)

- Ouverture : événement d'interface 0x90 publié par `CaptureReadyModel` (`0x532a85dc`) quand le test
  `0x532a848c` répond oui ; l'action `0x53226738` demande le passage au contrôleur
  `QuickViewController` (identifiant 0x0800000c) par `0x5316c9d8(this, id, id courant)`, qui ne fait
  que publier l'événement 0x193 avec la demande (certitude : lue dans le code).
- Next shot (`0x531ca804`) : lève l'octet +0x180 de l'écran puis demande le retour à la visée
  (0x08000000), et renvoie 1. Retake (`0x531ca7d8`) publie 0xb7. Complete passe par l'émetteur
  `0x531a4d80` (événement 0xb8), déjà utilisé par Film Advance.
- Hypothèse (à vérifier sur le boîtier) : si l'écran ne s'ouvre pas, la visée reste avec l'état
  de multi-exposition 2 et le cliché transparent, comme après Next shot. Inconnue : le rôle de
  l'octet +0x180, qui n'est pas levé quand l'écran est sauté.

### Build de test T13-FN2 : pas d'écran après chaque vue, sonde de l'appui long

- À l'entrée de `0x53226738` : en mode U, avec Film Roll Mode et l'état de multi-exposition 2,
  l'action renvoie 1 sans ouvrir l'écran ; sinon l'écran s'ouvre comme avant (P, Av, Tv, M, Film
  Roll Mode Off, autres cas).
- Sonde des touches (même table qu'en T12-KEYS2, à `0x55804390`) gardée jusqu'à l'extinction : elle
  n'est plus remise à zéro en fin de séquence. Date des photos : 20YY = touche la plus pressée,
  MM = 1 + son nombre de pressions (12 au plus), DD = 1 + nombre de pressions de la deuxième,
  HH:mm = code de la deuxième touche en minutes (HH × 60 + mm). But : voir quel code donne un appui
  long sur la touche droite (le code 35 est l'appui court).
- Vérifié en émulateur : écran sauté seulement dans le bon cas (120 combinaisons de mode, Film Roll
  Mode, état et pointeurs), registres et pile rendus ; table gardée en fin de séquence ; horloge des
  deux touches (égalités, plafonds) ; tout le reste de T13-FN1 et la sonde du garde-fou repassés.

### Résultats sur le boîtier (build T13-FN2, 2026-10-30)

- C2, D2 : l'écran Next / Retake / Complete n'apparaît plus en mode pellicule. G : avec Film Roll
  Mode Off, il apparaît comme avant.
- C3 : après la vue, le boîtier reste sur l'aperçu de la photo (affichage qui précède l'écran),
  pas en visée : sauter l'action d'ouverture ne ramène pas en visée. F1 : deux vues prises à la
  suite sont bien superposées (la séquence continue).
- E2 : depuis la visée (retour par le déclencheur), la touche Film Advance ne fait rien ; depuis
  l'aperçu, elle fait avancer le film. Hypothèse : sans passage par un contrôleur, la visée
  retrouvée n'est pas celle de `CaptureReadyModel` qui exécute les fonctions des touches.
- F2 : 2005.12.19 00:06, soit touche 5 (12 pressions ou plus) puis touche 6 (18 pressions). Le
  code 35 n'est pas dans la table : remise à zéro seulement à l'allumage, la table de 4 entrées se
  remplit de codes émis sans geste (5, 6, puis d'autres). Sonde non concluante pour l'appui long.
- Conclusion : il ne faut pas sauter l'ouverture mais la rediriger vers la visée (0x08000000),
  comme le fait Next shot ; et la sonde doit ignorer les codes parasites et repartir de zéro à
  chaque vue.

### Build de test T13-FN3 : la visée au lieu de l'écran, sonde corrigée

- Dans l'action d'ouverture, en `0x53226760` (`mov r1,#0xc`, suivi de `movt r1,#0x800`) : en mode U,
  avec Film Roll Mode et l'état de multi-exposition 2, r1 reçoit 0 au lieu de 0xc, donc la demande
  vise le contrôleur de la visée (0x08000000) comme Next shot ; ailleurs, l'écran comme avant. Le
  saut de T13-FN2 (`0x53226738`) n'est pas dans ce build.
- Sonde des touches : table vidée au début de chaque vue (crochet d'exposition), codes 6 et 57
  ignorés ; date = les deux touches les plus pressées depuis la dernière vue (même codage que
  T13-FN2). Test prévu avec Film Advance sur Fn et la touche Drive sur Off, pour observer l'appui
  long de la touche droite sans faire avancer le film.
- Vérifié en émulateur : redirection seulement dans le bon cas (120 combinaisons), registres et pile
  rendus ; table vidée par l'exposition, codes 6 et 57 ignorés, horloge ; T13-FN1 et T13-FN2
  reconstruits identiques octet pour octet ; sonde du garde-fou repassée.

### Résultats sur le boîtier (build T13-FN3, 2026-10-30)

- B2 : l'écran Next / Retake / Complete n'apparaît pas ; B3, B4 : on reste sur l'aperçu, sans
  retour en visée ni transparence. Demander la visée ne change rien.
- Observation de l'utilisateur : pendant l'aperçu, toucher l'écran déplace le collimateur (fonction
  de la visée). Conclusion (forte) : l'aperçu est un état du contrôleur de la visée ; la demande de
  passer à 0x08000000 vise le contrôleur courant et reste sans effet. Seul le passage par
  QuickViewController puis Next shot relance la visée avec la transparence.
- D2 : Film Advance (sur Fn) fonctionne depuis l'aperçu (compteur 1 → 2).
- E2 : 2008.02.01 00:00 : depuis la vue, une seule touche vue, code 8 (Fn), une fois. Les 5 appuis
  longs sur la touche droite réglée sur Off n'ont donné aucun code : une touche sur Off n'arrive
  pas au gestionnaire `0x53221a1c`. Appui long non mesuré.
- Décisions : Retake par une seconde fonction « Film Retake » de Fn Button Settings (l'utilisateur
  la mettra sur la touche gauche) ; pour l'écran, l'ouvrir puis déclencher Next shot
  automatiquement (analyse à faire).

### QuickViewController : démarrage et retour automatique (analyse statique, 2026-10-30)

- Table virtuelle à `0x53b41380` (posée par le destructeur `0x531ca634` : `[this] = 0x53b41378 + 8`) :
  [6] `0x531ca6b4` donne l'identifiant de l'écran (0x0800000c par défaut ; 0x0800000d, 0x0800000e,
  0x08000011 selon l'octet +0x799 d'un modèle), [7] **`0x531cbde4` = démarrage** (état +0x16c = 6,
  +0x182 = 0, préparation de l'affichage, publie 0xf1), [10] `0x531cbfc4` = événements (sélecteur sur
  le code), [13] `0x531ca7b0` = transmission au modèle, [15] `0x531ca86c` = minuterie (si la minuterie
  +0x178 expire avec l'état +0x16c ≤ 1 : +0x180 = 1 puis retour à la visée, comme Next shot).
- Deux autres chemins font comme Next shot : `0x531ca82c` (Cancel du dialogue de suppression, après
  `0x532300d4(…, 0)`) et `0x531cbf98`.
- Retake hors de l'écran : l'événement 0xb7 est traité par la table globale des actions
  (`0x53227830`) puis le modèle `0x5323a1a4`, seulement à l'état 2 ; la commande distante le publie
  aussi sans écran. Le publier depuis la visée doit donc marcher, comme 0xb8 pour Film Advance
  (certitude moyenne : à vérifier sur le boîtier).
- Plan T13-FN4 : (1) à l'entrée du démarrage `0x531cbde4`, en mode pellicule (U, Film Roll Mode,
  état 2), exécuter le démarrage natif puis appeler Next shot (`0x531ca804`) sur l'écran ; (2) fonction
  43 « Film Retake » dans Fn Button Settings : publie 0xb7 si une vue a été prise.

### Build de test T13-FN4 : l'écran se referme seul, Retake dans Fn Button Settings

- À l'entrée du démarrage de QuickViewController (`0x531cbde4`) : en mode U, avec Film Roll Mode et
  l'état de multi-exposition 2, le démarrage natif est appelé (pile d'entrée, ip = sp), puis Next shot
  (`0x531ca804`, r0 = l'écran) ; ailleurs, le démarrage seul. Ni la sonde des touches ni les
  crochets de T13-FN2 et T13-FN3 ne sont dans ce build.
- Fonction 43 « Retake » : table des fonctions à 38 entrées (42 puis 43), texte du boîtier 0x2b5
  (« Retake shot », « Reprendre photo » en français, vérifié dans les tables de textes), icône 0x121 ;
  pressée (Fn, ISO, Drive, Movie/Wireless, Hold) : publie l'événement 0xb7
  (`0x532288b0(0x5320aefc(0x5320ad88()), 0xb7, 0, 0)`, comme le bouton de l'écran) en mode U avec
  Film Roll Mode et l'état 2, puis le boîtier continue comme pour Off.
- Vérifié en émulateur : démarrage puis Next shot seulement dans le bon cas (120 combinaisons),
  arguments, pile et retour ; Retake publié seulement dans le bon cas (mode, Film Roll Mode, état
  0 ou 2) sur les deux chemins ; liste (38 fonctions pour les trois modèles), texte et icône ;
  T13-FN1 et T13-FN3 reconstruits identiques octet pour octet ; sondes de T13-FN1 à T13-FN3 et du
  garde-fou repassées.
- Note d'émulation : Unicorn enchaîne les blocs déjà exécutés, un saut vers un bloc déjà atteint
  n'est plus arrêté à l'adresse de fin ; les cas qui s'arrêtent en `fn + 4` passent donc en premier.

### Résultats sur le boîtier (build T13-FN4, 2026-10-30)

- A3 : « Reprendre photo » en dernière ligne de Fn Button Settings.
- B2 à B4, C2, E2 : **l'écran Next / Retake / Complete n'apparaît plus du tout** (pas même un
  éclair), retour direct en visée avec les vues précédentes en transparence. F : Film Advance fait
  avancer (1 → 2). I2 : avec Film Roll Mode Off, l'écran apparaît et reste, comme avant.
  **Suppression de l'écran : validée sur le boîtier.**
- D2 : Retake sur la touche gauche **sans effet** (la fenêtre reste, puis lampe + fenêtre + livre).
  Deux hypothèses : la touche gauche ne passe pas par `GetEventCustomize` ni `GetEventSwitchWlan`
  (Film Advance n'a été testé que sur Fn et Drive), ou l'événement 0xb7 n'est pas traité hors de
  QuickViewController. Test discriminant sans nouveau build : échanger les deux fonctions entre les
  touches gauche et droite.
- Test d'échange (même build) : Reprendre photo sur la touche droite, Film Advance sur la gauche.
  X5 : Retake toujours sans effet ; X6 : la touche gauche fait avancer (2 → 3). G2 : la photo finale
  superpose lampe, fenêtre et livre. Conclusion (forte) : la touche gauche passe bien par nos
  crochets ; c'est l'événement 0xb7 publié en visée qui n'aboutit pas.

### Build de test T13-FN5 : Retake par l'action du boîtier

- La fonction 43 appelle directement l'action de l'événement 0xb7, `0x532270d4` (modèle de prise de
  vue par `0x5320b19c`, puis son Retake `0x5323a1a4`, qui vérifie lui-même l'état 2), au lieu de
  publier l'événement. C'est la jumelle de l'action Complete `0x532270f4`. Le reste est T13-FN4.
- Vérifié en émulateur : l'action appelée seulement dans le bon cas, sur les deux chemins ; T13-FN4
  reconstruit identique octet pour octet ; sondes de T13-FN1, T13-FN4 et du garde-fou repassées.

### Résultats sur le boîtier (build T13-FN5, 2026-10-31)

- D2 : Retake par l'action `0x532270d4` toujours sans effet (D3 compteur 1 ; E2 lampe, fenêtre,
  livre ; F2 avance 1 → 2 ; G2 les trois vues sur la photo).
- `QuickViewController` à l'arrêt (table [8] `0x531cab24`) : si Next shot n'a pas été choisi
  (+0x180 = 0), il appelle `0x532a838c` sur le modèle `0x5320b61c` ; avec Next shot, rien.
- Hypothèse (non établie) : le Retake natif n'annule que la vue en attente de décision ; une fois
  Next shot passé (automatiquement dans T13-FN4 et T13-FN5), la vue est acceptée et Retake n'a plus
  rien à annuler, ou bien le Retake du modèle refuse l'état. À trancher par une sonde : appels du
  Retake du modèle `0x5323a1a4`, résultat de son test d'état (`0x535493ac`), appels de la machine à
  états `0x5346a8d8`.
- Observation de l'utilisateur (T13-FN5) : après un passage par le menu (pour vérifier la touche
  gauche) puis retour, l'affichage de prise de vue (collimateur, informations) avait disparu, mais
  une vue restait possible en superposition et la vue précédente restait en transparence (pas
  d'avance). Natif : ouvrir le menu pendant une multi-exposition fait Complete (phase 2.6). À
  comprendre (sortie de QuickViewController sans passage par l'arrêt normal ?).

### Build de test T13-RT1 : où s'arrête le Retake

- T13-FN5, plus une sonde (octets à `0x55804390`, nuls au démarrage) : + 0 appels du Retake du
  modèle (`0x5323a1a4`), + 1 valeur de son test d'état + 1 (`0x5323a1d0`, `cmp r0,#2`), + 2 appels du
  Retake de la machine à états (`0x5346a8d8`), + 3 sa phase (+ 4 de son objet) + 1, + 4 fins de
  séquence (`0x5346a910`), + 5 appuis sur la fonction 43, + 6 appels de l'action Retake par notre code.
- Date des photos : 20YY = + 0 ; MM = 1 + (+ 1) ; DD = 1 + (+ 2) ; HH = + 3 ; mm = 10 × (+ 6) + (+ 5).
- Vérifié en émulateur (chaque crochet, registres et drapeaux rendus, horloge) ; T13-FN5 reconstruit
  identique ; sondes repassées.

### Résultats sur le boîtier (build T13-RT1, 2026-10-31)

Lecture (attention : MM = valeur du test + 2, HH = phase + 1) :

| Photo | Date | Notre code (+6 / +5) | Retake du modèle | Test d'état | Retake de la machine | Phase |
|---|---|---|---|---|---|---|
| B6 (mode pellicule, 1 appui gauche) | 2004.04.05 03:44 | 4 appels / 4 appuis | 4 | 2 (accepté) | 4 | 2 |
| C4 (natif, Retake sur l'écran) | 2005.04.06 02:44 | inchangé | 5 (+1) | 2 | 5 (+1) | 1 |

- **Un appui sur la touche gauche appelle `GetEventCustomize` 4 fois** (4 « appuis » comptés, 4
  Retake). Film Advance est donc aussi appelé 4 fois par appui ; sans conséquence pour l'avance (le
  modèle refuse la fin dès que l'état n'est plus 2), mais à filtrer pour Retake.
- Notre Retake va jusqu'au bout de la chaîne : modèle (état 2 accepté), commande, machine à états.
  Pourtant la vue n'est pas retirée (B : compteur 2 → 3, comme une avance normale).
- Différence avec le natif : la phase. Natif (C) : phase 1 (première vue en attente), Retake → état
  0, la vue est bien retirée (C4 : le livre seul). Mode pellicule (B) : phase 2, Retake → état 2.
- Conclusion (probable) : une vue validée par Next shot (automatique depuis T13-FN4) ne peut plus
  être retirée ; le Retake natif ne retire que la vue en attente de décision.
- `0x532a838c` (appelé à l'arrêt de l'écran sans Next shot) : remise en état de CaptureReadyModel
  (publie 0x66 et 0x15a), pas un retrait de vue.

### Build de test T13-FN6 : Retake annule toute la vue en cours

- Décision (2026-10-31) : la fonction 43 (texte du boîtier « Reprendre photo ») annule la vue en
  cours entière (toutes ses expositions), sans avancer le film.
- Fonction 43 : en mode U, Film Roll Mode, état 2, si le drapeau `0x55804398` est baissé : le lever
  et appeler l'action Retake `0x532270d4` ; drapeau levé : rien (les 4 appels par appui n'en font
  qu'un). Machine à états, entrée de `0x5346a8d8` : drapeau levé, phase (+ 4) forcée à 1 et drapeau
  baissé ; la machine finit alors à l'état 0, comme le Retake natif de la première vue (vue vide).
  Le drapeau tombe aussi à chaque exposition (préfixe du crochet d'exposition).
- Vérifié en émulateur (machine, déduplication, effacement à l'exposition ; un défaut trouvé et
  corrigé avant envoi : l'événement 0xb7 était aussi publié) ; T13-FN4, T13-FN5, T13-RT1 reconstruits
  identiques ; sondes repassées.
- Inconnues : la transparence en visée s'efface-t-elle ; le compteur et le dossier restent-ils justes.

### Résultats sur le boîtier (build T13-FN6, 2026-10-31, partiels)

- C2 : après l'annulation, la visée garde la lampe et la fenêtre en transparence ; C3 compteur 3
  (inchangé). D2 : après la vue suivante, lampe, fenêtre et livre en transparence. E2 : avance (3 → 4).
- G4 : vue, annulation, puis Film Advance : **aucun effet** ; l'annulation a bien remis la machine
  hors de l'état 2 (sinon l'avance aurait eu lieu).
- Conclusion provisoire : l'annulation agit sur la machine à états, mais pas sur l'image de
  transparence en visée. À établir : le contenu de la photo de E (lampe et fenêtre comprises ou non).
- **Bogue majeur signalé (2026-10-31)** : en mode pellicule, après Menu puis retour, l'affichage de
  prise de vue a disparu (plus de collimateur ni d'informations), alors qu'une vue reste possible.
  Déjà vu en T13-FN5. Cause inconnue ; à cerner (mode P, mode pellicule sans vue, avec vue).

### Test guidé T13-FN6 (2026-10-31, réponses cliquées, U3)

| Étape | Geste | Résultat |
|---|---|---|
| 1 | lampe, fenêtre, touche gauche | lampe et fenêtre toujours en transparence |
| 2 | livre, touche droite | compteur + 1 |
| 3 | lecture, dernière photo | **lampe, fenêtre et livre** : l'annulation ne retire rien de l'image |
| 4 | Menu, Menu, sans vue en cours | affichage normal |
| 5 | lampe, Menu, Menu | **affichage disparu**, plus de transparence |
| 6 | | compteur non affiché |
| 7 | lecture | la lampe : le menu a fait Complete (natif) |
| 8 | mi-course | toujours disparu |
| 9 | une vue | toujours disparu, la vue est en transparence |
| 10 | touche droite | toujours disparu |
| 11 | molette P puis U3 | toujours disparu |
| 12 | extinction, rallumage | tout revient |
| 13 | Film Roll Mode Off, vue, écran natif, Photo suivante, Menu, Menu | **affichage normal** |

- L'image de la superposition est construite au fil des vues : une vue validée y reste. Retake vue par
  vue ou annulation de la vue en cours : impossibles sans garder la décision sur l'écran natif.
- Le bogue du menu vient de notre fermeture automatique (étape 13 : rien en natif). Hypothèse : le
  chemin du menu (Complete par le menu) redémarre QuickViewController alors que l'état vaut encore 2,
  et notre Next shot automatique demande la visée au milieu du passage au menu. Seul ouvreur trouvé
  par recherche des identifiants 0x0800000c à 0x08000011 : l'action `0x53226738` (les autres
  occurrences sont la fabrique `0x5316f3bc`, le gestionnaire de touches et QuickViewController).

### Build de test T13-FN7 : correction du bogue du menu, sans Retake

- Décision (2026-10-31) : pas de Retake en mode pellicule ; la fonction 43 est retirée.
- Fermeture automatique seulement après un déclenchement : l'action d'ouverture `0x53226738` (événement
  0x90) lève un drapeau (`0x55804399`) ; le démarrage `0x531cbde4` le consomme (toujours baissé) et
  n'appelle Next shot que s'il était levé, en plus des conditions de T13-FN4. Le drapeau tombe aussi à
  chaque exposition. Si le chemin du menu passe lui aussi par `0x53226738`, la correction ne suffira
  pas : le test le dira.
- Protection : une fonction supérieure à 42 (43 enregistrée par T13-FN4 à T13-FN6) se lit comme Off
  (texte, icône, exécution sur les deux chemins).
- Vérifié en émulateur : 240 cas de démarrage (avec et sans drapeau), drapeau levé par l'ouverture et
  baissé par l'exposition, protection 43 et 200 ; T13-FN1, T13-FN4, T13-FN6 reconstruits identiques ;
  sondes repassées.

### Résultats sur le boîtier (build T13-FN7, 2026-10-31, test guidé, U3)

- Vue : pas d'écran, visée et transparence. Vue puis Menu, Menu : **affichage normal** (bogue
  corrigé), compteur + 1 (le menu fait Complete, natif). Deux vues : pas d'écran, transparence.
  Film Advance : + 1. Touche gauche (43 enregistrée) : rien, pas de plantage ; sa ligne de Fn Button
  Settings affiche Off sans plantage.
- **Phase 6 (avance par une touche, sans écran après chaque vue) : validée sur le boîtier.**
- Conclusion : le chemin du menu redémarrait QuickViewController sans passer par l'action
  d'ouverture `0x53226738` ; le drapeau suffit.

### Décisions du 2026-10-31 (suite de la phase 6)

- Dossier : `NNN` + code Image Control (3) + longueur (2), par exemple `112NEG36` ; codes STD, VIV,
  MON, SMO, HMO, HCB, POS, BLB, RET, HDR, CRP, NEG ; films de GR Mod : code fixé par film, saisi
  dans l'application à l'ajout du film.
- Pas de verrou : changer l'Image Control ou le format clôt le rouleau. JPEG non imposé.
- Ligne « Rembobiner » sous Save Settings, avec confirmation Oui / Non.
- Carte changée ou dossier supprimé : rouleau perdu, compteur à 1 dans un nouveau dossier.
- Maintenabilité avec GR Mod : fonction intégrée comme les autres (application, build livrable sans
  sondes).
- Priorités : nom du dossier, puis extinction ou changement de mode pendant une vue, puis fin de
  rouleau.

### Nom du dossier du rouleau (analyse statique, 2026-10-31)

- Le réglage d'origine Folder Name (`+0x936`, 5 octets) et son type (`+0x934`) sont copiés dans les
  huit enregistrements (réglage global), puis transmis aux valeurs de prise de vue en direct :
  `0x5326caa0` → `0x5354d138(live, nom)` (élément 0xfd de `0x5354b564`) ; `0x53258604` →
  `0x5354d104(live, type)` (si `0x532585a4()`). `live = *0x53525d5c()`. Certitude : lu dans le code.
- Le chemin du fichier est formé sur le gabarit `" :\DCIM\        \        .   "` (`0x53d26c68`,
  utilisé par `0x536bd410` et `0x5383d430`) ; la recherche des dossiers existants utilise `"%03d*"`
  (`0x5359efc0`). Le nom de 5 caractères d'un nouveau dossier vient donc des valeurs en direct.
- T10-FILMPROBE5 a montré que nom, type et drapeau posés à la fin du modèle (`0x5323a080`, tâche de
  l'interface) s'appliquent au dossier créé pour l'image qui suit.
- Image Control actif : octet `+0x1c2` (11 Standard à 22 Negative Film ; les films de GR Mod ont
  leurs propres valeurs).
- Proposition : poser le nom du rouleau (code + longueur) et le type « nom libre » **seulement dans
  les valeurs en direct** à la fin du modèle en mode pellicule et au rappel d'un mode U pellicule ;
  remettre le nom et le type enregistrés au rappel d'un autre mode et quand Film Roll Mode passe à
  Off. Le réglage enregistré de l'utilisateur n'est jamais modifié.

### Nom des fichiers (analyse statique en cours, 2026-10-31)

- Décision : fichiers du mode pellicule `NEG_6857.JPG` (code du film + `_` + numérotation continue du
  boîtier).
- Réglage d'origine File Name : 2 octets à `+0x93d` (copiés dans les huit enregistrements par
  `0x5326cacc`), transmis aux valeurs en direct par `0x5326cb1c` → `0x5354d168(live, nom)`
  (élément 0xfe). Le nom de fichier natif `R0016855` = préfixe de 2 caractères + 6 chiffres : ce
  réglage seul ne permet pas 4 caractères.
- Format `"%s%04d.%s"` (`0x53d26c14`) utilisé par `0x535b87f0` (préfixe de 4 caractères pris dans une
  structure de fichier, numéro sur 4 chiffres) : semble servir à la lecture des fichiers existants ;
  le point de fabrication du nom d'un nouveau fichier reste à trouver.

### Build de test T14-DIR1 : nom du dossier du rouleau

- T13-FN7, plus : à chaque avance en mode pellicule (fin du modèle, rouleau entamé, état 2), avant
  l'enregistrement de l'image, le nom `code + longueur` (`NEG36`, 5 caractères et un zéro à
  `0x558043b0`) et le type 1 (nom libre) sont donnés **aux seules valeurs en direct**
  (`0x5354d138`, `0x5354d104` sur `*0x53525d5c()`). Code : octet `+0x1c2` (11 à 22 → STD ... NEG ;
  autre valeur → FLM en attendant le code saisi dans l'application). Longueur : celle du compteur.
- Au rappel d'un mode libre ou d'un mode U sans Film Roll Mode, et quand Film Roll Mode passe à Off :
  le nom (`+0x936`) et le type (`+0x934`) enregistrés sont redonnés aux valeurs en direct. Le réglage
  Folder Name enregistré n'est jamais modifié.
- Vérifié en émulateur : nom et type donnés à chaque avance (180 cas, codes connus et inconnus,
  ratios), rien sinon ; remise au rappel (15 cas) et non au rappel d'un U pellicule (13 cas) ; remise
  par Off ; T13-FN7 et T13-FN1 reconstruits identiques ; sonde du garde-fou adaptée (substitution des
  deux setters en direct) et repassée.
- Inconnue : la création du dossier lit-elle bien les valeurs en direct (et non l'enregistrement) ?
  T10-FILMPROBE5 passait par les setters complets.

### Résultats sur le boîtier (build T14-DIR1, 2026-10-31, test guidé)

- U3 (Negative Film, 3:2), Save Settings : 1/36 ; deux vues avancées : 3/36 ; P une photo ; U3 une vue
  avancée : 4 puis 5. Carte : **dossier `137NEG36`** avec les 4 vues du rouleau ; la photo de P dans
  un dossier au nom habituel (`NNNRICOH`). **Nom du dossier du rouleau : validé sur le boîtier**
  (les valeurs en direct suffisent ; le réglage enregistré est intact).
- Anomalie : en arrivant sur P depuis U3 (après vue et avance), l'affichage de visée manque
  **parfois** jusqu'à la photo suivante (reproduit 1 fois sur 3 environ). P → Av → P (trois fois,
  notre remise du nom passe aussi par là) : jamais. Cause non établie : à comparer avec T13-FN7
  (même enchaînement), et à tester avec un délai entre l'avance et la molette.

### Démarrage de QuickViewController et retour automatique (analyse statique, 2026-10-31)

- Démarrage `0x531cbde4` : état `+0x16c` = 6, puis `0x531cb7bc(this, mode)` avec mode = identifiant
  du contrôleur − 0x0800000c (`0x531cb028`, `0x5316d8d4`) ; l'écran ouvert par l'action
  `0x53226738` est 0x0800000c, donc mode 0. Si l'état final ≤ 1 : `0x531caa7c`.
- `0x531caa7c` = retour automatique natif (vue simple) : durée de Rec Review (`+0x900` de
  l'enregistrement par `0x532462d0`) ; 0 → aussitôt `+0x180 = 1` et visée (`0x5316c9d8(this,
  0x08000000, 0x10000000)`, exactement comme Next shot) ; −1 → rien (maintien) ; sinon minuterie
  `0x5322b468` rangée en `+0x178`, traitée par `0x531ca86c` (même retour). `0x531cbe78` (publie 0xf1)
  y mène aussi.
- Conséquence : notre fermeture (Next shot juste après le démarrage) a la même forme que le retour
  immédiat natif « Rec Review Off ». La course supposée n'est donc pas démontrée par le code ; la
  différence tient à l'état de multi-exposition (écran de décision affiché) au moment du retour.
- Piste retenue : appuyer sur Next shot au premier événement reçu par l'écran après son démarrage
  (gestionnaire `0x531cbfc4`, entrée 10 de la table), c'est-à-dire quand l'écran est actif, comme un
  appui réel.

### Résultats et build de test T14-DIR2 (2026-10-31)

- Précision de l'utilisateur sur T14-DIR1 : après P puis retour en U3, une vue fait **disparaître
  l'affichage de visée** (la vue est en transparence) ; Film Advance valide la vue mais l'affichage
  ne revient pas, ni en P, jusqu'à la photo suivante. Même famille que le bogue du menu.
- T14-DIR2 : le démarrage de l'écran ne fait plus que noter l'écran (son adresse en `0x5580439c`,
  0 sinon ; mêmes conditions que T13-FN7, drapeau d'ouverture compris) ; au premier événement reçu
  par cet écran (gestionnaire `0x531cbfc4`), l'événement est traité normalement, puis Next shot.
- Vérifié en émulateur : 120 cas de démarrage, gestionnaire inchangé pour un autre écran, appel du
  gestionnaire puis de Next shot pour l'écran noté ; T14-DIR1 reconstruit identique ; sondes
  repassées.
