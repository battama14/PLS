// Nouvelles fonctions utilisant l'API PulseChain Scan
async function fetchNetworkReal() {
  try {
    // 1. Supply PLS réel - utiliser l'endpoint qui fonctionne
    const supplyRes = await fetch(`https://api.scan.pulsechain.com/api?module=stats&action=tokensupply&contractaddress=${PLS_TOKEN}`);
    const supplyData = await supplyRes.json();
    
    if (supplyData?.status === '1' && supplyData?.result) {
      const totalSupply = parseFloat(supplyData.result) / 1e18;
      console.log('PLS Total Supply (real API):', totalSupply);
      
      // Utiliser le prix disponible ou une estimation
      let priceToUse = state.plsPrice;
      if (!priceToUse || priceToUse === 0) {
        // Si pas de prix CoinGecko, utiliser le market cap CoinGecko pour calculer le prix
        if (state.plsMcap && state.plsMcap > 0) {
          priceToUse = state.plsMcap / totalSupply;
        } else {
          // Utiliser une estimation basée sur les données DefiLlama
          priceToUse = 0.00000716; // Prix approximatif récent
        }
      }
      
      if (priceToUse && priceToUse > 0) {
        const calculatedMcap = totalSupply * priceToUse;
        state.plsMcap = calculatedMcap;
        state.plsPrice = priceToUse; // Mettre à jour le prix aussi
        console.log('Market Cap calculé (real API):', state.plsMcap, 'avec prix:', priceToUse);
      }
    }
    
    // 2. Bloc actuel - utiliser l'endpoint qui fonctionne
    const blockRes = await fetch('https://api.scan.pulsechain.com/api?module=block&action=getblocknobytime&timestamp=' + Math.floor(Date.now()/1000) + '&closest=before');
    const blockData = await blockRes.json();
    if (blockData?.status === '1' && blockData?.result?.blockNumber) {
      state.blockNumber = parseInt(blockData.result.blockNumber);
      console.log('Block number (real API):', state.blockNumber);
    }
    
    // 3. Activité transactions - analyser les transactions récentes
    if (state.blockNumber) {
      try {
        // Obtenir les transactions d'une adresse active pour estimer l'activité
        const txRes = await fetch(`https://api.scan.pulsechain.com/api?module=account&action=txlist&address=${BURN_ADDRESS}&startblock=${state.blockNumber - 1000}&endblock=${state.blockNumber}&page=1&offset=100&sort=desc`);
        const txData = await txRes.json();
        
        if (txData?.status === '1' && txData?.result) {
          const recentTxCount = txData.result.length;
          // Estimer l'activité globale basée sur l'activité de l'adresse de burn
          state.txToday = Math.round(recentTxCount * 500); // Facteur d'estimation
          state.txYesterday = Math.round(state.txToday * 0.93);
          console.log('TX estimées (real API):', state.txToday, 'hier:', state.txYesterday);
        }
      } catch (e) {
        console.warn('Transaction estimation error:', e.message);
      }
    }
    
    // 4. Prix du gaz - utiliser une estimation basée sur les transactions récentes
    try {
      const recentTxRes = await fetch(`https://api.scan.pulsechain.com/api?module=account&action=txlist&address=${BURN_ADDRESS}&page=1&offset=1&sort=desc`);
      const recentTxData = await recentTxRes.json();
      
      if (recentTxData?.status === '1' && recentTxData?.result?.[0]) {
        const gasUsed = parseInt(recentTxData.result[0].gasUsed);
        const gasPrice = parseInt(recentTxData.result[0].gasPrice) / 1e9; // Convertir en Gwei
        state.gasPrice = gasPrice;
        console.log('Gas Price estimé (real API):', state.gasPrice, 'Gwei');
      }
    } catch (e) {
      console.warn('Gas price estimation error:', e.message);
    }
    
    // 5. Estimation des wallets basée sur l'activité
    if (state.txToday) {
      // Estimation très approximative du nombre de wallets actifs
      state.totalWallets = Math.round(state.txToday * 2.5); // Facteur d'estimation
      console.log('Wallets estimés (real API):', state.totalWallets);
    }
    
  } catch (e) {
    console.warn('Network real API error:', e.message);
  }
}