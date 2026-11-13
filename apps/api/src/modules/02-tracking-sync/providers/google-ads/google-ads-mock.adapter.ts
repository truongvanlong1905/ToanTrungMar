import type { IGoogleAdsClient, GoogleAdsHealthCheckResult } from './google-ads-client.interface';
import {
  type GoogleAdsCampaignMetricRow,
  type GoogleAdsKeywordMetricRow,
  type GoogleAdsSyncWindow,
  type GoogleAdsSyncOptions,
  GoogleAdsAuthError,
  GoogleAdsRateLimitError,
  GoogleAdsTimeoutError,
} from './google-ads.types';

interface MockCampaignDef {
  id: string;
  name: string;
  budgetMicros: string;
  baseImpressions: number;
  baseCpcVnd: number;
}

interface MockKeywordDef {
  criterionId: string;
  campaignId: string;
  campaignName: string;
  text: string;
  matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  shareOfCampaignClicks: number;
}

const MOCK_CAMPAIGNS: MockCampaignDef[] = [
  {
    id: 'CMP-LED-INDOOR-P25',
    name: 'Chiến dịch Màn hình LED Hội trường P2.5 Q4',
    budgetMicros: '3500000000000', // 3,500,000 VND
    baseImpressions: 8200,
    baseCpcVnd: 28500,
  },
  {
    id: 'CMP-LED-OUTDOOR-P4',
    name: 'Chiến dịch Màn hình LED Ngoài trời P4/P5 Q4',
    budgetMicros: '5000000000000', // 5,000,000 VND
    baseImpressions: 11400,
    baseCpcVnd: 31200,
  },
  {
    id: 'CMP-BOARD-FACTORY',
    name: 'Bảng điện tử Năng suất & An toàn Nhà máy',
    budgetMicros: '1500000000000', // 1,500,000 VND
    baseImpressions: 4300,
    baseCpcVnd: 19800,
  },
];

const MOCK_KEYWORDS: MockKeywordDef[] = [
  {
    criterionId: 'KW-01',
    campaignId: 'CMP-LED-INDOOR-P25',
    campaignName: 'Chiến dịch Màn hình LED Hội trường P2.5 Q4',
    text: 'báo giá màn hình led hội trường p2.5',
    matchType: 'PHRASE',
    shareOfCampaignClicks: 0.45,
  },
  {
    criterionId: 'KW-02',
    campaignId: 'CMP-LED-INDOOR-P25',
    campaignName: 'Chiến dịch Màn hình LED Hội trường P2.5 Q4',
    text: 'màn hình led p2.5 trong nhà',
    matchType: 'EXACT',
    shareOfCampaignClicks: 0.35,
  },
  {
    criterionId: 'KW-03',
    campaignId: 'CMP-LED-INDOOR-P25',
    campaignName: 'Chiến dịch Màn hình LED Hội trường P2.5 Q4',
    text: 'màn hình led hội trường',
    matchType: 'BROAD',
    shareOfCampaignClicks: 0.2,
  },
  {
    criterionId: 'KW-04',
    campaignId: 'CMP-LED-OUTDOOR-P4',
    campaignName: 'Chiến dịch Màn hình LED Ngoài trời P4/P5 Q4',
    text: 'màn hình led ngoài trời p4',
    matchType: 'EXACT',
    shareOfCampaignClicks: 0.5,
  },
  {
    criterionId: 'KW-05',
    campaignId: 'CMP-LED-OUTDOOR-P4',
    campaignName: 'Chiến dịch Màn hình LED Ngoài trời P4/P5 Q4',
    text: 'báo giá led p5 outdoor chống nước',
    matchType: 'PHRASE',
    shareOfCampaignClicks: 0.35,
  },
  {
    criterionId: 'KW-06',
    campaignId: 'CMP-BOARD-FACTORY',
    campaignName: 'Bảng điện tử Năng suất & An toàn Nhà máy',
    text: 'bảng điện tử năng suất nhà máy',
    matchType: 'EXACT',
    shareOfCampaignClicks: 0.6,
  },
  {
    criterionId: 'KW-07',
    campaignId: 'CMP-BOARD-FACTORY',
    campaignName: 'Bảng điện tử Năng suất & An toàn Nhà máy',
    text: 'bảng led an toàn lao động cổng công ty',
    matchType: 'PHRASE',
    shareOfCampaignClicks: 0.4,
  },
];

