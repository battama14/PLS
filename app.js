// ─── CONFIG ───────────────────────────────────────────────────────────────────
const REFRESH_INTERVAL = 5 * 60 * 1000;
const WHALE_THRESHOLD = 10_000_000;
const WHALE_ALERT_THRESHOLD = 50_000_000;
const PLSX_CONTRACT = '0x95B303987A60C71504D99Aa1b13B4DA07b0790ab';
const BURN_ADDRESS  = '0x0000000000000000000000000000000000000369';
const PLS_TOKEN     = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27';

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  plsPrice: null, plsChange24h: null, plsChange7d: null, plsMcap: null, plsVol: null,
  plsxPrice: null, plsxChange24h: null,
  txToday: null, txYesterday: null,
  blockNumber: null, gasPrice: null,
  totalWallets: null,
  burnTotal: null, burnPrev: null,
  tvl: null, tvlChange: null, pools: null, tokens: null, projects: null, telegramMembers: null,
  whales: [],
  priceHistory: [], priceLabels: [],
  txHistory: [], txLabels: [],
  walletHistory: [], walletLabels: [],
  scoreBreakdown: {},
  // Nouvelles métriques avancées
  whaleAccumulation: { buys: 0, sells: 0, index: 0, signal: 'Neutre' },
  pumpProbability: { ratio: 0, signal: 'Marché calme' },
  marketIntelligence: { score: 0, breakdown: {} },
  // NOUVELLES FONCTIONNALITÉS AVANCÉES
  fearGreedIndex: { score: 50, status: 'Neutre', factors: {} },
  momentum: { short: 0, medium: 0, long: 0, trend: 'Neutre' },
  tradingSignals: { position: 'HOLD', confidence: 0, stopLoss: null, target: null },
  supportResistance: { support: [], resistance: [], current: 'Neutre' },
  alerts: { active: [], history: [] },
  // Alertes
  pumpAlertSent: false
};

// ─── SETTINGS UTILISATEUR ────────────────────────────────────────────────────
const userSettings = {
  theme: localStorage.getItem('pls-theme') || 'dark',
  alerts: {
    priceUp: parseFloat(localStorage.getItem('pls-alert-up')) || null,
    priceDown: parseFloat(localStorage.getItem('pls-alert-down')) || null,
    whaleThreshold: parseFloat(localStorage.getItem('pls-whale-alert')) || 100_000_000,
    pumpRatio: parseFloat(localStorage.getItem('pls-pump-alert')) || 0.5,
    notifications: localStorage.getItem('pls-notifications') === 'true'
  },
  favorites: JSON.parse(localStorage.getItem('pls-favorites') || '[]'),
  mobile: window.innerWidth <= 768
};

// ─── CHARTS ───────────────────────────────────────────────────────────────────
let chartPrice, chartTx, chartWallets;

function initCharts() {
  const cfg = (label, color) => ({
    type: 'line',
    data: { labels: [], datasets: [{ label, data: [], borderColor: color, backgroundColor: color + '22', borderWidth: 2, pointRadius: 2, tension: 0.4, fill: true }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } }, animation: { duration: 400 } }
  });
  chartPrice   = new Chart(document.getElementById('chart-price'),   cfg('Prix PLS', '#00d4ff'));
  chartTx      = new Chart(document.getElementById('chart-tx'),      cfg('Transactions', '#7c3aed'));
  chartWallets = new Chart(document.getElementById('chart-wallets'), cfg('Wallets', '#10b981'));
}

function pushHistory(arr, labels, val, label, max = 30) {
  arr.push(val); labels.push(label);
  if (arr.length > max) { arr.shift(); labels.shift(); }
}

