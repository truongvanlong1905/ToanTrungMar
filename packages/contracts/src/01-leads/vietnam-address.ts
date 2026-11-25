/**
 * Vietnam Administrative Address Directory (Dual-Support: Pre-2025 Legacy & 2025 Merged Units).
 * Allows searching provinces, districts, and wards by either current or former names, with or without diacritics.
 */

export interface VietnamProvinceEntry {
  name: string;
  legacyNames: string[];
  districts: string[];
}

/**
 * Strips Vietnamese diacritics and normalizes whitespace/case for fuzzy matching.
 */
export function normalizeVietnameseText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[.,\-/()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const VN_PROVINCE_DIRECTORY: VietnamProvinceEntry[] = [
  {
    name: 'TP. Hồ Chí Minh',
    legacyNames: ['Hồ Chí Minh', 'TP.HCM', 'Sài Gòn', 'Bình Dương', 'Bà Rịa - Vũng Tàu', 'Vũng Tàu'],
    districts: [
      'TP. Thủ Đức',
      'Quận 1',
      'Quận 3',
      'Quận 4',
      'Quận 5',
      'Quận 6',
      'Quận 7',
      'Quận 8',
      'Quận 10',
      'Quận 11',
      'Quận 12',
      'Quận Bình Thạnh',
      'Quận Gò Vấp',
      'Quận Phú Nhuận',
      'Quận Tân Bình',
      'Quận Tân Phú',
      'Quận Bình Tân',
      'Huyện Bình Chánh',
      'Huyện Củ Chi',
      'Huyện Hóc Môn',
      'Huyện Nhà Bè',
      'Huyện Cần Giờ',
      // Bình Dương (cũ)
      'TP. Thủ Dầu Một (Bình Dương cũ)',
      'TP. Dĩ An (Bình Dương cũ)',
      'TP. Thuận An (Bình Dương cũ)',
      'TP. Tân Uyên (Bình Dương cũ)',
      'TP. Bến Cát (Bình Dương cũ)',
      'Huyện Bàu Bàng (Bình Dương cũ)',
      'Huyện Bắc Tân Uyên (Bình Dương cũ)',
      'Huyện Dầu Tiếng (Bình Dương cũ)',
      'Huyện Phú Giáo (Bình Dương cũ)',
      // Bà Rịa - Vũng Tàu (cũ)
      'TP. Vũng Tàu (BR-VT cũ)',
      'TP. Bà Rịa (BR-VT cũ)',
      'TP. Phú Mỹ (BR-VT cũ)',
      'Huyện Long Đất (BR-VT cũ)',
      'Huyện Châu Đức (BR-VT cũ)',
      'Huyện Xuyên Mộc (BR-VT cũ)',
      'Huyện Côn Đảo',
    ],
  },
  {
    name: 'Hà Nội',
    legacyNames: ['TP. Hà Nội', 'Hà Tây cũ'],
    districts: [
      'Quận Ba Đình',
      'Quận Hoàn Kiếm',
      'Quận Tây Hồ',
      'Quận Long Biên',
      'Quận Cầu Giấy',
      'Quận Đống Đa',
      'Quận Hai Bà Trưng',
      'Quận Hoàng Mai',
      'Quận Thanh Xuân',
      'Quận Nam Từ Liêm',
      'Quận Bắc Từ Liêm',
      'Quận Hà Đông',
      'Thị xã Sơn Tây',
      'Huyện Đông Anh',
      'Huyện Gia Lâm',
      'Huyện Thanh Trì',
      'Huyện Hoài Đức',
      'Huyện Đan Phượng',
      'Huyện Thạch Thất',
      'Huyện Quốc Oai',
      'Huyện Chương Mỹ',
      'Huyện Thường Tín',
      'Huyện Sóc Sơn',
      'Huyện Mê Linh',
    ],
  },
  {
    name: 'TP. Đà Nẵng',
    legacyNames: ['Đà Nẵng', 'Quảng Nam'],
    districts: [
      'Quận Hải Châu',
      'Quận Thanh Khê',
      'Quận Sơn Trà',
      'Quận Ngũ Hành Sơn',
      'Quận Liên Chiểu',
      'Quận Cẩm Lệ',
      'Huyện Hòa Vang',
      'TP. Tam Kỳ (Quảng Nam cũ)',
      'TP. Hội An (Quảng Nam cũ)',
      'Thị xã Điện Bàn (Quảng Nam cũ)',
      'Huyện Duy Xuyên (Quảng Nam cũ)',
      'Huyện Núi Thành (Quảng Nam cũ)',
      'Huyện Thăng Bình (Quảng Nam cũ)',
    ],
  },
  {
    name: 'TP. Hải Phòng',
    legacyNames: ['Hải Phòng', 'Hải Dương'],
    districts: [
      'Quận Hồng Bàng',
      'Quận Ngô Quyền',
      'Quận Lê Chân',
      'Quận Hải An',
      'Quận Kiến An',
      'Quận Đồ Sơn',
      'Quận Dương Kinh',
      'TP. Thủy Nguyên',
      'Huyện An Dương',
      'Huyện An Lão',
      'TP. Hải Dương (Hải Dương cũ)',
      'TP. Chí Linh (Hải Dương cũ)',
      'Thị xã Kinh Môn (Hải Dương cũ)',
    ],
  },
  {
    name: 'TP. Cần Thơ',
    legacyNames: ['Cần Thơ', 'Sóc Trăng', 'Hậu Giang'],
    districts: [
      'Quận Ninh Kiều',
      'Quận Bình Thủy',
      'Quận Cái Răng',
      'Quận Ô Môn',
      'Quận Thốt Nốt',
      'Huyện Phong Điền',
      'TP. Sóc Trăng (Sóc Trăng cũ)',
      'TP. Vị Thanh (Hậu Giang cũ)',
      'TP. Ngã Bảy (Hậu Giang cũ)',
    ],
  },
  {
    name: 'TP. Huế',
    legacyNames: ['Thừa Thiên Huế', 'Huế'],
    districts: [
      'Quận Thuận Hóa',
      'Quận Phú Xuân',
      'Thị xã Hương Thủy',
      'Thị xã Hương Trà',
      'Thị xã Phong Điền',
      'Huyện Phú Vang',
      'Huyện Phú Lộc',
    ],
  },
  {
    name: 'Đồng Nai',
    legacyNames: ['Bình Phước'],
    districts: [
      'TP. Biên Hòa',
      'TP. Long Khánh',
      'Huyện Long Thành',
      'Huyện Nhơn Trạch',
      'Huyện Trảng Bom',
      'Huyện Vĩnh Cửu',
      'Huyện Xuân Lộc',
      'Huyện Định Quán',
      'TP. Đồng Xoài (Bình Phước cũ)',
      'Thị xã Chơn Thành (Bình Phước cũ)',
      'Thị xã Bình Long (Bình Phước cũ)',
      'Thị xã Phước Long (Bình Phước cũ)',
    ],
  },
  {
    name: 'Tây Ninh',
    legacyNames: ['Long An'],
    districts: [
      'TP. Tây Ninh',
      'Thị xã Trảng Bàng',
      'Thị xã Hòa Thành',
      'Huyện Gò Dầu',
      'Huyện Bến Cầu',
      'TP. Tân An (Long An cũ)',
      'Thị xã Kiến Tường (Long An cũ)',
      'Huyện Đức Hòa (Long An cũ)',
      'Huyện Bến Lức (Long An cũ)',
      'Huyện Cần Đước (Long An cũ)',
      'Huyện Cần Giuộc (Long An cũ)',
    ],
  },
  {
    name: 'Lâm Đồng',
    legacyNames: ['Đắk Nông', 'Bình Thuận'],
    districts: [
      'TP. Đà Lạt',
      'TP. Bảo Lộc',
      'Huyện Đức Trọng',
      'Huyện Di Linh',
      'Huyện Lâm Hà',
      'TP. Gia Nghĩa (Đắk Nông cũ)',
      'TP. Phan Thiết (Bình Thuận cũ)',
      'Thị xã La Gi (Bình Thuận cũ)',
    ],
  },
  {
    name: 'Đắk Lắk',
    legacyNames: ['Phú Yên'],
    districts: [
      'TP. Buôn Ma Thuột',
      'Thị xã Buôn Hồ',
      'Huyện Cư M’gar',
      'Huyện Ea Kar',
      'TP. Tuy Hòa (Phú Yên cũ)',
      'Thị xã Sông Cầu (Phú Yên cũ)',
      'Thị xã Đông Hòa (Phú Yên cũ)',
    ],
  },
  {
    name: 'Khánh Hòa',
    legacyNames: ['Ninh Thuận'],
    districts: [
      'TP. Nha Trang',
      'TP. Cam Ranh',
      'Thị xã Ninh Hòa',
      'Huyện Diên Khánh',
      'Huyện Cam Lâm',
      'TP. Phan Rang - Tháp Chàm (Ninh Thuận cũ)',
    ],
  },
  {
    name: 'Gia Lai',
    legacyNames: ['Bình Định'],
    districts: [
      'TP. Pleiku',
      'Thị xã An Khê',
      'Thị xã Ayun Pa',
      'TP. Quy Nhơn (Bình Định cũ)',
      'Thị xã An Nhơn (Bình Định cũ)',
      'Thị xã Hoài Nhơn (Bình Định cũ)',
    ],
  },
  {
    name: 'Quảng Ngãi',
    legacyNames: ['Kon Tum'],
    districts: [
      'TP. Quảng Ngãi',
      'Thị xã Đức Phổ',
      'Huyện Bình Sơn',
      'TP. Kon Tum (Kon Tum cũ)',
    ],
  },
  {
    name: 'Quảng Trị',
    legacyNames: ['Quảng Bình'],
    districts: [
      'TP. Đông Hà',
      'Thị xã Quảng Trị',
      'TP. Đồng Hới (Quảng Bình cũ)',
      'Thị xã Ba Đồn (Quảng Bình cũ)',
    ],
  },
  {
    name: 'Hà Tĩnh',
    legacyNames: [],
    districts: ['TP. Hà Tĩnh', 'Thị xã Hồng Lĩnh', 'Thị xã Kỳ Anh', 'Huyện Nghi Xuân'],
  },
  {
    name: 'Nghệ An',
    legacyNames: [],
    districts: ['TP. Vinh', 'Thị xã Hoàng Mai', 'Thị xã Thái Hòa', 'Huyện Diễn Châu', 'Huyện Nghi Lộc'],
  },
  {
    name: 'Thanh Hóa',
    legacyNames: [],
    districts: ['TP. Thanh Hóa', 'TP. Sầm Sơn', 'Thị xã Bỉm Sơn', 'Thị xã Nghi Sơn', 'Huyện Hoằng Hóa'],
  },
  {
    name: 'Ninh Bình',
    legacyNames: ['Hà Nam', 'Nam Định'],
    districts: [
      'TP. Hoa Lư',
      'TP. Tam Điệp',
      'TP. Phủ Lý (Hà Nam cũ)',
      'Thị xã Duy Tiên (Hà Nam cũ)',
      'TP. Nam Định (Nam Định cũ)',
    ],
  },
  {
    name: 'Hưng Yên',
    legacyNames: ['Thái Bình'],
    districts: [
      'TP. Hưng Yên',
      'Thị xã Mỹ Hào',
      'Huyện Văn Giang',
      'Huyện Yên Mỹ',
      'TP. Thái Bình (Thái Bình cũ)',
    ],
  },
  {
    name: 'Bắc Ninh',
    legacyNames: ['Bắc Giang'],
    districts: [
      'TP. Bắc Ninh',
      'TP. Từ Sơn',
      'Thị xã Quế Võ',
      'Thị xã Thuận Thành',
      'TP. Bắc Giang (Bắc Giang cũ)',
      'Thị xã Việt Yên (Bắc Giang cũ)',
    ],
  },
  {
    name: 'Phú Thọ',
    legacyNames: ['Vĩnh Phúc', 'Hòa Bình'],
    districts: [
      'TP. Việt Trì',
      'Thị xã Phú Thọ',
      'TP. Vĩnh Yên (Vĩnh Phúc cũ)',
      'TP. Phúc Yên (Vĩnh Phúc cũ)',
      'TP. Hòa Bình (Hòa Bình cũ)',
    ],
  },
  {
    name: 'Thái Nguyên',
    legacyNames: ['Bắc Kạn'],
    districts: [
      'TP. Thái Nguyên',
      'TP. Sông Công',
      'TP. Phổ Yên',
      'TP. Bắc Kạn (Bắc Kạn cũ)',
    ],
  },
  {
    name: 'Tuyên Quang',
    legacyNames: ['Hà Giang'],
    districts: ['TP. Tuyên Quang', 'TP. Hà Giang (Hà Giang cũ)'],
  },
  {
    name: 'Lào Cai',
    legacyNames: ['Yên Bái'],
    districts: ['TP. Lào Cai', 'Thị xã Sa Pa', 'TP. Yên Bái (Yên Bái cũ)'],
  },
  {
    name: 'Quảng Ninh',
    legacyNames: [],
    districts: ['TP. Hạ Long', 'TP. Móng Cái', 'TP. Cẩm Phả', 'TP. Uông Bí', 'TP. Đông Triều', 'Thị xã Quảng Yên'],
  },
  {
    name: 'Lạng Sơn',
    legacyNames: [],
    districts: ['TP. Lạng Sơn', 'Huyện Hữu Lũng', 'Huyện Cao Lộc'],
  },
  {
    name: 'Cao Bằng',
    legacyNames: [],
    districts: ['TP. Cao Bằng', 'Huyện Trùng Khánh'],
  },
  {
    name: 'Sơn La',
    legacyNames: [],
    districts: ['TP. Sơn La', 'Thị xã Mộc Châu', 'Huyện Mai Sơn'],
  },
  {
    name: 'Điện Biên',
    legacyNames: [],
    districts: ['TP. Điện Biên Phủ', 'Thị xã Mường Lay'],
  },
  {
    name: 'Lai Châu',
    legacyNames: [],
    districts: ['TP. Lai Châu', 'Huyện Tam Đường'],
  },
  {
    name: 'Đồng Tháp',
    legacyNames: ['Tiền Giang'],
    districts: [
      'TP. Cao Lãnh',
      'TP. Sa Đéc',
      'TP. Hồng Ngự',
      'TP. Mỹ Tho (Tiền Giang cũ)',
      'TP. Gò Công (Tiền Giang cũ)',
      'Thị xã Cai Lậy (Tiền Giang cũ)',
    ],
  },
  {
    name: 'Vĩnh Long',
    legacyNames: ['Bến Tre', 'Trà Vinh'],
    districts: [
      'TP. Vĩnh Long',
      'Thị xã Bình Minh',
      'TP. Bến Tre (Bến Tre cũ)',
      'TP. Trà Vinh (Trà Vinh cũ)',
    ],
  },
  {
    name: 'An Giang',
    legacyNames: ['Kiên Giang'],
    districts: [
      'TP. Long Xuyên',
      'TP. Châu Đốc',
      'TP. Rạch Giá (Kiên Giang cũ)',
      'TP. Phú Quốc (Kiên Giang cũ)',
      'TP. Hà Tiên (Kiên Giang cũ)',
    ],
  },
  {
    name: 'Cà Mau',
    legacyNames: ['Bạc Liêu'],
    districts: ['TP. Cà Mau', 'Huyện Năm Căn', 'TP. Bạc Liêu (Bạc Liêu cũ)', 'Thị xã Giá Rai (Bạc Liêu cũ)'],
  },
];

const COMMON_WARDS_BY_DISTRICT: Record<string, string[]> = {
  'TP. Thủ Đức': [
    'Phường Linh Trung',
    'Phường Linh Xuân',
    'Phường Linh Tây',
    'Phường Linh Chiểu',
    'Phường Bình Thọ',
    'Phường Trường Thọ',
    'Phường Hiệp Bình Chánh',
    'Phường Hiệp Bình Phước',
    'Phường Thảo Điền',
    'Phường An Phú',
    'Phường Thủ Thiêm',
    'Phường Long Bình',
    'Phường Tăng Nhơn Phú A',
    'Phường Tăng Nhơn Phú B',
    'Phường Phước Long A',
    'Phường Phước Long B',
  ],
  'Quận 1': [
    'Phường Bến Nghé',
    'Phường Bến Thành',
    'Phường Đa Kao',
    'Phường Tân Định',
    'Phường Nguyễn Thái Bình',
    'Phường Phạm Ngũ Lão',
    'Phường Cầu Ông Lãnh',
    'Phường Cô Giang',
  ],
  'Quận 3': ['Phường Võ Thị Sáu', 'Phường 1', 'Phường 2', 'Phường 4', 'Phường 5', 'Phường 9', 'Phường 10', 'Phường 14'],
  'Quận 7': [
    'Phường Tân Phong',
    'Phường Tân Phú',
    'Phường Phú Mỹ',
    'Phường Tân Kiểng',
    'Phường Tân Quy',
    'Phường Tân Thuận Đông',
    'Phường Tân Thuận Tây',
    'Phường Bình Thuận',
  ],
  'Quận Bình Thạnh': ['Phường 1', 'Phường 2', 'Phường 17', 'Phường 19', 'Phường 21', 'Phường 22', 'Phường 25', 'Phường 26'],
  'Quận Tân Bình': ['Phường 1', 'Phường 2', 'Phường 4', 'Phường 12', 'Phường 13', 'Phường 14', 'Phường 15'],
  'Quận Gò Vấp': ['Phường 1', 'Phường 3', 'Phường 5', 'Phường 6', 'Phường 10', 'Phường 11', 'Phường 14', 'Phường 17'],
  'Huyện Bình Chánh': ['Thị trấn Tân Túc', 'Xã Vĩnh Lộc A', 'Xã Vĩnh Lộc B', 'Xã Bình Hưng', 'Xã Phong Phú', 'Xã Tân Kiên', 'Xã Lê Minh Xuân'],
  'Huyện Củ Chi': ['Thị trấn Củ Chi', 'Xã Tân Phú Trung', 'Xã Tân Thông Hội', 'Xã Phước Vĩnh An', 'Xã Trung An'],
  'Huyện Hóc Môn': ['Thị trấn Hóc Môn', 'Xã Bà Điểm', 'Xã Xuân Thới Thượng', 'Xã Đông Thạnh', 'Xã Trung Chánh'],
  'Huyện Nhà Bè': ['Thị trấn Nhà Bè', 'Xã Phước Kiển', 'Xã Nhơn Đức', 'Xã Long Thới', 'Xã Hiệp Phước'],
  'TP. Dĩ An (Bình Dương cũ)': ['Phường Dĩ An', 'Phường An Bình', 'Phường Đông Hòa', 'Phường Tân Đông Hiệp', 'Phường Bình An'],
  'TP. Thuận An (Bình Dương cũ)': ['Phường Lái Thiêu', 'Phường An Phú', 'Phường Bình Hòa', 'Phường Thuận Giao', 'Phường Vĩnh Phú'],
  'TP. Thủ Dầu Một (Bình Dương cũ)': ['Phường Phú Cường', 'Phường Phú Hòa', 'Phường Chánh Nghĩa', 'Phường Hiệp Thành', 'Phường Hòa Phú'],
  'TP. Biên Hòa': ['Phường Tân Hiệp', 'Phường Trảng Dài', 'Phường Long Bình', 'Phường Tam Hiệp', 'Phường An Bình', 'Phường Bửu Long'],
};

export interface ProvinceSearchOption {
  name: string;
  matchedLegacyName: string | null;
  legacyLabel: string;
}

/**
 * Searches provinces matching either current 2025 names or pre-2025 legacy province names.
 */
export function searchVietnamProvinces(query: string): ProvinceSearchOption[] {
  const q = normalizeVietnameseText(query);
  const results: ProvinceSearchOption[] = [];

  for (const entry of VN_PROVINCE_DIRECTORY) {
    const normName = normalizeVietnameseText(entry.name);
    const matchedLegacy = entry.legacyNames.find((leg) =>
      normalizeVietnameseText(leg).includes(q),
    );
    const nameMatches = !q || normName.includes(q);
    if (nameMatches || matchedLegacy) {
      results.push({
        name: entry.name,
        matchedLegacyName: !nameMatches && matchedLegacy ? matchedLegacy : null,
        legacyLabel:
          entry.legacyNames.length > 0 ? `Gồm cũ: ${entry.legacyNames.join(', ')}` : '',
      });
    }
  }
  return results;
}

/**
 * Resolves any province name (old or new) to its parent directory entry.
 */
export function findProvinceEntry(provinceInput?: string | null): VietnamProvinceEntry | null {
  if (!provinceInput) return null;
  const q = normalizeVietnameseText(provinceInput);
  if (!q) return null;

  return (
    VN_PROVINCE_DIRECTORY.find((entry) => {
      if (normalizeVietnameseText(entry.name) === q) return true;
      if (entry.legacyNames.some((leg) => normalizeVietnameseText(leg) === q)) return true;
      return (
        normalizeVietnameseText(entry.name).includes(q) ||
        entry.legacyNames.some((leg) => normalizeVietnameseText(leg).includes(q))
      );
    }) ?? null
  );
}

/**
 * Returns districts matching query for the selected province (supports old/new province names).
 */
export function searchDistrictsByProvince(provinceInput: string, query: string): string[] {
  const entry = findProvinceEntry(provinceInput);
  const sourceList = entry
    ? entry.districts
    : VN_PROVINCE_DIRECTORY.flatMap((p) => p.districts);
  const q = normalizeVietnameseText(query);
  if (!q) return sourceList;
  return sourceList.filter((d) => normalizeVietnameseText(d).includes(q));
}

/**
 * Returns common wards/communes for a district, filtered by query.
 */
export function searchWardsByDistrict(districtInput: string, query: string): string[] {
  const exactKey = Object.keys(COMMON_WARDS_BY_DISTRICT).find(
    (k) => normalizeVietnameseText(k) === normalizeVietnameseText(districtInput),
  );
  const list = exactKey ? COMMON_WARDS_BY_DISTRICT[exactKey] : [];
  const q = normalizeVietnameseText(query);
  if (!q) return list;
  return list.filter((w) => normalizeVietnameseText(w).includes(q));
}

/**
 * Infers internal `areaType` from province string for backward-compatible reporting.
 */
export function inferAreaTypeFromProvince(province?: string | null): 'hcm' | 'other_province' {
  const norm = normalizeVietnameseText(province || '');
  if (!norm) return 'hcm';
  if (
    norm.includes('ho chi minh') ||
    norm.includes('tphcm') ||
    norm.includes('sai gon')
  ) {
    return 'hcm';
  }
  return 'other_province';
}

/**
 * Packs ward + district cleanly into the DB `district` column (max 100 chars).
 */
export function composeLeadDistrictField(ward?: string | null, district?: string | null): string | null {
  const w = (ward || '').trim();
  const d = (district || '').trim();
  if (w && d) return `${w}, ${d}`.slice(0, 100);
  if (d) return d.slice(0, 100);
  if (w) return w.slice(0, 100);
  return null;
}

/**
 * Splits a stored `district` string back into `{ ward, district }` for editing.
 */
export function splitLeadDistrictField(raw?: string | null): { ward: string; district: string } {
  const val = (raw || '').trim();
  if (!val) return { ward: '', district: '' };
  const idx = val.indexOf(',');
  if (idx > 0) {
    return {
      ward: val.slice(0, idx).trim(),
      district: val.slice(idx + 1).trim(),
    };
  }
  if (/^(phường|xã|thị trấn)\s/i.test(val)) {
    return { ward: val, district: '' };
  }
  return { ward: '', district: val };
}

/**
 * Formats a concise human-readable address summary across table, card, and detail views.
 */
export function formatLeadLocationLabel(lead: {
  province?: string | null;
  hcmDistrict?: string | null;
  installationAddress?: string | null;
  areaType?: string | null;
}): string {
  const parts = [
    lead.installationAddress?.trim(),
    lead.hcmDistrict?.trim(),
    lead.province?.trim() || (lead.areaType === 'hcm' ? 'TP. Hồ Chí Minh' : ''),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Chưa cập nhật địa chỉ';
}

