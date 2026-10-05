import { normalizeUrl, extractPrice, evaluate, numberPrice } from './price.js';
const money = n => `${Number(n).toLocaleString('vi-VN')}đ`;
const dayVN = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function send(env,text,urgent=false) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:env.OWNER_CHAT_ID,text:text.slice(0,4000),disable_web_page_preview:true,disable_notification:!urgent}),signal:AbortSignal.timeout(10000)});
  if (!r.ok || !(await r.json()).ok) throw new Error('Telegram gửi thất bại.');
}
async function enqueue(env,key,kind,value) {
  return env.DB.prepare('INSERT OR IGNORE INTO jobs(key,kind,value) VALUES(?,?,?)').bind(key,kind,String(value)).run();
}
async function resolveUrl(raw) {
  let url = normalizeUrl(raw);
  for (let i=0;i<5;i++) {
    if (new URL(url).hostname !== 's.lazada.vn') return url;
    const r = await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(8000)});
    if (![301,302,303,307,308].includes(r.status) || !r.headers.get('location')) throw new Error('Không giải được link rút gọn. Hãy copy link đầy đủ từ trang sản phẩm.');
    url = normalizeUrl(new URL(r.headers.get('location'),url).href);
  }
  throw new Error('Link chuyển hướng quá nhiều.');
}
async function readPrice(env,url) {
  const day = dayVN();
  await env.DB.prepare('INSERT OR IGNORE INTO budget(day,used) VALUES(?,0)').bind(day).run();
  const budget = await env.DB.prepare('UPDATE budget SET used=used+1 WHERE day=? AND used<12 RETURNING used').bind(day).first();
  if (!budget) throw new Error('Đã dùng 12 lượt lấy giá hôm nay; chờ ngày mai để giữ ngân sách miễn phí.');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-run/content`,{method:'POST',headers:{Authorization:`Bearer ${env.CF_BROWSER_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({url,gotoOptions:{waitUntil:'networkidle2',timeout:20000}}),signal:AbortSignal.timeout(25000)});
  if (!r.ok) throw new Error(`Browser Run không lấy được trang (HTTP ${r.status}).`);
  const data = await r.json();
  if (!data.success || typeof data.result !== 'string') throw new Error('Browser Run trả kết quả không hợp lệ.');
  const html = data.result;
  if(html.length>2000000) throw new Error('Trang quá lớn; chưa lấy được giá an toàn.');
  try { return extractPrice(html); } catch (error) {
    // Never override ambiguity/out-of-stock with a displayed minimum price.
    if (!error.message.startsWith('Không lấy được')) throw error;
    let title = '', currency = '', amount = '', dom = '';
    await new HTMLRewriter()
      .on('meta[property="og:title"]',{element(e){title=e.getAttribute('content') || '';}})
      .on('meta[property="product:price:currency"]',{element(e){currency=e.getAttribute('content') || '';}})
      .on('meta[property="product:price:amount"]',{element(e){amount=e.getAttribute('content') || '';}})
      .on('.pdp-price_type_normal',{text(t){dom+=t.text;}})
      .transform(new Response(html)).text();
    const meta = currency === 'VND' ? numberPrice(amount) : null;
    const visible = numberPrice(dom);
    if (meta && visible && meta === visible) return {price:meta,name:title.slice(0,200) || 'Sản phẩm Lazada',source:'meta VND + giá hiển thị khớp'};
    throw error;
  }
}
async function checkProduct(env,product,oneOff=false) {
  const quote = await readPrice(env,product.url);
  const day = dayVN();
  const history = product.id ? (await env.DB.prepare("SELECT price,day FROM prices WHERE product_id=? AND day<? AND day>=date(?,'-30 days') ORDER BY day").bind(product.id,day,day).all()).results : [];
  const verdict = evaluate(quote.price,history);
  if (product.id) await env.DB.batch([
    env.DB.prepare('INSERT INTO prices(product_id,day,price,source) VALUES(?,?,?,?) ON CONFLICT(product_id,day) DO UPDATE SET price=excluded.price,source=excluded.source').bind(product.id,day,quote.price,quote.source),
    env.DB.prepare('UPDATE products SET name=? WHERE id=?').bind(quote.name,product.id)
  ]);
  const lines = [`📊 LAZADA — ${day}`,`${product.id ? '#'+product.id+' ' : ''}${quote.name}`,`💰 Giá trang sản phẩm: ${money(quote.price)}`];
  if(verdict.min) lines.push(`📉 Thấp nhất 30 ngày trước: ${money(verdict.min)}`);
  if(verdict.average) lines.push(`📊 Trung bình ${history.length} ngày: ${money(verdict.average)}`);
  lines.push(oneOff && !product.id ? 'Chưa có lịch sử riêng: chưa đủ dữ liệu khuyên mua.' : verdict.label,'Voucher, phí ship và giá thanh toán: chưa xác minh.',`Nguồn: ${quote.source}`,product.url);
  await send(env,lines.join('\n'));
  if(verdict.deal && product.id) {
    const alert = await env.DB.prepare('INSERT OR IGNORE INTO alerts(product_id,day) VALUES(?,?)').bind(product.id,day).run();
    if(alert.meta.changes) {
      try { await send(env,`🚨🔥 GIÁ NGON\n${quote.name}\n${money(quote.price)}\n${verdict.label}\nĐánh giá theo lịch sử đã thu thập; hãy kiểm tra biến thể và tổng tiền trước khi mua.\n${product.url}`,true); }
      catch(e) { await env.DB.prepare('DELETE FROM alerts WHERE product_id=? AND day=?').bind(product.id,day).run(); throw e; }
    }
  }
}
async function handleJob(env,job) {
  if(job.kind === 'add') {
    const url = await resolveUrl(job.value);
    const existing = await env.DB.prepare('SELECT * FROM products WHERE url=?').bind(url).first();
    const count = await env.DB.prepare('SELECT count(*) AS n FROM products WHERE active=1').first();
    if(!existing?.active && count.n>=3) throw new Error('Bản miễn phí này theo dõi tối đa 3 món. /remove ID trước khi thêm.');
    await env.DB.prepare('INSERT INTO products(url) VALUES(?) ON CONFLICT(url) DO UPDATE SET active=1').bind(url).run();
    const product = await env.DB.prepare('SELECT * FROM products WHERE url=?').bind(url).first();
    await send(env,`Đã thêm #${product.id}. Sẽ theo dõi mỗi sáng 07:00. Đang kiểm tra giá lần đầu.`);
    return checkProduct(env,product);
  }
  if(job.kind === 'url') {
    const url = await resolveUrl(job.value);
    const product = await env.DB.prepare('SELECT * FROM products WHERE url=?').bind(url).first();
    return checkProduct(env,product || {url},true);
  }
  const product = await env.DB.prepare('SELECT * FROM products WHERE id=? AND active=1').bind(Number(job.value)).first();
  if (product) return checkProduct(env,product);
}
async function processOne(env) {
  const job = await env.DB.prepare("UPDATE jobs SET status='running',leased_at=unixepoch(),attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE (status='pending' OR (status='running' AND leased_at<unixepoch()-180)) AND attempts<2 ORDER BY id LIMIT 1) RETURNING *").first();
  if (!job) return;
  try {
    await handleJob(env,job);
    await env.DB.prepare("UPDATE jobs SET status='done' WHERE id=?").bind(job.id).run();
  } catch(e) {
    // A failed fetch must never become a price point or a buying alert.
    try { await send(env,`⚠️ Không hoàn tất yêu cầu ${job.kind} ${job.kind==='check'?'#'+job.value:''}: ${e.message}\nDùng /check để thử lại sau.`); } catch {}
    await env.DB.prepare("UPDATE jobs SET status='failed' WHERE id=?").bind(job.id).run();
  }
}
async function command(env,update) {
  const msg = update.message;
  if (!msg || msg.chat?.type !== 'private' || String(msg.chat.id)!==String(env.OWNER_CHAT_ID) || !msg.text) return;
  const text = msg.text.trim();
  const [raw,...args] = text.split(/\s+/);
  const cmd = raw.split('@')[0];
  const value = args.join(' ');
  const key = `tg:${update.update_id}`;
  if(cmd==='/start' || cmd==='/help') return send(env,'Dán link Lazada: kiểm tra một lần\n/add LINK: theo dõi mỗi sáng 07:00\n/list: danh sách\n/check: kiểm tra tất cả\n/check ID: kiểm tra một món\n/remove ID: dừng theo dõi\nTối đa 3 món; tối đa 12 lượt lấy giá/ngày. Lệnh lấy giá xử lý khoảng 1–3 phút.');
  if(cmd==='/list') {
    const rows=(await env.DB.prepare('SELECT * FROM products WHERE active=1 ORDER BY id').all()).results;
    return send(env,rows.length ? rows.map(p=>`#${p.id} ${p.name || 'Chưa lấy được tên'}\n${p.url}`).join('\n\n') : 'Danh sách đang trống. Dùng /add LINK.');
  }
  if(cmd==='/remove') {
    if(!/^\d+$/.test(value)) return send(env,'Dùng /remove ID (ID xem bằng /list).');
    const r=await env.DB.prepare('UPDATE products SET active=0 WHERE id=? AND active=1').bind(Number(value)).run();
    return send(env,r.meta.changes ? `Đã dừng theo dõi #${value}.` : 'Không có ID này trong danh sách.');
  }
  if(cmd==='/check') {
    if(value && !/^\d+$/.test(value)) return send(env,'Dùng /check hoặc /check ID.');
    const rows=(await env.DB.prepare('SELECT id FROM products WHERE active=1').all()).results.filter(p=>!value || p.id===Number(value));
    if(!rows.length) return send(env,'Không có sản phẩm phù hợp. Dùng /list hoặc /add LINK.');
    for(const p of rows) await enqueue(env,`${key}:${p.id}`,'check',p.id);
    return send(env,`Đã xếp lịch kiểm tra ${rows.length} món. Kết quả sẽ về trong khoảng 1–3 phút.`);
  }
  if(cmd==='/add' || /^https:\/\//.test(text)) {
    let url;
    try {url = normalizeUrl(cmd==='/add' ? value : text);} catch {return send(env,'Hãy gửi link https trang sản phẩm Lazada Việt Nam hợp lệ.');}
    await enqueue(env,key,cmd==='/add'?'add':'url',url);
    return send(env,'Đã nhận link. Đang xếp lịch lấy giá (khoảng 1–3 phút).');
  }
  return send(env,'Dùng /help để xem lệnh.');
}
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path==='/health' && request.method==='GET') return Response.json({ok:true});
    if(path!=='/telegram' || request.method!=='POST') return new Response('Not found',{status:404});
    if(!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET) return new Response('Forbidden',{status:403});
    if(Number(request.headers.get('content-length') || 0)>32768) return new Response('Too large',{status:413});
    let update; try {const body=await request.text();if(body.length>32768) return new Response('Too large',{status:413});update=JSON.parse(body);} catch {return new Response('Bad JSON',{status:400});}
    // Persist jobs before acknowledging webhook; unique keys stop duplicate fetch jobs.
    try {await command(env,update);} catch {return new Response('Retry',{status:503});}
    return new Response('OK');
  },
  async scheduled(controller,env,ctx) {
    ctx.waitUntil((async()=>{
      if(controller.cron==='0 0 * * *') {
        const rows=(await env.DB.prepare('SELECT id FROM products WHERE active=1 ORDER BY id').all()).results;
        for(const p of rows) await enqueue(env,`daily:${dayVN()}:${p.id}`,'check',p.id);
      }
      await processOne(env);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM jobs WHERE created_at<unixepoch()-604800 AND status IN ('done','failed')"),
        env.DB.prepare("DELETE FROM budget WHERE day<date('now','-7 days')"),
        env.DB.prepare("DELETE FROM alerts WHERE day<date('now','-35 days')")
      ]);
    })());
  }
};
