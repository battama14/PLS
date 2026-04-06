const { getStore } = require("@netlify/blobs");

exports.handler = async () => {
  const store = getStore("whales");
  const { blobs } = await store.list();

  const now = Date.now();
  const il_y_a_24h = now - 24*60*60*1000;
  const il_y_a_48h = now - 48*60*60*1000;

  const whales = [];
  for(const blob of blobs){
    const data = await store.get(blob.key, {type:"json"});
    if(data) whales.push(data);
  }

  // Periode : dernières 24h vs 24h précédentes
  const periode_recente  = whales.filter(w => w.timestamp >= il_y_a_24h);
  const periode_precedente = whales.filter(w => w.timestamp >= il_y_a_48h && w.timestamp < il_y_a_24h);

  const stats = (liste) => ({
    achats: liste.filter(w=>w.type==="buy").reduce((s,w)=>s+w.amount,0),
    ventes: liste.filter(w=>w.type==="sell").reduce((s,w)=>s+w.amount,0),
    total: liste.length
  });

  const recent = stats(periode_recente);
  const precedent = stats(periode_precedente);

  const alertes = [];

  // Calcul variation en %
  if(precedent.achats > 0){
    const varAchat = ((recent.achats - precedent.achats) / precedent.achats) * 100;
    if(varAchat >= 10){
      alertes.push(`📈 Hausse des ACHATS whales de ${Math.round(varAchat)}% sur 24h`);
    }
    if(varAchat <= -10){
      alertes.push(`📉 Baisse des ACHATS whales de ${Math.abs(Math.round(varAchat))}% sur 24h`);
    }
  }

  if(precedent.ventes > 0){
    const varVente = ((recent.ventes - precedent.ventes) / precedent.ventes) * 100;
    if(varVente >= 10){
      alertes.push(`📈 Hausse des VENTES whales de ${Math.round(varVente)}% sur 24h`);
    }
    if(varVente <= -10){
      alertes.push(`📉 Baisse des VENTES whales de ${Math.abs(Math.round(varVente))}% sur 24h`);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      alertes,
      recent,
      precedent
    })
  };
};
