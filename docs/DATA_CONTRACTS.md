# Đặc tả Hợp đồng Dữ liệu & Trạng thái (`DATA_CONTRACTS.md`)

Tài liệu mô tả nguồn dữ liệu, định nghĩa chỉ số, quy ước ngày giờ và cách biểu diễn trạng thái lỗi/thiếu dữ liệu trên `ToanTrungMar_V2_Independent`.

## 1. Nguồn dữ liệu thực tế
| Miền | Nguồn chính | Tài sản / Phạm vi được phép | Bảng DB chính |
| --- | --- | --- | --- |
| **Lead & CRM (M01)** | Nhập tay, Website Webhook, Gmail API (`gmail.readonly`) | 2 form web (`bangled.vn`, `toantrung.com.vn`), email khách, hotline, Zalo | `leads`, `lead_activities`, `marketing_trackings` |
| **Traffic Web (M02/M03)** | Google Analytics 4 Data API (`runReport`, `runRealtimeReport`) | 4 Properties: `512879968` (toantrung.com.vn), `509190194` (manhinhled.net.vn), `538179128` (bangled.vn), `508951192` (Bảng điện tử) | `platform_daily_metrics` (`platform='ga4'`) |
| **SEO / Tìm kiếm (M02/M03)** | Google Search Console API | 3 Sites: `https://toantrung.com.vn/`, `https://manhinhled.net.vn/`, `https://bangled.vn/` | `platform_daily_metrics` (`platform='search_console'`), `seo_keywords` |
| **Quảng cáo (M02/M03)** | Google Ads API / Nhập Excel/CSV | Chiến dịch & chi phí VND (`spendMicros`, `clicks`, `impressions`) | `campaigns`, `platform_daily_metrics` (`platform='google_ads'`) |
| **AI Design (M05)** | Google Gemini/Imagen, OpenAI/Custom Gateway, Studio Engine v3 | Phối cảnh 3D & Banner/Poster + BOM LED | `design_requests`, `design_asset_versions`, `ai_usage_logs` |

## 2. Định nghĩa chỉ số & Quy ước ngày
- **Phễu Lead (M01/M02/M04):**
  - **L1 (Lead thô):** Mọi Lead tiếp nhận trong kỳ lọc.
  - **L2 (Lead hợp lệ - Pipeline):** `L1` trừ toàn bộ Lead bị gắn cờ Spam (`isSpam = true`, kể cả chờ xác nhận).
  - **L3 (Lead hiệu quả - Tính CPL):** `L2` trừ Spam tự động & Spam đã xác nhận (`spamAdsExclusionStatus`).
- **Múi giờ & Cửa sổ ngày (`reporting-dates.ts`):**
  - Lưu trữ UTC; chuẩn hóa lọc & báo cáo theo ngày nghiệp vụ `Asia/Ho_Chi_Minh`.
  - **Độ trễ chốt sổ Google:** GA4 lịch sử và Search Console thường trễ 24–48 giờ cho ngày hiện tại. Khi người dùng chọn mốc `Hôm nay` (`periodDays <= 1`) mà chưa có bản ghi ngày hôm nay, API tự động hiển thị cửa sổ lũy kế gần nhất đã đồng bộ kèm nhãn chú thích rõ phạm vi ngày thực tế (không trả `--` giả trống, không bịa số ngày hôm nay).
- **Chống trùng tiếp nhận:**
  - Khóa duy nhất `(intakeSourceProvider, intakeSourceAccountKey, externalSubmissionId)` trên `marketing_trackings`. Gmail sync kiểm tra tồn tại trước khi tải chi tiết thư và trước khi insert.

## 3. Biểu diễn trạng thái Lỗi / Thiếu dữ liệu (Trung thực, không giả lập)
- `NOT_CONNECTED`: Chưa liên kết Google OAuth 2.0.
- `SANDBOX_DEMO`: Đang ở chế độ kiểm thử mẫu, không gọi Gmail/Google API thật.
- `MISSING_GMAIL_SCOPE`: Token Google chưa có quyền `gmail.readonly`.
- `FAILED_SYNC` / `STALE_DATA_WITH_ERROR`: Phiên đồng bộ gần nhất thất bại, giữ lại dữ liệu cũ nếu có và hiển thị rõ thông báo lỗi thật.
- `CONFIRMED_ZERO`: API Google trả về thành công với giá trị 0 thực tế trong kỳ.
- `NOT_SYNCED`: Đã kết nối nhưng chưa có bản ghi cho kỳ được chọn.
- `LIVE_SEARCH_DEMAND`: Tab xu hướng tổng hợp trực tiếp từ từ khóa tìm kiếm thực tế trên Search Console khi Google Trends API chưa được cấp quyền.

