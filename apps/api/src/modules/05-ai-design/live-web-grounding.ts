/**
 * Module 05 — Real-Time Internet Grounding Helper
 * Supplies up-to-date Vietnam time, live weather (Open-Meteo), live FX rates (ExchangeRate-API),
 * and fresh web/news snippets (DuckDuckGo HTML & Google News RSS) so conversational AI
 * behaves like a modern online assistant (ChatGPT / Gemini with Search).
 */

interface GeoCoord {
  label: string;
  lat: number;
  lon: number;
}

const VN_CITY_COORDS: Array<{ aliases: string[]; coord: GeoCoord }> = [
  { aliases: ['gia lai', 'pleiku', 'p lei ku', 'ayun pa', 'an khe'], coord: { label: 'Gia Lai (Pleiku)', lat: 13.9833, lon: 108.0 } },
  { aliases: ['ha noi', 'hanoi', 'thu do'], coord: { label: 'Hà Nội', lat: 21.0285, lon: 105.8542 } },
  { aliases: ['ho chi minh', 'sai gon', 'saigon', 'tphcm', 'tp hcm', 'hcm'], coord: { label: 'TP. Hồ Chí Minh', lat: 10.8231, lon: 106.6297 } },
  { aliases: ['da nang', 'danang'], coord: { label: 'Đà Nẵng', lat: 16.0544, lon: 108.2022 } },
  { aliases: ['can tho'], coord: { label: 'Cần Thơ', lat: 10.0452, lon: 105.7469 } },
  { aliases: ['hai phong'], coord: { label: 'Hải Phòng', lat: 20.8449, lon: 106.6881 } },
  { aliases: ['hue', 'thua thien hue'], coord: { label: 'Huế', lat: 16.4637, lon: 107.5909 } },
  { aliases: ['dak lak', 'buon ma thuot', 'bmt'], coord: { label: 'Đắk Lắk (Buôn Ma Thuột)', lat: 12.6667, lon: 108.05 } },
  { aliases: ['lam dong', 'da lat', 'dalat', 'bao loc'], coord: { label: 'Lâm Đồng (Đà Lạt)', lat: 11.9404, lon: 108.4583 } },
  { aliases: ['khanh hoa', 'nha trang', 'cam ranh'], coord: { label: 'Khánh Hòa (Nha Trang)', lat: 12.2388, lon: 109.1967 } },
  { aliases: ['binh dinh', 'quy nhon'], coord: { label: 'Bình Định (Quy Nhơn)', lat: 13.783, lon: 109.2197 } },
  { aliases: ['kon tum'], coord: { label: 'Kon Tum', lat: 14.3497, lon: 108.0005 } },
  { aliases: ['dak nong', 'gia nghia'], coord: { label: 'Đắk Nông', lat: 12.0033, lon: 107.6876 } },
  { aliases: ['binh duong', 'thu dau mot'], coord: { label: 'Bình Dương', lat: 11.1667, lon: 106.6667 } },
  { aliases: ['dong nai', 'bien hoa'], coord: { label: 'Đồng Nai (Biên Hòa)', lat: 10.9574, lon: 106.8427 } },
  { aliases: ['ba ria', 'vung tau'], coord: { label: 'Bà Rịa - Vũng Tàu', lat: 10.346, lon: 107.0843 } },
  { aliases: ['quang ninh', 'ha long', 'halong'], coord: { label: 'Quảng Ninh (Hạ Long)', lat: 20.9599, lon: 107.0425 } },
  { aliases: ['quang nam', 'hoi an', 'tam ky'], coord: { label: 'Quảng Nam (Hội An)', lat: 15.8801, lon: 108.338 } },
  { aliases: ['quang ngai'], coord: { label: 'Quảng Ngãi', lat: 15.1214, lon: 108.8044 } },
  { aliases: ['phu yen', 'tuy hoa'], coord: { label: 'Phú Yên (Tuy Hòa)', lat: 13.0955, lon: 109.3209 } },
  { aliases: ['nghe an', 'tp vinh', 'vinh'], coord: { label: 'Nghệ An (Vinh)', lat: 18.6796, lon: 105.6813 } },
  { aliases: ['thanh hoa'], coord: { label: 'Thanh Hóa', lat: 19.8067, lon: 105.7852 } },
  { aliases: ['lao cai', 'sa pa', 'sapa'], coord: { label: 'Lào Cai (Sa Pa)', lat: 22.3364, lon: 103.8438 } },
  { aliases: ['ninh thuan', 'phan rang'], coord: { label: 'Ninh Thuận', lat: 11.5752, lon: 108.989 } },
  { aliases: ['binh thuan', 'phan thiet'], coord: { label: 'Bình Thuận (Phan Thiết)', lat: 10.9289, lon: 108.1021 } },
  { aliases: ['an giang', 'long xuyen', 'chau doc'], coord: { label: 'An Giang', lat: 10.5216, lon: 105.1259 } },
  { aliases: ['kien giang', 'phu quoc', 'rach gia'], coord: { label: 'Kiên Giang (Phú Quốc)', lat: 10.2899, lon: 103.984 } },
  { aliases: ['tay ninh'], coord: { label: 'Tây Ninh', lat: 11.3352, lon: 106.1099 } },
  { aliases: ['long an', 'tan an'], coord: { label: 'Long An', lat: 10.5359, lon: 106.4137 } },
  { aliases: ['tien giang', 'my tho'], coord: { label: 'Tiền Giang', lat: 10.4493, lon: 106.3421 } },
  { aliases: ['ben tre'], coord: { label: 'Bến Tre', lat: 10.2434, lon: 106.3756 } },
  { aliases: ['ca mau'], coord: { label: 'Cà Mau', lat: 9.1768, lon: 105.1524 } },
  { aliases: ['thai nguyen'], coord: { label: 'Thái Nguyên', lat: 21.5942, lon: 105.8482 } },
  { aliases: ['bac ninh'], coord: { label: 'Bắc Ninh', lat: 21.1861, lon: 106.0763 } },
  { aliases: ['quang binh', 'dong hoi'], coord: { label: 'Quảng Bình', lat: 17.4689, lon: 106.6223 } },
  { aliases: ['quang tri', 'dong ha'], coord: { label: 'Quảng Trị', lat: 16.7403, lon: 107.1855 } },
  { aliases: ['ha tinh'], coord: { label: 'Hà Tĩnh', lat: 18.3559, lon: 105.8877 } },
  { aliases: ['binh phuoc', 'dong xoai'], coord: { label: 'Bình Phước', lat: 11.7512, lon: 106.7235 } },
  { aliases: ['nam dinh'], coord: { label: 'Nam Định', lat: 20.4388, lon: 106.1621 } },
  { aliases: ['ninh binh'], coord: { label: 'Ninh Bình', lat: 20.2506, lon: 105.9745 } },
  { aliases: ['hai duong'], coord: { label: 'Hải Dương', lat: 20.9373, lon: 106.3146 } },
  { aliases: ['hung yen'], coord: { label: 'Hưng Yên', lat: 20.6464, lon: 106.0511 } },
  { aliases: ['vinh phuc', 'vinh yen'], coord: { label: 'Vĩnh Phúc', lat: 21.3089, lon: 105.6049 } },
  { aliases: ['phu tho', 'viet tri'], coord: { label: 'Phú Thọ', lat: 21.3227, lon: 105.402 } },
  { aliases: ['thai binh'], coord: { label: 'Thái Bình', lat: 20.4463, lon: 106.3366 } },
  { aliases: ['dong thap', 'cao lanh', 'sa dec'], coord: { label: 'Đồng Tháp', lat: 10.4938, lon: 105.6882 } },
  { aliases: ['vinh long'], coord: { label: 'Vĩnh Long', lat: 10.2537, lon: 105.9722 } },
  { aliases: ['soc trang'], coord: { label: 'Sóc Trăng', lat: 9.6037, lon: 105.98 } },
  { aliases: ['bac lieu'], coord: { label: 'Bạc Liêu', lat: 9.294, lon: 105.7216 } },
  { aliases: ['tra vinh'], coord: { label: 'Trà Vinh', lat: 9.9513, lon: 106.3346 } },
  { aliases: ['hau giang', 'vi thanh'], coord: { label: 'Hậu Giang', lat: 9.7579, lon: 105.6413 } },
  { aliases: ['son la'], coord: { label: 'Sơn La', lat: 21.3256, lon: 103.9188 } },
  { aliases: ['dien bien', 'dien bien phu'], coord: { label: 'Điện Biên', lat: 21.386, lon: 103.023 } },
  { aliases: ['lai chau'], coord: { label: 'Lai Châu', lat: 22.3964, lon: 103.4582 } },
  { aliases: ['yen bai'], coord: { label: 'Yên Bái', lat: 21.7168, lon: 104.8986 } },
  { aliases: ['ha giang'], coord: { label: 'Hà Giang', lat: 22.8233, lon: 104.9836 } },
  { aliases: ['cao bang'], coord: { label: 'Cao Bằng', lat: 22.6657, lon: 106.2579 } },
  { aliases: ['lang son'], coord: { label: 'Lạng Sơn', lat: 21.8537, lon: 106.7615 } },
  { aliases: ['bac giang'], coord: { label: 'Bắc Giang', lat: 21.2819, lon: 106.1975 } },
  { aliases: ['tuyen quang'], coord: { label: 'Tuyên Quang', lat: 21.8236, lon: 105.2142 } },
  { aliases: ['hoa binh'], coord: { label: 'Hòa Bình', lat: 20.8172, lon: 105.3376 } },
];

