import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUrl,numberPrice,extractPrice,evaluate} from '../src/price.js';
const html = offers => `<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Test',offers})}</script>`;
test('URL rejects other hosts, credentials, product-less links; preserves SKU',()=>{
  for(const url of ['https://evil.com/products/a-i123.html','https://lazada.vn.evil.com/products/a-i123.html','https://u:p@lazada.vn/products/a-i123.html','http://lazada.vn/products/a-i123.html','https://lazada.vn/']) assert.throws(()=>normalizeUrl(url));
  assert.equal(normalizeUrl('https://lazada.vn/products/a-i123.html?sku=5&spm=test'),'https://www.lazada.vn/products/a-i123.html?sku=5');
});
test('currency amounts avoid ranges and decimal ambiguity',()=>{
  assert.equal(numberPrice('1.799.000 ₫'),1799000);assert.equal(numberPrice('1799000.00'),1799000);
  for(const x of ['10 - 20','12.50',0,-10,'']) assert.equal(numberPrice(x),null);
});
test('only one VND product offer is accepted',()=>{
  assert.equal(extractPrice(html({price:'1799000',priceCurrency:'VND'})).price,1799000);
  assert.throws(()=>extractPrice(html({price:100,priceCurrency:'USD'})));
  assert.throws(()=>extractPrice(html({'@type':'AggregateOffer',lowPrice:10,highPrice:20,priceCurrency:'VND'})));
  assert.throws(()=>extractPrice(html([{price:10,priceCurrency:'VND'},{price:20,priceCurrency:'VND'}])));
  assert.throws(()=>extractPrice(html({price:10,priceCurrency:'VND',availability:'https://schema.org/OutOfStock'})));
  assert.throws(()=>extractPrice('<h1>captcha</h1>'));
});
test('warm-up never recommends purchase, tiny new low is not a deal',()=>{
  assert.equal(evaluate(50,Array.from({length:6},()=>({price:100}))).deal,false);
  assert.equal(evaluate(99,Array.from({length:7},()=>({price:100}))).deal,false);
  assert.equal(evaluate(85,Array.from({length:7},()=>({price:100}))).deal,true);
});
import worker from '../src/worker.js';
test('webhook refuses forged requests without accessing DB',async()=>{
  const r=await worker.fetch(new Request('https://bot.test/telegram',{method:'POST',body:'{}'}),{TELEGRAM_WEBHOOK_SECRET:'secret'});
  assert.equal(r.status,403);
});
test('unauthorized private chat is silently ignored',async()=>{
  const r=await worker.fetch(new Request('https://bot.test/telegram',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'secret'},body:JSON.stringify({message:{chat:{type:'private',id:999},text:'/add https://lazada.vn/products/a-i123.html'}})}),{TELEGRAM_WEBHOOK_SECRET:'secret',OWNER_CHAT_ID:'123'});
  assert.equal(r.status,200);
});
