exports.handler = async (event) => {
  if(event.httpMethod !== "POST") return {statusCode:405, body:"Méthode non autorisée"};

  const {message} = JSON.parse(event.body);
  const TOKEN = process.env.TELEGRAM_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({chat_id:CHAT_ID, text:message})
  });

  const data = await res.json();
  return {statusCode: data.ok ? 200 : 500, body: JSON.stringify(data)};
};
