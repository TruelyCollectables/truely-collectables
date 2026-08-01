"use client";

import { useEffect } from "react";
import type { GoogleCustomerReviewsOptInConfig } from "../lib/google-customer-reviews";

type GoogleSurveyOptInModule = {
  render(config: GoogleCustomerReviewsOptInConfig): void;
};

type GooglePlatformApi = {
  load(moduleName: "surveyoptin", callback: () => void): void;
  surveyoptin?: GoogleSurveyOptInModule;
};

declare global {
  interface Window {
    gapi?: GooglePlatformApi;
    renderOptIn?: () => void;
    __truelyGoogleCustomerReviewOrders?: Set<string>;
  }
}

const GOOGLE_PLATFORM_SCRIPT_ID = "google-customer-reviews-platform";
const GOOGLE_PLATFORM_SCRIPT_URL =
  "https://apis.google.com/js/platform.js?onload=renderOptIn";

export default function GoogleCustomerReviewsOptIn({
  config,
}: {
  config: GoogleCustomerReviewsOptInConfig | null;
}) {
  useEffect(() => {
    if (!config) return;

    let cancelled = false;
    let moduleLoading = false;
    let loadListenerAttached = false;
    let platformScript = document.getElementById(
      GOOGLE_PLATFORM_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    const renderedOrders =
      window.__truelyGoogleCustomerReviewOrders || new Set<string>();

    window.__truelyGoogleCustomerReviewOrders = renderedOrders;

    const renderOptIn = () => {
      if (
        cancelled ||
        moduleLoading ||
        renderedOrders.has(config.order_id) ||
        !window.gapi?.load
      ) {
        return;
      }

      moduleLoading = true;
      window.gapi.load("surveyoptin", () => {
        if (cancelled || renderedOrders.has(config.order_id)) return;

        const surveyOptIn = window.gapi?.surveyoptin;
        if (!surveyOptIn?.render) {
          moduleLoading = false;
          return;
        }

        surveyOptIn.render(config);
        renderedOrders.add(config.order_id);
      });
    };

    window.renderOptIn = renderOptIn;

    if (window.gapi?.load) {
      renderOptIn();
    } else if (platformScript) {
      platformScript.addEventListener("load", renderOptIn, { once: true });
      loadListenerAttached = true;
    } else {
      platformScript = document.createElement("script");
      platformScript.id = GOOGLE_PLATFORM_SCRIPT_ID;
      platformScript.src = GOOGLE_PLATFORM_SCRIPT_URL;
      platformScript.async = true;
      platformScript.defer = true;
      platformScript.addEventListener("load", renderOptIn, { once: true });
      loadListenerAttached = true;
      document.body.appendChild(platformScript);
    }

    return () => {
      cancelled = true;
      if (loadListenerAttached && platformScript) {
        platformScript.removeEventListener("load", renderOptIn);
      }
    };
  }, [config]);

  return null;
}
