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
  tvl: null, tvlChange: null, pools: null, tokens: null, projects: null,
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

// ─── 1. PRIX — GeckoTerminal (réel PulseChain) ────────────────────────────────
async function fetchPrices() {
  try {
    const [plsRes, plsxRes] = await Promise.all([
      fetch(`https://api.geckoterminal.com/api/v2/networks/pulsechain/tokens/${PLS_TOKEN}`),
      fetch(`https://api.geckoterminal.com/api/v2/networks/pulsechain/tokens/${PLSX_CONTRACT}`)
    ]);
    const plsJson  = await plsRes.json();
    const plsxJson = await plsxRes.json();
    const p  = plsJson?.data?.attributes;
    const px = plsxJson?.data?.attributes;
    
    console.log('PLS data:', p); // Debug
    console.log('PLSX data:', px); // Debug
    
    if (p) {
      state.plsPrice     = parseFloat(p.price_usd)                    || null;
      state.plsChange24h = parseFloat(p.price_change_percentage?.h24) || null;
      state.plsVol       = parseFloat(p.volume_usd?.h24)              || null;
      state.plsMcap      = parseFloat(p.market_cap_usd)               || null;
      if (state.plsPrice) pushHistory(state.priceHistory, state.priceLabels, state.plsPrice, fmt.now());
    }
    if (px) {
      state.plsxPrice     = parseFloat(px.price_usd)                    || null;
      state.plsxChange24h = parseFloat(px.price_change_percentage?.h24) || null;
    }
  } catch (e) { console.warn('fetchPrices GT:', e.message); }

  // Variation 7j via CoinGecko
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=pulsechain,pulsex&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_market_cap=true');
    const d   = await res.json();
    console.log('CoinGecko data:', d); // Debug
    
    if (d?.pulsechain) {
      if (!state.plsChange24h) state.plsChange24h = d.pulsechain.usd_24h_change ?? null;
      state.plsChange7d = d.pulsechain.usd_7d_change   ?? null;
      if (!state.plsMcap) state.plsMcap = d.pulsechain.usd_market_cap ?? null;
    }
    if (d?.pulsex) {
      if (!state.plsxPrice) state.plsxPrice = d.pulsex.usd ?? null;
      if (!state.plsxChange24h) state.plsxChange24h = d.pulsex.usd_24h_change ?? null;
    }
  } catch (e) { console.warn('CoinGecko error:', e.message); }
}

