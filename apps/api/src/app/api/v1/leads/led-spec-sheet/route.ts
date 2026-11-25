import { prisma } from '@toantrung/database';
import { hasBaPermission } from '@toantrung/contracts';
import { jsonError, jsonSuccess } from '../../../../../core/http';
import { requireAuthenticatedSession } from '../../../../../core/permissions';
import { bumpDomainRevisions } from '../../../../../core/cache/server-data-cache';
import {
  LED_CABINET_CATALOG,
  evaluateLedTechnicalConfig,
} from '../../../../../modules/05-ai-design/led-technical.engine';
import { assertLeadMutationScope } from '../../../../../modules/01-leads/service';

export const dynamic = 'force-dynamic';

function recommendPitchByEnvironmentAndDistance(
  environment: 'indoor' | 'outdoor' | 'semi_outdoor',
  minViewingDistanceM: number,
): { recommendedPitch: string; pitchReason: string; suggestedCabinetCode: string } {
  const dist = Math.max(1, Number.isFinite(minViewingDistanceM) ? minViewingDistanceM : 4);
  if (environment === 'outdoor' || environment === 'semi_outdoor') {
    if (dist <= 4) {
      return {
        recommendedPitch: 'P3.076',
        pitchReason: 'Ngoài trời / Bán ngoài trời nhìn gần (≤ 4m) cần mật độ điểm ảnh cao chuẩn IP65 (≥ 5.000 cd/m²).',
        suggestedCabinetCode: 'CAB_960_960',
      };
    }
    if (dist <= 6) {
      return {
        recommendedPitch: 'P4.0',
        pitchReason: 'Ngoài trời tầm nhìn trung bình (4–6m): P4 Outdoor cân bằng tối ưu độ nét, độ bền IP65 và công suất nguồn.',
        suggestedCabinetCode: 'CAB_960_960',
      };
    }
    if (dist <= 9) {
      return {
        recommendedPitch: 'P5.0',
        pitchReason: 'Ngoài trời mặt tiền / pano tầm nhìn 6–9m: P5 Outdoor độ sáng ≥ 5.500 cd/m² chống chói nắng trực tiếp.',
        suggestedCabinetCode: 'CAB_960_960',
      };
    }
    return {
      recommendedPitch: 'P8.0',
      pitchReason: 'Pano quảng cáo tầm xa (> 9m): P8/P10 Outdoor tối ưu tải trọng kết cấu thép và tiết kiệm điện năng.',
      suggestedCabinetCode: 'CAB_960_960',
    };
  }

  // Indoor
  if (dist <= 2.2) {
    return {
      recommendedPitch: 'P1.53',
      pitchReason: 'Phòng họp điều hành VIP / Trung tâm chỉ huy nhìn gần (≤ 2.2m): P1.53 đạt chuẩn mịn 4K không lộ hạt LED.',
      suggestedCabinetCode: 'CAB_640_480',
    };
  }
  if (dist <= 3.2) {
    return {
      recommendedPitch: 'P2.0',
      pitchReason: 'Phòng họp lớn / Showroom cao cấp (2.2–3.2m): P2.0 tần số quét 3840Hz chống sọc khi quay phim/chụp ảnh.',
      suggestedCabinetCode: 'CAB_640_480',
    };
  }
  if (dist <= 5.5) {
    return {
      recommendedPitch: 'P2.5',
      pitchReason: 'Hội trường / Sảnh sự kiện tiêu chuẩn (3–5.5m): P2.5 Indoor là dòng chủ lực bền bỉ, dễ bảo trì mặt trước.',
      suggestedCabinetCode: 'CAB_640_480',
    };
  }
  return {
    recommendedPitch: 'P3.076',
    pitchReason: 'Hội trường lớn / Nhà thi đấu tầm nhìn xa (> 5.5m): P3.076 đảm bảo độ sáng đồng đều trên diện tích rộng.',
    suggestedCabinetCode: 'CAB_640_480',
  };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildWordCompatibleSpecHtml(params: {
  specCode: string;
  projectTitle: string;
  customerOrg: string;
  environmentLabel: string;
  viewingDistanceM: number;
  pitchReason: string;
  evalResult: ReturnType<typeof evaluateLedTechnicalConfig>;
  hdComparisonLabel: string;
  avgKw: string;
  maxKw: string;
  breakerNote: string;
  preparedBy: string;
  createdAtVi: string;
}): string {
  const { evalResult } = params;
  const actualW =
    evalResult.cabinetCols && LED_CABINET_CATALOG[evalResult.cabinetModelCode]
      ? Math.round(evalResult.cabinetCols * LED_CABINET_CATALOG[evalResult.cabinetModelCode].cabinetWidthMm)
      : evalResult.widthMm || 0;
  const actualH =
    evalResult.cabinetRows && LED_CABINET_CATALOG[evalResult.cabinetModelCode]
      ? Math.round(evalResult.cabinetRows * LED_CABINET_CATALOG[evalResult.cabinetModelCode].cabinetHeightMm)
      : evalResult.heightMm || 0;

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="vi">
<head>
<meta charset="utf-8" />
<title>Phiếu Đề Xuất Cấu Hình Kỹ Thuật LED - ${escapeHtml(params.specCode)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.5; margin: 28px; font-size: 13px; }
  .header { border-bottom: 3px solid #0F275C; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { font-size: 18px; font-weight: 800; color: #0F275C; text-transform: uppercase; letter-spacing: 0.4px; }
  .sub { font-size: 12px; color: #475569; margin-top: 2px; }
  h1 { font-size: 17px; color: #0F275C; margin: 12px 0 6px; text-transform: uppercase; }
  .meta-box { background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px 14px; border-radius: 8px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; font-size: 12.5px; }
  th { background: #0F275C; color: #ffffff; font-weight: 700; }
  .kv td:first-child { width: 36%; font-weight: 700; background: #f1f5f9; color: #1e293b; }
  .note { background: #eff6ff; border-left: 4px solid #1d4ed8; padding: 10px 12px; font-size: 12px; margin-bottom: 16px; }
  .footer { margin-top: 24px; font-size: 11.5px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">CÔNG TY CỔ PHẦN ĐIỆN TỬ VIỄN THÔNG TOÀN TRUNG</div>
    <div class="sub">Giải pháp Màn hình LED Hội trường, Quảng cáo Outdoor &amp; Bảng điện tử Công nghiệp chuẩn ISO</div>
  </div>

  <h1>PHIẾU ĐỀ XUẤT CẤU HÌNH KỸ THUẬT MÀN HÌNH LED</h1>
  <div class="meta-box">
    <div><strong>Mã phiếu kỹ thuật:</strong> ${escapeHtml(params.specCode)} &nbsp;|&nbsp; <strong>Ngày lập:</strong> ${escapeHtml(params.createdAtVi)}</div>
    <div><strong>Hạng mục / Dự án:</strong> ${escapeHtml(params.projectTitle)}</div>
    <div><strong>Đơn vị thụ hưởng:</strong> ${escapeHtml(params.customerOrg)}</div>
    <div><strong>Chuyên viên lập phiếu:</strong> ${escapeHtml(params.preparedBy)}</div>
  </div>

  <div class="note">
    <strong>Cơ sở tư vấn kỹ thuật:</strong> ${escapeHtml(params.pitchReason)} (Khoảng cách nhìn tối thiểu: ${params.viewingDistanceM}m · Môi trường: ${escapeHtml(params.environmentLabel)}).
  </div>

  <table class="kv">
    <tr><th colspan="2">1. THÔNG SỐ HÌNH HỌC &amp; ĐỘ PHÂN GIẢI HIỂN THỊ</th></tr>
    <tr><td>Chủng loại Pixel Pitch đề xuất</td><td><strong>${escapeHtml(evalResult.pixelPitch || 'P2.5')}</strong> (Tần số làm tươi ≥ 3840Hz)</td></tr>
    <tr><td>Kích thước mặt bằng khảo sát</td><td>${evalResult.widthMm} × ${evalResult.heightMm} mm (${((evalResult.widthMm || 0) / 1000).toFixed(2)}m × ${((evalResult.heightMm || 0) / 1000).toFixed(2)}m)</td></tr>
    <tr><td>Kích thước ghép Cabinet thực tế</td><td><strong>${actualW} × ${actualH} mm</strong> — Diện tích hiển thị: <strong>${evalResult.areaM2} m²</strong></td></tr>
    <tr><td>Cấu hình ghép Cabinet / Khung</td><td>${evalResult.cabinetCols} cột × ${evalResult.cabinetRows} hàng = <strong>${evalResult.cabinetCount} bộ</strong> (${escapeHtml(evalResult.cabinetDimensionsMm)})</td></tr>
    <tr><td>Tổng số tấm Module LED</td><td>${evalResult.moduleCols} × ${evalResult.moduleRows} = <strong>${evalResult.moduleCount} tấm</strong> (${escapeHtml(evalResult.moduleDimensionsMm)})</td></tr>
    <tr><td>Độ phân giải điểm ảnh thực tế</td><td><strong>${evalResult.theoreticalResolutionWidthPx} × ${evalResult.theoreticalResolutionHeightPx} pixels</strong> (${escapeHtml(params.hdComparisonLabel)})</td></tr>
    <tr><td>Công suất tiêu thụ điện ước tính</td><td>Trung bình: <strong>${escapeHtml(params.avgKw)} kW</strong> · Cực đại (100% trắng): <strong>${escapeHtml(params.maxKw)} kW</strong> (${escapeHtml(params.breakerNote)})</td></tr>
    <tr><td>Tổng tải trọng màn hình ước tính</td><td>~ <strong>${evalResult.estimatedWeightKg ?? 0} kg</strong> (Chưa bao gồm khung gia cố phụ trợ)</td></tr>
  </table>

  <table>
    <thead>
      <tr>
        <th style="width:8%">STT</th>
        <th style="width:42%">Hạng mục Vật tư Kỹ thuật Đồng bộ</th>
        <th style="width:12%">ĐVT</th>
        <th style="width:12%">Số lượng</th>
        <th style="width:26%">Tiêu chuẩn Kỹ thuật</th>
      </tr>
    </thead>
    <tbody>
      ${evalResult.bomItems
        .map(
          (item, idx) => `<tr>
        <td>${idx + 1}</td>
        <td><strong>${escapeHtml(item.itemName)}</strong></td>
        <td>${escapeHtml(item.unit)}</td>
        <td><strong>${item.quantity ?? '—'}</strong></td>
        <td>${escapeHtml(item.notes)}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <div class="footer">
    Phiếu này xác nhận cấu hình thông số kỹ thuật tiêu chuẩn ngành Màn hình LED B2B của Toàn Trung (không bao gồm báo giá thương mại). Thông số cuối cùng sẽ được đối chiếu theo bản vẽ thi công thực địa.
  </div>
</body>
</html>`;
}

export async function POST(req: Request) {
  const auth = await requireAuthenticatedSession(req, { requireCsrf: true });
  if (!auth.ok) return auth.response;

  const canUse =
    hasBaPermission(auth.user.roleCode, 'LEAD_VIEW_OWN') ||
    hasBaPermission(auth.user.roleCode, 'AI_DESIGN');
  if (!canUse) {
    return jsonError('FORBIDDEN', 'Tài khoản không có quyền lập Phiếu Đề xuất Kỹ thuật LED.', 403);
  }

  let body: {
    action?: 'calculate' | 'export_doc' | 'save_to_lead';
    leadId?: number | null;
    projectTitle?: string;
    customerOrg?: string;
    widthM?: number;
    heightM?: number;
    viewingDistanceM?: number;
    environment?: 'indoor' | 'outdoor' | 'semi_outdoor';
    pixelPitch?: string | null;
    cabinetModelCode?: string | null;
    screenStyle?: 'flat' | 'curved' | 'corner_90';
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('INVALID_JSON', 'Dữ liệu thông số kỹ thuật không hợp lệ.', 400);
  }

  const widthM = Math.min(80, Math.max(0.5, Number(body.widthM) || 4.8));
  const heightM = Math.min(40, Math.max(0.5, Number(body.heightM) || 2.7));
  const env = body.environment || 'indoor';
  const viewDist = Math.min(100, Math.max(1, Number(body.viewingDistanceM) || 4));

  const rec = recommendPitchByEnvironmentAndDistance(env, viewDist);
  const effectivePitch =
    body.pixelPitch && body.pixelPitch !== 'AUTO' ? body.pixelPitch : rec.recommendedPitch;
  const effectiveCabinet =
    body.cabinetModelCode && body.cabinetModelCode !== 'AUTO'
      ? body.cabinetModelCode
      : rec.suggestedCabinetCode;

  const evalResult = evaluateLedTechnicalConfig({
    widthMm: Math.round(widthM * 1000),
    heightMm: Math.round(heightM * 1000),
    pixelPitch: effectivePitch,
    cabinetModelCode: effectiveCabinet,
    screenStyle: body.screenStyle || 'flat',
  });

  const totalPixels =
    (evalResult.theoreticalResolutionWidthPx || 0) *
    (evalResult.theoreticalResolutionHeightPx || 0);
  const fhdRatio = totalPixels / (1920 * 1080);
  const hdComparisonLabel =
    fhdRatio >= 3.8
      ? `Đạt chuẩn Ultra HD 4K (${fhdRatio.toFixed(1)}× Full HD)`
      : fhdRatio >= 0.95
        ? `Đạt chuẩn Full HD 1080p (${(fhdRatio * 100).toFixed(0)}% điểm ảnh FHD)`
        : `Đạt chuẩn HD trình chiếu (${(fhdRatio * 100).toFixed(0)}% điểm ảnh FHD)`;

  const avgKw = ((evalResult.avgPowerWatts || 0) / 1000).toFixed(2);
  const maxKw = ((evalResult.maxPowerWatts || 0) / 1000).toFixed(2);
  const maxWatts = evalResult.maxPowerWatts || 0;
  const breakerNote =
    maxWatts > 6500
      ? `Khuyến nghị cấp nguồn 3 pha 380V, CB tổng ≥ ${Math.ceil(maxWatts / 600 / 5) * 5}A`
      : `Nguồn 1 pha 220V tiêu chuẩn, CB riêng ≥ ${Math.max(16, Math.ceil(maxWatts / 180 / 4) * 4)}A`;

  const envLabel =
    env === 'outdoor'
      ? 'Ngoài trời (Outdoor IP65)'
      : env === 'semi_outdoor'
        ? 'Bán ngoài trời (Có mái che)'
        : 'Trong nhà (Indoor Hội trường/Phòng họp)';

  const specCode = `SPEC-LED-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.round(widthM * 10)}x${Math.round(heightM * 10)}`;

  if (body.action === 'save_to_lead' && body.leadId) {
    const leadRow = await prisma.lead.findUnique({ where: { id: Number(body.leadId) } });
    if (!leadRow) {
      return jsonError('LEAD_NOT_FOUND', 'Không tìm thấy hồ sơ Lead cần lưu phiếu kỹ thuật.', 404);
    }
    if (!hasBaPermission(auth.user.roleCode, 'LEAD_UPDATE_PIPELINE')) {
      return jsonError('FORBIDDEN', 'Vai trò hiện tại không có quyền ghi chú kỹ thuật vào Lead.', 403);
    }
    assertLeadMutationScope(auth.user, leadRow);

    const summaryNote = `[PHIẾU KỸ THUẬT LED ${specCode}] Đề xuất ${evalResult.pixelPitch} (${envLabel}) · Kích thước khảo sát ${widthM}m × ${heightM}m → ${evalResult.cabinetCount} bộ (${evalResult.cabinetCols}×${evalResult.cabinetRows}) · Độ phân giải ${evalResult.theoreticalResolutionWidthPx}×${evalResult.theoreticalResolutionHeightPx}px (${hdComparisonLabel}) · Điện TB ${avgKw}kW / Max ${maxKw}kW.`;

    await prisma.leadActivity.create({
      data: {
        leadId: leadRow.id,
        actionById: auth.user.id,
        actorType: 'user',
        actionType: 'add_note',
        note: summaryNote,
      },
    });
    bumpDomainRevisions(['leads'], 'led_spec_saved_to_lead');
  }

  const docHtml =
    body.action === 'export_doc'
      ? buildWordCompatibleSpecHtml({
          specCode,
          projectTitle: (body.projectTitle || 'Hệ thống Màn hình LED Trình chiếu').trim(),
          customerOrg:
            auth.user.roleCode === 'MKT_STAFF' || auth.user.roleCode === 'ADS'
              ? 'Khách hàng Doanh nghiệp Toàn Trung'
              : (body.customerOrg || 'Quý Khách hàng / Đối tác Dự án').trim(),
          environmentLabel: envLabel,
          viewingDistanceM: viewDist,
          pitchReason: rec.pitchReason,
          evalResult,
          hdComparisonLabel,
          avgKw,
          maxKw,
          breakerNote,
          preparedBy: `${auth.user.fullName} (${auth.user.roleName})`,
          createdAtVi: new Date().toLocaleString('vi-VN'),
        })
      : null;

  return jsonSuccess({
    specCode,
    recommendedPitch: rec.recommendedPitch,
    pitchReason: rec.pitchReason,
    suggestedCabinetCode: rec.suggestedCabinetCode,
    environmentLabel: envLabel,
    hdComparisonLabel,
    avgKw,
    maxKw,
    breakerNote,
    evaluation: evalResult,
    availableCabinets: Object.values(LED_CABINET_CATALOG).map((c) => ({
      modelCode: c.modelCode,
      modelName: c.modelName,
      environment: c.environment,
    })),
    docHtml,
  });
}
