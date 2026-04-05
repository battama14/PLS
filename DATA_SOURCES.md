# PulseChain Intelligence Dashboard - Sources de Données

## 🟢 DONNÉES 100% RÉELLES (APIs officielles)

### PulseChain Scan API
- **Supply PLS** : `api.scan.pulsechain.com/api?module=stats&action=tokensupply`
- **Numéro de bloc** : `api.scan.pulsechain.com/api?module=block&action=getblocknobytime`
- **Burn PLSX** : `api.scan.pulsechain.com/api?module=account&action=tokenbalance`
- **Transactions baleines** : `api.scan.pulsechain.com/api?module=account&action=txlist`

### DefiLlama API
- **TVL PulseChain** : `api.llama.fi/v2/chains`

### CoinGecko API (quand disponible)
- **Prix PLS/PLSX** : `api.coingecko.com/api/v3/simple/price`
- **Variations 24h/7j** : Incluses dans l'API prix
- **Volume 24h** : Inclus dans l'API prix

## 🟡 DONNÉES CALCULÉES (basées sur vraies données)

### Market Cap
- **Formule** : Supply PLS réel × Prix CoinGecko réel
- **Affiché seulement** si les deux données sources sont disponibles

### Whale Accumulation Index
- **Formule** : Somme des achats réels - Somme des ventes réelles
- **Classification** : Basée sur les vraies transactions >10M PLS détectées

### Pump Probability Ratio
- **Formule** : Volume 24h réel / TVL réel
- **Seuils** : <0.05 (calme), 0.05-0.15 (normal), 0.15-0.30 (accumulation), >0.30 (pump)

### Market Intelligence Score
- **Composants** : Basé uniquement sur les métriques réelles disponibles
- **Pénalités** : Appliquées pour les vraies distributions de baleines

## 🔴 DONNÉES NON DISPONIBLES (affichées comme "--")

- **Transactions quotidiennes** : Pas d'API fiable trouvée
- **Nombre de wallets** : Pas d'API publique disponible  
- **Prix du gaz** : API PulseChain non fonctionnelle
- **Croissance des wallets** : Dépend des données de wallets

## 📊 POLITIQUE DE TRANSPARENCE

- **Aucune simulation** ou donnée artificielle
- **Aucun équilibrage** des données de baleines
- **Classification réelle** : Vente = vers burn address, Achat = depuis contrat/exchange
- **Affichage "--"** quand les données ne sont pas disponibles
- **Logs console** indiquent clairement les sources (RÉEL vs CALCULÉ)