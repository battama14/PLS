import { getStore } from "@netlify/blobs";

const RPC = "https://rpc.pulsechain.com";
const WHALE_THRESHOLD = 500000000;
const BLOCK_LOOKBACK = 5;
const TELEGRAM_BOT = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PULSEX_ROUTER = "0x98bf93ebf5c380C0e6Ae8e192A7e2AE08edAcc02";
const PULSEX_FACTORY = "0x1715a3E4A142d8b698131108995174F37aEBA10D";
const SWAP_METHODS = ["0x38ed1739","0x7ff36ab5","0x18cbafe5"];
const ADD_LIQUIDITY_METHOD = "0xe8e33700";
const CREATE_PAIR_METHOD = "0xc9c65396";
const SWAP_TOPIC = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
const LP_LOCK_ADDRESSES = [
  "0x000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000000"
];

async function rpc(method, params){
  const res = await fetch(RPC, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({jsonrpc:"2.0", method, params, id:1})
  });
  const data = await res.json();
  return data.result;
}

async function sendTelegram(msg){
  try{
    await fetch(TELEGRAM_BOT, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({chat_id: CHAT_ID, text: msg})
    });
  }catch(e){
    console.error("Telegram error:", e);
  }
}

async function getMarketData(){
  try{
    const [resPLS, resPLSX] = await Promise.all([
      fetch("https://api.dexscreener.com/latest/dex/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27"),
      fetch("https://api.dexscreener.com/latest/dex/tokens/0x95B303987A60C71504D99Aa1b13B4DA07b0790ab")
    ]);
    const [dataPLS, dataPLSX] = await Promise.all([resPLS.json(), resPLSX.json()]);
    return {
      pls: dataPLS.pairs?.[0] || null,
      plsx: dataPLSX.pairs?.[0] || null
    };
  }catch(e){
    return {pls: null, plsx: null};
  }
}

