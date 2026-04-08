export const handler = async (event) => {
  try {
    const { token } = event.queryStringParameters || {};
    
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ error: "Token required" }) };
    }

    const url = `https://api.dexscreener.com/latest/dex/tokens/${token}`;
    const response = await fetch(url);
    const data = await response.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    };
  } catch (error) {
    console.error("Proxy error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
