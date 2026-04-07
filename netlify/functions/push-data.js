// Reçoit les données de l'indexeur local et les stocke dans Supabase
// Appelé par ton indexeur local toutes les X secondes

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  // Vérification du secret pour que seul ton indexeur puisse écrire
  const auth = event.headers["x-indexer-secret"];
  if (auth !== process.env.INDEXER_SECRET) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { whales = [], netflow = null } = body;
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_KEY;

  const headers = {
    "Content-Type": "application/json",
    "apikey": SUPA_KEY,
    "Authorization": `Bearer ${SUPA_KEY}`,
    "Prefer": "resolution=ignore-duplicates" // ignore si tx_hash déjà présent
  };

  const errors = [];

  // Insérer les événements whales
  if (whales.length > 0) {
    const res = await fetch(`${SUPA_URL}/rest/v1/whale_events`, {
      method: "POST",
      headers,
      body: JSON.stringify(whales.map(w => ({
        wallet: w.wallet,
        amount_pls: w.amount_pls,
        type: w.type,
        block_number: w.block_number || null,
        tx_hash: w.tx_hash || null
      })))
    });
    if (!res.ok) errors.push(await res.text());
  }

  // Insérer un snapshot netflow
  if (netflow) {
    const res = await fetch(`${SUPA_URL}/rest/v1/netflow_snapshots`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({
        buy_accum: netflow.buy_accum,
        sell_accum: netflow.sell_accum,
        net: netflow.buy_accum - netflow.sell_accum
      })
    });
    if (!res.ok) errors.push(await res.text());
  }

  if (errors.length > 0) {
    return { statusCode: 500, body: JSON.stringify({ errors }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, inserted: whales.length }) };
}
