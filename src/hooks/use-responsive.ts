import * as React from "react";

export type DeviceType = 'mobile' | 'ipad_portrait' | 'ipad_landscape' | 'desktop';
export type Orientation = 'portrait' | 'landscape';

export interface ResponsiveState {
  deviceType: DeviceType;
  orientation: Orientation;
  isMobile: boolean;
  isIPadPortrait: boolean;
  isIPadLandscape: boolean;
  isIPad: boolean;
  isDesktop: boolean;
  isPortrait: boolean;
  isLandscape: boolean;
  isTouchDevice: boolean;
  width: number;
  height: number;
}

export function useResponsiveDevice(): ResponsiveState {
  const [state, setState] = React.useState<ResponsiveState>({
    deviceType: 'desktop',
    orientation: 'landscape',
    isMobile: false,
    isIPadPortrait: false,
    isIPadLandscape: false,
    isIPad: false,
    isDesktop: true,
    isPortrait: false,
    isLandscape: true,
    isTouchDevice: false,
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateState = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const orientation: Orientation = w < h ? 'portrait' : 'landscape';
      
      const ua = navigator.userAgent || '';
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isIPadUA = /iPad|Macintosh/i.test(ua) && isTouchDevice && w >= 600;

      let deviceType: DeviceType = 'desktop';

      if (w < 640) {
        deviceType = 'mobile';
      } else if (w >= 640 && w <= 1024 && orientation === 'portrait') {
        deviceType = 'ipad_portrait';
      } else if (w >= 640 && w <= 1180 && orientation === 'landscape') {
        deviceType = 'ipad_landscape';
      } else if (isIPadUA && orientation === 'portrait') {
        deviceType = 'ipad_portrait';
      } else if (isIPadUA && orientation === 'landscape') {
        deviceType = 'ipad_landscape';
      } else {
        deviceType = 'desktop';
      }

      const isMobile = deviceType === 'mobile';
      const isIPadPortrait = deviceType === 'ipad_portrait';
      const isIPadLandscape = deviceType === 'ipad_landscape';
      const isIPad = isIPadPortrait || isIPadLandscape;
      const isDesktop = deviceType === 'desktop';
      const isPortrait = orientation === 'portrait';
      const isLandscape = orientation === 'landscape';

      setState({
        deviceType,
        orientation,
        isMobile,
        isIPadPortrait,
        isIPadLandscape,
        isIPad,
        isDesktop,
        isPortrait,
        isLandscape,
        isTouchDevice,
        width: w,
        height: h,
      });
    };

    updateState();

    window.addEventListener('resize', updateState);
    window.addEventListener('orientationchange', updateState);
    if (window.screen && window.screen.orientation) {
      window.screen.orientation.addEventListener('change', updateState);
    }

    return () => {
      window.removeEventListener('resize', updateState);
      window.removeEventListener('orientationchange', updateState);
      if (window.screen && window.screen.orientation) {
        window.screen.orientation.removeEventListener('change', updateState);
      }
    };
  }, []);

  return state;
}
