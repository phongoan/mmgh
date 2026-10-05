export function normalizeUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !['www.lazada.vn','lazada.vn','s.lazada.vn'].includes(u.hostname)) throw new Error('Chỉ nhận link https Lazada Việt Nam.');
  if (u.hostname !== 's.lazada.vn' && !/\/products\/.+-i\d+/.test(u.pathname)) throw new Error('Hãy gửi link trang sản phẩm Lazada.');
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (!['sku','sku_id'].includes(key)) u.searchParams.delete(key);
  if (u.hostname === 'lazada.vn') u.hostname = 'www.lazada.vn';
  return u.href;
}
export function numberPrice(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  const s = String(v ?? '').trim().replace(/(?:₫|đ|VND)/gi,'').trim();
  if (/^\d+$/.test(s)) return numberPrice(Number(s));
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) return numberPrice(Number(s.replace(/[.,]/g,'')));
  if (/^\d+\.00$/.test(s)) return numberPrice(Number(s));
  return null;
}
export function extractPrice(html) {
  const candidates = [];
  let name = 'Sản phẩm Lazada';
  const visit = x => {
    if (Array.isArray(x)) return x.forEach(visit);
    if (!x || typeof x !== 'object') return;
    if ([x['@type']].flat().includes('Product')) {
      name = x.name || name;
      for (const offer of [x.offers].flat()) {
        if (!offer) continue;
        if (offer['@type'] === 'AggregateOffer' || offer.lowPrice != null || offer.highPrice != null) throw new Error('Sản phẩm có nhiều mức giá/biến thể. Chưa xác định được giá đúng.');
        if (!/^(VND)$/i.test(offer.priceCurrency || '')) continue;
        if (/OutOfStock|Discontinued|SoldOut/.test(offer.availability || '')) throw new Error('Sản phẩm hết hàng.');
        const p = numberPrice(offer.price);
        if (p) candidates.push(p);
      }
    }
    if (x['@graph']) visit(x['@graph']);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(match[1]); } catch { continue; } visit(data);
  }
  if (candidates.length) {
    if (new Set(candidates).size !== 1) throw new Error('Có nhiều giá khác nhau; cần xác nhận biến thể.');
    return {price:candidates[0],name:String(name).slice(0,200),source:'JSON-LD VND'};
  }
  throw new Error('Không lấy được giá chắc chắn (có thể CAPTCHA hoặc trang đổi cấu trúc). Không ghi vào lịch sử.');
}
export function evaluate(price, rows) {
  const prior = rows.filter(x => Number.isFinite(x.price) && x.price > 0);
  if (prior.length < 7) return {deal:false,label:`Đang thu thập lịch sử (${prior.length}/7 ngày trước đó).`,min:prior.length ? Math.min(...prior.map(x=>x.price)) : null};
  const values = prior.map(x=>x.price).sort((a,b)=>a-b);
  const median = values[Math.floor(values.length/2)];
  const min = values[0];
  const deal = price <= median * .9 || (price < min && price <= median * .97);
  return {deal,min,average:Math.round(values.reduce((a,b)=>a+b,0)/values.length),label:deal ? '🔥 GIÁ NGON — CÓ THỂ MUA' : price <= min * 1.03 ? '🟢 GIÁ TỐT — gần đáy 30 ngày' : price > median * 1.1 ? '🔴 CHƯA NÊN MUA — cao hơn giá thường gặp' : '🟡 CÓ THỂ CHỜ'};
}