async function checkTokenLiquidity(contract){
  try{
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contract}`);
    const data = await res.json();
    const pair = data.pairs?.[0];
    if(!pair) return null;
    return {
      liquidity: parseFloat(pair.liquidity?.usd || 0),
      volume: parseFloat(pair.volume?.h24 || 0),
      fdv: parseFloat(pair.fdv || 0),
      symbol: pair.baseToken?.symbol || contract.slice(0,8)
    };
  }catch(e){
    return null;
  }
}

export default async function handler(req){
  try{
    // Charger l'etat persistant depuis Netlify Blobs
    const store = getStore("whales");
    let state = await store.get("state", {type:"json"}) || {
      totalBuy24h: 0,
      totalSell24h: 0,
      totalBuy1h: 0,
      totalSell1h: 0,
      lastBlock: 0,
      lastUpdate: Date.now(),
      lastHourReset: Date.now(),
      lastBurstAlert: 0,
      lastAccumulationAlert: 0
    };

    // Reset 24h
    if(Date.now() - state.lastUpdate > 24*60*60*1000){
      state.totalBuy24h = 0;
      state.totalSell24h = 0;
    }
    // Reset 1h
    if(Date.now() - state.lastHourReset > 60*60*1000){
      state.totalBuy1h = 0;
      state.totalSell1h = 0;
      state.lastHourReset = Date.now();
    }

    const latestBlockHex = await rpc("eth_blockNumber", []);
    const latestBlock = parseInt(latestBlockHex, 16);

    // Eviter de rescanner les memes blocs
    if(latestBlock <= state.lastBlock){
      return new Response("No new blocks", {status: 200});
    }

    const {pls, plsx} = await getMarketData();
    const plsPrice = pls ? parseFloat(pls.priceUsd) : 0;
    const plsChange = pls ? parseFloat(pls.priceChange?.h1 || 0) : 0;

    // Alertes marche PLS
    if(plsChange > 5){
      await sendTelegram(`🚀 PLS MOMENTUM\n━━━━━━━━━━━━━━━\nHausse 1h : +${plsChange}%\nPrix : $${plsPrice}\nVolume en hausse\n━━━━━━━━━━━━━━━`);
    }
    if(plsChange < -5){
      await sendTelegram(`⚠️ PLS SELL PRESSURE\n━━━━━━━━━━━━━━━\nBaisse 1h : ${plsChange}%\nPrix : $${plsPrice}\n━━━━━━━━━━━━━━━`);
    }
    if(plsx && pls && plsx.volume?.h24 > pls.volume?.h24){
      await sendTelegram(`📊 Capital Rotation\n━━━━━━━━━━━━━━━\nPLSX volume dépasse PLS\nPossible rotation vers DEX\n━━━━━━━━━━━━━━━`);
    }

    const alertesEnvoyees = new Set();
    const createPairDetected = {};
    const liquidityAdded = {};
    const lpLockedContracts = {};
    const earlyWhaleSignals = {};
    const liquiditySpikeDetected = {};
    const liquidityHistory = {};
    const liquidityEvents = {};
    const preSpikeWhales = {};
    const pumpScores = {};
    let totalFlow = state.totalBuy24h;
    let totalVolume = state.totalSell24h;
    let totalBuy1h = state.totalBuy1h;
    let totalSell1h = state.totalSell1h;
    let whaleBuysHistory = [];
    let whaleBurst = [];
    let lastAccumulationAlert = state.lastAccumulationAlert;
    let lastBurstAlert = state.lastBurstAlert;

    function calculatePumpScore(contract){
      let score = 0;
      if(createPairDetected[contract]) score += 10;
      if(liquidityAdded[contract]) score += 20;
      if(lpLockedContracts[contract]) score += 15;
      if(earlyWhaleSignals[contract]) score += 20;
      if(liquiditySpikeDetected[contract]) score += 15;
      if(preSpikeWhales[contract]?.length >= 2) score += 10;
      if(score > 100) score = 100;
      pumpScores[contract] = score;
      return score;
    }

    // Scanner les blocs
    for(let i = 0; i < BLOCK_LOOKBACK; i++){
      const hex = "0x" + (latestBlock - i).toString(16);
      const block = await rpc("eth_getBlockByNumber", [hex, true]);
      if(!block || !block.transactions) continue;

      for(const tx of block.transactions){
        const value = parseInt(tx.value, 16) / 1e18;

        // --- MODULES PRO sur toutes les tx ---

        // 1. detectCreatePair
        if(tx.input && tx.input !== "0x" &&
           tx.to?.toLowerCase() === PULSEX_FACTORY.toLowerCase() &&
           tx.input.slice(0,10) === CREATE_PAIR_METHOD &&
           !alertesEnvoyees.has("pair_"+tx.hash)){
          alertesEnvoyees.add("pair_"+tx.hash);
          if(tx.creates) createPairDetected[tx.creates] = true;
          await sendTelegram(`🧪 Nouvelle Pool PulseX\n━━━━━━━━━━━━━━━\nWallet : ${tx.from}\nBloc : ${latestBlock-i}\n⚠️ Avant Dexscreener\n━━━━━━━━━━━━━━━`);
        }

        // 2. detectLiquidity
        if(tx.input && tx.input !== "0x" &&
           tx.input.slice(0,10) === ADD_LIQUIDITY_METHOD &&
           !alertesEnvoyees.has("liq_"+tx.hash)){
          alertesEnvoyees.add("liq_"+tx.hash);
          liquidityEvents[tx.from] = {time: Date.now(), whales: []};
          if(tx.creates) liquidityAdded[tx.creates] = true;
        }

        // 3. detectLpLock
        if(tx.to && LP_LOCK_ADDRESSES.includes(tx.to.toLowerCase())){
          lpLockedContracts[tx.from] = true;
          await sendTelegram(`🔒 LP Lock détecté\n━━━━━━━━━━━━━━━\nWallet : ${tx.from}\n✅ Bon signal\n━━━━━━━━━━━━━━━`);
        }

        // 4. detectNewPair (contrat créé)
        if(tx.creates && !alertesEnvoyees.has("new_"+tx.creates)){
          alertesEnvoyees.add("new_"+tx.creates);
          const tokenData = await checkTokenLiquidity(tx.creates);
          if(tokenData && tokenData.liquidity >= 3000){
            // Calcul risk
            let risk = "🟢 SAFE";
            if(tokenData.fdv > 0){
              const ratio = tokenData.liquidity / tokenData.fdv;
              if(ratio < 0.02) risk = "🔴 RUG RISK";
              else if(ratio < 0.05) risk = "⚠️ HIGH DEV SUPPLY";
              else if(ratio < 0.1) risk = "🟡 MEDIUM";
            }
            // Liquidity history
            liquidityHistory[tx.creates] = {start: tokenData.liquidity, last: tokenData.liquidity, time: Date.now()};
            createPairDetected[tx.creates] = true;
            const score = calculatePumpScore(tx.creates);
            if(score >= 60){
              await sendTelegram(`💰 Nouveau Token Détecté !\n━━━━━━━━━━━━━━━\nToken : ${tokenData.symbol}\nContrat : ${tx.creates}\nLiquidité : $${Math.round(tokenData.liquidity).toLocaleString()}\nRisque : ${risk}\nScore : ${score}/100\nhttps://dexscreener.com/pulsechain/${tx.creates}\n━━━━━━━━━━━━━━━`);
            }
          }
        }

        // 5. detectLargeSwaps
        if(tx.input && tx.input !== "0x" &&
           tx.to?.toLowerCase() === PULSEX_ROUTER.toLowerCase() &&
           SWAP_METHODS.includes(tx.input.slice(0,10)) &&
           tx.input.length >= 200 &&
           value > 1000000000 &&
           !alertesEnvoyees.has("swap_"+tx.hash)){
          alertesEnvoyees.add("swap_"+tx.hash);
          await sendTelegram(`🐋 Gros Swap PulseX\n━━━━━━━━━━━━━━━\nMontant : ${Math.round(value/1000000)}M PLS\nWallet : ${tx.from}\nBloc : ${latestBlock-i}\nPrix PLS : $${plsPrice}\n━━━━━━━━━━━━━━━`);
        }

        // --- WHALE TRANSFERS (tx simples uniquement) ---
        if(tx.input !== "0x") continue;
        if(!tx.from || !tx.to) continue;
        if(value < WHALE_THRESHOLD) continue;
        if(tx.from && tx.to) {
          // Filtre bots
          // (whaleWallets non disponible côté serveur, on skip ce filtre)
        }

        if(alertesEnvoyees.has(tx.hash)) continue;
        alertesEnvoyees.add(tx.hash);

        // Incrementer BUY (transfert simple = on considere comme flow entrant)
        totalFlow += value;
        totalBuy1h += value;

        // Whale burst
        whaleBurst.push({amount: value, time: Date.now()});
        whaleBurst = whaleBurst.filter(t => Date.now() - t.time < 10*60*1000);
        const burstTotal = whaleBurst.reduce((s,t) => s+t.amount, 0);
        if(burstTotal > 2000000000 && Date.now() - lastBurstAlert > 30*60*1000){
          lastBurstAlert = Date.now();
          await sendTelegram(`🔥 Whale Burst !\n━━━━━━━━━━━━━━━\nVolume : ${Math.round(burstTotal/1000000)}M PLS en 10min\nPossible mouvement du marché\n━━━━━━━━━━━━━━━`);
        }

        // Whale accumulation
        whaleBuysHistory.push({amount: value, time: Date.now()});
        whaleBuysHistory = whaleBuysHistory.filter(t => Date.now() - t.time < 20*60*1000);
        const accumTotal = whaleBuysHistory.reduce((s,t) => s+t.amount, 0);
        if(accumTotal > 1500000000 && Date.now() - lastAccumulationAlert > 30*60*1000){
          lastAccumulationAlert = Date.now();
          await sendTelegram(`🚀 Whale Accumulation !\n━━━━━━━━━━━━━━━\nAccumulation : ${Math.round(accumTotal/1000000)}M PLS en 20min\nSignal : accumulation whales\n━━━━━━━━━━━━━━━`);
        }

        // Early whale entry
        Object.keys(liquidityEvents).forEach(dev => {
          const event = liquidityEvents[dev];
          if(Date.now() - event.time < 30000 && !event.whales.includes(tx.from)){
            event.whales.push(tx.from);
            if(event.whales.length >= 3){
              earlyWhaleSignals[dev] = true;
              sendTelegram(`🚀 EARLY WHALE ENTRY !\n━━━━━━━━━━━━━━━\nDev : ${dev}\n${event.whales.length} whales en 30 sec\nPossible pump imminent\n━━━━━━━━━━━━━━━`);
            }
          }
        });

        // Alerte whale principale (> 1B)
        if(value > 1000000000){
          const net = totalFlow - totalVolume;
          let signal;
          if(net > 1000000000) signal = "🟢 Accumulation";
          else if(net < -1000000000) signal = "🔴 Distribution";
          else signal = "🟡 Neutre";
          const priority = value > 2000000000 ? "MEGA WHALE" : "WHALE ALERT";
          await sendTelegram(`🐋 ${priority}\n━━━━━━━━━━━━━━━\nTransaction : ${Math.round(value/1000000)}M PLS\nWallet : ${tx.from}\nBloc : ${latestBlock-i}\nPrix PLS : $${plsPrice}\nSignal : ${signal}\n━━━━━━━━━━━━━━━`);
        }
      }
    }

    // Rapport horaire (minute 0 seulement, pas 0-2 pour eviter doublons)
    const minute = new Date().getMinutes();
    if(minute === 0){
      const net24h = totalFlow - totalVolume;
      const net1h = totalBuy1h - totalSell1h;
      let signal24h, signal1h;
      if(net24h > 1000000000) signal24h = "🟢 Accumulation";
      else if(net24h < -1000000000) signal24h = "🔴 Distribution";
      else signal24h = "🟡 Neutre";
      if(net1h > 500000000) signal1h = "🟢 Hausse";
      else if(net1h < -500000000) signal1h = "🔴 Baisse";
      else signal1h = "🟡 Stable";

      // Interpretation croisee
      let interpretation = "";
      if(net1h > 0 && net24h > 0) interpretation = "📈 Accumulation continue";
      else if(net1h < 0 && net24h > 0) interpretation = "⚠️ Correction sur tendance haussiere";
      else if(net1h > 0 && net24h < 0) interpretation = "🔄 Rebond sur tendance baissiere";
      else interpretation = "📉 Distribution continue";

      await sendTelegram(`📊 Rapport Horaire PulseChain\n━━━━━━━━━━━━━━━\nPrix PLS : $${plsPrice}\nVariation 1h : ${plsChange > 0 ? "+" : ""}${plsChange}%\n━━━━━━━━━━━━━━━\nWhales 1h\nBUY : ${Math.round(totalBuy1h/1000000)}M PLS\nSELL : ${Math.round(totalSell1h/1000000)}M PLS\nFlux 1h : ${net1h > 0 ? "+" : ""}${Math.round(net1h/1000000)}M ${signal1h}\n━━━━━━━━━━━━━━━\nWhales 24h\nBUY : ${Math.round(totalFlow/1000000)}M PLS\nSELL : ${Math.round(totalVolume/1000000)}M PLS\nFlux 24h : ${net24h > 0 ? "+" : ""}${Math.round(net24h/1000000)}M ${signal24h}\n━━━━━━━━━━━━━━━\n${interpretation}\n━━━━━━━━━━━━━━━`);
    }

    // Sauvegarder l'etat mis a jour
    state.totalBuy24h = totalFlow;
    state.totalSell24h = totalVolume;
    state.totalBuy1h = totalBuy1h;
    state.totalSell1h = totalSell1h;
    state.netflow24h = totalFlow - totalVolume;
    state.lastBlock = latestBlock;
    state.lastUpdate = Date.now();
    state.lastBurstAlert = lastBurstAlert;
    state.lastAccumulationAlert = lastAccumulationAlert;
    await store.setJSON("state", state);

    return new Response("OK", {status: 200});

  }catch(e){
    console.error("Scan error:", e);
    return new Response("Error: "+e.message, {status: 500});
  }
}

export const config = {
  schedule: "*/2 * * * *"
};
