const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if(event.httpMethod !== "POST") return {statusCode:405};

  const { type, amount, wallet, price } = JSON.parse(event.body);

  const store = getStore("whales");
  const key = `whale_${Date.now()}`;

  await store.setJSON(key, {
    type,
    amount,
    wallet,
    price,
    timestamp: Date.now()
  });

  return { statusCode: 200, body: JSON.stringify({ok:true}) };
};