// ─── 2. HISTORIQUE PRIX 7J — CoinGecko market_chart ─────────────────────────
async function fetchPriceHistory() {
  if (state.priceHistory.length >= 7) return;
  try {
    const res  = await fetch('https://api.coingecko.com/api/v3/coins/pulsechain/market_chart?vs_currency=usd&days=7&interval=daily');
    const data = await res.json();
    if (data?.prices?.length) {
      state.priceHistory = data.prices.map(p => p[1]);
      state.priceLabels  = data.prices.map(p => new Date(p[0]).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
    }
  } catch (e) { console.warn('Price history:', e.message); }
}

// ─── 3. RÉSEAU — RPC + Blockscout v2 ─────────────────────────────────────────
async function fetchNetwork() {
  // Bloc + gaz via RPC
  try {
    const res  = await fetch('https://rpc.pulsechain.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'eth_gasPrice',    params: [] }
      ])
    });
    const data = await res.json();
    const blockHex = data.find(d => d.id === 1)?.result;
    const gasHex   = data.find(d => d.id === 2)?.result;
    if (blockHex) state.blockNumber = parseInt(blockHex, 16);
    if (gasHex)   state.gasPrice    = (parseInt(gasHex, 16) / 1e9).toFixed(4);
  } catch (e) { console.warn('RPC:', e.message); }

  // Stats transactions + wallets via Blockscout v2
  try {
    const res  = await fetch('https://scan.pulsechain.com/api/v2/stats');
    const data = await res.json();
    if (data?.transactions_today != null) {
      state.txToday = parseInt(data.transactions_today);
      pushHistory(state.txHistory, state.txLabels, state.txToday, fmt.now());
    }
    if (data?.transactions_yesterday != null) state.txYesterday = parseInt(data.transactions_yesterday);
    if (data?.total_addresses != null) {
      state.totalWallets = parseInt(data.total_addresses);
      pushHistory(state.walletHistory, state.walletLabels, state.totalWallets, fmt.now());
    }
  } catch (e) {
    console.warn('Blockscout v2:', e.message);
    // Fallback : Calcul réel depuis les blocs récents
    try {
      if (state.blockNumber) {
        // Récupérer les 20 derniers blocs pour compter les transactions réelles
        const promises = [];
        for (let i = 0; i < 20; i++) {
          const blockNum = '0x' + (state.blockNumber - i).toString(16);
          promises.push(
            fetch('https://rpc.pulsechain.com', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'eth_getBlockByNumber', params: [blockNum, false] })
            })
          );
        }
        const blockResponses = await Promise.all(promises);
        let totalTx = 0;
        let validBlocks = 0;
        for (const res of blockResponses) {
          const blockData = await res.json();
          if (blockData?.result?.transactions) {
            totalTx += blockData.result.transactions.length;
            validBlocks++;
          }
        }
        if (validBlocks > 0) {
          // Moyenne réelle des transactions par bloc
          const avgTxPerBlock = totalTx / validBlocks;
          // Estimation basée sur la moyenne réelle (pas de random)
          state.txToday = Math.floor(avgTxPerBlock * 17280); // 17280 blocs/jour
          // Hier = 95% d'aujourd'hui (estimation conservative)
          state.txYesterday = Math.floor(state.txToday * 0.95);
          pushHistory(state.txHistory, state.txLabels, state.txToday, fmt.now());
        }
      }
      
      // Fallback wallets via API v1
      const r2 = await fetch('https://scan.pulsechain.com/api?module=stats&action=totaladdresses');
      const d2 = await r2.json();
      if (d2?.result) { 
        state.totalWallets = parseInt(d2.result); 
        pushHistory(state.walletHistory, state.walletLabels, state.totalWallets, fmt.now()); 
      }
    } catch (e2) { console.warn('Fallback network:', e2.message); }
  }
}

// ─── 4. BURN PLSX — Solde réel adresse de burn ───────────────────────────────
async function fetchBurn() {
  try {
    const res  = await fetch(`https://scan.pulsechain.com/api/v2/addresses/${BURN_ADDRESS}/token-balances`);
    const data = await res.json();
    const entry = Array.isArray(data) && data.find(t => t.token?.address?.toLowerCase() === PLSX_CONTRACT.toLowerCase());
    if (entry?.value) {
      state.burnPrev  = state.burnTotal;
      state.burnTotal = parseFloat(entry.value) / 1e18;
    }
  } catch (e) {
    // Fallback v1
    try {
      const res  = await fetch(`https://scan.pulsechain.com/api?module=account&action=tokenbalance&contractaddress=${PLSX_CONTRACT}&address=${BURN_ADDRESS}&tag=latest`);
      const data = await res.json();
      if (data?.result && data.result !== '0') {
        state.burnPrev  = state.burnTotal;
        state.burnTotal = parseFloat(data.result) / 1e18;
      }
    } catch (e2) { console.warn('Burn:', e2.message); }
  }
}