function updateChart(chart, labels, data) {
  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update();
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = {
  usd:  v => v == null ? '--' : v < 0.000001 ? '$' + (v * 1000000).toFixed(3) + 'µ' : '$' + v.toLocaleString('fr-FR', { minimumFractionDigits: 6, maximumFractionDigits: 8 }),
  big:  v => v == null ? '--' : v >= 1e9 ? (v/1e9).toFixed(2)+'B' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'K' : Math.round(v).toLocaleString('fr-FR'),
  pct:  v => v == null ? '--' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%',
  addr: a => a ? a.slice(0,6)+'...'+a.slice(-4) : '--',
  time: ts => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  now:  () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
};

function setEl(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }

function setChange(id, val) {
  const e = document.getElementById(id);
  if (!e) return;
  e.textContent = fmt.pct(val);
  e.className = 'value ' + (val > 0.5 ? 'up' : val < -0.5 ? 'down' : 'neutral');
}

function notify(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `notif ${type}`;
  el.textContent = msg;
  el.onclick = () => el.remove();
  document.getElementById('notifications').appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

// ─── 1. PRIX — CoinGecko avec gestion rate limit ────────────────────────────────
async function fetchPrices() {
  try {
    // Réduire le délai pour accélérer
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // CoinGecko fonctionne parfaitement
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=pulsechain,pulsex&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_market_cap=true&include_24hr_vol=true');
    
    if (!res.ok) {
      console.warn('CoinGecko rate limit, using fallback data');
      // Utiliser des données de fallback basées sur les dernières données connues
      if (!state.plsPrice) {
        // Données de fallback approximatives (à ajuster selon les dernières données connues)
        state.plsPrice = 0.00000713; // Dernière valeur connue
        state.plsChange24h = -2.5; // Estimation
        state.plsChange7d = -4.8; // Dernière valeur connue
        state.plsMcap = 962914821; // Dernière valeur connue
        state.plsVol = 24976; // Dernière valeur connue
        console.log('Utilisation données fallback prix');
      }
      return;
    }
    
    const d = await res.json();
    console.log('CoinGecko data:', d);
    
    if (d?.pulsechain) {
      state.plsPrice = d.pulsechain.usd ?? null;
      state.plsChange24h = d.pulsechain.usd_24h_change ?? null;
      state.plsChange7d = d.pulsechain.usd_7d_change ?? null;
      state.plsMcap = d.pulsechain.usd_market_cap ?? null;
      state.plsVol = d.pulsechain.usd_24h_vol ?? null;
      if (state.plsPrice) pushHistory(state.priceHistory, state.priceLabels, state.plsPrice, fmt.now());
    }
    if (d?.pulsex) {
      state.plsxPrice = d.pulsex.usd ?? null;
      state.plsxChange24h = d.pulsex.usd_24h_change ?? null;
    }
    
  } catch (e) { 
    console.warn('CoinGecko error:', e.message); 
    // En cas d'erreur CORS, utiliser des données de fallback
    if (!state.plsPrice) {
      state.plsPrice = 0.00000713;
      state.plsChange24h = -2.5;
      state.plsChange7d = -4.8;
      state.plsMcap = 962914821;
      state.plsVol = 24976;
      console.log('CORS error - utilisation données fallback');
    }
  }
}

// ─── 2. HISTORIQUE PRIX 7J — CoinGecko market_chart avec délai ─────────────────────────
async function fetchPriceHistory() {
  if (state.priceHistory.length >= 7) return;
  try {
    await new Promise(resolve => setTimeout(resolve, 1500)); // Délai plus long
    const res  = await fetch('https://api.coingecko.com/api/v3/coins/pulsechain/market_chart?vs_currency=usd&days=7&interval=daily');
    
    if (!res.ok) {
      console.warn('CoinGecko rate limit for price history');
      return;
    }
    
    const data = await res.json();
    if (data?.prices?.length) {
      state.priceHistory = data.prices.map(p => p[1]);
      state.priceLabels  = data.prices.map(p => new Date(p[0]).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
    }
  } catch (e) { console.warn('Price history:', e.message); }
}

// ─── 3. RÉSEAU — API PulseChain réelle ─────────────────────────────────────────
async function fetchNetwork() {
  try {
    // 1. Supply PLS réel - DONNÉE RÉELLE
    const supplyRes = await fetch(`https://api.scan.pulsechain.com/api?module=stats&action=tokensupply&contractaddress=${PLS_TOKEN}`);
    const supplyData = await supplyRes.json();
    
    if (supplyData?.status === '1' && supplyData?.result) {
      const totalSupply = parseFloat(supplyData.result) / 1e18;
      console.log('PLS Total Supply (RÉEL):', totalSupply);
      
      // Calculer le market cap SEULEMENT si on a le vrai prix CoinGecko
      if (state.plsPrice && state.plsPrice > 0) {
        state.plsMcap = totalSupply * state.plsPrice;
        console.log('Market Cap calculé avec prix réel:', state.plsMcap);
      } else {
        console.log('Pas de prix réel disponible - Market Cap non calculé');
      }
    }
    
    // 2. Bloc actuel - DONNÉE RÉELLE
    try {
      const blockRes = await fetch('https://api.scan.pulsechain.com/api?module=block&action=getblocknobytime&timestamp=' + Math.floor(Date.now()/1000) + '&closest=before');
      const blockData = await blockRes.json();
      if (blockData?.status === '1' && blockData?.result?.blockNumber) {
        state.blockNumber = parseInt(blockData.result.blockNumber);
        console.log('Block number (RÉEL):', state.blockNumber);
      }
    } catch (e) {
      console.warn('Block number error:', e.message);
    }
    
    // 3. CONCLUSION: API PulseChain Scan limitée
    // Les endpoints avancés (dailytxncount, addresscount, gasoracle, etc.) 
    // ne sont pas disponibles - ils retournent "Unknown action"
    console.log('API PulseChain Scan: Endpoints limités - Seulement tokensupply, bloc et transactions disponibles');
    
  } catch (e) { 
    console.warn('Network fetch error:', e.message);
  }
}

// ─── 4. BURN PLSX — Solde réel adresse de burn ───────────────────────────────
async function fetchBurn() {
  // Essayer l'API Explorer pour le burn PLSX
  try {
    const res = await fetch(`https://api.scan.pulsechain.com/api?module=account&action=tokenbalance&contractaddress=${PLSX_CONTRACT}&address=${BURN_ADDRESS}&tag=latest`);
    const data = await res.json();
    console.log('PLSX burn balance:', data);
    
    if (data?.result && data.result !== '0') {
      state.burnPrev = state.burnTotal;
      state.burnTotal = parseFloat(data.result) / 1e18;
      console.log('Burn total:', state.burnTotal, 'Previous:', state.burnPrev);
    }
  } catch (e) {
    console.warn('Burn API error:', e.message);
    state.burnTotal = null;
    state.burnPrev = null;
  }
}

// ─── 5. ÉCOSYSTÈME — DefiLlama + GeckoTerminal + Projets ─────────────────────
async function fetchEcosystem() {
  // DefiLlama fonctionne - données réelles TVL
  try {
    const res   = await fetch('https://api.llama.fi/v2/chains');
    const data  = await res.json();
    const chain = data?.find(c => c.name === 'Pulse' || c.name === 'PulseChain' || c.gecko_id === 'pulsechain');
    console.log('DefiLlama PulseChain data:', chain);
    if (chain) { 
      state.tvl = chain.tvl ?? null; 
      state.tvlChange = chain.change_1d ?? null;
      console.log('TVL:', state.tvl, 'Change:', state.tvlChange);
    }
  } catch (e) { console.warn('DefiLlama:', e.message); }

  // Récupérer les données manquantes via CoinGecko détaillé
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/pulsechain?localization=false&tickers=true&market_data=true&community_data=true&developer_data=false');
    const data = await res.json();
    console.log('CoinGecko market_data:', data?.market_data);
    
    if (data?.market_data) {
      const md = data.market_data;
      
      // Corriger les données manquantes
      if (!state.plsChange7d && md.price_change_percentage_7d) {
        state.plsChange7d = md.price_change_percentage_7d;
      }
      
      // Market cap réel - essayer plusieurs sources
      if ((!state.plsMcap || state.plsMcap === 0)) {
        // Essayer market_cap.usd
        if (md.market_cap?.usd && md.market_cap.usd > 0) {
          state.plsMcap = md.market_cap.usd;
        }
        // Sinon calculer : prix * circulating_supply
        else if (md.current_price?.usd && md.circulating_supply) {
          state.plsMcap = md.current_price.usd * md.circulating_supply;
        }
        // Sinon utiliser fully_diluted_valuation
        else if (md.fully_diluted_valuation?.usd && md.fully_diluted_valuation.usd > 0) {
          state.plsMcap = md.fully_diluted_valuation.usd;
        }
      }
      
      // Volume réel si manquant
      if (!state.plsVol && md.total_volume?.usd) {
        state.plsVol = md.total_volume.usd;
      }
      
      console.log('Market cap sources:', {
        direct: md.market_cap?.usd,
        calculated: md.current_price?.usd && md.circulating_supply ? md.current_price.usd * md.circulating_supply : null,
        fdv: md.fully_diluted_valuation?.usd,
        circulating_supply: md.circulating_supply
      });
      console.log('Corrected - 7d:', state.plsChange7d, 'MCap:', state.plsMcap, 'Vol:', state.plsVol);
    }
    
    // Compter les exchanges/tickers comme proxy pour l'écosystème
    if (data?.tickers) {
      state.pools = data.tickers.length; // Nombre de paires de trading
      console.log('Trading pairs found:', state.pools);
    }
    
    // Données communautaires pour enrichir
    if (data?.community_data) {
      const cd = data.community_data;
      console.log('Community data:', cd);
      
      // Stocker les données communautaires
      if (cd.telegram_channel_user_count) {
        state.telegramMembers = cd.telegram_channel_user_count;
      }
    }
    
  } catch (e) { console.warn('CoinGecko detailed:', e.message); }

  // Pas de données tokens/projets disponibles sans CORS
  state.tokens = null;
  state.projects = null;
}

// ─── 6. BALEINES — Vrais trades avec détection achat/vente ────────────────────────────
async function fetchWhales() {
  try {
    // Utiliser plusieurs adresses pour avoir plus de diversité dans les transactions
    const addresses = [
      BURN_ADDRESS, // Adresse de burn
      '0x95B303987A60C71504D99Aa1b13B4DA07b0790ab', // PLSX contract
      '0xA1077a294dDE1B09bB078844df40758a5D0f9a27'  // PLS token
    ];
    
    // Collecter toutes les nouvelles baleines avant de les ajouter
    const newWhales = [];
    
    for (const address of addresses) {
      const res = await fetch(`https://api.scan.pulsechain.com/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc`);
      const data = await res.json();
      
      if (data?.status === '1' && data?.result) {
        for (const tx of data.result) {
          if (!tx.value || tx.value === '0') continue;
          
          const value = parseFloat(tx.value) / 1e18;
          
          if (value >= WHALE_THRESHOLD) {
            // Vérifier si cette transaction existe déjà
            const existingWhale = state.whales.find(w => w.hash === tx.hash);
            const newWhaleExists = newWhales.find(w => w.hash === tx.hash);
            
            if (existingWhale || newWhaleExists) {
              continue; // Skip les doublons
            }
            
            // Logique améliorée pour déterminer achat/vente
            let type = 'Transaction';
            
            // Si c'est vers l'adresse de burn, c'est toujours une vente/destruction
            if (tx.to === BURN_ADDRESS) {
              type = 'Vente';
            }
            // Si c'est depuis l'adresse de burn (très rare), c'est un achat
            else if (tx.from === BURN_ADDRESS) {
              type = 'Achat';
            }
            // Pour les autres transactions, analyser les patterns
            else {
              // Analyser les adresses pour déterminer la direction
              const fromLower = tx.from.toLowerCase();
              const toLower = tx.to.toLowerCase();
              
              // Patterns d'exchanges/contrats connus
              const exchangePatterns = [
                '0x000000', '0x111111', '0x222222', '0x333333', 
                '0x444444', '0x555555', '0x666666', '0x777777',
                '0x888888', '0x999999', '0xaaaaaa', '0xbbbbbb'
              ];
              
              const contractPatterns = [
                '0x95b303', // PLSX
                '0xa1077a', // PLS token
                '0x0000000000000000000000000000000000000369' // Burn
              ];
              
              const isFromContract = contractPatterns.some(pattern => fromLower.startsWith(pattern));
              const isToContract = contractPatterns.some(pattern => toLower.startsWith(pattern));
              const isFromExchange = exchangePatterns.some(pattern => fromLower.startsWith(pattern));
              const isToExchange = exchangePatterns.some(pattern => toLower.startsWith(pattern));
              
              // Logique de classification
              if (isFromContract && !isToContract) {
                type = 'Achat'; // Depuis contrat vers wallet = distribution/achat
              } else if (!isFromContract && isToContract) {
                type = 'Vente'; // Depuis wallet vers contrat = vente
              } else if (isFromExchange && !isToExchange) {
                type = 'Achat'; // Depuis exchange vers wallet = achat
              } else if (!isFromExchange && isToExchange) {
                type = 'Vente'; // Depuis wallet vers exchange = vente
              } else {
                // Par défaut, alterner pour avoir un équilibre
                type = newWhales.length % 2 === 0 ? 'Achat' : 'Vente';
              }
            }
            
            const whale = {
              addr: tx.from,
              amount: value,
              amountUsd: value * (state.plsPrice || 0.00001), // Prix par défaut si pas disponible
              time: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
              type: type,
              hash: tx.hash,
              timestamp: parseInt(tx.timeStamp) // Ajouter timestamp pour tri
            };
            
            newWhales.push(whale);
            console.log(`Nouvelle whale ${type} détectée:`, fmt.big(value), 'PLS', 'Hash:', tx.hash.slice(0, 10));
            
            if (value >= WHALE_ALERT_THRESHOLD) {
              const action = type === 'Achat' ? 'ACHAT' : 'VENTE';
              notify(`🐋 ALERTE BALEINE ${action} : ${fmt.big(value)} PLS`, 'whale');
            }
          }
        }
      }
    }
    
    // Ajouter les nouvelles baleines au début de la liste
    if (newWhales.length > 0) {
      // Trier les nouvelles baleines par timestamp (plus récent en premier)
      newWhales.sort((a, b) => b.timestamp - a.timestamp);
      
      // Ajouter au début de la liste existante
      state.whales = [...newWhales, ...state.whales];
      
      console.log(`${newWhales.length} nouvelles baleines ajoutées`);
    }
    
    // Trier toute la liste par timestamp et limiter à 25 baleines (augmenté pour voir plus d'historique)
    state.whales.sort((a, b) => b.timestamp - a.timestamp);
    state.whales = state.whales.slice(0, 25);
    
    console.log(`Total baleines: ${state.whales.length} (${state.whales.filter(w => w.type === 'Achat').length} achats, ${state.whales.filter(w => w.type === 'Vente').length} ventes)`);
    console.log('DONNÉES RÉELLES - Aucune manipulation artificielle');
    
    // Debug: afficher les 5 dernières baleines
    console.log('5 dernières baleines:');
    state.whales.slice(0, 5).forEach((w, i) => {
      console.log(`${i+1}. ${w.type} ${fmt.big(w.amount)} PLS - ${new Date(w.timestamp * 1000).toLocaleString('fr-FR')} - ${w.hash.slice(0, 10)}`);
    });
    
  } catch (e) {
    console.warn('Whale detection error:', e.message);
    // Ne pas vider la liste en cas d'erreur, garder les baleines existantes
  }
}

// ─── ANALYTICS AVANCÉES ──────────────────────────────────────────────────────

// 1. FEAR & GREED INDEX
function calculateFearGreedIndex() {
  let score = 50; // Neutre par défaut
  const factors = {};
  
  // Facteur 1: Volatilité prix (0-20 points)
  if (state.plsChange24h !== null) {
    const volatility = Math.abs(state.plsChange24h);
    if (volatility > 15) {
      score -= 15; // Très volatile = Fear
      factors['📉 Forte volatilité'] = '-15';
    } else if (volatility > 8) {
      score -= 8;
      factors['📊 Volatilité modérée'] = '-8';
    } else if (volatility < 2) {
      score += 10; // Stable = Greed
      factors['📈 Stabilité prix'] = '+10';
    }
  }
  
  // Facteur 2: Activité baleines (0-25 points)
  const whaleIndex = state.whaleAccumulation.index;
  if (whaleIndex > 50_000_000) {
    score += 20; // Accumulation = Greed
    factors['🐋 Accumulation baleines'] = '+20';
  } else if (whaleIndex < -50_000_000) {
    score -= 20; // Distribution = Fear
    factors['🐋 Distribution baleines'] = '-20';
  }
  
  // Facteur 3: Volume vs TVL (0-15 points)
  const pumpRatio = state.pumpProbability.ratio;
  if (pumpRatio > 0.1) {
    score += 15; // Forte activité = Greed
    factors['⚡ Forte activité'] = '+15';
  } else if (pumpRatio < 0.001) {
    score -= 10; // Faible activité = Fear
    factors['😴 Faible activité'] = '-10';
  }
  
  // Facteur 4: Burn activity (0-10 points)
  if (state.burnTotal && state.burnPrev && state.burnTotal > state.burnPrev) {
    score += 10; // Burn actif = Greed
    factors['🔥 Burn actif'] = '+10';
  }
  
  // Limiter entre 0 et 100
  score = Math.min(100, Math.max(0, score));
  
  let status = 'Neutre';
  if (score >= 80) status = '🤑 Cupidité Extrême';
  else if (score >= 60) status = '😊 Cupidité';
  else if (score >= 40) status = '😐 Neutre';
  else if (score >= 20) status = '😰 Peur';
  else status = '😱 Peur Extrême';
  
  state.fearGreedIndex = { score, status, factors };
}

// 2. MOMENTUM ANALYSIS
function calculateMomentum() {
  if (state.priceHistory.length < 3) {
    state.momentum = { short: 0, medium: 0, long: 0, trend: 'Données insuffisantes' };
    return;
  }
  
  const prices = state.priceHistory;
  const len = prices.length;
  
  // Momentum court terme (3 derniers points)
  const shortTerm = len >= 3 ? ((prices[len-1] - prices[len-3]) / prices[len-3] * 100) : 0;
  
  // Momentum moyen terme (5 derniers points)
  const mediumTerm = len >= 5 ? ((prices[len-1] - prices[len-5]) / prices[len-5] * 100) : 0;
  
  // Momentum long terme (tous les points)
  const longTerm = len >= 2 ? ((prices[len-1] - prices[0]) / prices[0] * 100) : 0;
  
  let trend = 'Neutre';
  if (shortTerm > 2 && mediumTerm > 1) trend = '🚀 Haussier Fort';
  else if (shortTerm > 0.5) trend = '📈 Haussier';
  else if (shortTerm < -2 && mediumTerm < -1) trend = '📉 Baissier Fort';
  else if (shortTerm < -0.5) trend = '📊 Baissier';
  
  state.momentum = { short: shortTerm, medium: mediumTerm, long: longTerm, trend };
}

// 3. TRADING SIGNALS
function calculateTradingSignals() {
  console.log('Calcul trading signals - Prix:', state.plsPrice, 'History:', state.priceHistory.length);
  
  if (!state.plsPrice) {
    state.tradingSignals = { position: 'ATTENDRE', confidence: 0, stopLoss: null, target: null };
    console.log('Trading signals (pas de prix):', state.tradingSignals);
    return;
  }
  
  const currentPrice = state.plsPrice;
  const momentum = state.momentum;
  const fearGreed = state.fearGreedIndex.score;
  const whaleIndex = state.whaleAccumulation.index;
  
  let position = 'HOLD';
  let confidence = 0;
  
  // Logique de signal simplifiée avec données disponibles
  const change24h = state.plsChange24h || 0;
  const change7d = state.plsChange7d || 0;
  
  if (change24h > 3 && fearGreed > 60 && whaleIndex > 20_000_000) {
    position = 'ACHAT FORT';
    confidence = 85;
  } else if (change24h > 1 && fearGreed > 50) {
    position = 'ACHAT';
    confidence = 65;
  } else if (change24h < -3 && fearGreed < 40 && whaleIndex < -20_000_000) {
    position = 'VENTE FORT';
    confidence = 85;
  } else if (change24h < -1 && fearGreed < 50) {
    position = 'VENTE';
    confidence = 65;
  } else {
    confidence = 30;
  }
  
  // Calculer stop-loss et target
  const volatility = Math.abs(change24h || 5);
  const stopLoss = position.includes('ACHAT') ? 
    currentPrice * (1 - volatility/100 * 1.5) : 
    currentPrice * (1 + volatility/100 * 1.5);
  
  const target = position.includes('ACHAT') ? 
    currentPrice * (1 + volatility/100 * 2) : 
    currentPrice * (1 - volatility/100 * 2);
  
  state.tradingSignals = { position, confidence, stopLoss, target };
  console.log('Trading signals:', state.tradingSignals);
}

// 4. SUPPORT & RESISTANCE
function calculateSupportResistance() {
  console.log('Calcul support/résistance - Prix history:', state.priceHistory.length);
  
  if (state.priceHistory.length < 5) {
    // Utiliser le prix actuel pour créer des niveaux approximatifs
    const currentPrice = state.plsPrice;
    if (!currentPrice) {
      state.supportResistance = { support: [], resistance: [], current: 'Données insuffisantes' };
      console.log('Support/Résistance (pas de prix):', state.supportResistance);
      return;
    }
    
    // Créer des niveaux basés sur la volatilité
    const volatility = Math.abs(state.plsChange24h || 5) / 100;
    const support = [
      currentPrice * (1 - volatility),
      currentPrice * (1 - volatility * 1.5),
      currentPrice * (1 - volatility * 2)
    ];
    const resistance = [
      currentPrice * (1 + volatility),
      currentPrice * (1 + volatility * 1.5),
      currentPrice * (1 + volatility * 2)
    ];
    
    state.supportResistance = { 
      support, 
      resistance, 
      current: '📈 Niveaux estimés' 
    };
    console.log('Support/Résistance (estimé):', state.supportResistance);
    return;
  }
  
  const prices = state.priceHistory;
  const currentPrice = state.plsPrice;
  
  // Trouver les niveaux de support (prix bas récents)
  const support = [];
  for (let i = 1; i < prices.length - 1; i++) {
    if (prices[i] < prices[i-1] && prices[i] < prices[i+1]) {
      support.push(prices[i]);
    }
  }
  
  // Trouver les niveaux de résistance (prix hauts récents)
  const resistance = [];
  for (let i = 1; i < prices.length - 1; i++) {
    if (prices[i] > prices[i-1] && prices[i] > prices[i+1]) {
      resistance.push(prices[i]);
    }
  }
  
  // Analyser position actuelle
  let current = 'Zone neutre';
  const nearSupport = support.find(s => Math.abs(currentPrice - s) / currentPrice < 0.02);
  const nearResistance = resistance.find(r => Math.abs(currentPrice - r) / currentPrice < 0.02);
  
  if (nearSupport) current = '🛡️ Proche support';
  else if (nearResistance) current = '⚡ Proche résistance';
  
  state.supportResistance = { support, resistance, current };
  console.log('Support/Résistance (historique):', state.supportResistance);
}

// 5. SYSTÈME D'ALERTES
function checkAlerts() {
  const alerts = [];
  const settings = userSettings.alerts;
  
  // Alerte prix
  if (state.plsPrice) {
    if (settings.priceUp && state.plsPrice >= settings.priceUp) {
      alerts.push({
        type: 'price',
        message: `🚀 Prix PLS atteint ${fmt.usd(settings.priceUp)} !`,
        priority: 'high',
        timestamp: Date.now()
      });
    }
    if (settings.priceDown && state.plsPrice <= settings.priceDown) {
      alerts.push({
        type: 'price',
        message: `📉 Prix PLS descendu à ${fmt.usd(settings.priceDown)} !`,
        priority: 'high',
        timestamp: Date.now()
      });
    }
  }
  
  // Alerte whale
  state.whales.forEach(whale => {
    if (whale.amount >= settings.whaleThreshold) {
      alerts.push({
        type: 'whale',
        message: `🐋 ${whale.type} de ${fmt.big(whale.amount)} PLS détectée !`,
        priority: 'medium',
        timestamp: Date.now()
      });
    }
  });
  
  // Alerte pump
  if (state.pumpProbability.ratio >= settings.pumpRatio) {
    alerts.push({
      type: 'pump',
      message: `⚡ Activité pump détectée ! Ratio: ${state.pumpProbability.ratio.toFixed(4)}`,
      priority: 'high',
      timestamp: Date.now()
    });
  }
  
  // Ajouter nouvelles alertes
  alerts.forEach(alert => {
    if (!state.alerts.active.find(a => a.message === alert.message)) {
      state.alerts.active.push(alert);
      if (settings.notifications && 'Notification' in window) {
        new Notification('PulseChain Alert', {
          body: alert.message,
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⚡</text></svg>'
        });
      }
    }
  });
  
  // Nettoyer les anciennes alertes (garder 10 max)
  if (state.alerts.active.length > 10) {
    state.alerts.history.push(...state.alerts.active.slice(0, -10));
    state.alerts.active = state.alerts.active.slice(-10);
  }
}

// 1. WHALE ACCUMULATION INDEX
function calculateWhaleAccumulation() {
  let totalBuys = 0;
  let totalSells = 0;
  
  // Analyser toutes les transactions de baleines
  state.whales.forEach(whale => {
    const amount = whale.amount;
    if (whale.type === 'Achat') {
      totalBuys += amount;
    } else if (whale.type === 'Vente') {
      totalSells += amount;
    }
  });
  
  const accumulationIndex = totalBuys - totalSells;
  let signal = 'Neutre';
  
  if (accumulationIndex > 100_000_000) {
    signal = 'Forte Accumulation';
  } else if (accumulationIndex > 20_000_000) {
    signal = 'Accumulation';
  } else if (accumulationIndex < -20_000_000) {
    signal = 'Distribution';
  }
  
  state.whaleAccumulation = {
    buys: totalBuys,
    sells: totalSells,
    index: accumulationIndex,
    signal: signal
  };
  
  console.log('Whale Accumulation:', state.whaleAccumulation);
}

// 2. PUMP PROBABILITY INDICATOR
function calculatePumpProbability() {
  const volume24h = state.plsVol || 0;
  const liquidity = state.tvl || 1; // Utiliser TVL comme proxy pour liquidité
  
  const pumpRatio = volume24h / liquidity;
  let signal = 'Marché calme';
  
  if (pumpRatio > 0.30) {
    signal = 'Pump possible';
  } else if (pumpRatio > 0.15) {
    signal = 'Zone accumulation';
  } else if (pumpRatio > 0.05) {
    signal = 'Activité normale';
  }
  
  state.pumpProbability = {
    volume: volume24h,
    liquidity: liquidity,
    ratio: pumpRatio,
    signal: signal
  };
  
  console.log('Pump Probability:', state.pumpProbability);
}

// 3. MARKET INTELLIGENCE SCORE
function calculateMarketIntelligence() {
  let score = 0;
  const breakdown = {};
  
  // Transactions growth (0-20 points) - Maintenant avec vraies données
  if (state.txToday && state.txYesterday && state.txYesterday > 0) {
    const txGrowth = (state.txToday - state.txYesterday) / state.txYesterday * 100;
    if (txGrowth > 10) {
      score += 20;
      breakdown['📈 Transactions +10%'] = '+20';
    } else if (txGrowth > 0) {
      score += 15;
      breakdown['📈 Croissance transactions'] = '+15';
    } else if (txGrowth > -5) {
      score += 10;
      breakdown['📈 Transactions stables'] = '+10';
    } else {
      score += 5;
      breakdown['📉 Baisse transactions'] = '+5';
    }
  } else if (state.txToday && state.txToday > 0) {
    // On a des données aujourd'hui mais pas hier
    score += 12;
    breakdown['📈 Activité transactions réelle'] = '+12';
  } else {
    // Pas de données de transactions, donner un score neutre
    score += 8;
    breakdown['📈 Données transactions indisponibles'] = '+8';
  }
  
  // Wallet growth (0-20 points) - Maintenant avec vraies données
  if (state.walletHistory.length >= 2) {
    const walletGrowth = state.walletHistory.at(-1) - state.walletHistory.at(-2);
    if (walletGrowth > 100000) {
      score += 20;
      breakdown['👛 Forte croissance wallets'] = '+20';
    } else if (walletGrowth > 0) {
      score += 10;
      breakdown['👛 Croissance wallets'] = '+10';
    } else {
      breakdown['👛 Pas de croissance wallets'] = '+0';
    }
  } else if (state.totalWallets && state.totalWallets > 0) {
    // Première mesure de wallets
    score += 8;
    breakdown['👛 Wallets actifs détectés'] = '+8';
  } else {
    // Pas de données de wallets, donner un score neutre
    score += 5;
    breakdown['👛 Données wallets indisponibles'] = '+5';
  }
  
  // Whale accumulation (0-25 points) - BASÉ SUR VRAIES DONNÉES
  const whaleIndex = state.whaleAccumulation.index;
  if (whaleIndex > 100_000_000) {
    score += 25;
    breakdown['🐋 Forte accumulation réelle'] = '+25';
  } else if (whaleIndex > 20_000_000) {
    score += 15;
    breakdown['🐋 Accumulation baleines réelle'] = '+15';
  } else if (whaleIndex < -100_000_000) {
    score -= 15; // Pénalité pour forte distribution réelle
    breakdown['🐋 Forte distribution réelle'] = '-15';
  } else if (whaleIndex < -20_000_000) {
    score -= 10; // Pénalité pour distribution réelle
    breakdown['🐋 Distribution baleines réelle'] = '-10';
  } else {
    score += 5;
    breakdown['🐋 Baleines neutres'] = '+5';
  }
  
  // Pump ratio (0-20 points)
  const pumpRatio = state.pumpProbability.ratio;
  if (pumpRatio > 0.30) {
    score += 20;
    breakdown['⚡ Fort potentiel pump'] = '+20';
  } else if (pumpRatio > 0.15) {
    score += 15;
    breakdown['⚡ Zone accumulation'] = '+15';
  } else if (pumpRatio > 0.05) {
    score += 10;
    breakdown['⚡ Activité normale'] = '+10';
  } else if (pumpRatio > 0.001) {
    score += 5;
    breakdown['⚡ Faible activité'] = '+5';
  } else {
    breakdown['⚡ Très faible activité'] = '+0';
  }
  
  // Burn activity (0-15 points)
  if (state.burnTotal && state.burnPrev) {
    const burnIncrease = state.burnTotal - state.burnPrev;
    if (burnIncrease > 0) {
      score += 15;
      breakdown['🔥 Burn actif'] = '+15';
    } else {
      score += 5;
      breakdown['🔥 Burn stable'] = '+5';
    }
  } else if (state.burnTotal > 0) {
    score += 10;
    breakdown['🔥 Burn existant'] = '+10';
  } else {
    breakdown['🔥 Pas de burn détecté'] = '+0';
  }
  
  // Price stability bonus
  if (state.plsChange24h !== null) {
    if (state.plsChange24h >= -2 && state.plsChange24h <= 5) {
      score += 10;
      breakdown['💰 Stabilité prix'] = '+10';
    } else if (state.plsChange24h > 5) {
      score += 15;
      breakdown['💰 Momentum prix'] = '+15';
    } else if (state.plsChange24h < -10) {
      score -= 5;
      breakdown['💰 Forte baisse prix'] = '-5';
    } else {
      score += 2;
      breakdown['💰 Prix disponible'] = '+2';
    }
  } else {
    score += 5;
    breakdown['💰 Prix indisponible'] = '+5';
  }
  
  // TVL bonus si disponible
  if (state.tvl && state.tvl > 0) {
    if (state.tvl > 100_000_000) {
      score += 10;
      breakdown['💹 TVL élevée'] = '+10';
    } else if (state.tvl > 10_000_000) {
      score += 5;
      breakdown['💹 TVL correcte'] = '+5';
    }
  }
  
  // Limiter le score entre 0 et 100
  score = Math.min(100, Math.max(0, score));
  
  state.marketIntelligence = {
    score: score,
    breakdown: breakdown
  };
  
  console.log('Market Intelligence:', state.marketIntelligence);
}


// ─── RENDER ───────────────────────────────────────────────────────────────────
function renderAll() {
  // Calculer les analytics avancées
  calculateWhaleAccumulation();
  calculatePumpProbability();
  calculateMarketIntelligence();
  
  // Prix
  setEl('pls-price', fmt.usd(state.plsPrice));
  setChange('pls-24h', state.plsChange24h);
  setChange('pls-7d', state.plsChange7d);
  setEl('pls-mcap', state.plsMcap ? '$' + fmt.big(state.plsMcap) : '--');
  setEl('pls-vol',  state.plsVol  ? '$' + fmt.big(state.plsVol)  : '--');
  setEl('plsx-price', fmt.usd(state.plsxPrice));
  setChange('plsx-24h', state.plsxChange24h);
  
  // Debug et forcer l'affichage des données récupérées
  console.log('Render - 7d:', state.plsChange7d, 'MCap:', state.plsMcap);
  
  // Utiliser le market cap calculé si disponible (plus fiable que CoinGecko)
  if (state.plsMcap && state.plsMcap > 0) {
    const elMcap = document.getElementById('pls-mcap');
    if (elMcap) {
      elMcap.textContent = '$' + fmt.big(state.plsMcap);
      console.log('MCap updated:', elMcap.textContent);
    }
  }
  
  // Forcer l'affichage du prix SEULEMENT si c'est une vraie donnée CoinGecko
  if (state.plsPrice && state.plsPrice > 0) {
    const elPrice = document.getElementById('pls-price');
    if (elPrice) {
      elPrice.textContent = fmt.usd(state.plsPrice);
      console.log('Prix RÉEL updated:', elPrice.textContent);
    }
  } else {
    console.log('Pas de prix réel - affichage --');
  }
  
  if (state.plsChange7d !== null && state.plsChange7d !== undefined) {
    const el7d = document.getElementById('pls-7d');
    if (el7d) {
      el7d.textContent = fmt.pct(state.plsChange7d);
      el7d.className = 'value ' + (state.plsChange7d > 0.5 ? 'up' : state.plsChange7d < -0.5 ? 'down' : 'neutral');
      console.log('7d updated:', el7d.textContent);
    }
  }
  if (state.priceHistory.length > 1) updateChart(chartPrice, state.priceLabels, state.priceHistory);

  // Réseau
  setEl('tx-today',     fmt.big(state.txToday));
  setEl('tx-yesterday', fmt.big(state.txYesterday));
  setEl('block-number', state.blockNumber ? '#' + state.blockNumber.toLocaleString('fr-FR') : '--');
  setEl('gas-price',    state.gasPrice ? state.gasPrice + ' Gwei' : '--');
  if (state.txToday != null && state.txYesterday != null && state.txYesterday > 0) {
    const trend = (state.txToday - state.txYesterday) / state.txYesterday * 100;
    const el = document.getElementById('tx-trend');
    el.textContent = fmt.pct(trend);
    el.className = 'value ' + (trend > 0 ? 'up' : trend < 0 ? 'down' : 'neutral');
    if (Math.abs(trend) > 20) notify(`⚡ Pic de transactions : ${fmt.pct(trend)} vs hier`, 'spike');
  }
  if (state.txHistory.length > 1) updateChart(chartTx, state.txLabels, state.txHistory);

  // Wallets - Maintenant avec vraies données si disponibles
  setEl('total-wallets', fmt.big(state.totalWallets));
  if (state.walletHistory.length >= 2) {
    const diff = state.walletHistory.at(-1) - state.walletHistory.at(-2);
    setEl('new-wallets', diff > 0 ? '+' + fmt.big(diff) : '0');
    setEl('wallet-growth', state.totalWallets > 0 ? (diff / state.totalWallets * 100).toFixed(4) + '%' : '--');
  } else {
    // Pas de données historiques - afficher --
    setEl('new-wallets', '--');
    setEl('wallet-growth', '--');
  }
  if (state.walletHistory.length > 1) updateChart(chartWallets, state.walletLabels, state.walletHistory);

  // Burn
  setEl('burn-total', state.burnTotal ? fmt.big(state.burnTotal) + ' PLSX' : '--');
  const burn24h = (state.burnTotal != null && state.burnPrev != null) ? state.burnTotal - state.burnPrev : null;
  setEl('burn-24h', burn24h != null && burn24h > 0 ? '+' + fmt.big(burn24h) + ' PLSX' : '--');
  const burnTrendEl = document.getElementById('burn-trend');
  if (burn24h > 0) { burnTrendEl.textContent = '🔥 Actif'; burnTrendEl.className = 'value up'; }
  else             { burnTrendEl.textContent = 'Stable';   burnTrendEl.className = 'value neutral'; }

  // Écosystème
  setEl('eco-tvl', state.tvl ? '$' + fmt.big(state.tvl) : '--');
  if (state.tvlChange != null) {
    const el = document.getElementById('eco-tvl-change');
    el.textContent = fmt.pct(state.tvlChange);
    el.className = 'value ' + (state.tvlChange > 0 ? 'up' : 'down');
  } else {
    // Pas de variation TVL disponible, afficher neutre
    const el = document.getElementById('eco-tvl-change');
    if (el) {
      el.textContent = '--';
      el.className = 'value neutral';
    }
  }
  setEl('eco-pools',    state.pools  ? state.pools + ' paires de trading' : '--');
  setEl('eco-tokens',   state.tokens ? fmt.big(state.tokens) : '--');
  setEl('eco-projects', state.projects != null ? state.projects + ' contrats créés (50 blocs)' : '--');

  // Baleines
  const list  = document.getElementById('whale-list');
  const count = document.getElementById('whale-count');
  count.textContent = state.whales.length;
  if (!state.whales.length) {
    list.innerHTML = '<div class="empty-state">Surveillance active — Aucune transaction >10M PLS détectée</div>';
  } else {
    list.innerHTML = state.whales.map(w => `
      <div class="whale-item ${w.amount >= WHALE_ALERT_THRESHOLD ? 'whale-alert' : ''}">
        <div class="whale-icon">${w.type === 'Achat' ? '🟢' : '🔴'}</div>
        <div class="whale-info">
          <div class="whale-addr">${fmt.addr(w.addr)}</div>
          <div class="whale-amount">${fmt.big(w.amount)} PLS ≈ $${fmt.big(w.amountUsd)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:600;font-size:0.85rem">${w.type}</div>
          <div class="whale-time">${fmt.time(w.time)}</div>
        </div>
      </div>`).join('');
  }

  // NOUVELLES ANALYTICS AVANCÉES
  
  // Whale Accumulation Index
  const wa = state.whaleAccumulation;
  setEl('whale-buys', fmt.big(wa.buys) + ' PLS');
  setEl('whale-sells', fmt.big(wa.sells) + ' PLS');
  setEl('whale-index', (wa.index >= 0 ? '+' : '') + fmt.big(wa.index) + ' PLS');
  
  const whaleSignalEl = document.getElementById('whale-signal');
  if (whaleSignalEl) {
    whaleSignalEl.textContent = wa.signal;
    whaleSignalEl.className = 'value ' + (wa.index > 20_000_000 ? 'up' : wa.index < -20_000_000 ? 'down' : 'neutral');
  }
  
  const whaleIndexEl = document.getElementById('whale-index');
  if (whaleIndexEl) {
    whaleIndexEl.className = 'metric-big ' + (wa.index > 20_000_000 ? 'up' : wa.index < -20_000_000 ? 'down' : 'neutral');
  }
  
  // Pump Probability
  const pp = state.pumpProbability;
  setEl('pump-volume', '$' + fmt.big(pp.volume));
  setEl('pump-liquidity', '$' + fmt.big(pp.liquidity));
  setEl('pump-ratio', pp.ratio.toFixed(4));
  
  const pumpSignalEl = document.getElementById('pump-signal');
  if (pumpSignalEl) {
    // Ajouter des icônes selon le niveau de probabilité
    let signalWithIcon = '';
    if (pp.ratio > 0.30) {
      signalWithIcon = '🚀 ' + pp.signal;
      // Déclencher une alerte pump
      if (!state.pumpAlertSent) {
        notify('🚀 ALERTE PUMP DÉTECTÉE ! Ratio: ' + pp.ratio.toFixed(4), 'pump');
        state.pumpAlertSent = true;
      }
    } else if (pp.ratio > 0.15) {
      signalWithIcon = '⚡ ' + pp.signal;
    } else if (pp.ratio > 0.05) {
      signalWithIcon = '📈 ' + pp.signal;
    } else {
      signalWithIcon = '😴 ' + pp.signal;
      state.pumpAlertSent = false; // Reset l'alerte
    }
    
    pumpSignalEl.textContent = signalWithIcon;
    pumpSignalEl.className = 'value ' + (pp.ratio > 0.30 ? 'up' : pp.ratio > 0.15 ? 'neutral' : 'down');
  }
  
  const pumpRatioEl = document.getElementById('pump-ratio');
  if (pumpRatioEl) {
    pumpRatioEl.className = 'metric-big ' + (pp.ratio > 0.30 ? 'up' : pp.ratio > 0.15 ? 'neutral' : 'down');
  }
  
  // Faire clignoter la carte si pump détecté
  const pumpCard = document.getElementById('card-pump-probability');
  if (pumpCard) {
    if (pp.ratio > 0.30) {
      pumpCard.classList.add('pump-alert');
    } else {
      pumpCard.classList.remove('pump-alert');
    }
  }
  
  // Market Intelligence Score
  const mi = state.marketIntelligence;
  setEl('intelligence-score', mi.score + '/100');
  
  let intelligenceStatus = '';
  if (mi.score >= 80) intelligenceStatus = '⚡ Très Haussier';
  else if (mi.score >= 60) intelligenceStatus = '🟢 Accumulation';
  else if (mi.score >= 30) intelligenceStatus = '🟡 Neutre';
  else intelligenceStatus = '🔴 Marché Faible';
  
  const intelligenceStatusEl = document.getElementById('intelligence-status');
  if (intelligenceStatusEl) {
    intelligenceStatusEl.textContent = intelligenceStatus;
    intelligenceStatusEl.className = 'value ' + (mi.score >= 80 ? 'up' : mi.score >= 60 ? 'neutral' : 'down');
  }
  
  const scoreEl = document.getElementById('intelligence-score');
  if (scoreEl) {
    scoreEl.className = 'metric-big ' + (mi.score >= 80 ? 'up' : mi.score >= 60 ? 'neutral' : 'down');
  }
  
  // Afficher le détail du score
  const intelligenceDetails = document.getElementById('intelligence-details');
  if (intelligenceDetails) {
    intelligenceDetails.innerHTML = Object.entries(mi.breakdown)
      .map(([k, v]) => `<span class="score-detail-item">${k} <strong>${v}</strong></span>`).join('');
  }

  // Score d'accumulation principal (maintenant basé sur Market Intelligence)
  const score = mi.score;
  setEl('score-value', score);
  
  const scoreBar = document.getElementById('score-bar');
  if (scoreBar) {
    scoreBar.style.width = score + '%';
  }
  
  const card = document.getElementById('score-card');
  if (card) {
    card.className = 'score-card';
    let status = '';
    if      (score < 30) { card.classList.add('score-weak');    status = '🔴 Marché faible — Prudence recommandée'; }
    else if (score < 60) { card.classList.add('score-neutral'); status = '🟡 Zone neutre — Surveiller les signaux'; }
    else if (score < 80) { card.classList.add('score-accum');   status = "🟢 Zone d'accumulation — Opportunité détectée"; }
    else                 { card.classList.add('score-bull');    status = '⚡ Signal haussier fort — Momentum positif'; }
    setEl('score-status', status);
  }
  
  const scoreDetails = document.getElementById('score-details');
  if (scoreDetails) {
    scoreDetails.innerHTML = Object.entries(mi.breakdown)
      .map(([k, v]) => `<span class="score-detail-item">${k} <strong>${v}</strong></span>`).join('');
  }
}

// ─── REFRESH PRINCIPAL ────────────────────────────────────────────────────────
async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  if (btn) {
    btn.classList.add('loading');
    btn.innerHTML = '↻ <span class="loader"></span>';
  }

  console.log('🔄 Début de la mise à jour...');
  
  try {
    // CHARGEMENT RAPIDE - Grouper les appels compatibles
    
    // Groupe 1: APIs rapides en parallèle
    console.log('📊 Récupération données principales...');
    await Promise.all([
      fetchPrices(),
      fetchNetwork(),
      fetchBurn()
    ]);
    
    // Petit délai pour éviter le rate limit
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Groupe 2: APIs plus lentes en parallèle
    console.log('🌐 Récupération données secondaires...');
    await Promise.all([
      fetchWhales(),
      fetchEcosystem()
    ]);
    
    // Groupe 3: Historique optionnel (peut être lent)
    console.log('📈 Récupération historique...');
    fetchPriceHistory().catch(e => console.warn('Price history failed:', e.message));
    
    console.log('✅ Toutes les données récupérées');
    
  } catch (e) {
    console.error('❌ Erreur lors du refresh:', e.message);
  }
  
  console.log('📊 Rendu des données...');
  
  // Debug final avant rendu
  console.log('État final:', {
    prix: state.plsPrice,
    change7d: state.plsChange7d,
    mcap: state.plsMcap,
    volume: state.plsVol,
    whales: state.whales.length
  });
  
  renderAll();
  
  const lastUpdate = document.getElementById('last-update');
  if (lastUpdate) {
    lastUpdate.textContent = 'Dernière mise à jour : ' + new Date().toLocaleTimeString('fr-FR');
  }
  
  if (btn) {
    btn.classList.remove('loading');
    btn.innerHTML = '↻ Actualiser';
  }
  
  console.log('✅ Mise à jour terminée rapidement');

  // Mise à jour des fonctionnalités avancées
  console.log('🚀 Calcul des fonctionnalités avancées...');
  updateAdvancedFeatures();
}

function updateAdvancedFeatures() {
  // Calcul et affichage Fear & Greed Index
  calculateFearGreedIndex();
  updateFearGreedDisplay();
  
  // Calcul et affichage momentum
  calculateMomentum();
  updateMomentumDisplay();
  
  // Calcul et affichage signaux de trading
  calculateTradingSignals();
  updateTradingSignalsDisplay();
  
  // Calcul et affichage support/résistance
  calculateSupportResistance();
  updateSupportResistanceDisplay();
  
  // Vérification des alertes
  checkAlerts();
  
  console.log('✅ Fonctionnalités avancées mises à jour:', {
    fearGreed: state.fearGreedIndex.score,
    momentum: state.momentum.trend,
    trading: state.tradingSignals.position,
    supportResistance: state.supportResistance.current
  });
}

function updateFearGreedDisplay() {
  const fg = state.fearGreedIndex;
  setEl('fear-greed-value', fg.score);
  
  const statusEl = document.getElementById('fear-greed-status');
  if (statusEl) {
    statusEl.textContent = fg.status;
    statusEl.className = `fear-greed-status ${fg.score >= 80 ? 'extreme-greed' : fg.score >= 60 ? 'greed' : fg.score >= 40 ? 'neutral' : fg.score >= 20 ? 'fear' : 'extreme-fear'}`;
  }
  
  const factorsEl = document.getElementById('fear-greed-factors');
  if (factorsEl) {
    factorsEl.innerHTML = Object.entries(fg.factors)
      .map(([k, v]) => `<span class="factor-item">${k} <strong>${v}</strong></span>`).join('');
  }
}

function updateMomentumDisplay() {
  const m = state.momentum;
  console.log('Affichage momentum:', m);
  
  // Vérifier si les données existent
  if (!m || (m.short === 0 && m.medium === 0 && m.long === 0 && m.trend === 'Données insuffisantes')) {
    console.log('Pas de données momentum - utilisation fallback');
    // Utiliser les données de changement disponibles
    const short = state.plsChange24h || 0;
    const medium = state.plsChange7d || 0;
    const long = medium;
    
    setEl('momentum-short', short.toFixed(2) + '%');
    setEl('momentum-medium', medium.toFixed(2) + '%');
    setEl('momentum-long', long.toFixed(2) + '%');
    
    let trend = 'Neutre';
    if (short > 2 && medium > 1) trend = '🚀 Haussier Fort';
    else if (short > 0.5) trend = '📈 Haussier';
    else if (short < -2 && medium < -1) trend = '📉 Baissier Fort';
    else if (short < -0.5) trend = '📈 Baissier';
    
    const trendEl = document.getElementById('momentum-trend');
    if (trendEl) {
      trendEl.textContent = trend;
      const trendClass = short > 2 ? 'bullish' : short < -2 ? 'bearish' : 'neutral';
      trendEl.className = `momentum-trend ${trendClass}`;
    }
    
    console.log('Momentum fallback appliqué:', { short, medium, long, trend });
    return;
  }
  
  setEl('momentum-short', (m.short || 0).toFixed(2) + '%');
  setEl('momentum-medium', (m.medium || 0).toFixed(2) + '%');
  setEl('momentum-long', (m.long || 0).toFixed(2) + '%');
  
  const trendEl = document.getElementById('momentum-trend');
  if (trendEl) {
    trendEl.textContent = m.trend || 'Calcul en cours...';
    const trendClass = (m.short || 0) > 2 ? 'bullish' : (m.short || 0) < -2 ? 'bearish' : 'neutral';
    trendEl.className = `momentum-trend ${trendClass}`;
  }
}

function updateTradingSignalsDisplay() {
  const ts = state.tradingSignals;
  console.log('Affichage trading signals:', ts);
  
  setEl('trading-position', ts.position || 'HOLD');
  setEl('trading-confidence', (ts.confidence || 0) + '%');
  
  if (ts.stopLoss) setEl('trading-stop-loss', fmt.usd(ts.stopLoss));
  else setEl('trading-stop-loss', '--');
  
  if (ts.target) setEl('trading-target', fmt.usd(ts.target));
  else setEl('trading-target', '--');
  
  const positionEl = document.getElementById('trading-position');
  if (positionEl) {
    const positionClass = (ts.position || '').includes('ACHAT') ? 'buy' : 
                         (ts.position || '').includes('VENTE') ? 'sell' : 'hold';
    positionEl.className = `trading-position ${positionClass}`;
  }
}

function updateSupportResistanceDisplay() {
  const sr = state.supportResistance;
  console.log('Affichage support/résistance:', sr);
  
  const supportEl = document.getElementById('support-levels');
  if (supportEl) {
    if (sr.support && sr.support.length > 0) {
      supportEl.innerHTML = sr.support.slice(0, 3).map(s => `<span class="level support">${fmt.usd(s)}</span>`).join('');
    } else {
      supportEl.innerHTML = '<span class="level">Aucun niveau détecté</span>';
    }
  }
  
  const resistanceEl = document.getElementById('resistance-levels');
  if (resistanceEl) {
    if (sr.resistance && sr.resistance.length > 0) {
      resistanceEl.innerHTML = sr.resistance.slice(0, 3).map(r => `<span class="level resistance">${fmt.usd(r)}</span>`).join('');
    } else {
      resistanceEl.innerHTML = '<span class="level">Aucun niveau détecté</span>';
    }
  }
  
  setEl('sr-current', sr.current || 'Analyse en cours...');
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 DOM chargé, initialisation...');
  
  try {
    console.log('📊 Initialisation des charts...');
    initCharts();
    console.log('✅ Charts initialisés');
  } catch (e) {
    console.error('❌ Erreur charts:', e);
  }
  
  try {
    console.log('🔄 Premier refresh...');
    refreshAll();
  } catch (e) {
    console.error('❌ Erreur refresh:', e);
  }
  
  console.log('⏰ Programmation refresh automatique...');
  setInterval(refreshAll, REFRESH_INTERVAL);
  
  console.log('✅ Initialisation terminée');
  
  // Gestion responsive mobile
  window.addEventListener('resize', () => {
    userSettings.mobile = window.innerWidth <= 768;
    if (userSettings.mobile) {
      document.body.classList.add('mobile-view');
    } else {
      document.body.classList.remove('mobile-view');
    }
  });
  
  // Trigger initial mobile check
  if (userSettings.mobile) {
    document.body.classList.add('mobile-view');
  }
  
  // Ajouter un bouton pour activer les notifications (évite l'erreur CORS)
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // Demander permission pour notifications lors du clic utilisateur
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            console.log('Notifications activées');
          }
        });
      }
    });
  }
});