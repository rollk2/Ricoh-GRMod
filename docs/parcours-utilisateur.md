# Mode pellicule : parcours utilisateur

Document de travail pour décider ensemble du comportement exact du mode pellicule.
Chaque section décrit le parcours et dit si le comportement est **en place** (validé sur le
boîtier) ou **à décider**. Les questions à trancher sont regroupées à la fin, avec ma
recommandation.

## Vocabulaire

| Terme | Sens |
|---|---|
| BOX | Un jeu de réglages enregistré par Save Settings, rappelé par U1, U2 ou U3. |
| Pellicule, rouleau | Une BOX avec Film Roll Mode sur On. Une BOX = un rouleau. |
| Vue | Une image du rouleau. Elle peut superposer plusieurs déclenchements. |
| Avancer | Enregistrer la vue en cours et passer à la suivante (touche Film Advance). |
| Compteur | `vue/total` en haut à droite, par exemple `12/36`. |
| Dossier du rouleau | `NNN` + code du film + longueur, par exemple `112NEG36`. |

## 1. Préparer une pellicule (en place)

1. Choisir l'Image Control (le film) et le format (3:2, 1:1, XPan...) avec les menus normaux.
2. Menu C (Customize Settings) : Film Roll Mode sur On.
3. Save Settings dans la BOX de U1, U2 ou U3.
4. Une seule fois : dans Fn Button Settings, mettre Film Advance sur une touche (par exemple la
   touche droite).

La longueur du rouleau vient du format : 36 (3:2), 12 (1:1), 21 (XPan), 15 (4:3), 72 (3:4).

## 2. Démarrer le rouleau (en place)

- Le rouleau démarre à la **première vue** prise dans ce mode U. Aucune action de menu.
- Le boîtier passe en multi-exposition, sans vues intermédiaires.
- Le dossier du rouleau est créé à l'enregistrement de la première vue.

## 3. Prendre des vues (en place)

- **Déclencher** : la photo s'affiche brièvement (selon Affichage immédiat, Off valant 1 ms en
  mode pellicule), puis la visée revient avec la vue en transparence. Pas d'écran Next / Retake /
  Complete.
- **Déclencher encore** sans avancer : superposition sur la même vue.
- **Avancer** (touche Film Advance) : la vue est enregistrée dans le dossier du rouleau, le
  compteur passe à la vue suivante. Sans vue prise, la touche ne fait rien.
- Pas de Retake : une vue validée ne peut plus être retirée (décision du 2026-10-31).

## 4. Interrompre (en place)

| Action pendant une vue non avancée | Effet |
|---|---|
| Menu | La vue est enregistrée dans le rouleau, compteur + 1. |
| Extinction | Idem. |
| Molette vers un autre mode | Idem : elle compte dans le rouleau du mode U qui l'a prise. |
| P, Av, Tv, M | Photos normales, dans leur propre dossier. Le rouleau attend. |
| Retour sur le mode U | Le rouleau reprend où il en était. |
| Film Roll Mode sur Off (sans Save Settings) | Le rouleau est suspendu ; il reprend au prochain rappel de la BOX. |
| Retrait de la batterie | Le rouleau est conservé (sauvegarde à chaque avance) ; une vue non avancée est perdue. |

## 5. Plusieurs pellicules (en place)

U1, U2 et U3 peuvent porter chacun leur rouleau, avec leur compteur et leur dossier. Passer de
l'un à l'autre ne perd rien.

## 6. Fin du rouleau (à décider)

Aujourd'hui : à l'avance de la dernière vue, le rouleau est clos en silence. La vue suivante
démarre un nouveau rouleau (nouveau dossier, compteur à 1), avec les mêmes réglages.

Défaut repéré dans le code, à corriger dans tous les cas : la dernière vue risque d'être rangée
dans un nouveau dossier, car le rouleau est clos avant l'enregistrement de son image.

Ce qu'il faut décider :

- **Q1. Que se passe-t-il après la dernière vue ?**
  - (a) Nouveau rouleau automatique à la vue suivante, comme aujourd'hui.
  - (b) Le mode U refuse de déclencher tant qu'on n'a pas rembobiné (comme un vrai boîtier).
    Plus fidèle, mais plus risqué à réaliser.
- **Q2. Message de fin de rouleau.** Afficher un message à l'avance de la dernière vue, par
  exemple « Pellicule terminée. Rembobinez ou changez de film. » Le boîtier a un mécanisme de
  messages, à étudier.