const WEATHER_INTENT_REGEX =
  /thời\s*tiết|nhiệt\s*độ|dự\s*báo|trời\s*(?:mưa|nắng|lạnh|nóng)|độ\s*ẩm|bão|áp\s*thấp|weather|forecast/i;

const FX_INTENT_REGEX =
  /tỷ\s*giá|tiền\s*tệ|đổi\s*tiền|\busd\b|\beur\b|\bjpy\b|\bcny\b|đô\s*la|nhân\s*dân\s*tệ|yên\s*nhật|ngoại\s*tệ/i;

const WEB_NEWS_INTENT_REGEX =
  /(?:\b(?:tin\s*tức|báo\s*mới|giá\s*vàng|giá\s*xăng|giá\s*dầu|tỷ\s*số|lịch\s*thi\s*đấu|chứng\s*khoán|vn-?index|bitcoin|crypto)\b|\b(?:thời\s*tiết|nhiệt\s*độ|tỷ\s*giá)\b.*?\b(?:hôm\s*nay|hiện\s*tại|mới\s*nhất)\b|\b(?:tra\s*cứu|tìm\s*kiếm|cập\s*nhật)\s+(?:tin|giá|thời\s*tiết|tỷ\s*giá|thông\s*tin\s+mới))/i;

function normalizeVi(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeWmoCode(code: number | null | undefined): string {
  if (code === null || code === undefined || Number.isNaN(code)) return 'Không rõ';
  if (code === 0) return 'Trời quang, nắng';
  if (code === 1 || code === 2) return 'Ít mây đến mây rải rác';
  if (code === 3) return 'Nhiều mây / âm u';
  if (code === 45 || code === 48) return 'Có sương mù';
  if (code >= 51 && code <= 55) return 'Mưa phùn nhẹ đến vừa';
  if (code >= 61 && code <= 65) return 'Có mưa (nhẹ đến mưa vừa/to)';
  if (code >= 71 && code <= 77) return 'Mưa tuyết / băng giá';
  if (code >= 80 && code <= 82) return 'Mưa rào';
  if (code >= 95 && code <= 99) return 'Có dông, khả năng kèm sét/gió giật';
  return `Mã thời tiết ${code}`;
}

export function formatVietnamNowLabel(): string {
  try {
    const formatted = new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
    return `${formatted} (GMT+7)`;
  } catch {
    return `${new Date().toISOString()} (UTC)`;
  }
}

async function resolveLocationForWeather(prompt: string): Promise<GeoCoord | null> {
  const norm = normalizeVi(prompt);
  // Check longer aliases first so e.g. "ho chi minh" wins before shorter tokens
  const sortedEntries = [...VN_CITY_COORDS].sort(
    (a, b) => Math.max(...b.aliases.map((x) => x.length)) - Math.max(...a.aliases.map((x) => x.length))
  );
  for (const item of sortedEntries) {
    for (const alias of item.aliases) {
      const pattern = new RegExp(`(?:^|\\s|[,.!?;:])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s|[,.!?;:])`, 'i');
      if (pattern.test(norm)) {
        return item.coord;
      }
    }
  }

  // Extract candidate location phrase via Open-Meteo Geocoding
  const stripped = norm
    .replace(/\b(cho toi|cho minh|xem|hoi|ve|tinh hinh|du bao|thoi tiet|nhiet do|hom nay|ngay mai|tuan nay|hien tai|luc nay|o|tai|khu vuc|tinh|thanh pho|tp|weather|forecast|in|for|today)\b/gi, ' ')
    .replace(/[?!.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped || stripped.length < 2) {
    return null;
  }

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(stripped)}&count=3&language=vi&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: Array<{ name?: string; admin1?: string; country?: string; latitude?: number; longitude?: number }>;
    };
    const first = json.results?.[0];
    if (first && typeof first.latitude === 'number' && typeof first.longitude === 'number') {
      const parts = [first.name, first.admin1, first.country].filter(Boolean);
      return {
        label: parts.join(', ') || stripped,
        lat: first.latitude,
        lon: first.longitude,
      };
    }
  } catch {
    // Ignore geocoding network failures
  }
  return null;
}