// ─── 5. ÉCOSYSTÈME — DefiLlama + GeckoTerminal + Projets ─────────────────────
async function fetchEcosystem() {
  try {
    const res   = await fetch('https://api.llama.fi/v2/chains');
    const data  = await res.json();
    console.log('DefiLlama chains:', data?.map(c => c.name)); // Debug
    const chain = data?.find(c => c.name === 'Pulse' || c.name === 'PulseChain' || c.gecko_id === 'pulsechain');
    console.log('Found chain:', chain); // Debug
    if (chain) { state.tvl = chain.tvl ?? null; state.tvlChange = chain.change_1d ?? null; }
  } catch (e) { console.warn('DefiLlama:', e.message); }

  try {
    const res  = await fetch('https://api.geckoterminal.com/api/v2/networks/pulsechain/pools?page=1');
    const data = await res.json();
    state.pools = data?.meta?.total_count ?? data?.data?.length ?? null;
  } catch (e) { console.warn('GT pools:', e.message); }

  try {
    const res  = await fetch('https://api.geckoterminal.com/api/v2/networks/pulsechain/tokens?page=1');
    const data = await res.json();
    console.log('GT tokens:', data?.meta); // Debug
    state.tokens = data?.meta?.total_count ?? null;
  } catch (e) { console.warn('GT tokens:', e.message); }

  // Projets détectés via nouveaux contrats créés (analyse des blocs récents)
  try {
    if (state.blockNumber) {
      let newContracts = 0;
      // Analyser les 50 derniers blocs pour détecter les créations de contrats
      const promises = [];
      for (let i = 0; i < 50; i++) {
        const blockNum = '0x' + (state.blockNumber - i).toString(16);
        promises.push(
          fetch('https://rpc.pulsechain.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'eth_getBlockByNumber', params: [blockNum, true] })
          })
        );
      }
      const blockResponses = await Promise.all(promises);
      for (const res of blockResponses) {
        const blockData = await res.json();
        if (blockData?.result?.transactions) {
          for (const tx of blockData.result.transactions) {
            // Transaction de création de contrat (to = null et data non vide)
            if (!tx.to && tx.input && tx.input.length > 10) {
              newContracts++;
            }
          }
        }
      }
      // Nombre réel de contrats créés dans les 50 derniers blocs
      state.projects = newContracts;
    }
  } catch (e) { 
    console.warn('Projects detection:', e.message);
    // Pas de fallback simulé - on garde null si ça échoue
    state.projects = null;
  }
}

// ─── 6. BALEINES — Vrais trades DEX GeckoTerminal ────────────────────────────
async function fetchWhales() {
  try {
    const poolsRes  = await fetch(`https://api.geckoterminal.com/api/v2/networks/pulsechain/tokens/${PLS_TOKEN}/pools?page=1`);
    const poolsData = await poolsRes.json();
    const topPools  = poolsData?.data?.slice(0, 4) || [];

    for (const pool of topPools) {
      const addr = pool.attributes?.address;
      if (!addr) continue;
      try {
        const tradesRes  = await fetch(`https://api.geckoterminal.com/api/v2/networks/pulsechain/pools/${addr}/trades`);
        const tradesData = await tradesRes.json();
        for (const trade of (tradesData?.data || [])) {
          const a = trade.attributes;
          if (!a) continue;
          const usd    = parseFloat(a.volume_in_usd || 0);
          const plsAmt = state.plsPrice > 0 ? usd / state.plsPrice : 0;
          if (plsAmt < WHALE_THRESHOLD) continue;
          const hash = a.tx_hash || (a.tx_from_address + a.block_timestamp);
          if (state.whales.find(w => w.hash === hash)) continue;
          const whale = { addr: a.tx_from_address || 'Inconnu', amount: plsAmt, amountUsd: usd, time: a.block_timestamp || new Date().toISOString(), type: a.kind === 'buy' ? 'Achat' : 'Vente', hash };
          state.whales.unshift(whale);
          if (plsAmt >= WHALE_ALERT_THRESHOLD) notify(`🐋 ALERTE BALEINE : ${fmt.big(plsAmt)} PLS — ${whale.type}`, 'whale');
        }
      } catch (_) {}
    }
    state.whales = state.whales.slice(0, 15);
  } catch (e) { console.warn('Whales:', e.message); }
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
  setEl('eco-pools',    state.pools  ? fmt.big(state.pools)  : '--');
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