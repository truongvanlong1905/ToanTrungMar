'use client';

import React, { useEffect, useState } from 'react';

interface SystemUpgradeSplashProps {
  title?: string;
  subtitle?: string;
  badgeText?: string;
  showReloadAction?: boolean;
  onRetry?: () => void;
}

export function SystemUpgradeSplash({
  title = 'Toàn Trung CRM',
  subtitle = 'Đang kết nối không gian làm việc và đồng bộ phiên của bạn...',
  badgeText = 'KHÔNG GIAN QUẢN TRỊ NỘI BỘ',
  showReloadAction = false,
  onRetry,
}: SystemUpgradeSplashProps) {
  const [showManualReload, setShowManualReload] = useState(showReloadAction);

  useEffect(() => {
    if (showReloadAction) {
      setShowManualReload(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowManualReload(true);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [showReloadAction]);

  const handleReload = () => {
    if (onRetry) {
      onRetry();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 select-none"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background:
          'radial-gradient(circle at 18% 20%, rgba(37, 99, 235, 0.22) 0%, transparent 45%), radial-gradient(circle at 82% 80%, rgba(56, 189, 248, 0.16) 0%, transparent 45%), linear-gradient(135deg, #070E1C 0%, #0B172E 52%, #112244 100%)',
        fontFamily:
          "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: '#F8FAFC',
        boxSizing: 'border-box',
      }}
    >
      <style>{`
        @keyframes ttUpgradeSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes ttUpgradePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.92); }
        }
        @keyframes ttUpgradeBar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(15%); }
          100% { transform: translateX(120%); }
        }
        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
          }
        }
      `}</style>

      <div
        style={{
          width: '100%',
          maxWidth: '520px',
          background: 'rgba(15, 25, 48, 0.88)',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          borderRadius: '24px',
          padding: '36px 32px',
          boxShadow:
            '0 25px 60px -15px rgba(2, 6, 23, 0.72), 0 0 0 1px rgba(59, 130, 246, 0.14) inset',
          backdropFilter: 'blur(16px)',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Top Glowing Accent Bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'linear-gradient(90deg, #1E3A8A 0%, #2563EB 40%, #38BDF8 75%, #F59E0B 100%)',
          }}
        />

        {/* Brand Identity + Animated Spinner */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '72px',
              height: '72px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Outer rotating ring */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '9999px',
                border: '3px solid rgba(56, 189, 248, 0.18)',
                borderTopColor: '#38BDF8',
                borderRightColor: '#2563EB',
                animation: 'ttUpgradeSpin 1.15s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite',
              }}
            />
            {/* Inner TT Badge */}
            <div
              style={{
                width: '54px',
                height: '54px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 10px 24px -6px rgba(37, 99, 235, 0.65)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
              }}
            >
              <span
                style={{
                  fontSize: '17px',
                  fontWeight: 900,
                  letterSpacing: '0.04em',
                  color: '#FFFFFF',
                  lineHeight: 1,
                }}
              >
                TT
              </span>
              <span
                style={{
                  fontSize: '8px',
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  color: '#FBBF24',
                  marginTop: '3px',
                }}
              >
                CRM V2
              </span>
            </div>
          </div>

          {/* Status Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '5px 14px',
              borderRadius: '9999px',
              background: 'rgba(37, 99, 235, 0.18)',
              border: '1px solid rgba(56, 189, 248, 0.32)',
              color: '#7DD3FC',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '9999px',
                backgroundColor: '#38BDF8',
                boxShadow: '0 0 10px #38BDF8',
                animation: 'ttUpgradePulse 1.4s ease-in-out infinite',
              }}
            />
            <span>{badgeText}</span>
          </div>
        </div>

        {/* Title & Description */}
        <h1
          style={{
            margin: '0 0 10px 0',
            fontSize: '20px',
            fontWeight: 800,
            lineHeight: 1.35,
            color: '#FFFFFF',
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h1>

        <p
          style={{
            margin: '0 auto 22px auto',
            maxWidth: '430px',
            fontSize: '13.5px',
            lineHeight: 1.6,
            color: '#94A3B8',
            fontWeight: 500,
          }}
        >
          {subtitle}
        </p>

        {/* Animated Shimmer Progress Track */}
        <div
          style={{
            width: '100%',
            height: '6px',
            borderRadius: '9999px',
            backgroundColor: 'rgba(30, 41, 59, 0.9)',
            overflow: 'hidden',
            position: 'relative',
            marginBottom: '20px',
            border: '1px solid rgba(148, 163, 184, 0.12)',
          }}
        >
          <div
            style={{
              width: '55%',
              height: '100%',
              borderRadius: '9999px',
              background: 'linear-gradient(90deg, #2563EB 0%, #38BDF8 60%, #60A5FA 100%)',
              animation: 'ttUpgradeBar 1.6s ease-in-out infinite',
            }}
          />
        </div>

        {/* Feature Status Chips */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          {[
            'Gmail Auto-Lead',
            'Đồng bộ GA4 · GSC · Ads',
            'Báo cáo SEO & AI Studio',
          ].map((item) => (
            <span
              key={item}
              style={{
                padding: '5px 11px',
                borderRadius: '10px',
                backgroundColor: 'rgba(30, 41, 59, 0.75)',
                border: '1px solid rgba(148, 163, 184, 0.16)',
                color: '#CBD5E1',
                fontSize: '11.5px',
                fontWeight: 600,
              }}
            >
              ✓ {item}
            </span>
          ))}
        </div>

        {/* Manual Reload Action if loading takes longer */}
        {showManualReload && (
          <div style={{ marginTop: '22px', paddingTop: '16px', borderTop: '1px solid rgba(148, 163, 184, 0.14)' }}>
            <button
              type="button"
              onClick={handleReload}
              style={{
                padding: '9px 18px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)',
                color: '#FFFFFF',
                fontSize: '12.5px',
                fontWeight: 700,
                border: '1px solid rgba(96, 165, 250, 0.35)',
                cursor: 'pointer',
                boxShadow: '0 8px 20px -6px rgba(37, 99, 235, 0.55)',
              }}
            >
              Làm mới phiên làm việc ngay
            </button>
          </div>
        )}

        {/* Footer Brand */}
        <p
          style={{
            margin: '18px 0 0 0',
            fontSize: '11px',
            fontWeight: 600,
            color: '#64748B',
            letterSpacing: '0.04em',
          }}
        >
          TOÀN TRUNG SINCE 2006 · HỆ THỐNG QUẢN TRỊ NỘI BỘ
        </p>
      </div>
    </div>
  );
}

