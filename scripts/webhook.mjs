// Read secrets only from environment. Never print token or Telegram response URLs.
const {TELEGRAM_BOT_TOKEN:token,TELEGRAM_WEBHOOK_SECRET:secret,WORKER_URL:url}=process.env;
if(!token || !secret || !url || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) throw new Error('Cần TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (16–256 ký tự A-Z a-z 0-9 _ -), WORKER_URL.');
const target=new URL('/telegram',url);
if(target.protocol!=='https:') throw new Error('WORKER_URL phải dùng HTTPS.');
const r=await fetch(`https://api.telegram.org/bot${token}/setWebhook`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:target.href,secret_token:secret,allowed_updates:['message'],max_connections:1}),signal:AbortSignal.timeout(15000)});
const data=await r.json();
if(!r.ok || !data.ok) throw new Error(`Không đăng ký được webhook (HTTP ${r.status}).`);
console.log('Webhook đã đăng ký. Gửi /start cho bot để kiểm tra.');
