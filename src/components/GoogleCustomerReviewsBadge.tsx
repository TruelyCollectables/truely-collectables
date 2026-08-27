"use client";

import Script from "next/script";
import { GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID } from "../lib/google-customer-reviews";

type GoogleMerchantWidgetApi = {
  start(config: { merchant_id: number }): void;
};

declare global {
  interface Window {
    merchantwidget?: GoogleMerchantWidgetApi;
    __truelyGoogleCustomerReviewsBadgeStarted?: boolean;
  }
}

const GOOGLE_MERCHANT_WIDGET_SCRIPT =
  "https://www.gstatic.com/shopping/merchant/merchantwidget.js";

function startGoogleCustomerReviewsBadge() {
  if (
    window.__truelyGoogleCustomerReviewsBadgeStarted ||
    !window.merchantwidget?.start
  ) {
    return;
  }

  try {
    window.merchantwidget.start({
      merchant_id: GOOGLE_CUSTOMER_REVIEWS_MERCHANT_ID,
    });
    window.__truelyGoogleCustomerReviewsBadgeStarted = true;
  } catch {
    // The storefront remains usable if Google's optional badge cannot load.
  }
}

export default function GoogleCustomerReviewsBadge() {
  return (
    <Script
      id="merchantWidgetScript"
      src={GOOGLE_MERCHANT_WIDGET_SCRIPT}
      strategy="afterInteractive"
      onReady={startGoogleCustomerReviewsBadge}
    />
  );
}
