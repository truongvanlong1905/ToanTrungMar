# Handoff 05-ai-design — Hỗ trợ thiết kế & phối cảnh AI (Giai đoạn 2)

Cập nhật: 11/11/2026.  
Nhóm 5 — Lý Tăng Hữu.  
Nhánh Git: `feature/ai-design`.  
Kho mã nguồn GitHub: `https://github.com/truongvanlong1905/ToanTrungMar` (nhánh `main`).

---

## 1. Hiện trạng & Nguồn nghiệp vụ chuẩn
- Đã tiếp nhận và phân tích toàn diện **Tài liệu đặc tả BA: UC06 (Hỗ trợ thiết kế & phối cảnh AI)** kèm Sơ đồ hoạt động, Sơ đồ tuần tự và BPMN As-is/To-be.
- Chi tiết đặc tả nghiệp vụ đầy đủ đã được ghi nhận tại [docs/modules/05-ai-design.md](../modules/05-ai-design.md).
- Mã nguồn hiện tại: Đã triển khai hoàn chỉnh (`apps/web/src/modules/05-ai-design/AiDesignWorkspace.tsx`, `apps/api/src/modules/05-ai-design/service.ts`, `apps/api/src/modules/05-ai-design/providers/`, `packages/contracts/src/05-ai-design/index.ts`):
  - Rút gọn **Cài đặt thông số** chỉ còn 2 cột thiết yếu (**1. Thông tin dự án** và **2. Cài đặt chuẩn Đầu ra & Khung hình**), loại bỏ tab **Sơ đồ Cabin & BOM** và nút **Hồ sơ A4 / PDF** tự suy diễn thông số kỹ thuật giả định.
  - Tách **Kho ảnh** thành 2 kho riêng biệt: **🏗️ Công trình** (tải hàng loạt ảnh công trình vào dự án đang mở) và **🏢 Kho SP Cty** (kho ảnh mẫu sản phẩm công ty dùng chung xuyên suốt mọi dự án để bấm chọn ghép vào hiện trường / Banner).
  - Rút gọn bộ chọn **Model** thành 1 danh sách tối giản (`GPT 2.5 Image`, `Gemini 2.5 Flash Image`, `Google Imagen 3`, `Gemini 3.5 Flash`, `FLUX.1 Pro Ultra`) kèm dòng gắn API Key nhanh.
  - Đã kiểm tra `npm run typecheck` (0 lỗi trên cả 4 workspace) và `node --test apps/api/src/core/__tests__/ai-design-studio-upgrade.test.js` (16/16 test PASS).

---

## 2. Các nghiệp vụ trọng tâm đã chốt
1. **Dựng nháp phối cảnh 3D màn hình LED bằng AI**:
   - Đầu vào: Ảnh hiện trạng công trình thực tế (từ máy hoặc đính kèm từ Lead UC01) + Chủng loại/kiểu dáng LED + Kích thước/vị trí trên ảnh + Prompt mô tả.
   - AI render màn hình LED 3D chân thực lên ảnh hiện trạng. Lưu vào Thư viện ấn phẩm, ghi nhận thời gian và chi phí token AI.
2. **Tạo hình ảnh & Banner bằng AI**:
   - Thiết lập kích thước pixel, tỷ lệ khung hình màn hình LED cần hiển thị.
   - AI sinh ảnh banner độ nét cao đúng tỷ lệ khung hình.
3. **Quản lý Thư viện ấn phẩm & Hoàn thiện**:
   - Lưu trữ bản nháp AI (`ai_draft_image_url`) và bản hoàn thiện sau khi Designer chỉnh sửa qua Photoshop/3DsMax (`final_render_url`).
   - Tải file độ phân giải cao bàn giao cho bộ phận Kinh doanh đính kèm báo giá.