async function fetchLiveWeatherContext(prompt: string): Promise<string | null> {
  const coord = await resolveLocationForWeather(prompt);
  if (!coord) return null;

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coord.lat}&longitude=${coord.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FHo_Chi_Minh&forecast_days=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      current?: {
        time?: string;
        temperature_2m?: number;
        relative_humidity_2m?: number;
        apparent_temperature?: number;
        precipitation?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
      };
    };

    const cur = json.current;
    if (!cur) return null;

    const lines: string[] = [
      `📍 **Thời tiết thực tế tại ${coord.label}** (cập nhật lúc ${cur.time || 'hiện tại'} GMT+7, nguồn Open-Meteo):`,
      `• Tình trạng: **${describeWmoCode(cur.weather_code)}**`,
      `• Nhiệt độ hiện tại: **${cur.temperature_2m ?? '—'}°C** (cảm giác như ${cur.apparent_temperature ?? '—'}°C)`,
      `• Độ ẩm: **${cur.relative_humidity_2m ?? '—'}%** · Lượng mưa đo được: **${cur.precipitation ?? 0} mm** · Gió: **${cur.wind_speed_10m ?? '—'} km/h**`,
    ];

    const dates = json.daily?.time || [];
    if (dates.length > 0) {
      lines.push('• Dự báo 3 ngày (giờ Việt Nam):');
      for (let i = 0; i < Math.min(3, dates.length); i++) {
        const dStr = dates[i];
        const minT = json.daily?.temperature_2m_min?.[i];
        const maxT = json.daily?.temperature_2m_max?.[i];
        const rainP = json.daily?.precipitation_probability_max?.[i];
        const code = json.daily?.weather_code?.[i];
        lines.push(
          `  - ${dStr}: ${describeWmoCode(code)} · Nhiệt độ ${minT ?? '—'}°C – ${maxT ?? '—'}°C · Xác suất mưa ${rainP ?? '—'}%`
        );
      }
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}

