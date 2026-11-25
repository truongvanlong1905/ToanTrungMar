'use client';

import React, { useMemo, useState } from 'react';
import {
  searchDistrictsByProvince,
  searchVietnamProvinces,
  searchWardsByDistrict,
} from '@toantrung/contracts';
import { ChevronDown, MapPin } from 'lucide-react';

interface VietnamAddressFieldsProps {
  province: string;
  onProvinceChange: (value: string) => void;
  district: string;
  onDistrictChange: (value: string) => void;
  ward: string;
  onWardChange: (value: string) => void;
  installationAddress: string;
  onInstallationAddressChange: (value: string) => void;
  /** Optional input name for uncontrolled form compatibility */
  installationAddressName?: string;
}

export function VietnamAddressFields({
  province,
  onProvinceChange,
  district,
  onDistrictChange,
  ward,
  onWardChange,
  installationAddress,
  onInstallationAddressChange,
  installationAddressName,
}: VietnamAddressFieldsProps) {
  const [openDropdown, setOpenDropdown] = useState<'province' | 'district' | 'ward' | null>(null);
  const [provinceQuery, setProvinceQuery] = useState('');
  const [districtQuery, setDistrictQuery] = useState('');
  const [wardQuery, setWardQuery] = useState('');

  const provinceOptions = useMemo(
    () => searchVietnamProvinces(openDropdown === 'province' ? provinceQuery : ''),
    [openDropdown, provinceQuery],
  );

  const districtOptions = useMemo(
    () => searchDistrictsByProvince(province, openDropdown === 'district' ? districtQuery : ''),
    [province, openDropdown, districtQuery],
  );

  const wardOptions = useMemo(
    () => searchWardsByDistrict(district, openDropdown === 'ward' ? wardQuery : ''),
    [district, openDropdown, wardQuery],
  );

  return (
    <div className="sm:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1 border-t border-slate-100">
      {/* 1. Tỉnh / Thành phố (Hỗ trợ gõ tên cũ & mới) */}
      <div className="relative">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Tỉnh / Thành phố <span className="text-[10px] text-slate-400">(cũ &amp; mới)</span>
        </label>
        <div className="relative">
          <input
            type="text"
            value={openDropdown === 'province' ? provinceQuery : province}
            onFocus={() => {
              setProvinceQuery('');
              setOpenDropdown('province');
            }}
            onBlur={() => {
              setTimeout(() => {
                setOpenDropdown((prev) => (prev === 'province' ? null : prev));
              }, 160);
            }}
            onChange={(e) => {
              const val = e.target.value;
              setProvinceQuery(val);
              onProvinceChange(val);
              setOpenDropdown('province');
            }}
            placeholder="Gõ tỉnh cũ hoặc mới..."
            className="w-full h-9 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs sm:text-sm focus:outline-none focus:border-[#1E3A8A]"
          />
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        {openDropdown === 'province' && (
          <div className="absolute z-40 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
            {provinceOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500">
                Giữ giá trị nhập tay: <strong className="text-slate-800">{provinceQuery}</strong>
              </div>
            ) : (
              provinceOptions.map((opt) => (
                <button
                  key={opt.name}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onProvinceChange(opt.name);
                    setProvinceQuery(opt.name);
                    if (opt.name !== province) {
                      onDistrictChange('');
                      onWardChange('');
                    }
                    setOpenDropdown(null);
                  }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-blue-50 transition-colors ${
                    opt.name === province ? 'bg-blue-50/70' : ''
                  }`}
                >
                  <div className="text-xs font-semibold text-slate-800 flex items-center justify-between gap-1">
                    <span>{opt.name}</span>
                    {opt.matchedLegacyName && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                        Cũ: {opt.matchedLegacyName}
                      </span>
                    )}
                  </div>
                  {opt.legacyLabel && (
                    <div className="text-[10px] text-slate-400 truncate">{opt.legacyLabel}</div>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* 2. Quận / Huyện / Thị xã */}
      <div className="relative">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Quận / Huyện / Thị xã
        </label>
        <div className="relative">
          <input
            type="text"
            value={openDropdown === 'district' ? districtQuery : district}
            onFocus={() => {
              setDistrictQuery(district);
              setOpenDropdown('district');
            }}
            onBlur={() => {
              setTimeout(() => {
                setOpenDropdown((prev) => (prev === 'district' ? null : prev));
              }, 160);
            }}
            onChange={(e) => {
              const val = e.target.value;
              setDistrictQuery(val);
              onDistrictChange(val);
              setOpenDropdown('district');
            }}
            placeholder="Gõ Quận / Huyện / TP..."
            className="w-full h-9 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs sm:text-sm focus:outline-none focus:border-[#1E3A8A]"
          />
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
        {openDropdown === 'district' && districtOptions.length > 0 && (
          <div className="absolute z-40 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
            {districtOptions.map((d) => (
              <button
                key={d}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onDistrictChange(d);
                  setDistrictQuery(d);
                  setOpenDropdown(null);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 ${
                  d === district ? 'bg-blue-50/70 font-semibold text-[#1E3A8A]' : 'text-slate-700'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3. Phường / Xã / Thị trấn */}
      <div className="relative">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Phường / Xã / Thị trấn
        </label>
        <div className="relative">
          <input
            type="text"
            value={openDropdown === 'ward' ? wardQuery : ward}
            onFocus={() => {
              setWardQuery(ward);
              setOpenDropdown('ward');
            }}
            onBlur={() => {
              setTimeout(() => {
                setOpenDropdown((prev) => (prev === 'ward' ? null : prev));
              }, 160);
            }}
            onChange={(e) => {
              const val = e.target.value;
              setWardQuery(val);
              onWardChange(val);
              setOpenDropdown('ward');
            }}
            placeholder="VD: Phường Linh Trung, Xã..."
            className="w-full h-9 pl-2.5 pr-7 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs sm:text-sm focus:outline-none focus:border-[#1E3A8A]"
          />
          {wardOptions.length > 0 && (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          )}
        </div>
        {openDropdown === 'ward' && wardOptions.length > 0 && (
          <div className="absolute z-40 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
            {wardOptions.map((w) => (
              <button
                key={w}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onWardChange(w);
                  setWardQuery(w);
                  setOpenDropdown(null);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 ${
                  w === ward ? 'bg-blue-50/70 font-semibold text-[#1E3A8A]' : 'text-slate-700'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 4. Thôn / Ấp / Số nhà, Đường chi tiết */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
          <MapPin className="w-3 h-3 text-slate-400" />
          <span>Thôn / Ấp / Số nhà, Đường</span>
        </label>
        <input
          name={installationAddressName}
          type="text"
          value={installationAddress}
          onChange={(e) => onInstallationAddressChange(e.target.value)}
          placeholder="Thôn, ấp, số nhà, đường, KCN..."
          className="w-full h-9 px-3 rounded-lg border border-slate-200 text-slate-800 text-xs sm:text-sm focus:outline-none focus:border-[#1E3A8A]"
        />
      </div>
    </div>
  );
}

