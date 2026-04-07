// Sert les données au frontend ET envoie les alertes Telegram
// Deux actions selon le paramètre ?action=

export async function handler(event) {
  const action = event.queryStringParameters?.action || "get-data";

  if (action === "get-data") return getData();
  if (action === "notify" && event.httpMethod === "POST") return sendNotify(event);

  return { statusCode: 400, body: "Unknown action" };
}

// ─── Lecture des données pour le frontend ────────────────────
async function getData() {
  const SUPA_URL = process.env.SUPABASE_URL;
  const SUPA_KEY = process.env.SUPABASE_KEY;

  const headers = {
    "apikey": SUPA_KEY,
    "Authorization": `Bearer ${SUPA_KEY}`
  };

  const [whalesRes, netflowRes] = await Promise.all([
    fetch(`${SUPA_URL}/rest/v1/whale_events?order=created_at.desc&limit=50`, { headers }),
    fetch(`${SUPA_URL}/rest/v1/netflow_snapshots?order=snapshot_at.desc&limit=200`, { headers })
  ]);

  const [whales, netflow] = await Promise.all([whalesRes.json(), netflowRes.json()]);

  // Calcul des stats agrégées
  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  const recent = whales.filter(w => new Date(w.created_at).getTime() > last24h);
  const buyVol  = recent.filter(w => w.type === "buy").reduce((s, w) => s + Number(w.amount_pls), 0);
  const sellVol = recent.filter(w => w.type === "sell").reduce((s, w) => s + Number(w.amount_pls), 0);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=15" // cache 15s côté CDN Netlify
    },
    body: JSON.stringify({
      whales,
      netflow_history: netflow.reverse(), // chronologique pour le graphique
      stats: {
        buy_24h: buyVol,
        sell_24h: sellVol,
        net_24h: buyVol - sellVol,
        tx_count_24h: recent.length
      },
      updated_at: Date.now()
    })
  };
}

// ─── Envoi alerte Telegram ────────────────────────────────────
async function sendNotify(event) {
  // Vérification du secret pour éviter le spam
  const auth = event.headers["x-indexer-secret"];
  if (auth !== process.env.INDEXER_SECRET) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Invalid JSON" }; }

  const { message, level = "medium" } = body;
  if (!message) return { statusCode: 400, body: "Missing message" };
  if (level === "low") return { statusCode: 200, body: JSON.stringify({ skipped: true }) };

  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML"
      })
    }
  );

  const data = await res.json();
  return { statusCode: res.ok ? 200 : 500, body: JSON.stringify(data) };
}
