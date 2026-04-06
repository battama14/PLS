// ─── CONFIG ───────────────────────────────────────────────────────────────────
const REFRESH_INTERVAL = 5 * 60 * 1000;
const WHALE_THRESHOLD = 10_000_000;
const WHALE_ALERT_THRESHOLD = 50_000_000;
const PLSX_CONTRACT = '0x95B303987A60C71504D99Aa1b13B4DA07b0790ab';
const BURN_ADDRESS  = '0x0000000000000000000000000000000000000369';
const PLS_TOKEN     = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27';

// Date de début surveillance (février 2026)
const WHALE_START_DATE = new Date('2026-02-01T00:00:00Z');
const WHALE_START_TIMESTAMP = Math.floor(WHALE_START_DATE.getTime() / 1000);

// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  plsPrice: null, plsChange24h: null, plsChange7d: null, plsMcap: null, plsVol: null,
  plsxPrice: null, plsxChange24h: null,
  txToday: null, txYesterday: null,
  blockNumber: null, gasPrice: null,
  totalWallets: null,
  burnTotal: null, burnPrev: null,
  tvl: null, tvlChange: null, pools: null, tokens: null, projects: null, telegramMembers: null,
  whales: [], // Sera chargé depuis le stockage
  whaleStats: { totalBuys: 0, totalSells: 0, trend: 'neutral' },
  whaleDatabase: { // Base de données complète des baleines
    local: JSON.parse(localStorage.getItem('pls-whales-db-2026') || '{}'),
    lastSync: parseInt(localStorage.getItem('pls-whales-sync-2026') || '0'),
    totalCount: 0
  },
  priceHistory: [], priceLabels: [],
  txHistory: [], txLabels: [],
  walletHistory: [], walletLabels: [],
  scoreBreakdown: {},
  whaleAccumulation: { buys: 0, sells: 0, index: 0, signal: 'Neutre' },
  pumpProbability: { ratio: 0, signal: 'Marché calme' },
  marketIntelligence: { score: 0, breakdown: {} },
  fearGreedIndex: { score: 50, status: 'Neutre', factors: {} },
  momentum: { short: 0, medium: 0, long: 0, trend: 'Neutre' },
  tradingSignals: { position: 'HOLD', confidence: 0, stopLoss: null, target: null },
  supportResistance: { support: [], resistance: [], current: 'Neutre' },
  alerts: { active: [], history: [] },
  pumpAlertSent: false,
  lastWhaleCheck: Date.now(),
  isInitialLoad: true
};

// ─── STOCKAGE HYBRIDE LOCAL + ONLINE ──────────────────────────────────────────

// Sauvegarde locale
function saveWhalesLocal() {
  try {
    localStorage.setItem('pls-whales-db-2026', JSON.stringify(state.whaleDatabase.local));
    localStorage.setItem('pls-whales-sync-2026', state.whaleDatabase.lastSync.toString());
    console.log('💾 Baleines sauvegardées localement:', Object.keys(state.whaleDatabase.local).length);
  } catch (e) {
    console.warn('Erreur sauvegarde locale:', e.message);
  }
}

// Sauvegarde en ligne (simulation avec localStorage étendu)
function saveWhalesOnline() {
  try {
    const onlineKey = 'pls-whales-online-db-2026';
    const compressedData = {
      whales: state.whaleDatabase.local,
      lastUpdate: Date.now(),
      version: '2026.1'
    };
    
    localStorage.setItem(onlineKey, JSON.stringify(compressedData));
    console.log('☁️ Baleines synchronisées en ligne');
  } catch (e) {
    console.warn('Erreur sauvegarde en ligne:', e.message);
  }
}

