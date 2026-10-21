# Déploiement Phase 3 : Formats, Conditionnements et Coûts Unitaires

Ce guide décrit la séquence réelle de déploiement et de migration pour la machine boutique (Shop PC).

---

## 1. Sauvegarde de la Base de Données

Le fichier SQLite principal est localisé à `data/erp.sqlite` (ou configuré via la variable d'environnement `DATABASE_PATH`) comme défini dans [`server/db/index.ts:16`](file:///home/admin/VibeCoding/JaziraERP/server/db/index.ts#L16).

La base de données fonctionne en mode WAL (Write-Ahead Logging), activé au démarrage dans [`server/db/index.ts:28`](file:///home/admin/VibeCoding/JaziraERP/server/db/index.ts#L28) :
```typescript
db.pragma('journal_mode = WAL');
```

> [!WARNING]
> **Ne jamais exécuter un `cp` direct sur un fichier SQLite en cours d'exécution avec WAL actif.**
> Les transactions actives résident dans `data/erp.sqlite-wal` et un `cp` brut risque de produire une copie corrompue ou incomplète.

Deux méthodes sûres sont disponibles :

### Option A : Sauvegarde à chaud via l'API (Recommandé)
Déclencher une sauvegarde en ligne via le point de terminaison [`server/routes/backup.ts:24-32`](file:///home/admin/VibeCoding/JaziraERP/server/routes/backup.ts#L24-L32) :
```bash
curl -X POST http://127.0.0.1:3000/api/backups
```
Cette méthode invoque [`server/services/backupService.ts:40-46`](file:///home/admin/VibeCoding/JaziraERP/server/services/backupService.ts#L40-L46) qui utilise l'API de sauvegarde en ligne de better-sqlite3 ou `VACUUM INTO ?` pour créer un cliché cohérent et intègre sous le répertoire `backups/`.

### Option B : Sauvegarde à froid (Service arrêté)
Arrêter le processus serveur (Node.js), puis copier l'ensemble de la base :
```bash
# Arrêter le processus serveur (ex: Ctrl+C ou gestionnaire de processus)
cp data/erp.sqlite data/erp_backup_$(date +%Y%m%d_%H%M%S).sqlite
# Copier également les fichiers WAL temporaires s'ils existent encore avant redémarrage
[ -f data/erp.sqlite-wal ] && cp data/erp.sqlite-wal data/erp_backup_$(date +%Y%m%d_%H%M%S).sqlite-wal
```

---

## 2. Mise à Jour du Code & Démarrage

Sur le Shop PC, récupérer les modifications, installer les dépendances et recompiler le frontend :

```bash
git pull origin master
npm install
npm run build
```

Redémarrer ensuite le serveur Node.js.

### Note sur les Migrations de Schéma
Il n'existe **aucun script de migration externe `.sql` manuel** à exécuter. Les évolutions de schéma sont appliquées automatiquement et de manière idempotente lors de l'initialisation de l'instance DB dans [`server/db/index.ts`](file:///home/admin/VibeCoding/JaziraERP/server/db/index.ts) :
1. Ajout de la colonne `size_volume` sur `products` via `ensureColumn` dans [`server/db/index.ts:67`](file:///home/admin/VibeCoding/JaziraERP/server/db/index.ts#L67).
2. Ajout de la colonne `batch_volume` sur `production_batches` via `ensureColumn` dans [`server/db/index.ts:68`](file:///home/admin/VibeCoding/JaziraERP/server/db/index.ts#L68).
3. Création de la table `product_packaging_items` et de son index dans [`server/db/index.ts:88-96`](file:///home/admin/VibeCoding/JaziraERP/server/db/index.ts#L88-L96).

Vérifier la santé du serveur après lancement :
```bash
curl -s http://127.0.0.1:3000/api/health
```

---

## 3. Configuration des Tailles (Rattrapage des Formats)

Pour calculer correctement le coût de matière première vrac, chaque article de type fabriqué (`MANUFACTURED`) doit avoir une taille numérique positive `products.size_volume` en litres ou kilos ([`server/services/costingService.ts:211-223`](file:///home/admin/VibeCoding/JaziraERP/server/services/costingService.ts#L211-L223)).

1. Ouvrir l'application dans le navigateur et aller dans **Backoffice -> Articles**.
2. Cliquer sur **« Tailles & Coûts de Fabrication »**.
3. **Onglet 1 : « 1. Rattrapage Tailles Manquantes »** :
   - L'API [`POST /api/products/backfill-size-preview`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L413-L441) liste uniquement les articles fabriqués sans taille (`size_volume IS NULL`) et suggère un volume à partir du libellé (ex. "1.5L" -> `1.5`).
   - Vérifier ou ajuster les valeurs proposées.
   - Cliquer sur **« Enregistrer les tailles »** pour soumettre à [`POST /api/products/backfill-size-confirm`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L443-L488).
   - Ce rattrapage met à jour uniquement `size_volume` en base transactionnelle sans altérer les coûts de revient existants ([`server/routes/products.ts:470-487`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L470-L487)).

---

## 4. Renseignement des Articles de Conditionnement (Packaging)

Pour chaque article conditionné (bouteilles 1.5L, 2L, bidons 5L...) :

1. Dans **Backoffice -> Articles**, éditer l'article concerné.
2. Dans la section **« Articles de conditionnement »** ([`src/components/backoffice/CreateProductModal.tsx:432-520`](file:///home/admin/VibeCoding/JaziraERP/src/components/backoffice/CreateProductModal.tsx#L432-L520)) :
   - Ajouter chaque composant d'emballage (ex. Bouteille vide, Bouchon, Étiquette).
   - Indiquer la quantité requise par unité finie (ex. 1 bouteille, 1 bouchon, 1 étiquette).
3. L'API [`POST /api/products/:id/packaging`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L687-L738) valide que :
   - La famille du produit est bien `MANUFACTURED` ([`server/routes/products.ts:707-710`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L707-L710)).
   - La matière appartient à l'une des catégories autorisées : `bottle`, `cap`, `label`, ou `packaging` ([`server/routes/products.ts:712-716`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L712-L716)).
   - La quantité est strictement positive ([`server/routes/products.ts:718-723`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L718-L723)).
   - L'ajout d'emballages **ne modifie pas** silencieusement `products.cost_reference` ([`server/routes/products.ts:730-736`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L730-L736)).

---

## 5. Nettoyage des Recettes (Suppression des Emballages des Formules)

Dans l'ancien modèle, certains emballages pouvaient être inclus dans la recette globale de chimie. Avec le nouveau modèle, les recettes représentent uniquement la formulation chimique en vrac (ex. cuve de 2000 L).

> [!IMPORTANT]
> **Garde anti-double décompte :**
> Si une recette contient encore des articles d'emballage (`bottle`, `cap`, `label`, `packaging`) alors que le produit possède des emballages spécifiques configurés dans `product_packaging_items`, le moteur de coût rejette l'opération avec une erreur explicite ([`server/services/costingService.ts:236-243`](file:///home/admin/VibeCoding/JaziraERP/server/services/costingService.ts#L236-L243)) :
> ```typescript
> if (recipeHasPackaging && packagingItems.length > 0) {
>   throw new ProductionValidationError("Incohérence : la formule contient déjà des articles d'emballage alors que le produit a des emballages spécifiques configurés (risque de double décompte).");
> }
> ```

1. Aller dans **Backoffice -> Production / Recettes**.
2. Éditer chaque formule associée à des familles fabriquées ([`server/routes/formulations.ts:133-188`](file:///home/admin/VibeCoding/JaziraERP/server/routes/formulations.ts#L133-L188)).
3. Retirer les lignes correspondant aux bouteilles, bouchons ou étiquettes pour ne conserver que les matières premières de la formule chimique liquide.
4. Enregistrer la formule.

---

## 6. Aperçu et Confirmation Collective des Coûts de Revient

Une fois les recettes nettoyées et les conditionnements renseignés :

1. Retourner dans **Backoffice -> Articles -> « Tailles & Coûts de Fabrication »**.
2. Sélectionner l'**« Onglet 2 : Mise à Jour Coûts de Revient »** ([`src/components/backoffice/BatchCostBackfillModal.tsx:462-690`](file:///home/admin/VibeCoding/JaziraERP/src/components/backoffice/BatchCostBackfillModal.tsx#L462-L690)).
3. L'API [`POST /api/products/batch-cost-preview`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L490-L575) calcule pour chaque SKU le coût unitaire décomposé :
   `Coût Unitaire = (Volume x Coût Base Vrac) + Somme(Qté Conditionnement x Coût)`
   tel qu'implémenté dans [`server/services/costingService.ts:252-254`](file:///home/admin/VibeCoding/JaziraERP/server/services/costingService.ts#L252-L254).
4. Le tableau présente la valorisation actuelle, la nouvelle valorisation projetée et la variation nette sur le stock.
5. Cliquer sur **« Appliquer les nouveaux coûts »** :
   - L'API [`POST /api/products/batch-cost-confirm`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L577-L684) recalcule les coûts côté serveur dans la transaction ([`server/routes/products.ts:639`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L639)).
   - En cas d'écart > 0.001 DT avec l'aperçu client, la requête est rejetée avec un code 409 sans rien écrire ([`server/routes/products.ts:643-652`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L643-L652)).
   - Lors de la validation, seuls les coûts calculés par le serveur sont inscrits dans `products.cost_reference` ([`server/routes/products.ts:654-666`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L654-L666)).

---

## 7. Exécution d'un Lot de Production Test

Pour valider l'ensemble de la chaîne opérationnelle :

1. Aller dans **Backoffice -> Production -> Nouveau Lot** ([`server/routes/production.ts:62-224`](file:///home/admin/VibeCoding/JaziraERP/server/routes/production.ts#L62-L224)).
2. Sélectionner une formule et un produit cible (ex. Liquide Vaisselle 1.5L).
3. Saisir soit le volume de cuve (ex. 300 L), soit le nombre d'unités cibles (ex. 200 unités) :
   - [`server/services/costingService.ts:318-360`](file:///home/admin/VibeCoding/JaziraERP/server/services/costingService.ts#L318-L360) calcule automatiquement le facteur d'échelle :
     `Volume Lot = Unités x size_volume`
   - Les ingrédients chimiques sont proportionnés au volume total produit divisé par le rendement de base ([`server/services/costingService.ts:365-385`](file:///home/admin/VibeCoding/JaziraERP/server/services/costingService.ts#L365-L385)).
   - Les articles de conditionnement sont proportionnés au nombre d'unités produites ([`server/services/costingService.ts:387-414`](file:///home/admin/VibeCoding/JaziraERP/server/services/costingService.ts#L387-L414)).
4. Confirmer la production :
   - Les matières chimiques et emballages sont déduits atomiquement des stocks de matières premières ([`server/routes/production.ts:190-208`](file:///home/admin/VibeCoding/JaziraERP/server/routes/production.ts#L190-L208)).
   - Le stock du produit fini augmente de `units_produced` et son `cost_reference` est mis à jour avec le coût unitaire réel calculé du lot ([`server/routes/production.ts:212-222`](file:///home/admin/VibeCoding/JaziraERP/server/routes/production.ts#L212-L222)).
   - Vérifier dans **Backoffice -> Articles** que le stock de l'article a augmenté et que son coût unitaire est exact.
