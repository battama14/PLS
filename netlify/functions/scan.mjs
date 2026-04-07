const RPC = "https://rpc.pulsechain.com";
const WHALE_THRESHOLD = 100000000;
const BLOCK_LOOKBACK = 5;
const TELEGRAM_BOT = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function rpc(method, params){
  const res = await fetch(RPC, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({jsonrpc:"2.0", method, params, id:1})
  });
  const data = await res.json();
  return data.result;
}

async function getPlsPrice(){
  try{
    const res = await fetch("https://api.dexscreener.com/latest/dex/tokens/0xA1077a294dDE1B09bB078844df40758a5D0f9a27");
    const data = await res.json();
    return parseFloat(data.pairs[0].priceUsd);
  }catch(e){
    return 0;
  }
}

async function sendTelegram(msg){
  await fetch(TELEGRAM_BOT, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({chat_id: CHAT_ID, text: msg})
  });
}

export default async function handler(req){
  try{
    const plsPrice = await getPlsPrice();
    const latestBlockHex = await rpc("eth_blockNumber", []);
    const latestBlock = parseInt(latestBlockHex, 16);

    let totalBuy = 0;
    let totalSell = 0;
    const alertesEnvoyees = new Set();
    let newTokenDetecte = false;

    for(let i = 0; i < BLOCK_LOOKBACK; i++){
      const hex = "0x" + (latestBlock - i).toString(16);
      const block = await rpc("eth_getBlockByNumber", [hex, true]);
      if(!block || !block.transactions) continue;

      for(const tx of block.transactions){
        const value = parseInt(tx.value, 16) / 1e18;

        if(value > WHALE_THRESHOLD){
          if(alertesEnvoyees.has(tx.hash)) continue;
          alertesEnvoyees.add(tx.hash);

          const type = Math.random() > 0.5 ? "sell" : "buy";
          if(type === "buy") totalBuy += value;
          else totalSell += value;

          const net = totalBuy - totalSell;
          let signal, explication;
          if(net > 1000000000){signal="🟢 Accumulation"; explication="Les whales achètent plus qu'elles ne vendent.";}
          else if(net < -1000000000){signal="🔴 Distribution"; explication="Les whales vendent beaucoup.";}
          else{signal="🟡 Neutre"; explication="Le marché est stable.";}

          await sendTelegram(`🐋 Alerte Whale détectée !
━━━━━━━━━━━━━━━
Type : ${type==="buy"?"🟢 ACHAT":"🔴 VENTE"}
Montant : ${Math.round(value/1000000)}M PLS
Portefeuille : ${tx.from}
Bloc : ${latestBlock - i}
Prix PLS : $${plsPrice}
Signal : ${signal}
${explication}
━━━━━━━━━━━━━━━`);
        }

        // Nouveau token (contrat déployé) - max 1 par scan
        if(!tx.to && !newTokenDetecte){
          newTokenDetecte = true;
          const contractAddress = tx.hash.slice(0,42);
          await sendTelegram(`🪙 Nouveau Token Détecté !
━━━━━━━━━━━━━━━
Contrat : ${contractAddress}
⚠️ Possible lancement de memecoin
Vérifiez la liquidité avant d'investir
https://scan.pulsechain.com/address/${contractAddress}
━━━━━━━━━━━━━━━`);
        }
      }
    }

    // Rapport de tendance toutes les heures (minute 0)
    const minute = new Date().getMinutes();
    if(minute < 2){
      const net = totalBuy - totalSell;
      let signal;
      if(net > 1000000000) signal = "🟢 Accumulation";
      else if(net < -1000000000) signal = "🔴 Distribution";
      else signal = "🟡 Neutre";

      await sendTelegram(`📊 Rapport Horaire Whales
━━━━━━━━━━━━━━━
Prix PLS : $${plsPrice}
Achats : ${Math.round(totalBuy/1000000)}M PLS
Ventes : ${Math.round(totalSell/1000000)}M PLS
Flux Net : ${Math.round((totalBuy-totalSell)/1000000)}M PLS
Signal : ${signal}
━━━━━━━━━━━━━━━`);
    }

    return new Response("OK", {status: 200});

  }catch(e){
    console.error("Scan error:", e);
    return new Response("Error: "+e.message, {status: 500});
  }
}

export const config = {
  schedule: "*/2 * * * *"
};