async function fetchLiveExchangeRateContext(): Promise<string | null> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: string;
      time_last_update_utc?: string;
      rates?: Record<string, number>;
    };
    const rates = json.rates;
    const vndPerUsd = rates?.VND;
    if (!rates || typeof vndPerUsd !== 'number' || vndPerUsd <= 0) return null;

    const fmtVnd = (val: number) => `${Math.round(val).toLocaleString('vi-VN')} VNĐ`;
    const currencies = [
      { code: 'USD', name: '1 USD (Đô la Mỹ)' },
      { code: 'EUR', name: '1 EUR (Euro)' },
      { code: 'CNY', name: '1 CNY (Nhân dân tệ)' },
      { code: 'JPY', name: '1 JPY (Yên Nhật)' },
      { code: 'GBP', name: '1 GBP (Bảng Anh)' },
      { code: 'AUD', name: '1 AUD (Đô la Úc)' },
      { code: 'KRW', name: '1 KRW (Won Hàn)' },
      { code: 'SGD', name: '1 SGD (Đô la Singapore)' },
      { code: 'THB', name: '1 THB (Baht Thái)' },
    ];

    const lines = [
      `💱 **Tỷ giá ngoại tệ tham chiếu trực tiếp sang VNĐ** (cập nhật: ${json.time_last_update_utc || 'hôm nay'}, nguồn ExchangeRate-API):`,
    ];
    for (const c of currencies) {
      const rate = rates[c.code];
      if (typeof rate === 'number' && rate > 0) {
        const vnd = c.code === 'USD' ? vndPerUsd : vndPerUsd / rate;
        lines.push(`• ${c.name} ≈ **${fmtVnd(vnd)}**`);
      }
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}