4. **Bảo mật & Database Model (Đã hoàn thiện tại `packages/database/prisma/models/05-ai-design.prisma`)**:
   - Tuyệt đối không gửi thông tin cá nhân khách hàng (SĐT, email, tên công ty) sang AI bên thứ 3.
   - Gồm 2 bảng thuộc Nhóm 5: `design_requests` (hỗ trợ `lead_id` tùy chọn cho Banner độc lập, `version`, `approved_version_id`, `total_cost_micros BigInt?`) và `design_asset_versions` (`@@unique([design_request_id, version_number])`, lưu đầy đủ từng phiên bản nháp AI và bản hoàn thiện Designer).
   - Nhật ký từng lượt gọi AI (kể cả lỗi/timeout) dùng bảng chung `ai_usage_logs` tại `core.prisma` thông qua contract `recordAiUsageAttempt`. Quy tắc bắt buộc gắn Lead cho riêng phối cảnh 3D và điểm tạo ticket theo dõi tại [Q14](../decisions/OPEN_QUESTIONS.md#q14).

---

## 3. Nâng cấp MK01–MK07: 4 Tác vụ tường minh, AI Model Registry & Lineage (18/11/2026)
1. **Phân chia 4 tác vụ thiết kế tường minh**:
   - `banner_generate`: Tạo banner / poster truyền thông từ brief và kích thước kênh.
   - `design_edit`: Chỉnh sửa trên phiên bản/ảnh tham chiếu gốc (`parentVersionId`), chuyển trực tiếp buffer vào `/images/edits`, tuyệt đối không fallback ngầm về tạo mới.
   - `perspective_compose`: Dựng phối cảnh màn hình LED lên ảnh công trình.
   - `brief_analyze`: Phân tích brief & tư vấn thông số bằng mô hình ngôn ngữ/vision (Gemini Flash), không sinh ảnh và không tốn phí ảnh.
2. **AI Model Registry (MK03)**:
   - Tự động khám phá danh mục model từ upstream (Google Gemini/Imagen, OpenAI Gateway) với phân trang an toàn SSRF.
   - Cơ chế gắn cờ taxonomy: `verified`, `listed_unverified`, `blocked_permission`, `blocked_quota_billing`, `deprecated`, `unsupported`.
   - Giới hạn ngân sách probe tối đa $0.08, bảo mật tuyệt đối không trả raw API Key ra frontend hoặc localStorage.
3. **Truy xuất nguồn gốc & Closed-Loop Lineage (MK04–MK05)**:
   - Ghi nhận `requestedModel`, `reportedModel` (cảnh báo alias gateway), `generationOrigin` (`AI_PLUS_LAYOUT`, `CLOUD_AI`).
   - Xuất file ZIP chứa đầy đủ file ảnh, file thiết kế và file metadata `design-brief-and-lineage.json`.

---

## 4. Nâng cấp V3: Gắn Màn LED Nhanh 12 Hình thái + Marketing Turbo Kit (21/11/2026)
1. **Universal LED Geometry & Material Engine (`led-homography.ts`, `led-geometry-engine.ts`)**:
   - Nâng cấp toán học từ inverse bilinear sang **Projective Homography `3×3`** và **chuẩn hóa 4 đỉnh chống xoắn** (`canonicalizeQuad`).
   - Hỗ trợ đủ **12 hình thái LED thực tế** (`flat_rect`, `rounded_rect` / mái vòm Arch, `circle_oval`, `free_polygon` 3–24 đỉnh bo góc, `curved_arc`, `corner_90_smooth`, `cylindrical_column` 360°, `multi_segment_wave`, `transparent_glass` xuyên kính 40–85%, `led_floor`, `led_ceiling`, `led_standee`) và **tổ hợp nhiều màn hình (`screens[]`) trong cùng 1 ảnh**.
2. **1-Chạm Vision Auto-Snap + Cloud AI Alpha Mask & Pixel Guard (`led-placement-playbook.ts`, `service.ts`)**:
   - Action `auto_detect_led_placement`: Gắn lưới tọa độ `0..100` & chấm đỏ gửi Vision AI để tự khoanh đúng khung & gợi ý hình thái LED.
   - Action `quick_install_led`: Hỗ trợ cả **Xuất Nhanh (`$0`)** lẫn **Hòa sáng Cloud AI** (gửi kèm `Guided Composite` + `Alpha Mask PNG` vào `universal-cloud.provider.ts` / `openai-image.provider.ts` và bảo toàn 100% ảnh gốc ngoài vùng chọn bằng `applyPostAiPixelGuard`, tôn trọng **Cọ đưa vật cản tiền cảnh lên trước**).
   - Action `generate_led_screen_content`: AI vẽ riêng ruột màn hình (nền đen cho LED Trong suốt, tâm tròn cho Oval) rồi ép vào khung.
3. **Marketing Turbo Kit (`LedQuickInstallWizard.tsx`, `led-content-presets.ts`, `marketing-export-kit.ts`)**:
   - Tự đổ Brief từ M03/M04, kho 16 mẫu 1 chạm, **Sinh Bộ 3 Biến Thể A/B**, **Ảnh Trước/Sau (3 layout)**, **Smart Focal Crop** xuất 5 khổ (`Gốc`, `1:1`, `4:5`, `16:9`, `9:16`) kèm Brand Kit Overlay & lưu công thức.
   - Bảo toàn nguyên vẹn ma trận quyền BA (`Q16` đã ghi nhận tại [OPEN_QUESTIONS.md](../decisions/OPEN_QUESTIONS.md#q16)).
4. **Kiểm chứng & Bản vá QA 21/11/2026 – 23/11/2026 (Khôi phục Studio hợp nhất + `@banner` & Nâng cấp toàn hệ thống)**:
   - Khôi phục không gian **Studio Phối cảnh & Banner AI hợp nhất** (`🎯 1. Gắn LED Nhanh & MKT` | `✨ 2. Studio Phối cảnh & Banner AI` kèm nút `Trợ lý AI` thu phóng và `Thông số`) theo đúng luồng gõ lệnh trực tiếp `@banner`, `@baneer`, `@taobanner`, `@TaoAnhPoster`, `@taoanh` trong cùng một khung chat duy nhất.
   - Giữ nguyên tách biệt `bannerMode='prompt_only'` (Banner thuần Prompt) và `bannerMode='with_product'` (Banner ghép ảnh Kho SP Công ty) ngay trên thanh ngữ cảnh của ô chat mà không cần chia tách thành nhiều tab rời rạc.
   - Ngắt fallback ngầm về `LocalSandboxAiProvider.generateBannerDraft` (vốn sinh gradient trơn lệch prompt) tại `executeBannerWithFallback` khi chạy Cloud AI; nâng cấp `google-imagen.provider.ts` (timeout 45s + truyền ảnh tham chiếu), `openai-image.provider.ts` (`/images/edits` chuẩn), `universal-cloud.provider.ts`, và tối ưu tốc độ `led-homography.ts` (hoist ma trận nghịch đảo $H^{-1}$ ra ngoài vòng lặp pixel) + `LedQuickInstallWizard.tsx` (LRU canvas cache 24 mục, tắt re-render con trỏ thụ động).
   - Khóa bảo mật đường dẫn `assertCanAccessStorageObjectKey` (chống Path Traversal + kiểm tra phân quyền dự án/Lead).
   - Bước tiếp theo: Chờ PO/Admin quyết định [Q16](../decisions/OPEN_QUESTIONS.md#q16) nếu muốn mở tab Gắn LED Nhanh trực tiếp cho `MKT_STAFF`/`MKT_LEAD`.



---

## 5. Nâng cấp Chuẩn Doanh Nghiệp Local — Enterprise Edition (24/11/2026)
- **Tách mô-đun dịch vụ & giao diện Studio**: Tách toàn bộ động cơ Gắn Màn LED Nhanh sang `quick-led-studio.service.ts` (giảm kích thước `05-ai-design/service.ts` ~700 dòng) và lazy-load `StudioProjectModals.tsx` + `StudioAiConfigAndPromptModals.tsx` khỏi `AiDesignWorkspace.tsx`.
- **Liên thông M01 → M05 từ Phiếu Kỹ thuật LED**: Nhận trực tiếp thông số kích thước $W \times H$ (m), dòng Pixel Pitch và phương án ghép Cabinet từ `/leads?specSheet=1` sang dự án phối cảnh Studio M05 mà không mang theo SĐT/Email hay đơn giá.
- **Studio Duyệt Phối cảnh Chuyên nghiệp (`StudioVisualPinOverlay.tsx` + `/api/v1/design/[id]/pins`)**: Bổ sung chế độ **Ghim nhận xét trực quan trên ảnh** (tọa độ `xPct`/`yPct`, đánh dấu đã xử lý, chặn tuyệt đối SĐT/Email khách hàng trong nội dung ghim) kết hợp thanh kéo **So sánh Trước / Sau** trực tiếp trên khung preview Studio.