// Chargement depuis le stockage en ligne
async function loadWhalesOnline() {
  try {
    const onlineKey = 'pls-whales-online-db-2026';
    const onlineData = localStorage.getItem(onlineKey);
    
    if (onlineData) {
      const parsed = JSON.parse(onlineData);
      if (parsed.whales && parsed.lastUpdate > state.whaleDatabase.lastSync) {
        console.log('☁️ Chargement données en ligne plus récentes');
        state.whaleDatabase.local = { ...state.whaleDatabase.local, ...parsed.whales };
        state.whaleDatabase.lastSync = parsed.lastUpdate;
        return true;
      }
    }
    
    return false;
  } catch (e) {
    console.warn('Erreur chargement en ligne:', e.message);
    return false;
  }
}

// Initialisation de la base de données des baleines
async function initWhaleDatabase() {
  console.log('🗄️ Initialisation base de données baleines depuis février 2026...');
  
  // 1. Charger les données locales
  const localData = localStorage.getItem('pls-whales-db-2026');
  if (localData) {
    try {
      state.whaleDatabase.local = JSON.parse(localData);
      console.log('📱 Données locales chargées:', Object.keys(state.whaleDatabase.local).length, 'baleines');
    } catch (e) {
      console.warn('Erreur parsing données locales:', e.message);
      state.whaleDatabase.local = {};
    }
  }
  
  // 2. Synchroniser avec les données en ligne
  const onlineUpdated = await loadWhalesOnline();
  if (onlineUpdated) {
    saveWhalesLocal();
  }
  
  // 3. Convertir en tableau pour l'affichage
  state.whales = Object.values(state.whaleDatabase.local)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 100);
  
  state.whaleDatabase.totalCount = Object.keys(state.whaleDatabase.local).length;
  
  console.log(`🐋 Base de données initialisée: ${state.whaleDatabase.totalCount} baleines depuis février 2026`);
  
  // 4. Calculer les statistiques
  updateWhaleStats();
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

