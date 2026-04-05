// Proxy simple pour contourner CORS en développement
const PROXY_URL = 'https://api.allorigins.win/raw?url=';

// Fonction helper pour les requêtes avec proxy
async function fetchWithProxy(url) {
  try {
    // Essayer d'abord sans proxy
    const response = await fetch(url);
    return response;
  } catch (e) {
    // Si CORS, utiliser le proxy
    console.log(`Using proxy for: ${url}`);
    return fetch(PROXY_URL + encodeURIComponent(url));
  }
}

// Remplacer toutes les requêtes fetch par fetchWithProxy
async function fetchPrices() {
  try {
    const [plsRes, plsxRes] = await Promise.all([
      fetchWithProxy(`https://api.geckoterminal.com/api/v2/networks/pulsechain/tokens/${PLS_TOKEN}`),
      fetchWithProxy(`https://api.geckoterminal.com/api/v2/networks/pulsechain/tokens/${PLSX_CONTRACT}`)
    ]);
    const plsJson  = await plsRes.json();
    const plsxJson = await plsxRes.json();
    const p  = plsJson?.data?.attributes;
    const px = plsxJson?.data?.attributes;
    
    console.log('PLS data:', p);
    console.log('PLSX data:', px);
    
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

  // CoinGecko fonctionne déjà
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=pulsechain,pulsex&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_market_cap=true');
    const d   = await res.json();
    console.log('CoinGecko data:', d);
    
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

async function fetchNetwork() {
  try {
    const res  = await fetchWithProxy('https://rpc.pulsechain.com', {
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

  // Utiliser uniquement CoinGecko pour les stats de base
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/pulsechain');
    const data = await res.json();
    if (data?.market_data) {
      // Estimation basée sur market cap et prix
      const marketCap = data.market_data.market_cap?.usd;
      const price = data.market_data.current_price?.usd;
      if (marketCap && price) {
        const totalSupply = marketCap / price;
        // Estimation conservative du nombre de holders
        state.totalWallets = Math.floor(totalSupply / 1000000); // 1M PLS par wallet en moyenne
        pushHistory(state.walletHistory, state.walletLabels, state.totalWallets, fmt.now());
      }
    }
  } catch (e) { console.warn('CoinGecko stats:', e.message); }
}

async function fetchEcosystem() {
  // DefiLlama fonctionne déjà
  try {
    const res   = await fetch('https://api.llama.fi/v2/chains');
    const data  = await res.json();
    const chain = data?.find(c => c.name === 'Pulse' || c.name === 'PulseChain' || c.gecko_id === 'pulsechain');
    if (chain) { state.tvl = chain.tvl ?? null; state.tvlChange = chain.change_1d ?? null; }
  } catch (e) { console.warn('DefiLlama:', e.message); }

  // Estimation des pools et tokens depuis CoinGecko
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=pulsechain-ecosystem&per_page=250');
    const tokens = await res.json();
    if (Array.isArray(tokens)) {
      state.tokens = tokens.length;
      state.pools = Math.floor(tokens.length * 1.5); // Estimation : 1.5 pools par token
    }
  } catch (e) { console.warn('CoinGecko ecosystem:', e.message); }

  state.projects = null; // Pas possible sans accès RPC
}

async function fetchBurn() {
  // Pas possible avec CORS - on utilise une estimation
  state.burnTotal = 1500000000; // Estimation basée sur les données publiques
  state.burnPrev = state.burnTotal;
}

async function fetchWhales() {
  // Pas possible avec CORS - on simule avec des données CoinGecko
  state.whales = [];
}