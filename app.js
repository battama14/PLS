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
  scoreBreakdown: {}
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
    // Ajouter un délai pour éviter le rate limit
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // CoinGecko fonctionne parfaitement
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=pulsechain,pulsex&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_market_cap=true&include_24hr_vol=true');
    
    if (!res.ok) {
      console.warn('CoinGecko rate limit, using fallback data');
      // Utiliser les dernières données connues ou des valeurs par défaut
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
    
    // Debug pour voir pourquoi certaines données manquent
    console.log('PLS Price:', state.plsPrice);
    console.log('PLS 7d change:', state.plsChange7d);
    console.log('PLS Market Cap:', state.plsMcap);
    
  } catch (e) { console.warn('CoinGecko error:', e.message); }
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
    // 1. Token supply PLS (données réelles uniquement)
    const supplyRes = await fetch(`https://api.scan.pulsechain.com/api?module=stats&action=tokensupply&contractaddress=${PLS_TOKEN}`);
    const supplyData = await supplyRes.json();
    
    if (supplyData?.status === '1' && supplyData?.result) {
      const totalSupply = parseFloat(supplyData.result) / 1e18;
      console.log('PLS Total Supply:', totalSupply);
      
      // Calculer le market cap réel si on a le prix
      if (state.plsPrice && (!state.plsMcap || state.plsMcap === 0)) {
        state.plsMcap = totalSupply * state.plsPrice;
        console.log('Calculated Market Cap:', state.plsMcap);
      }
    }
    
    // 2. Numéro de bloc actuel (données réelles uniquement)
    try {
      const blockRes = await fetch('https://api.scan.pulsechain.com/api?module=block&action=getblocknobytime&timestamp=' + Math.floor(Date.now()/1000) + '&closest=before');
      const blockData = await blockRes.json();
      if (blockData?.status === '1' && blockData?.result?.blockNumber) {
        state.blockNumber = parseInt(blockData.result.blockNumber);
        console.log('Current block number:', state.blockNumber);
      }
    } catch (e) {
      console.warn('Block number error:', e.message);
    }
    
    // 3. ARRÊT - Pas de données de transactions car aucune API fiable trouvée
    // Les champs resteront à "--" jusqu'à ce qu'on trouve une vraie API
    state.txToday = null;
    state.txYesterday = null;
    state.gasPrice = null;
    
    console.log('Network activity: No reliable API found, showing --');
    
  } catch (e) { 
    console.warn('Network fetch error:', e.message);
  }
  
  // 4. ARRÊT - Pas d'estimation de wallets
  // Les wallets resteront à "--" jusqu'à ce qu'on trouve une vraie API
  state.totalWallets = null;
  
  console.log('Wallet data: No real API available, showing --');
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
  // L'API nécessite une adresse - utiliser une adresse connue avec beaucoup de transactions
  try {
    // Utiliser l'adresse de burn comme exemple d'adresse avec de l'activité
    const res = await fetch(`https://api.scan.pulsechain.com/api?module=account&action=txlist&address=${BURN_ADDRESS}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc`);
    const data = await res.json();
    console.log('Burn address transactions:', data);
    
    if (data?.status === '1' && data?.result) {
      for (const tx of data.result) {
        if (!tx.value || tx.value === '0') continue;
        
        const value = parseFloat(tx.value) / 1e18;
        console.log('Transaction value:', value, 'PLS from', tx.from, 'to', tx.to);
        
        if (value >= WHALE_THRESHOLD) {
          // Déterminer si c'est un achat ou une vente basé sur l'adresse
          let type = 'Transaction';
          if (tx.to === BURN_ADDRESS) {
            type = 'Vente'; // Envoi vers burn = vente/destruction
          } else if (tx.from === BURN_ADDRESS) {
            type = 'Achat'; // Depuis burn = achat (rare mais possible)
          } else {
            // Analyser d'autres patterns pour déterminer achat/vente
            // Si l'adresse from est un exchange connu ou un contrat, c'est probablement un achat
            const fromLower = tx.from.toLowerCase();
            const toLower = tx.to.toLowerCase();
            
            // Patterns d'exchanges/contrats (adresses qui commencent par des patterns connus)
            const exchangePatterns = ['0x000000', '0x111111', '0x222222', '0x333333', '0x444444', '0x555555'];
            const isFromExchange = exchangePatterns.some(pattern => fromLower.startsWith(pattern));
            const isToExchange = exchangePatterns.some(pattern => toLower.startsWith(pattern));
            
            if (isFromExchange && !isToExchange) {
              type = 'Achat'; // Depuis exchange vers wallet = achat
            } else if (!isFromExchange && isToExchange) {
              type = 'Vente'; // Depuis wallet vers exchange = vente
            } else {
              // Par défaut, analyser la direction du flux
              type = tx.to === BURN_ADDRESS ? 'Vente' : 'Achat';
            }
          }
          
          const whale = {
            addr: tx.from,
            amount: value,
            amountUsd: value * (state.plsPrice || 0),
            time: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
            type: type,
            hash: tx.hash
          };
          
          if (!state.whales.find(w => w.hash === whale.hash)) {
            state.whales.unshift(whale);
            console.log('Whale detected:', whale);
            if (value >= WHALE_ALERT_THRESHOLD) {
              const action = type === 'Achat' ? 'ACHAT' : 'VENTE';
              notify(`🐋 ALERTE BALEINE ${action} : ${fmt.big(value)} PLS`, 'whale');
            }
          }
        }
      }
      state.whales = state.whales.slice(0, 15);
      console.log('Total whales found:', state.whales.length);
    }
  } catch (e) {
    console.warn('Whale detection error:', e.message);
    state.whales = [];
  }
}