async function fetchDuckDuckGoSnippets(query: string): Promise<string[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const snippets: string[] = [];
    const regex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null && snippets.length < 5) {
      const clean = decodeHtmlEntities(match[1]);
      if (clean && clean.length > 15) {
        snippets.push(clean);
      }
    }
    return snippets;
  } catch {
    return [];
  }
}

async function fetchWikipediaViSnippets(query: string): Promise<string[]> {
  try {
    const url = `https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=2`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'ToanTrung-AI/1.0',
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      query?: { search?: Array<{ title?: string; snippet?: string }> };
    };
    const items = json.query?.search || [];
    return items
      .map((item) => {
        const title = (item.title || '').trim();
        const snippet = decodeHtmlEntities(item.snippet || '');
        return title && snippet ? `${title}: ${snippet}` : '';
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchGoogleNewsRss(query: string): Promise<string[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=vi&gl=VN&ceid=VN:vi`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: string[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(xml)) !== null && items.length < 5) {
      const block = m[1];
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
      const pubMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      const srcMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')) : '';
      const pub = pubMatch ? pubMatch[1].trim() : '';
      const src = srcMatch ? decodeHtmlEntities(srcMatch[1]) : '';
      if (title) {
        items.push(`- ${title}${src ? ` (${src}` : ''}${pub ? `${src ? ' · ' : ' ('}${pub})` : src ? ')' : ''}`);
      }
    }
    return items;
  } catch {
    return [];
  }
}

export async function gatherLiveWebGrounding(
  userPrompt: string
): Promise<{ contextText: string; sources: string[] } | null> {
  if (process.env.NODE_TEST_CONTEXT) return null;
  const trimmed = (userPrompt || '').trim();
  if (trimmed.length < 2) return null;

  const wantsWeather = WEATHER_INTENT_REGEX.test(trimmed);
  const wantsFx = FX_INTENT_REGEX.test(trimmed);
  const wantsWebOrNews = WEB_NEWS_INTENT_REGEX.test(trimmed) || wantsWeather || wantsFx;

  if (!wantsWeather && !wantsFx && !wantsWebOrNews) {
    return null;
  }

  const tasks: Array<Promise<{ source: string; text: string | null }>> = [];

  if (wantsWeather) {
    tasks.push(
      fetchLiveWeatherContext(trimmed).then((text) => ({ source: 'Open-Meteo', text }))
    );
  }
  if (wantsFx) {
    tasks.push(
      fetchLiveExchangeRateContext().then((text) => ({ source: 'ExchangeRate-API', text }))
    );
  }
  if (wantsWebOrNews) {
    tasks.push(
      fetchDuckDuckGoSnippets(trimmed).then(async (list) => {
        if (list.length > 0) {
          return {
            source: 'DuckDuckGo',
            text: `🔎 Kết quả tìm kiếm Web:\n${list.map((s) => `- ${s}`).join('\n')}`,
          };
        }
        const wikiList = await fetchWikipediaViSnippets(trimmed);
        return {
          source: 'Wikipedia VI',
          text:
            wikiList.length > 0
              ? `📚 Thông tin tham khảo Wikipedia:\n${wikiList.map((s) => `- ${s}`).join('\n')}`
              : null,
        };
      })
    );
    tasks.push(
      fetchGoogleNewsRss(trimmed).then((list) => ({
        source: 'Google News',
        text: list.length > 0 ? `📰 Tin tức mới liên quan:\n${list.join('\n')}` : null,
      }))
    );
  }

  const settled = await Promise.all(tasks);
  const sections: string[] = [];
  const sources: string[] = [];

  for (const item of settled) {
    if (item.text) {
      sections.push(item.text);
      if (!sources.includes(item.source)) {
        sources.push(item.source);
      }
    }
  }

  if (sections.length === 0) return null;

  return {
    contextText: `[DỮ LIỆU THỜI GIAN THỰC TỪ INTERNET · ${formatVietnamNowLabel()}]\n\n${sections.join('\n\n')}`,
    sources,
  };
}
