# Lazada Telegram Watch

Bot riêng theo dõi tối đa 3 sản phẩm Lazada VN. Dán link = kiểm tra một lần; `/add LINK` = theo dõi mỗi sáng. `/list`, `/check`, `/check ID`, `/remove ID`, `/help`.

**Trạng thái: chưa deploy, chưa thử trên sản phẩm Lazada thật.** Source và kiểm thử đã có. CAPTCHA, đăng nhập, trang thay đổi hoặc dữ liệu nhiều biến thể có thể làm lấy giá thất bại. Không vượt CAPTCHA; không ghi giá khi không xác minh được.

## Cài đặt

Cần Node.js 22+, tài khoản Cloudflare Free, Telegram. Không bật gói trả phí để làm thử.

1. Telegram: tạo bot qua @BotFather với `/newbot`, giữ token riêng, nhắn `/start` cho bot mới. Lấy chat ID số của bạn qua @userinfobot.
2. Clone/tải repo về máy. Trong terminal ở thư mục repo chạy:

   ```sh
   npm install
   npx wrangler login
   npx wrangler d1 create lazada-watch
   ```

3. Điền `database_id` vừa tạo và `CF_ACCOUNT_ID` (Cloudflare Dashboard) trong `wrangler.toml`. Đây là ID, không phải token.
4. Cloudflare → API Tokens → Create Custom Token: quyền Account / Browser Rendering / Edit, giới hạn đúng tài khoản. Kiểm tra Browser Run khả dụng trên tài khoản.
5. Đặt secrets qua prompt; không đưa token vào repo hoặc gửi trong chat:

   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put OWNER_CHAT_ID
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npx wrangler secret put CF_BROWSER_TOKEN
   ```

   Webhook secret: chuỗi ngẫu nhiên 32+ ký tự chỉ gồm chữ, số, `_`, `-`; giữ lại để đăng ký webhook. Tạo bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
6. Chạy:

   ```sh
   npm run db:migrate
   npm test
   npm run deploy
   ```

7. Đăng ký webhook. Ví dụ PowerShell 7, nhập secrets bằng prompt tránh ghi vào lịch sử:

   ```powershell
   $env:TELEGRAM_BOT_TOKEN = Read-Host 'Telegram bot token' -MaskInput
   $env:TELEGRAM_WEBHOOK_SECRET = Read-Host 'Webhook secret' -MaskInput
   $env:WORKER_URL = Read-Host 'Worker URL https://...workers.dev'
   npm run webhook
   Remove-Item Env:TELEGRAM_BOT_TOKEN, Env:TELEGRAM_WEBHOOK_SECRET
   ```

   Với terminal khác, đặt ba biến môi trường qua cơ chế nhập bí mật rồi chạy `npm run webhook`. Script không in token.
8. Nhắn `/start`, dán link thật, đối chiếu giá với đúng biến thể trên Lazada. Sau đó `/add LINK` và `/list`. Kiểm tra báo cáo sáng hôm sau trước khi tin vào lịch sử.

## Giá và lịch sử

Cloudflare Browser Run `/content` lấy HTML sau khi chạy JavaScript. JSON-LD Product Offer phải có tiền tệ VND và một mức giá; fallback chỉ nhận khi meta VND khớp giá DOM. Không lấy giá gạch ngang. Nếu giá nhiều mức/hết hàng/không đọc được, gửi lỗi và không ghi vào lịch sử.

**Chỉ xác minh giá trang sản phẩm.** Voucher, phí ship, giá thanh toán cá nhân chưa xác minh và luôn ghi rõ. Bot không đăng nhập Lazada. Link SKU được giữ, nhưng chưa xác minh JSON-LD của mọi sản phẩm phản ánh SKU đã chọn. Nên bắt đầu với trang có một biến thể và đối chiếu giá lần đầu. Link rút gọn không giải được thì dùng link đầy đủ.

Mỗi link có lịch sử riêng. Cùng ngày cập nhật cùng một điểm, không làm tăng số ngày. Cần 7 ngày trước đó mới đánh giá; dùng tối đa 30 ngày:

- Deal: giá ≤90% trung vị, hoặc thấp nhất mới và ≤97% trung vị.
- Giá tốt: trong 3% đáy 30 ngày.
- Giá cao: >110% trung vị.
- Còn lại: có thể chờ.

Báo cáo thường gửi im lặng; cảnh báo deal bật thông báo tối đa một lần mỗi món/ngày, theo cài đặt Telegram của bạn. Đánh giá chỉ theo giá đã thu thập, không bao gồm chất lượng, uy tín shop hoặc lịch sử trước khi chạy bot.

## Lịch và giới hạn

Cron 00:00 UTC tạo lượt kiểm tra = 07:00 Việt Nam. Cron mỗi phút xử lý một món; kết quả khoảng 07:00–07:03, không bảo đảm đúng giây. Lệnh thủ công cũng đợi khoảng 1–3 phút (lâu hơn nếu còn hàng đợi).

Free Browser Run hiện 10 phút/ngày. Ứng dụng giới hạn 12 lượt lấy giá/ngày, timeout 25 giây/lượt; không tự nâng gói trả phí. Theo dõi usage trên Dashboard: các ứng dụng khác có thể chia sẻ quota, timeout không đảm bảo thời gian xử lý phía dịch vụ luôn dừng ngay. Quota hết thì bot báo lỗi.

D1 lưu hàng đợi trước khi webhook trả lời, unique key chống lặp job; lease tránh hai cron xử lý cùng job. Khi thất bại, dùng `/check` để thử lại. Gián đoạn sau khi gửi tin nhưng trước khi hoàn tất job có thể gửi lặp báo cáo; Telegram không hỗ trợ idempotency cho sendMessage. `/health` chỉ kiểm tra Worker phản hồi, không xác minh toàn bộ hệ thống.

Webhook bắt buộc secret, chỉ OWNER_CHAT_ID trong chat riêng được dùng. Repo không có token. Secrets lưu Cloudflare. Dừng theo dõi bằng `/remove ID`; dừng hoàn toàn bằng xóa cron/Worker trên Cloudflare. Hàng đợi hoàn tất dọn sau 7 ngày; lịch sử giữ trong D1.

## Kiểm thử

`npm test`: URL an toàn/giữ SKU, định dạng tiền, VND/nhiều biến thể/hết hàng/CAPTCHA, dữ liệu ít/đáy mới giảm nhẹ, webhook giả và chat trái phép. Chưa chạy end-to-end trên Cloudflare/Telegram/Lazada vì thiếu tài khoản và secrets.

## Tài liệu chính thức

- https://developers.cloudflare.com/browser-run/quick-actions/content-endpoint/
- https://developers.cloudflare.com/browser-run/limits/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/d1/get-started/
- https://core.telegram.org/bots/api#setwebhook