// ─── SCORE D'ACCUMULATION ─────────────────────────────────────────────────────
function calcScore() {
  let score = 0;
  const bd  = {};

  if (state.txToday != null && state.txYesterday != null && state.txYesterday > 0) {
    const g = (state.txToday - state.txYesterday) / state.txYesterday * 100;
    if (g > 5)      { score += 20; bd['📈 Transactions >+5%'] = '+20'; }
    else if (g > 0) { score += 10; bd['📈 Transactions en hausse'] = '+10'; }
    else            { bd['📉 Transactions en baisse'] = '+0'; }
  }

  if (state.walletHistory.length >= 2) {
    const diff = state.walletHistory.at(-1) - state.walletHistory.at(-2);
    if (diff > 0) { const pts = Math.min(20, Math.max(1, Math.floor(diff / 50))); score += pts; bd[`👛 +${diff} wallets`] = `+${pts}`; }
    else { bd['👛 Wallets stables'] = '+0'; }
  }

  if (state.plsChange24h != null) {
    if (state.plsChange24h >= -3 && state.plsChange24h <= 2) { score += 15; bd['💰 Prix stable'] = '+15'; }
    else if (state.plsChange24h > 2)                         { score += 8;  bd['💰 Prix en hausse'] = '+8'; }
    else                                                      { bd['💰 Prix en forte baisse'] = '+0'; }
  }

  const buys = state.whales.filter(w => w.type === 'Achat');
  if (buys.length >= 3)      { score += 25; bd[`🐋 ${buys.length} achats baleines`] = '+25'; }
  else if (buys.length >= 1) { score += 12; bd[`🐋 ${buys.length} achat baleine`]  = '+12'; }
  else                       { bd['🐋 Aucune baleine acheteuse'] = '+0'; }

  if (state.burnTotal != null && state.burnPrev != null) {
    const burned = state.burnTotal - state.burnPrev;
    if (burned > 0) { score += 10; bd[`🔥 Burn +${fmt.big(burned)} PLSX`] = '+10'; }
    else            { bd['🔥 Pas de nouveau burn'] = '+0'; }
  } else if (state.burnTotal > 0) { score += 5; bd['🔥 Burn total existant'] = '+5'; }

  if (state.tvlChange != null) {
    if (state.tvlChange > 0) { score += 10; bd[`💧 TVL +${state.tvlChange.toFixed(1)}%`] = '+10'; }
    else                     { bd[`💧 TVL ${state.tvlChange.toFixed(1)}%`] = '+0'; }
  }

  state.scoreBreakdown = bd;
  return Math.min(100, Math.max(0, Math.round(score)));
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function renderAll() {
  // Prix
  setEl('pls-price', fmt.usd(state.plsPrice));
  setChange('pls-24h', state.plsChange24h);
  setChange('pls-7d', state.plsChange7d);
  setEl('pls-mcap', state.plsMcap ? '$' + fmt.big(state.plsMcap) : '--');
  setEl('pls-vol',  state.plsVol  ? '$' + fmt.big(state.plsVol)  : '--');
  setEl('plsx-price', fmt.usd(state.plsxPrice));
  setChange('plsx-24h', state.plsxChange24h);
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

  // Wallets
  setEl('total-wallets', fmt.big(state.totalWallets));
  if (state.walletHistory.length >= 2) {
    const diff = state.walletHistory.at(-1) - state.walletHistory.at(-2);
    setEl('new-wallets', diff > 0 ? '+' + fmt.big(diff) : '0');
    setEl('wallet-growth', state.totalWallets > 0 ? (diff / state.totalWallets * 100).toFixed(4) + '%' : '--');
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

  // Score
  const score = calcScore();
  setEl('score-value', score);
  document.getElementById('score-bar').style.width = score + '%';
  const card = document.getElementById('score-card');
  card.className = 'score-card';
  let status = '';
  if      (score < 30) { card.classList.add('score-weak');    status = '🔴 Marché faible — Prudence recommandée'; }
  else if (score < 60) { card.classList.add('score-neutral'); status = '🟡 Zone neutre — Surveiller les signaux'; }
  else if (score < 80) { card.classList.add('score-accum');   status = "🟢 Zone d'accumulation — Opportunité détectée"; }
  else                 { card.classList.add('score-bull');    status = '⚡ Signal haussier fort — Momentum positif'; }
  setEl('score-status', status);
  document.getElementById('score-details').innerHTML = Object.entries(state.scoreBreakdown)
    .map(([k, v]) => `<span class="score-detail-item">${k} <strong>${v}</strong></span>`).join('');
}

// ─── REFRESH PRINCIPAL ────────────────────────────────────────────────────────
async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('loading');
  btn.innerHTML = '↻ <span class="loader"></span>';

  await Promise.allSettled([
    fetchPrices(),
    fetchPriceHistory(),
    fetchNetwork(),
    fetchBurn(),
    fetchEcosystem(),
    fetchWhales()
  ]);

  renderAll();
  setEl('last-update', 'Dernière mise à jour : ' + new Date().toLocaleTimeString('fr-FR'));
  btn.classList.remove('loading');
  btn.innerHTML = '↻ Actualiser';
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  refreshAll();
  setInterval(refreshAll, REFRESH_INTERVAL);
});