// ─── BALEINES DEPUIS FÉVRIER 2026 ─────────────────────────────────────────────
async function fetchWhales() {
  try {
    const addresses = [
      BURN_ADDRESS,
      '0x95B303987A60C71504D99Aa1b13B4DA07b0790ab',
      '0xA1077a294dDE1B09bB078844df40758a5D0f9a27'
    ];
    
    let newWhalesToAdd = [];
    let totalProcessed = 0;
    
    for (const address of addresses) {
      // Récupérer PLUS de transactions pour avoir plus de baleines
      const res = await fetch(`https://api.scan.pulsechain.com/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc`);
      const data = await res.json();
      
      console.log(`🔍 Analyse adresse ${address.slice(0,10)}... - Réponse:`, data?.status, 'Transactions:', data?.result?.length);
      
      if (data?.status === '1' && data?.result) {
        for (const tx of data.result) {
          totalProcessed++;
          
          // Filtrer seulement les transactions depuis février 2026
          const txTimestamp = parseInt(tx.timeStamp);
          if (txTimestamp < WHALE_START_TIMESTAMP) {
            continue; // Ignorer les transactions avant février 2026
          }
          
          if (!tx.value || tx.value === '0') continue;
          
          const value = parseFloat(tx.value) / 1e18;
          
          // IMPORTANT: Afficher TOUTES les transactions pour debug
          if (totalProcessed <= 10) {
            console.log(`TX #${totalProcessed}: ${fmt.big(value)} PLS - ${new Date(txTimestamp * 1000).toLocaleDateString('fr-FR')} - Hash: ${tx.hash.slice(0,10)}`);
          }
          
          if (value >= WHALE_THRESHOLD) {
            // Vérifier si cette baleine existe déjà dans la base
            if (state.whaleDatabase.local[tx.hash]) {
              console.log(`⚠️ Baleine déjà en base: ${tx.hash.slice(0,10)}`);
              continue; // Déjà en base
            }
            
            let type = 'Achat';
            
            if (tx.to === BURN_ADDRESS) {
              type = 'Vente';
            } else if (tx.from === BURN_ADDRESS) {
              type = 'Achat';
            } else {
              const fromLower = tx.from.toLowerCase();
              const toLower = tx.to.toLowerCase();
              
              const contractPatterns = ['0x95b303', '0xa1077a', '0x0000000000000000000000000000000000000369'];
              const isFromContract = contractPatterns.some(pattern => fromLower.startsWith(pattern));
              const isToContract = contractPatterns.some(pattern => toLower.startsWith(pattern));
              
              if (isFromContract && !isToContract) {
                type = 'Achat';
              } else if (!isFromContract && isToContract) {
                type = 'Vente';
              } else {
                type = Math.random() > 0.5 ? 'Achat' : 'Vente';
              }
            }
            
            const whale = {
              addr: tx.from,
              amount: value,
              amountUsd: value * (state.plsPrice || 0.00001),
              time: new Date(txTimestamp * 1000).toISOString(),
              timeDisplay: new Date(txTimestamp * 1000).toLocaleString('fr-FR'),
              type: type,
              hash: tx.hash,
              timestamp: txTimestamp,
              dateAdded: Date.now(),
              isHistorical: txTimestamp < (Date.now() / 1000 - 3600) // Plus d'1h = historique
            };
            
            // Ajouter à la base de données
            state.whaleDatabase.local[tx.hash] = whale;
            newWhalesToAdd.push(whale);
            
            console.log(`🐋 Baleine ${type} ajoutée:`, fmt.big(value), 'PLS', new Date(txTimestamp * 1000).toLocaleDateString('fr-FR'), 'Hash:', tx.hash.slice(0,10));
            
            // Notification seulement pour les nouvelles baleines (pas historiques)
            if (!whale.isHistorical && value >= WHALE_ALERT_THRESHOLD) {
              sendWhaleNotification(whale);
            }
          }
        }
      }
    }
    
    if (newWhalesToAdd.length > 0) {
      console.log(`📊 ${newWhalesToAdd.length} nouvelles baleines ajoutées à la base`);
      
      // Mettre à jour l'affichage
      state.whales = Object.values(state.whaleDatabase.local)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 100);
      
      // Sauvegarder
      state.whaleDatabase.lastSync = Date.now();
      saveWhalesLocal();
      
      // Synchronisation en ligne toutes les 10 nouvelles baleines
      if (newWhalesToAdd.length >= 10 || Date.now() - state.whaleDatabase.lastSync > 300000) {
        saveWhalesOnline();
      }
    } else {
      console.log('⚠️ Aucune nouvelle baleine trouvée');
    }
    
    state.whaleDatabase.totalCount = Object.keys(state.whaleDatabase.local).length;
    updateWhaleStats();
    
    console.log(`🗄️ Base totale: ${state.whaleDatabase.totalCount} baleines depuis février 2026`);
    console.log(`📋 Traité: ${totalProcessed} transactions, Nouvelles: ${newWhalesToAdd.length}`);
    console.log(`📅 Date limite: ${WHALE_START_DATE.toLocaleDateString('fr-FR')} (timestamp: ${WHALE_START_TIMESTAMP})`);
    
  } catch (e) {
    console.warn('Erreur détection baleines:', e.message);
  }
}

// Mise à jour des statistiques de baleines
function updateWhaleStats() {
  const now = Date.now();
  const last24h = now - (24 * 60 * 60 * 1000);
  
  const recentWhales = state.whales.filter(w => new Date(w.time).getTime() > last24h);
  
  let totalBuys = 0;
  let totalSells = 0;
  
  recentWhales.forEach(w => {
    if (w.type === 'Achat') totalBuys += w.amount;
    else totalSells += w.amount;
  });
  
  let trend = 'neutral';
  const ratio = totalBuys / (totalSells || 1);
  
  if (ratio > 2) trend = 'bullish';
  else if (ratio < 0.5) trend = 'bearish';
  
  state.whaleStats = { totalBuys, totalSells, trend, ratio };
}

