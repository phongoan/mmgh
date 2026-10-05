# Lazada Price Watch Bot

Telegram bot chạy trên Cloudflare Workers để theo dõi giá nhiều sản phẩm Lazada, lưu lịch sử giá trong D1 và tự gửi báo cáo mỗi ngày lúc **07:00 (Asia/Ho_Chi_Minh)**.

## Tính năng

- Dán link Lazada trực tiếp: check giá ngay, không thêm vào watchlist.
- `/add <link>`: thêm sản phẩm vào watchlist và check ngay.
- `/list`: xem danh sách đang theo dõi.
- `/check`: check toàn bộ watchlist ngay.
- `/check 2`: check sản phẩm số 2.
- `/remove 2`: bỏ theo dõi sản phẩm số 2.
- `/help`: xem lệnh.
- Cron tự chạy lúc 07:00 giờ Việt Nam mỗi ngày.
- Lưu lịch sử giá theo từng sản phẩm.
- Đánh giá: `NÊN MUA`, `GIÁ TỐT`, `CÓ THỂ CHỜ`, `CHƯA NÊN MUA`.
- Gửi thêm cảnh báo mạnh khi giá lập đáy mới hoặc thấp hơn đáng kể so với trung bình gần đây.

## Lưu ý về giá Lazada

Bot cố lấy **giá bán công khai đang hiển thị trên trang sản phẩm** bằng nhiều lớp fallback (JSON-LD, meta tag và DOM). Voucher cá nhân, LazCoins, giá theo tài khoản, địa chỉ giao hàng và phí ship ở bước checkout không phải lúc nào cũng có thể xác định chính xác khi chạy headless browser chưa đăng nhập. Vì vậy bot dùng giá trang sản phẩm làm mốc lịch sử chính.

## 1. Chuẩn bị

Cần:

- Tài khoản Cloudflare.
- Node.js 20+.
- Telegram bot token tạo bằng `@BotFather`.

Clone repo rồi cài package:

```bash
git clone https://github.com/phongoan/mmgh.git
cd mmgh
npm install
npx wrangler login
```

## 2. Tạo D1 database

```bash
npx wrangler d1 create lazada-price-bot-db
```

Cloudflare sẽ trả về `database_id`. Mở `wrangler.jsonc` và thay:

```text
REPLACE_WITH_D1_DATABASE_ID
```

bằng ID thật.

Chạy migration:

```bash
npx wrangler d1 migrations apply lazada-price-bot-db --remote
```

## 3. Khai báo secrets

Không ghi token vào source code.

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

`TELEGRAM_WEBHOOK_SECRET` có thể là một chuỗi ngẫu nhiên dài, ví dụ tạo bằng password manager.

## 4. Deploy Worker

```bash
npm run deploy
```

Sau khi deploy, ghi lại URL Worker, ví dụ:

```text
https://lazada-price-bot.<subdomain>.workers.dev
```

## 5. Set Telegram webhook

Chạy lệnh sau ở máy của bạn, thay các giá trị trong `<>`:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<WORKER_URL>/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Sau đó nhắn `/start` cho bot. Khi chưa cấu hình `ALLOWED_CHAT_ID`, bot chỉ trả về Chat ID để bootstrap.

Lấy Chat ID bot trả về rồi khóa bot chỉ cho tài khoản của bạn:

```bash
npx wrangler secret put ALLOWED_CHAT_ID
```

Nhập đúng Chat ID khi Wrangler yêu cầu.

## 6. Sử dụng

Ví dụ:

```text
/add https://www.lazada.vn/products/....html
/list
/check
/check 1
/remove 1
```

Hoặc chỉ dán một link Lazada vào chat để kiểm tra ngay mà không lưu vào watchlist.

## Logic đánh giá

Bot so giá hiện tại với lịch sử của chính sản phẩm đó:

- **🔥 NÊN MUA**: giá thấp nhất kể từ khi theo dõi, hoặc thấp hơn khoảng 10% so với trung bình lịch sử gần đây.
- **🟢 GIÁ TỐT**: gần đáy lịch sử hoặc thấp hơn khoảng 5% so với trung bình.
- **🟡 CÓ THỂ CHỜ**: quanh mức bình thường.
- **🔴 CHƯA NÊN MUA**: cao hơn đáng kể so với trung bình.

Khi có dưới 3 lần ghi nhận, bot sẽ báo đang thu thập dữ liệu thay vì kết luận mạnh.

## Cron

Cloudflare Cron chạy theo UTC. Repo cấu hình:

```text
0 0 * * *
```

Tức **00:00 UTC = 07:00 Asia/Ho_Chi_Minh**.

## Health check

```text
GET /health
```

sẽ trả về JSON `{"ok":true}` nếu Worker đang chạy.

## Bảo mật

- Không commit `TELEGRAM_BOT_TOKEN`.
- Không commit `TELEGRAM_WEBHOOK_SECRET`.
- Sau bootstrap nên luôn cấu hình `ALLOWED_CHAT_ID`.
- Telegram webhook được kiểm tra bằng header `X-Telegram-Bot-Api-Secret-Token`.