- **Q3. Vues bonus.** Comme une vraie 36 poses, accepter 1 ou 2 vues au-delà (`37/36`) ?

## 7. Changer de film ou de format en cours de rouleau (à décider)

Décision du 2026-10-31 : changer l'Image Control ou le format **clôt** le rouleau.

- **Q4. Quand la clôture a-t-elle lieu ?**
  - (a) À la vue suivante : si l'Image Control ou le format ne correspond plus au rouleau, celui-ci
    est clos et un nouveau rouleau démarre (nouveau dossier, compteur à 1).
  - (b) Dès le changement dans le menu.
- **Q5. Changement sans Save Settings.** Si l'on change l'Image Control dans le mode U sans faire
  Save Settings, la BOX garde l'ancien film : au prochain rappel, l'ancien réglage revient. Que
  devient le nouveau rouleau à ce moment-là : clos aussi, ou repris ?
- **Q6. Message.** Prévenir à la clôture (« Nouvelle pellicule ») ou rester silencieux ?

## 8. Rembobiner à la main (à décider)

Décision du 2026-10-31 : une ligne « Rembobiner » sous Save Settings, avec confirmation Oui / Non.

- **Q7. Effet.** Clôt le rouleau du mode U actif ; la vue suivante démarre un nouveau rouleau.
  Une vue en cours non avancée est-elle enregistrée d'abord (comme le menu le fait déjà) ?
- **Q8. Visibilité.** La ligne n'apparaît qu'en mode U avec Film Roll Mode sur On (griser n'est pas
  encore possible). Doit-elle aussi disparaître quand le rouleau n'est pas entamé ?
- **Q9. Nom.** « Rembobiner » en français ; en anglais « Rewind Film » ? (21 langues à traduire.)

## 9. Carte changée ou dossier supprimé (à décider)

Décision du 2026-10-31 : le rouleau est perdu (pellicule voilée), le compteur repart à 1 dans un
nouveau dossier.

- **Q10. Détection.** Le dossier du rouleau n'existe plus sur la carte au moment d'enregistrer :
  nouveau rouleau à 1. Mais si la nouvelle carte contient par hasard un dossier de même numéro,
  le rouleau continuerait dedans. Acceptable ?
- **Q11. Message.** Prévenir (« Pellicule perdue ») ou rester silencieux ?

## 10. Décisions (2026-11-01)

| N° | Décision |
|---|---|
| Q1 | Nouveau rouleau automatique à la vue suivante, **annoncé par un message**. |
| Q2 | Message à l'avance de la dernière vue, si le mécanisme du boîtier s'y prête. |
| Q3 | Pas de vues bonus pour l'instant. |
| Q4 | Clôture à la vue suivante quand le film ou le format ne correspond plus au rouleau. |
| Q5 | Même règle au retour de l'ancien film (changement sans Save Settings). |
| Q6 | Message à la clôture, le même que pour la fin de rouleau. |
| Q7 | Rembobiner : la vue en cours est d'abord enregistrée dans l'ancien rouleau. |
| Q8 | Ligne visible en mode U avec Film Roll Mode sur On, même rouleau vierge. |
| Q9 | Rembobiner / Rewind Film (21 langues). |
| Q10 | Dossier de même numéro sur une nouvelle carte : le rouleau continue dedans, **au bon numéro de vue** (le compteur mémorisé). |
| Q11 | Pas de message pour une pellicule perdue. |

## 11. Questions et recommandations (rappel)

| N° | Question | Ma recommandation |
|---|---|---|
| Q1 | Après la dernière vue | (a) nouveau rouleau automatique, plus sûr ; (b) en option plus tard |
| Q2 | Message de fin | Oui, si le mécanisme de messages se prête bien ; sinon rien |
| Q3 | Vues bonus | Non pour l'instant |
| Q4 | Moment de la clôture | (a) à la vue suivante |
| Q5 | Changement sans Save Settings | Clore aussi au retour de l'ancien film (même règle que Q4) |
| Q6 | Message à la clôture | Non |
| Q7 | Vue en cours au rembobinage | Enregistrée d'abord dans l'ancien rouleau |
| Q8 | Visibilité de Rembobiner | Visible en mode U avec Film Roll Mode sur On, même rouleau vierge |
| Q9 | Nom | Rembobiner / Rewind Film |
| Q10 | Dossier de même numéro | Acceptable |
| Q11 | Message pellicule perdue | Non |