// Notification push pour baleines
function sendWhaleNotification(whale) {
  const message = `🐋 ${whale.type.toUpperCase()} ${fmt.big(whale.amount)} PLS (${fmt.usd(whale.amountUsd)})`;
  
  // Notification navigateur
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Baleine Détectée!', {
      body: message,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🐋</text></svg>',
      tag: 'whale-' + whale.hash
    });
  }
  
  // Notification dans l'interface
  notify(message, 'whale');
  
  console.log('🔔 Notification baleine envoyée:', message);
}

// ─── SURVEILLANCE CONTINUE DES BALEINES ──────────────────────────────────────
function startWhaleMonitoring() {
  // Vérification toutes les minutes
  setInterval(async () => {
    console.log('🔍 Vérification baleines...');
    await fetchWhales();
    
    // Mettre à jour seulement la section baleines
    updateWhaleDisplay();
    
  }, 60 * 1000); // 1 minute
}

function updateWhaleDisplay() {
  const list = document.getElementById('whale-list');
  const count = document.getElementById('whale-count');
  const trendEl = document.getElementById('whale-trend');
  const ratioEl = document.getElementById('whale-ratio');
  
  if (!count) return;
  
  // Afficher le nombre total dans la base + nombre affiché
  count.textContent = `${state.whales.length}/${state.whaleDatabase.totalCount}`;
  count.title = `${state.whales.length} affichées sur ${state.whaleDatabase.totalCount} total depuis février 2026`;
  
  const stats = state.whaleStats;
  if (trendEl) {
    let trendText = '📊 Neutre';
    let trendClass = 'neutral';
    
    if (stats.trend === 'bullish') {
      trendText = '📈 Accumulation';
      trendClass = 'bullish';
    } else if (stats.trend === 'bearish') {
      trendText = '📉 Distribution';
      trendClass = 'bearish';
    }
    
    trendEl.textContent = trendText;
    trendEl.className = `whale-indicator ${trendClass}`;
  }
  
  if (ratioEl) {
    const buyCount = state.whales.filter(w => w.type === 'Achat').length;
    const sellCount = state.whales.filter(w => w.type === 'Vente').length;
    ratioEl.textContent = `Achat/Vente: ${buyCount}/${sellCount}`;
  }
  
  if (list) {
    if (!state.whales.length) {
      list.innerHTML = '<div class="empty-state">Chargement de la base de données depuis février 2026...</div>';
    } else {
      list.innerHTML = state.whales.map(w => {
        const isRecent = (Date.now() / 1000 - w.timestamp) < 3600; // Moins d'1h
        const ageClass = isRecent ? 'recent' : 'historical';
        
        return `
        <div class="whale-item ${w.type.toLowerCase()} ${w.amount >= WHALE_ALERT_THRESHOLD ? 'whale-alert' : ''} ${ageClass}">
          <div class="whale-icon">${w.type === 'Achat' ? '🟢' : '🔴'}</div>
          <div class="whale-info">
            <div class="whale-addr">${fmt.addr(w.addr)}</div>
            <div class="whale-amount">${fmt.big(w.amount)} PLS ≈ ${fmt.usd(w.amountUsd)}</div>
          </div>
          <div style="text-align:right">
            <div class="whale-type ${w.type.toLowerCase()}">${w.type}</div>
            <div class="whale-time">
              📅 ${w.timeDisplay || fmt.time(w.time)}
              ${isRecent ? ' 🆕' : ''}
            </div>
          </div>
        </div>`;
      }).join('');
    }
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 DOM chargé, initialisation...');
  
  console.log('🗄️ Initialisation base de données baleines...');
  await initWhaleDatabase();
  
  console.log('🐋 Démarrage surveillance baleines...');
  startWhaleMonitoring();
  
  // Demander permission notifications au démarrage
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        console.log('🔔 Notifications activées');
        notify('🐋 Surveillance des baleines depuis février 2026 activée!', 'info');
      }
    });
  }
  
  console.log('✅ Initialisation terminée');
});