function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const curr = new Date(startDate);
  const end = new Date(endDate);
  while (curr <= end) {
    dates.push(curr.toISOString().slice(0, 10));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

/**
 * Hàm băm chuỗi thành số nguyên xác định (deterministic pseudo-random)
 * Giúp các lần gọi cùng ngày trả về chính xác cùng 1 số liệu (đáp ứng tính lũy đẳng trong test).
 */
function deterministicHash(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export class GoogleAdsMockAdapter implements IGoogleAdsClient {
  public readonly accountPropertyId: string;
  public readonly isMock = true;

  constructor(accountPropertyId = 'GADS-SYNTH-MOCK-01') {
    this.accountPropertyId = accountPropertyId;
  }

  public async getHealthStatus(): Promise<GoogleAdsHealthCheckResult> {
    return {
      ok: true,
      provider: 'mock',
      accountPropertyId: this.accountPropertyId,
      accessLevel: 'Synthetic Mock Adapter (No Cloud Connection Required)',
      message: 'Bộ giả lập Google Ads đang hoạt động với dữ liệu tổng hợp chuẩn UC03.',
    };
  }

  private checkSimulatedError(options?: GoogleAdsSyncOptions): void {
    if (!options?.simulateError) return;
    switch (options.simulateError) {
      case 'AUTH_ERROR':
        throw new GoogleAdsAuthError();
      case 'RATE_LIMIT':
        throw new GoogleAdsRateLimitError();
      case 'TIMEOUT':
        throw new GoogleAdsTimeoutError();
      case 'EMPTY':
        break;
    }
  }

  public async fetchCampaignMetrics(
    window: GoogleAdsSyncWindow,
    options?: GoogleAdsSyncOptions,
  ): Promise<GoogleAdsCampaignMetricRow[]> {
    this.checkSimulatedError(options);
    if (options?.simulateError === 'EMPTY') return [];

    const dates = getDatesInRange(window.startDate, window.endDate);
    const rows: GoogleAdsCampaignMetricRow[] = [];

    for (const date of dates) {
      for (const camp of MOCK_CAMPAIGNS) {
        const seed = `${date}|${camp.id}`;
        const hash = deterministicHash(seed);
        // Variance +/- 10%
        const varianceFactor = 0.9 + ((hash % 200) / 1000);
        const impressions = Math.round(camp.baseImpressions * varianceFactor);
        const ctr = 0.038 + ((hash % 15) / 1000); // 3.8% ~ 5.3%
        const clicks = Math.max(1, Math.round(impressions * ctr));
        const cpcVnd = Math.round(camp.baseCpcVnd * (0.95 + ((hash % 100) / 1000)));
        const costVnd = clicks * cpcVnd;

        // Conversions: 1 ~ 8 (có phần lẻ data-driven)
        const conversions = Math.round((1 + ((hash % 60) / 10)) * 10) / 10;

        // Google Ads micros = VND * 1,000,000
        const costMicros = (BigInt(costVnd) * 1_000_000n).toString(10);
        const cpcMicros = (BigInt(cpcVnd) * 1_000_000n).toString(10);

        rows.push({
          campaignId: camp.id,
          campaignName: camp.name,
          campaignStatus: 'ENABLED',
          date,
          costMicros,
          dailyBudgetMicros: camp.budgetMicros,
          averageCpcMicros: cpcMicros,
          impressions,
          clicks,
          conversions,
          currencyCode: 'VND',
        });
      }
    }

    return rows;
  }

  public async fetchKeywordMetrics(
    window: GoogleAdsSyncWindow,
    options?: GoogleAdsSyncOptions,
  ): Promise<GoogleAdsKeywordMetricRow[]> {
    this.checkSimulatedError(options);
    if (options?.simulateError === 'EMPTY') return [];

    const dates = getDatesInRange(window.startDate, window.endDate);
    const rows: GoogleAdsKeywordMetricRow[] = [];

    for (const date of dates) {
      for (const kw of MOCK_KEYWORDS) {
        const camp = MOCK_CAMPAIGNS.find((c) => c.id === kw.campaignId);
        if (!camp) continue;

        const seed = `${date}|${kw.criterionId}|${kw.text}`;
        const hash = deterministicHash(seed);

        const campVariance = 0.9 + ((deterministicHash(`${date}|${camp.id}`) % 200) / 1000);
        const campClicks = Math.round(camp.baseImpressions * campVariance * 0.045);

        const kwClicks = Math.max(1, Math.round(campClicks * kw.shareOfCampaignClicks));
        const kwImpressions = Math.round(kwClicks * (20 + (hash % 10)));
        const cpcVnd = Math.round(camp.baseCpcVnd * (0.9 + ((hash % 200) / 1000)));
        const costVnd = kwClicks * cpcVnd;
        const conversions = Math.max(0, Math.round((kwClicks * 0.04) * 10) / 10);

        const costMicros = (BigInt(costVnd) * 1_000_000n).toString(10);
        const cpcMicros = (BigInt(cpcVnd) * 1_000_000n).toString(10);

        rows.push({
          campaignId: kw.campaignId,
          campaignName: kw.campaignName,
          criterionId: kw.criterionId,
          keywordText: kw.text,
          matchType: kw.matchType,
          date,
          costMicros,
          averageCpcMicros: cpcMicros,
          impressions: kwImpressions,
          clicks: kwClicks,
          conversions,
          currencyCode: 'VND',
        });
      }
    }

    return rows;
  }
}
