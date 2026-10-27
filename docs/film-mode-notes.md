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
