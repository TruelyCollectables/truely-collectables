"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  PLATFORM_DOMAIN,
  SELLER_TERMS_OF_SERVICE_VERSION,
} from "../../lib/legal";
import {
  clearAccountSession,
  getAccountSession,
  type StoredAccountSession,
} from "./account-session";

type AccountOrder = {
  id: string;
  created_at: string | null;
  total: number | null;
  status: string | null;
  fulfillment_status: string | null;
  shipping_name: string | null;
  tracking_number: string | null;
  carrier: string | null;
  item_count: number | null;
};

type SportsFavorite = {
  id: string;
  sport_key: string;
  league_key: string;
  team_name: string;
  team_abbreviation: string | null;
  include_news: boolean;
  include_scores: boolean;
  include_schedule: boolean;
  include_odds: boolean;
};

type MarketWatchlistItem = {
  id: string;
  asset_type: string;
  symbol: string;
  display_name: string | null;
  exchange_key: string | null;
  include_price: boolean;
  include_news: boolean;
  include_alerts: boolean;
};

type CollectionItem = {
  id: string;
  title: string;
  category: string | null;
  item_type: string | null;
  image_url: string | null;
  acquisition_source: string | null;
  acquisition_price: number | null;
  estimated_value: number | null;
  grade_company: string | null;
  grade_value: string | null;
  certification_number: string | null;
  condition: string | null;
  ownership_status: string;
  visibility: string;
  is_favorite: boolean;
  notes: string | null;
  created_at: string;
};

type WishListItem = {
  id: string;
  wish_type: string;
  title: string;
  category: string | null;
  item_type: string | null;
  player_name: string | null;
  team_name: string | null;
  brand: string | null;
  set_name: string | null;
  release_year: string | null;
  card_number: string | null;
  variant: string | null;
  desired_condition: string | null;
  desired_grade: string | null;
  budget_min: number | null;
  budget_max: number | null;
  priority: string;
  status: string;
  visibility: string;
  expires_at: string | null;
  auto_renew: boolean;
  notes: string | null;
  created_at: string;
};

type CollectorProfile = {
  id: string;
  collector_handle: string | null;
  bio: string | null;
  collecting_focus: string | null;
  location_label: string | null;
  website_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  x_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  whatnot_url: string | null;
  ebay_url: string | null;
  visibility: string;
  allow_messages: boolean;
};

type CollectorSocialProfile = {
  account_id: string;
  collector_handle: string | null;
  bio: string | null;
  collecting_focus: string | null;
  location_label: string | null;
  visibility: string;
  relationship?: string | null;
};

type CollectorSocialConnection = {
  id: string;
  otherAccountId: string;
  type: "follow" | "friend";
  status: string;
  direction: "incoming" | "outgoing";
  profile: CollectorSocialProfile | null;
};

type BragPost = {
  id: string;
  account_id: string;
  order_id: number | null;
  title: string;
  body: string | null;
  share_url: string | null;
  visibility: string;
  reaction_count: number;
  comment_count: number;
  click_count: number;
  created_at: string;
  authorLabel: string;
};

type CollectionImportSummary = {
  rows: number;
  imported: number;
  skipped: number;
  errors: number;
};

type SellerPayout = {
  provider: string;
  onboardingStatus: string;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  sellerTosAccepted: boolean;
  disabledReason?: string | null;
  requirementsCurrentlyDue?: string[];
  requirementsPastDue?: string[];
  updatedAt: string | null;
};

type SellerProtectionSummary = {
  program: string;
  reserveRate: number;
  maxCoverage: number;
  protectedRowCount: number;
  unprotectedRowCount: number;
  protectedItemAmount: number;
  reimbursableItemAmount: number;
  shippingExcludedAmount: number;
  reserveAmount: number;
  reimbursesShipping: false;
  status: "protected" | "unprotected" | "mixed" | "not_applicable";
  label: string;
  detail: string;
  sellerResponsibility: string;
};

type SellerPayoutBalance = {
  heldAmount: number;
  pendingFulfillmentAmount: number;
  pendingFulfillmentCount: number;
  disputeHoldAmount: number;
  disputeHoldCount: number;
  cancelledOrReversedAmount: number;
  cancelledOrReversedCount: number;
  eligibleAmount: number;
  eligibleCount: number;
  openRequestAmount: number;
  openRequestCount: number;
  availableToRequestAmount: number;
  paidAmount: number;
  requestCount: number;
  blockedRequestCount: number;
  reviewGuardUnavailable?: boolean;
  sellerProtection?: SellerProtectionSummary;
};

type SellerPayoutRequest = {
  id: string;
  requestedAmount: number;
  estimatedProcessorFeeRate: number;
  estimatedProcessorFeeAmount: number;
  estimatedNetAmount: number;
  finalProcessorFeeAmount: number;
  finalNetAmount: number;
  providerPayoutReference: string | null;
  providerPayoutStatus: string | null;
  status: string;
  requestNote: string | null;
  adminNote: string | null;
  requestedAt: string | null;
  createdAt: string | null;
  reviewBlocked?: boolean;
  reviewBlockReason?: string | null;
  affectedOrderIds?: number[];
  activeCaseCount?: number;
  blockedLedgerRowCount?: number;
  sellerProtection?: SellerProtectionSummary;
};

type SellerMarketplaceStageFilter =
  | "all"
  | "needs_review"
  | "staged"
  | "mapped"
  | "skipped"
  | "blocked"
  | "ready";

type SellerMarketplaceImportSummary = {
  total: number;
  ready: number;
  staged: number;
  needs_review: number;
  mapped: number;
  skipped: number;
  blocked: number;
  promoted: number;
};

type SellerMarketplaceImportJob = {
  id: string;
  status: string;
  row_count: number;
  staged_count: number;
  skipped_count: number;
  error_count: number;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  current_summary?: SellerMarketplaceImportSummary | null;
};

type SellerHoldContextSummary = {
  orderId: number;
  requestIds: string[];
  requestCount: number;
  activeCaseCount: number;
  blockedLedgerRowCount: number;
};

function sellerOrdersQueueHref(
  queue: "all" | "action_required" | "shipping" | "cash_out" | "completed",
  search?: string,
) {
  const params = new URLSearchParams();

  if (queue !== "all") {
    params.set("queue", queue);
  }

  if (search?.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString();
  return query ? `/seller/orders?${query}` : "/seller/orders";
}

function sellerPayoutOrderDetailHref(
  orderId: number,
  requestFilter: "blocked" | "open" | "paid" | "attention" = "blocked",
  requestSearch?: string,
) {
  const params = new URLSearchParams();
  params.set("return", "payouts");
  params.set("request", requestFilter);

  if (requestSearch?.trim()) {
    params.set("requestSearch", requestSearch.trim());
  }

  return `/seller/orders/${orderId}?${params.toString()}`;
}

function sellerPayoutWorkspaceLink(
  balance: SellerPayoutBalance | null,
  sellerPayout: SellerPayout | null,
) {
  if ((balance?.blockedRequestCount || 0) > 0) {
    return {
      href: "/seller/payouts?request=blocked",
      label: "Open Blocked Payouts",
    };
  }

  if ((balance?.openRequestCount || 0) > 0) {
    return {
      href: "/seller/payouts?request=open",
      label: "Open Cash-Out Payouts",
    };
  }

  if (
    !sellerPayout ||
    sellerPayout.onboardingStatus !== "active" ||
    !sellerPayout.detailsSubmitted ||
    !sellerPayout.payoutsEnabled
  ) {
    return {
      href: "/seller/payouts",
      label: "Seller Payout Setup",
    };
  }

  return {
    href: "/seller/payouts",
    label: "Open Seller Payouts",
  };
}

function sellerMarketplaceHref(stage: SellerMarketplaceStageFilter = "all") {
  if (stage === "all") {
    return "/seller/marketplaces";
  }

  return `/seller/marketplaces?stage=${stage}`;
}

function sellerMarketplaceWorkspaceLink(
  latestImportJob: SellerMarketplaceImportJob | null,
) {
  const summary = latestImportJob?.current_summary;

  if ((summary?.blocked || 0) > 0) {
    return {
      href: sellerMarketplaceHref("blocked"),
      label: "Blocked Marketplace Rows",
    };
  }

  if ((summary?.needs_review || 0) > 0) {
    return {
      href: sellerMarketplaceHref("needs_review"),
      label: "Needs Review",
    };
  }

  if ((summary?.ready || 0) > 0) {
    return {
      href: sellerMarketplaceHref("ready"),
      label: "Ready Marketplace Rows",
    };
  }

  if ((summary?.mapped || 0) > 0) {
    return {
      href: sellerMarketplaceHref("mapped"),
      label: "Mapped Marketplace Rows",
    };
  }

  return {
    href: sellerMarketplaceHref(),
    label: "Marketplace Rows",
  };
}

function sellerPayoutRequestWorkspaceLink(request: SellerPayoutRequest) {
  if (
    request.reviewBlocked ||
    (request.activeCaseCount || 0) > 0 ||
    (request.blockedLedgerRowCount || 0) > 0
  ) {
    return {
      href: `/seller/payouts?request=blocked&search=${encodeURIComponent(request.id)}`,
      label: "Open Blocked Payouts",
    };
  }

  if (["requested", "approved", "processing"].includes(request.status)) {
    return {
      href: `/seller/payouts?request=open&search=${encodeURIComponent(request.id)}`,
      label: "Open Cash-Out Payouts",
    };
  }

  if (request.status === "paid") {
    return {
      href: `/seller/payouts?request=paid&search=${encodeURIComponent(request.id)}`,
      label: "Open Paid Payouts",
    };
  }

  return {
    href: `/seller/payouts?search=${encodeURIComponent(request.id)}`,
    label: "Open Seller Payouts",
  };
}

function sellerPayoutRequestOrdersLink(request: SellerPayoutRequest) {
  if (
    request.reviewBlocked ||
    (request.activeCaseCount || 0) > 0 ||
    (request.blockedLedgerRowCount || 0) > 0
  ) {
    return {
      href: sellerOrdersQueueHref("action_required", request.id),
      label: "Open Action Orders",
    };
  }

  if (["requested", "approved", "processing"].includes(request.status)) {
    return {
      href: sellerOrdersQueueHref("cash_out", request.id),
      label: "Open Cash-Out Orders",
    };
  }

  if (request.status === "paid") {
    return {
      href: sellerOrdersQueueHref("completed", request.id),
      label: "Open Completed Orders",
    };
  }

  return {
    href: sellerOrdersQueueHref("all", request.id),
    label: "Open Seller Orders",
  };
}

function sellerHoldContextOrdersLink(summaries: SellerHoldContextSummary[]) {
  if (summaries.length === 1) {
    return {
      href: sellerOrdersQueueHref(
        "action_required",
        `order ${summaries[0].orderId}`,
      ),
      label: "Open Action Orders",
    };
  }

  return {
    href: sellerOrdersQueueHref("action_required"),
    label: "Open Action Orders",
  };
}

export default function AccountPage() {
  const [session, setSession] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [ordersError, setOrdersError] = useState("");
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [sportsFavorites, setSportsFavorites] = useState<SportsFavorite[]>([]);
  const [marketWatchlist, setMarketWatchlist] = useState<MarketWatchlistItem[]>(
    [],
  );
  const [dashboardError, setDashboardError] = useState("");
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [sellerPayout, setSellerPayout] = useState<SellerPayout | null>(null);
  const [sellerPayoutError, setSellerPayoutError] = useState("");
  const [isLoadingSellerPayout, setIsLoadingSellerPayout] = useState(false);
  const [isStartingSellerPayout, setIsStartingSellerPayout] = useState(false);
  const [sellerTosAccepted, setSellerTosAccepted] = useState(false);
  const [sellerPayoutBalance, setSellerPayoutBalance] =
    useState<SellerPayoutBalance | null>(null);
  const [sellerPayoutRequests, setSellerPayoutRequests] = useState<
    SellerPayoutRequest[]
  >([]);
  const [sellerMarketplaceLatestImportJob, setSellerMarketplaceLatestImportJob] =
    useState<SellerMarketplaceImportJob | null>(null);
  const [cashOutAmount, setCashOutAmount] = useState("");
  const [cashOutNote, setCashOutNote] = useState("");
  const [isRequestingCashOut, setIsRequestingCashOut] = useState(false);
  const [collectionItems, setCollectionItems] = useState<CollectionItem[]>([]);
  const [wishListItems, setWishListItems] = useState<WishListItem[]>([]);
  const [collectorProfile, setCollectorProfile] =
    useState<CollectorProfile | null>(null);
  const [collectorError, setCollectorError] = useState("");
  const [isLoadingCollector, setIsLoadingCollector] = useState(false);
  const [isSavingCollector, setIsSavingCollector] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isExportingCollection, setIsExportingCollection] = useState(false);
  const [isImportingCollection, setIsImportingCollection] = useState(false);
  const [collectionImportSource, setCollectionImportSource] = useState("csv_upload");
  const [collectionImportFile, setCollectionImportFile] = useState<File | null>(
    null,
  );
  const [collectionImportSummary, setCollectionImportSummary] =
    useState<CollectionImportSummary | null>(null);
  const [collectionImportDetails, setCollectionImportDetails] = useState<
    string[]
  >([]);
  const [collectors, setCollectors] = useState<CollectorSocialProfile[]>([]);
  const [following, setFollowing] = useState<CollectorSocialConnection[]>([]);
  const [friends, setFriends] = useState<CollectorSocialConnection[]>([]);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<
    CollectorSocialConnection[]
  >([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<
    CollectorSocialConnection[]
  >([]);
  const [bragFeed, setBragFeed] = useState<BragPost[]>([]);
  const [socialError, setSocialError] = useState("");
  const [isLoadingSocial, setIsLoadingSocial] = useState(false);
  const [isSavingSocial, setIsSavingSocial] = useState(false);
  const [bragOrderId, setBragOrderId] = useState("");
  const [bragTitle, setBragTitle] = useState("");
  const [bragBody, setBragBody] = useState("");
  const [bragVisibility, setBragVisibility] = useState("friends");
  const [teamName, setTeamName] = useState("");
  const [sportKey, setSportKey] = useState("football");
  const [leagueKey, setLeagueKey] = useState("nfl");
  const [teamAbbreviation, setTeamAbbreviation] = useState("");
  const [includeOdds, setIncludeOdds] = useState(false);
  const [assetType, setAssetType] = useState("stock");
  const [symbol, setSymbol] = useState("");
  const [assetName, setAssetName] = useState("");
  const [exchangeKey, setExchangeKey] = useState("");
  const [isSavingPreference, setIsSavingPreference] = useState(false);
  const [collectionTitle, setCollectionTitle] = useState("");
  const [collectionCategory, setCollectionCategory] = useState("cards");
  const [collectionCondition, setCollectionCondition] = useState("");
  const [collectionGradeCompany, setCollectionGradeCompany] = useState("");
  const [collectionGradeValue, setCollectionGradeValue] = useState("");
  const [collectionEstimatedValue, setCollectionEstimatedValue] = useState("");
  const [collectionNotes, setCollectionNotes] = useState("");
  const [wishTitle, setWishTitle] = useState("");
  const [wishType, setWishType] = useState("wish_list");
  const [wishCategory, setWishCategory] = useState("cards");
  const [wishPlayerName, setWishPlayerName] = useState("");
  const [wishTeamName, setWishTeamName] = useState("");
  const [wishBrand, setWishBrand] = useState("");
  const [wishSetName, setWishSetName] = useState("");
  const [wishBudgetMax, setWishBudgetMax] = useState("");
  const [wishPriority, setWishPriority] = useState("normal");
  const [collectorHandle, setCollectorHandle] = useState("");
  const [collectorBio, setCollectorBio] = useState("");
  const [collectingFocus, setCollectingFocus] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [whatnotUrl, setWhatnotUrl] = useState("");
  const [ebayUrl, setEbayUrl] = useState("");
  const [profileVisibility, setProfileVisibility] = useState("private");
  const [allowMessages, setAllowMessages] = useState(true);
  const accessToken = session?.access_token || "";
  const sellerHoldContextSummaries = useMemo(() => {
    const byOrderId = new Map<number, SellerHoldContextSummary>();

    for (const request of sellerPayoutRequests) {
      if (!request.reviewBlocked || !request.affectedOrderIds?.length) continue;

      for (const orderId of request.affectedOrderIds) {
        const existing = byOrderId.get(orderId) || {
          orderId,
          requestIds: [],
          requestCount: 0,
          activeCaseCount: 0,
          blockedLedgerRowCount: 0,
        };

        existing.requestCount += 1;
        existing.requestIds.push(request.id);
        existing.activeCaseCount += request.activeCaseCount || 0;
        existing.blockedLedgerRowCount += request.blockedLedgerRowCount || 0;
        byOrderId.set(orderId, existing);
      }
    }

    return Array.from(byOrderId.values()).sort((a, b) => a.orderId - b.orderId);
  }, [sellerPayoutRequests]);
  const sellerPayoutWorkspace = sellerPayoutWorkspaceLink(
    sellerPayoutBalance,
    sellerPayout,
  );
  const sellerMarketplaceWorkspace = sellerMarketplaceWorkspaceLink(
    sellerMarketplaceLatestImportJob,
  );
  const sellerHoldOrdersLink = sellerHoldContextOrdersLink(
    sellerHoldContextSummaries,
  );

  useEffect(() => {
    if (!accessToken) return;

    let isCancelled = false;

    async function loadOrders() {
      setIsLoadingOrders(true);
      setOrdersError("");

      try {
        const response = await fetch("/api/account/orders", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load orders");
        }

        if (!isCancelled) {
          setOrders(Array.isArray(data.orders) ? data.orders : []);
        }
      } catch (error: any) {
        if (!isCancelled) {
          setOrdersError(error.message || "Could not load orders");
          setOrders([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingOrders(false);
        }
      }
    }

    loadOrders();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    let isCancelled = false;

    async function loadSellerPayoutRequests() {
      try {
        const response = await fetch("/api/account/seller/payout-requests", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load seller balance");
        }

        if (!isCancelled) {
          setSellerPayoutBalance(data.balance || null);
          setSellerPayoutRequests(
            Array.isArray(data.requests) ? data.requests : [],
          );
        }
      } catch (error: any) {
        if (!isCancelled) {
          setSellerPayoutError(error.message || "Could not load seller balance");
          setSellerPayoutBalance(null);
          setSellerPayoutRequests([]);
        }
      }
    }

    loadSellerPayoutRequests();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    let isCancelled = false;

    async function loadSellerPayout() {
      setIsLoadingSellerPayout(true);
      setSellerPayoutError("");

      try {
        const response = await fetch("/api/account/seller/payout-onboarding", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load seller payout status");
        }

        if (!isCancelled) {
          setSellerPayout(data.sellerPayout || null);
          setSellerTosAccepted(data.sellerPayout?.sellerTosAccepted === true);
        }
      } catch (error: any) {
        if (!isCancelled) {
          setSellerPayoutError(
            error.message || "Could not load seller payout status",
          );
          setSellerPayout(null);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSellerPayout(false);
        }
      }
    }

    loadSellerPayout();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    let isCancelled = false;

    async function loadSellerMarketplaceWorkspace() {
      try {
        const response = await fetch(
          "/api/account/seller/marketplace-connections/ebay/staged-items?limit=1&importJobLimit=1",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "Could not load seller marketplace workspace",
          );
        }

        if (!isCancelled) {
          setSellerMarketplaceLatestImportJob(data.latestImportJob || null);
        }
      } catch {
        if (!isCancelled) {
          setSellerMarketplaceLatestImportJob(null);
        }
      }
    }

    loadSellerMarketplaceWorkspace();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    let isCancelled = false;

    async function loadDashboardPreferences() {
      setIsLoadingDashboard(true);
      setDashboardError("");

      try {
        const response = await fetch("/api/account/dashboard/preferences", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load dashboard preferences");
        }

        if (!isCancelled) {
          setSportsFavorites(
            Array.isArray(data.sportsFavorites) ? data.sportsFavorites : [],
          );
          setMarketWatchlist(
            Array.isArray(data.marketWatchlist) ? data.marketWatchlist : [],
          );
        }
      } catch (error: any) {
        if (!isCancelled) {
          setDashboardError(
            error.message || "Could not load dashboard preferences",
          );
          setSportsFavorites([]);
          setMarketWatchlist([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingDashboard(false);
        }
      }
    }

    loadDashboardPreferences();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    let isCancelled = false;

    async function loadCollectorItems() {
      setIsLoadingCollector(true);
      setCollectorError("");

      try {
        const response = await fetch("/api/account/collector/items", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load collector dashboard");
        }

        if (!isCancelled) {
          setCollectionItems(
            Array.isArray(data.collectionItems) ? data.collectionItems : [],
          );
          setWishListItems(
            Array.isArray(data.wishListItems) ? data.wishListItems : [],
          );
        }
      } catch (error: any) {
        if (!isCancelled) {
          setCollectorError(error.message || "Could not load collector dashboard");
          setCollectionItems([]);
          setWishListItems([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingCollector(false);
        }
      }
    }

    loadCollectorItems();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    let isCancelled = false;

    async function loadCollectorProfile() {
      try {
        const response = await fetch("/api/account/collector/profile", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load collector profile");
        }

        if (!isCancelled && data.profile) {
          const profile = data.profile as CollectorProfile;
          setCollectorProfile(profile);
          setCollectorHandle(profile.collector_handle || "");
          setCollectorBio(profile.bio || "");
          setCollectingFocus(profile.collecting_focus || "");
          setLocationLabel(profile.location_label || "");
          setWebsiteUrl(profile.website_url || "");
          setInstagramUrl(profile.instagram_url || "");
          setFacebookUrl(profile.facebook_url || "");
          setXUrl(profile.x_url || "");
          setTiktokUrl(profile.tiktok_url || "");
          setYoutubeUrl(profile.youtube_url || "");
          setWhatnotUrl(profile.whatnot_url || "");
          setEbayUrl(profile.ebay_url || "");
          setProfileVisibility(profile.visibility || "private");
          setAllowMessages(profile.allow_messages !== false);
        }
      } catch (error: any) {
        if (!isCancelled) {
          setCollectorError(error.message || "Could not load collector profile");
        }
      }
    }

    loadCollectorProfile();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;

    let isCancelled = false;

    async function loadSocial() {
      setIsLoadingSocial(true);
      setSocialError("");

      try {
        const response = await fetch("/api/account/collector/social", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load collector social");
        }

        if (!isCancelled) {
          setCollectors(Array.isArray(data.collectors) ? data.collectors : []);
          setFollowing(Array.isArray(data.following) ? data.following : []);
          setFriends(Array.isArray(data.friends) ? data.friends : []);
          setIncomingFriendRequests(
            Array.isArray(data.incomingFriendRequests)
              ? data.incomingFriendRequests
              : [],
          );
          setOutgoingFriendRequests(
            Array.isArray(data.outgoingFriendRequests)
              ? data.outgoingFriendRequests
              : [],
          );
          setBragFeed(Array.isArray(data.feed) ? data.feed : []);
        }
      } catch (error: any) {
        if (!isCancelled) {
          setSocialError(error.message || "Could not load collector social");
          setCollectors([]);
          setFollowing([]);
          setFriends([]);
          setIncomingFriendRequests([]);
          setOutgoingFriendRequests([]);
          setBragFeed([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSocial(false);
        }
      }
    }

    loadSocial();

    return () => {
      isCancelled = true;
    };
  }, [accessToken]);

  function logout() {
    clearAccountSession();
    setSession(null);
    setOrders([]);
    setOrdersError("");
    setSportsFavorites([]);
    setMarketWatchlist([]);
    setDashboardError("");
    setSellerPayout(null);
    setSellerPayoutError("");
    setSellerTosAccepted(false);
    setSellerPayoutBalance(null);
    setSellerPayoutRequests([]);
    setCashOutAmount("");
    setCashOutNote("");
    setCollectionItems([]);
    setWishListItems([]);
    setCollectorProfile(null);
    setCollectorError("");
    setCollectors([]);
    setFollowing([]);
    setFriends([]);
    setIncomingFriendRequests([]);
    setOutgoingFriendRequests([]);
    setBragFeed([]);
    setSocialError("");
  }

  async function refreshSocial() {
    if (!accessToken) return;

    setIsLoadingSocial(true);
    setSocialError("");

    try {
      const response = await fetch("/api/account/collector/social", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load collector social");
      }

      setCollectors(Array.isArray(data.collectors) ? data.collectors : []);
      setFollowing(Array.isArray(data.following) ? data.following : []);
      setFriends(Array.isArray(data.friends) ? data.friends : []);
      setIncomingFriendRequests(
        Array.isArray(data.incomingFriendRequests)
          ? data.incomingFriendRequests
          : [],
      );
      setOutgoingFriendRequests(
        Array.isArray(data.outgoingFriendRequests)
          ? data.outgoingFriendRequests
          : [],
      );
      setBragFeed(Array.isArray(data.feed) ? data.feed : []);
    } catch (error: any) {
      setSocialError(error.message || "Could not load collector social");
    } finally {
      setIsLoadingSocial(false);
    }
  }

  async function saveSocialAction(payload: Record<string, unknown>) {
    if (!accessToken) return;

    setIsSavingSocial(true);
    setSocialError("");

    try {
      const response = await fetch("/api/account/collector/social", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not update collector social");
      }

      await refreshSocial();
    } catch (error: any) {
      setSocialError(error.message || "Could not update collector social");
    } finally {
      setIsSavingSocial(false);
    }
  }

  async function removeSocialConnection(
    targetAccountId: string,
    connectionType: "follow" | "friend",
  ) {
    if (!accessToken) return;

    setIsSavingSocial(true);
    setSocialError("");

    try {
      const response = await fetch("/api/account/collector/social", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ targetAccountId, connectionType }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not remove collector connection");
      }

      await refreshSocial();
    } catch (error: any) {
      setSocialError(error.message || "Could not remove collector connection");
    } finally {
      setIsSavingSocial(false);
    }
  }

  async function saveDashboardPreference(payload: Record<string, unknown>) {
    if (!accessToken) return;

    setIsSavingPreference(true);
    setDashboardError("");

    try {
      const response = await fetch("/api/account/dashboard/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not save preference");
      }

      if (payload.kind === "sports_favorite" && data.sportsFavorite) {
        setSportsFavorites((current) => [
          data.sportsFavorite as SportsFavorite,
          ...current,
        ]);
        setTeamName("");
        setTeamAbbreviation("");
        setIncludeOdds(false);
      }

      if (payload.kind === "market_watchlist" && data.marketWatchlistItem) {
        setMarketWatchlist((current) => [
          data.marketWatchlistItem as MarketWatchlistItem,
          ...current,
        ]);
        setSymbol("");
        setAssetName("");
        setExchangeKey("");
      }
    } catch (error: any) {
      setDashboardError(error.message || "Could not save preference");
    } finally {
      setIsSavingPreference(false);
    }
  }

  async function removeDashboardPreference(kind: string, id: string) {
    if (!accessToken) return;

    setDashboardError("");

    try {
      const response = await fetch("/api/account/dashboard/preferences", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ kind, id }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not remove preference");
      }

      if (kind === "sports_favorite") {
        setSportsFavorites((current) => current.filter((item) => item.id !== id));
      }

      if (kind === "market_watchlist") {
        setMarketWatchlist((current) => current.filter((item) => item.id !== id));
      }
    } catch (error: any) {
      setDashboardError(error.message || "Could not remove preference");
    }
  }

  async function startSellerPayoutOnboarding() {
    if (!accessToken) return;

    setIsStartingSellerPayout(true);
    setSellerPayoutError("");

    try {
      const response = await fetch("/api/account/seller/payout-onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          sellerTosAccepted,
          sellerTosVersion: SELLER_TERMS_OF_SERVICE_VERSION,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not start seller verification");
      }

      if (data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
        return;
      }

      throw new Error("Seller verification link was not returned");
    } catch (error: any) {
      setSellerPayoutError(error.message || "Could not start seller verification");
    } finally {
      setIsStartingSellerPayout(false);
    }
  }

  async function refreshSellerPayoutRequests() {
    if (!accessToken) return;

    const response = await fetch("/api/account/seller/payout-requests", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not refresh seller balance");
    }

    setSellerPayoutBalance(data.balance || null);
    setSellerPayoutRequests(Array.isArray(data.requests) ? data.requests : []);
  }

  async function requestSellerCashOut() {
    if (!accessToken) return;

    setIsRequestingCashOut(true);
    setSellerPayoutError("");

    try {
      const response = await fetch("/api/account/seller/payout-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          amount: cashOutAmount,
          note: cashOutNote,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not request cash-out");
      }

      setCashOutAmount("");
      setCashOutNote("");
      await refreshSellerPayoutRequests();
    } catch (error: any) {
      setSellerPayoutError(error.message || "Could not request cash-out");
    } finally {
      setIsRequestingCashOut(false);
    }
  }

  async function saveCollectorItem(payload: Record<string, unknown>) {
    if (!accessToken) return;

    setIsSavingCollector(true);
    setCollectorError("");

    try {
      const response = await fetch("/api/account/collector/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not save collector item");
      }

      if (payload.kind === "collection_item" && data.collectionItem) {
        setCollectionItems((current) => [
          data.collectionItem as CollectionItem,
          ...current,
        ]);
        setCollectionTitle("");
        setCollectionCondition("");
        setCollectionGradeCompany("");
        setCollectionGradeValue("");
        setCollectionEstimatedValue("");
        setCollectionNotes("");
      }

      if (payload.kind === "wish_list_item" && data.wishListItem) {
        setWishListItems((current) => [
          data.wishListItem as WishListItem,
          ...current,
        ]);
        setWishTitle("");
        setWishPlayerName("");
        setWishTeamName("");
        setWishBrand("");
        setWishSetName("");
        setWishBudgetMax("");
      }
    } catch (error: any) {
      setCollectorError(error.message || "Could not save collector item");
    } finally {
      setIsSavingCollector(false);
    }
  }

  async function removeCollectorItem(kind: string, id: string) {
    if (!accessToken) return;

    setCollectorError("");

    try {
      const response = await fetch("/api/account/collector/items", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ kind, id }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not remove collector item");
      }

      if (kind === "collection_item") {
        setCollectionItems((current) => current.filter((item) => item.id !== id));
      }

      if (kind === "wish_list_item") {
        setWishListItems((current) => current.filter((item) => item.id !== id));
      }
    } catch (error: any) {
      setCollectorError(error.message || "Could not remove collector item");
    }
  }

  async function saveCollectorProfile() {
    if (!accessToken) return;

    setIsSavingProfile(true);
    setCollectorError("");

    try {
      const response = await fetch("/api/account/collector/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          collectorHandle,
          bio: collectorBio,
          collectingFocus,
          locationLabel,
          websiteUrl,
          instagramUrl,
          facebookUrl,
          xUrl,
          tiktokUrl,
          youtubeUrl,
          whatnotUrl,
          ebayUrl,
          visibility: profileVisibility,
          allowMessages,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not save collector profile");
      }

      setCollectorProfile(data.profile as CollectorProfile);
    } catch (error: any) {
      setCollectorError(error.message || "Could not save collector profile");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function downloadCollectionExport(format: "csv" | "catalog_json") {
    if (!accessToken) return;

    setIsExportingCollection(true);
    setCollectorError("");

    try {
      const response = await fetch(
        `/api/account/collector/exports?format=${format}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not export collection");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const fileName =
        match?.[1] ||
        (format === "catalog_json"
          ? "tcos-collection-catalog.json"
          : "tcos-collection.csv");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      setCollectorError(error.message || "Could not export collection");
    } finally {
      setIsExportingCollection(false);
    }
  }

  async function importCollectionCsv() {
    if (!accessToken || !collectionImportFile) return;

    setIsImportingCollection(true);
    setCollectorError("");
    setCollectionImportSummary(null);
    setCollectionImportDetails([]);

    try {
      const csvText = await collectionImportFile.text();
      const response = await fetch("/api/account/collector/imports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          csvText,
          sourceMarketplace: collectionImportSource,
          fileName: collectionImportFile.name,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not import collection CSV");
      }

      const importedItems = Array.isArray(data.importedItems)
        ? (data.importedItems as CollectionItem[])
        : [];

      setCollectionItems((current) => [...importedItems, ...current]);
      setCollectionImportSummary(data.summary as CollectionImportSummary);
      setCollectionImportDetails([
        ...(Array.isArray(data.skipped) ? data.skipped : []),
        ...(Array.isArray(data.errors) ? data.errors : []),
      ]);
      setCollectionImportFile(null);
    } catch (error: any) {
      setCollectorError(error.message || "Could not import collection CSV");
    } finally {
      setIsImportingCollection(false);
    }
  }

  async function postOrderBrag(order: AccountOrder) {
    if (!accessToken) return;

    setIsSavingSocial(true);
    setSocialError("");

    try {
      const response = await fetch("/api/account/collector/social", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          action: "create_brag",
          orderId: order.id,
          title:
            bragOrderId === order.id
              ? bragTitle
              : `Made it mine from order #${order.id}`,
          body:
            bragOrderId === order.id
              ? bragBody
              : "New pickup just landed in the collection.",
          visibility: bragVisibility,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not post brag");
      }

      setBragOrderId("");
      setBragTitle("");
      setBragBody("");
      setBragVisibility("friends");
      await refreshSocial();
    } catch (error: any) {
      setSocialError(error.message || "Could not post brag");
    } finally {
      setIsSavingSocial(false);
    }
  }

  async function copyShareUrl(shareUrl: string) {
    const trackedUrl = withShareSource(shareUrl, "copy");

    try {
      await navigator.clipboard.writeText(trackedUrl);
    } catch {
      window.prompt("Copy brag link", trackedUrl);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <section className="border-b border-neutral-200 pb-6">
        <p className="text-sm font-bold uppercase text-neutral-500">
          TCOS Account
        </p>
        <h1 className="mt-2 text-4xl font-black">Collector Account</h1>
        <p className="mt-3 max-w-3xl text-neutral-600">
          Customer accounts are the foundation for future collections, The
          Shelf, want ads, trades, brag sessions, and order history.
        </p>
      </section>

      {!session ? (
        <section className="mt-8 rounded-md border border-neutral-200 bg-white p-6">
          <h2 className="text-2xl font-black">Not Logged In</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Create or log into a buyer account. Seller and platform admin
            accounts stay separate.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/account/login"
              className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800"
            >
              Log In
            </Link>
            <Link
              href="/account/signup"
              className="rounded border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50"
            >
              Create Account
            </Link>
          </div>
        </section>
      ) : (
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[0.65fr_0.35fr]">
          <div className="rounded-md border border-neutral-200 bg-white p-6">
            <h2 className="text-2xl font-black">Account Ready</h2>
            <dl className="mt-5 space-y-3 text-sm">
              <Info label="Email" value={session.user?.email || "Signed in"} />
              <Info label="User ID" value={session.user?.id || "Not shown"} />
              <Info
                label="Session"
                value={session.expires_at ? "Active with expiration" : "Active"}
              />
            </dl>

            <button
              type="button"
              onClick={logout}
              className="mt-6 rounded border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50"
            >
              Log Out
            </button>
          </div>

          <aside className="rounded-md border border-neutral-200 bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Seller Verification</h2>
                <p className="mt-1 text-sm leading-6 text-neutral-600">
                  Bank and payout verification is handled by Stripe. TCOS does
                  not store raw bank account or routing numbers.
                </p>
              </div>
              {isLoadingSellerPayout ? (
                <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-600">
                  Loading
                </span>
              ) : null}
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <Info
                label="Status"
                value={sellerPayoutLabel(
                  sellerPayout?.onboardingStatus || "not_started",
                )}
              />
              <Info
                label="Payouts"
                value={sellerPayout?.payoutsEnabled ? "Enabled" : "Not enabled"}
              />
              <Info
                label="Details"
                value={
                  sellerPayout?.detailsSubmitted ? "Submitted" : "Not submitted"
                }
              />
            </dl>

            {sellerPayoutError ? (
              <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                {sellerPayoutError}
              </p>
            ) : null}

            <label className="mt-4 flex items-start gap-3 rounded border border-neutral-200 bg-neutral-50 p-3 text-xs leading-5 text-neutral-700">
              <input
                type="checkbox"
                checked={sellerTosAccepted}
                onChange={(event) => setSellerTosAccepted(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>
                I accept the{" "}
                <Link href="/seller-terms" className="font-bold underline">
                  Seller Terms
                </Link>{" "}
                version {SELLER_TERMS_OF_SERVICE_VERSION}.
              </span>
            </label>

            <button
              type="button"
              onClick={startSellerPayoutOnboarding}
              disabled={isStartingSellerPayout || !sellerTosAccepted}
              className="mt-4 w-full rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:bg-neutral-500"
            >
              {sellerPayout?.onboardingStatus === "active"
                ? "Refresh Stripe Verification"
                : isStartingSellerPayout
                  ? "Opening Stripe..."
                  : "Verify Seller Payouts"}
            </button>

            <Link
              href={sellerMarketplaceWorkspace.href}
              className="mt-3 block rounded border border-neutral-300 px-4 py-2 text-center text-sm font-bold hover:bg-neutral-50"
            >
              {sellerMarketplaceWorkspace.label}
            </Link>
            <Link
              href={sellerPayoutWorkspace.href}
              className="mt-3 block rounded border border-neutral-300 px-4 py-2 text-center text-sm font-bold hover:bg-neutral-50"
            >
              {sellerPayoutWorkspace.label}
            </Link>

            <div
              id="seller-cash-out"
              className="mt-5 rounded border border-neutral-200 bg-neutral-50 p-4"
            >
              <h3 className="font-black">Seller Cash-Out</h3>
              <p className="mt-1 text-xs leading-5 text-neutral-600">
                Only funds marked eligible can be requested. Cash-out provider
                fees are separate from the Dag Danky Holdings LLC platform rake
                and may reduce the final payout.
              </p>

              {sellerPayoutBalance?.reviewGuardUnavailable ? (
                <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                  Dispute review checks are temporarily unavailable. Active case
                  holds may still affect payout processing.
                </p>
              ) : null}

              <dl className="mt-4 space-y-2 text-sm">
                <Info
                  label="Held"
                  value={formatCurrency(sellerPayoutBalance?.heldAmount || 0)}
                />
                <Info
                  label="Eligible"
                  value={formatCurrency(
                    sellerPayoutBalance?.eligibleAmount || 0,
                  )}
                />
                <Info
                  label="Requested"
                  value={formatCurrency(
                    sellerPayoutBalance?.openRequestAmount || 0,
                  )}
                />
                <Info
                  label="Available"
                  value={formatCurrency(
                    sellerPayoutBalance?.availableToRequestAmount || 0,
                  )}
                />
                <Info
                  label="Blocked"
                  value={String(sellerPayoutBalance?.blockedRequestCount || 0)}
                />
              </dl>

              <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded border border-neutral-200 bg-white p-3">
                  <p className="font-black text-neutral-900">
                    Pending Fulfillment
                  </p>
                  <p className="mt-1 text-sm font-bold text-neutral-950">
                    {formatCurrency(
                      sellerPayoutBalance?.pendingFulfillmentAmount || 0,
                    )}
                  </p>
                  <p className="mt-1 text-neutral-500">
                    {sellerPayoutBalance?.pendingFulfillmentCount || 0} row(s)
                    still waiting to ship or clear fulfillment review.
                  </p>
                </div>

                <div className="rounded border border-neutral-200 bg-white p-3">
                  <p className="font-black text-neutral-900">Dispute Hold</p>
                  <p className="mt-1 text-sm font-bold text-neutral-950">
                    {formatCurrency(
                      sellerPayoutBalance?.disputeHoldAmount || 0,
                    )}
                  </p>
                  <p className="mt-1 text-neutral-500">
                    {sellerPayoutBalance?.disputeHoldCount || 0} row(s) tied to
                    active returns, chargebacks, or review cases.
                  </p>
                </div>

                <div className="rounded border border-neutral-200 bg-white p-3">
                  <p className="font-black text-neutral-900">
                    Reserved In Requests
                  </p>
                  <p className="mt-1 text-sm font-bold text-neutral-950">
                    {formatCurrency(sellerPayoutBalance?.openRequestAmount || 0)}
                  </p>
                  <p className="mt-1 text-neutral-500">
                    {sellerPayoutBalance?.openRequestCount || 0} open cash-out
                    request(s) already claiming eligible funds.
                  </p>
                </div>

                <div className="rounded border border-neutral-200 bg-white p-3">
                  <p className="font-black text-neutral-900">
                    Not Payable
                  </p>
                  <p className="mt-1 text-sm font-bold text-neutral-950">
                    {formatCurrency(
                      sellerPayoutBalance?.cancelledOrReversedAmount || 0,
                    )}
                  </p>
                  <p className="mt-1 text-neutral-500">
                    {sellerPayoutBalance?.cancelledOrReversedCount || 0} row(s)
                    cancelled or reversed after review outcome.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded border border-neutral-200 bg-white p-3 text-xs text-neutral-600">
                <p>
                  Cash-out ready now:{" "}
                  <strong className="text-neutral-950">
                    {formatCurrency(
                      sellerPayoutBalance?.availableToRequestAmount || 0,
                    )}
                  </strong>
                </p>
                <p className="mt-1">
                  Eligible rows:{" "}
                  <strong className="text-neutral-950">
                    {sellerPayoutBalance?.eligibleCount || 0}
                  </strong>
                  {" / "}Total requests on file:{" "}
                  <strong className="text-neutral-950">
                    {sellerPayoutBalance?.requestCount || 0}
                  </strong>
                </p>
              </div>

              {sellerPayoutBalance?.sellerProtection ? (
                <SellerProtectionCard
                  summary={sellerPayoutBalance.sellerProtection}
                  title="Under-$20 Protection Reserve"
                  detail="Optional seller coverage withholds 2% from protected Standard Envelope card shipments, caps reimbursement at $20 in item value, and excludes shipping from reimbursement."
                />
              ) : null}

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  requestSellerCashOut();
                }}
                className="mt-4 grid gap-3"
              >
                <label className="text-xs font-bold uppercase text-neutral-600">
                  Amount
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={cashOutAmount}
                    onChange={(event) => setCashOutAmount(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                    placeholder="0.00"
                  />
                </label>
                <label className="text-xs font-bold uppercase text-neutral-600">
                  Note
                  <input
                    value={cashOutNote}
                    onChange={(event) => setCashOutNote(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                    placeholder="Optional payout note"
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    isRequestingCashOut ||
                    Number(cashOutAmount || 0) <= 0 ||
                    Number(cashOutAmount || 0) >
                      Number(
                        sellerPayoutBalance?.availableToRequestAmount || 0,
                      )
                  }
                  className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:bg-neutral-500"
                >
                  {isRequestingCashOut ? "Requesting..." : "Request Cash-Out"}
                </button>
              </form>

              {sellerPayoutRequests.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {sellerPayoutRequests.slice(0, 3).map((request) => {
                    const payoutWorkspaceLink =
                      sellerPayoutRequestWorkspaceLink(request);
                    const ordersWorkspaceLink =
                      sellerPayoutRequestOrdersLink(request);

                    return (
                      <div
                        key={request.id}
                        className="rounded border border-neutral-200 bg-white p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-black">
                            {formatCurrency(request.requestedAmount)}
                          </span>
                          <span className="rounded bg-neutral-100 px-2 py-1 font-bold uppercase text-neutral-600">
                            {sellerPayoutLabel(request.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-neutral-500">
                          Requested {formatDate(request.requestedAt)}
                        </p>
                        {request.status === "paid" ? (
                          <p className="mt-1 text-neutral-600">
                            Net {formatCurrency(request.finalNetAmount)} / Fee{" "}
                            {formatCurrency(request.finalProcessorFeeAmount)}
                          </p>
                        ) : null}
                        {request.sellerProtection ? (
                          <SellerProtectionCard
                            summary={request.sellerProtection}
                            title="Request Protection Snapshot"
                            compact
                          />
                        ) : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link
                            href={payoutWorkspaceLink.href}
                            className="font-semibold underline"
                          >
                            {payoutWorkspaceLink.label}
                          </Link>
                          <Link
                            href={ordersWorkspaceLink.href}
                            className="font-semibold underline"
                          >
                            {ordersWorkspaceLink.label}
                          </Link>
                        </div>
                        {request.reviewBlocked ? (
                          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-950">
                            <p className="font-semibold">
                              {request.reviewBlockReason ||
                                "This request is being held by an active review case."}
                            </p>
                            {request.affectedOrderIds &&
                            request.affectedOrderIds.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                                {request.affectedOrderIds.map((orderId) => (
                                  <Link
                                    key={`${request.id}-${orderId}`}
                                    href={sellerPayoutOrderDetailHref(
                                      orderId,
                                      "blocked",
                                      request.id,
                                    )}
                                    className="font-semibold underline"
                                  >
                                    Order #{orderId}
                                  </Link>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {sellerHoldContextSummaries.length > 0 ? (
                <div className="mt-4 rounded border border-neutral-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="font-black text-neutral-950">
                        Hold Context
                      </h4>
                      <p className="mt-1 text-xs text-neutral-600">
                        These orders are currently tied to blocked seller
                        cash-out requests.
                      </p>
                    </div>
                    <Link
                      href={sellerHoldOrdersLink.href}
                      className="text-xs font-bold text-neutral-600 underline"
                    >
                      {sellerHoldOrdersLink.label}
                    </Link>
                  </div>

                  <div className="mt-3 space-y-2">
                    {sellerHoldContextSummaries.map((summary) => (
                      <div
                        key={summary.orderId}
                        id={holdContextAnchor(summary.orderId)}
                        className="rounded border border-neutral-200 bg-neutral-50 p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-black text-neutral-950">
                              Order #{summary.orderId}
                            </p>
                            <p className="mt-1 text-neutral-600">
                              {summary.requestCount} blocked request(s) /{" "}
                              {summary.activeCaseCount} active case reference(s)
                              / {summary.blockedLedgerRowCount} held ledger
                              reference(s)
                            </p>
                          </div>
                          <span className="rounded bg-amber-100 px-2 py-1 font-bold uppercase text-amber-900">
                            Hold
                          </span>
                        </div>
                        <p className="mt-2 text-neutral-600">
                          Cash-out on this order stays blocked until fulfillment
                          clears, dispute review is resolved, or admin releases
                          the related payout rows.
                        </p>
                        <Link
                          href={sellerPayoutOrderDetailHref(
                            summary.orderId,
                            "blocked",
                            summary.requestIds[0] || "",
                          )}
                          className="mt-3 inline-flex font-semibold underline"
                        >
                          Open Order Detail
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </aside>

          <div className="rounded-md border border-neutral-200 bg-white p-6 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">Collector Bio</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Public-facing collector story, social links, and message
                  settings.
                </p>
              </div>
              {collectorProfile ? (
                <span className="rounded bg-emerald-50 px-3 py-1 text-xs font-bold uppercase text-emerald-700">
                  Saved
                </span>
              ) : null}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveCollectorProfile();
              }}
              className="mt-5 grid grid-cols-1 gap-4"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-sm font-bold text-neutral-700">
                  Handle
                  <input
                    value={collectorHandle}
                    onChange={(event) => setCollectorHandle(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                    placeholder="TruelyCollector"
                  />
                </label>
                <label className="text-sm font-bold text-neutral-700">
                  Location
                  <input
                    value={locationLabel}
                    onChange={(event) => setLocationLabel(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                    placeholder="Colorado"
                  />
                </label>
                <label className="text-sm font-bold text-neutral-700">
                  Visibility
                  <select
                    value={profileVisibility}
                    onChange={(event) => setProfileVisibility(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                  >
                    <option value="private">Private</option>
                    <option value="community">Community</option>
                    <option value="public">Public</option>
                    <option value="admin_review">Admin Review</option>
                  </select>
                </label>
              </div>

              <label className="text-sm font-bold text-neutral-700">
                Bio
                <textarea
                  value={collectorBio}
                  onChange={(event) => setCollectorBio(event.target.value)}
                  className="mt-1 min-h-24 w-full rounded border border-neutral-300 px-3 py-2"
                  placeholder="What you collect, what got you started, and what makes your shelf yours."
                />
              </label>

              <label className="text-sm font-bold text-neutral-700">
                Collecting Focus
                <input
                  value={collectingFocus}
                  onChange={(event) => setCollectingFocus(event.target.value)}
                  className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                  placeholder="Vintage baseball, Denver teams, rare shoes, sealed wax..."
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <label className="text-sm font-bold text-neutral-700">
                  Website
                  <input
                    value={websiteUrl}
                    onChange={(event) => setWebsiteUrl(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                    placeholder="https://"
                  />
                </label>
                <label className="text-sm font-bold text-neutral-700">
                  Instagram
                  <input
                    value={instagramUrl}
                    onChange={(event) => setInstagramUrl(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                    placeholder="@handle or URL"
                  />
                </label>
                <label className="text-sm font-bold text-neutral-700">
                  Facebook
                  <input
                    value={facebookUrl}
                    onChange={(event) => setFacebookUrl(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                    placeholder="Profile URL"
                  />
                </label>
                <label className="text-sm font-bold text-neutral-700">
                  X
                  <input
                    value={xUrl}
                    onChange={(event) => setXUrl(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                    placeholder="@handle or URL"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <label className="text-sm font-bold text-neutral-700">
                  TikTok
                  <input
                    value={tiktokUrl}
                    onChange={(event) => setTiktokUrl(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                    placeholder="@handle or URL"
                  />
                </label>
                <label className="text-sm font-bold text-neutral-700">
                  YouTube
                  <input
                    value={youtubeUrl}
                    onChange={(event) => setYoutubeUrl(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                    placeholder="Channel URL"
                  />
                </label>
                <label className="text-sm font-bold text-neutral-700">
                  Whatnot
                  <input
                    value={whatnotUrl}
                    onChange={(event) => setWhatnotUrl(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                    placeholder="Store URL"
                  />
                </label>
                <label className="text-sm font-bold text-neutral-700">
                  eBay
                  <input
                    value={ebayUrl}
                    onChange={(event) => setEbayUrl(event.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                    placeholder="Seller URL"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
                <input
                  type="checkbox"
                  checked={allowMessages}
                  onChange={(event) => setAllowMessages(event.target.checked)}
                />
                Allow other collectors to message this profile when community
                features are enabled
              </label>

              <button
                type="submit"
                disabled={isSavingProfile}
                className="w-fit rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-500"
              >
                Save Collector Bio
              </button>
            </form>
          </div>

          <div className="rounded-md border border-neutral-200 bg-white p-6 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">Friends And Brag Feed</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Follow collectors, send friend requests, and share pickups
                  from your order history.
                </p>
              </div>
              {isLoadingSocial ? (
                <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-600">
                  Loading
                </span>
              ) : null}
            </div>

            {socialError ? (
              <p className="mt-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {socialError}
              </p>
            ) : null}

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[0.6fr_0.4fr]">
              <section className="rounded border border-neutral-200 bg-neutral-50 p-4">
                <h3 className="text-lg font-black">Brag Feed</h3>
                <div className="mt-4 space-y-3">
                  {bragFeed.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      No brag posts yet. Post one from an order when a pickup
                      deserves the spotlight.
                    </p>
                  ) : (
                    bragFeed.map((post) => (
                      <div
                        key={post.id}
                        className="rounded border border-neutral-200 bg-white p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase text-neutral-500">
                              {post.authorLabel} / {post.visibility}
                            </p>
                            <h4 className="mt-1 break-words text-lg font-black">
                              {post.title}
                            </h4>
                          </div>
                          <span className="rounded bg-neutral-100 px-2 py-1 text-[11px] font-bold uppercase text-neutral-600">
                            {formatDate(post.created_at)}
                          </span>
                        </div>
                        {post.body ? (
                          <p className="mt-3 text-sm leading-6 text-neutral-700">
                            {post.body}
                          </p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold uppercase text-neutral-500">
                          {post.order_id ? <span>Order #{post.order_id}</span> : null}
                          <span>{post.reaction_count} reactions</span>
                          <span>{post.comment_count} comments</span>
                          <span>{post.click_count} visits</span>
                        </div>
                        {post.share_url ? (
                          <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-3 text-xs font-semibold text-neutral-600">
                            <p>
                              <span>Find more at </span>
                              <a
                                href={withShareSource(post.share_url, "feed")}
                                className="font-black text-neutral-950 underline"
                              >
                                {PLATFORM_DOMAIN}
                              </a>
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <a
                                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                                  `${post.title} - ${PLATFORM_DOMAIN}`,
                                )}&url=${encodeURIComponent(
                                  withShareSource(post.share_url, "x"),
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                              >
                                Share X
                              </a>
                              <a
                                href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
                                  withShareSource(post.share_url, "facebook"),
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                              >
                                Facebook
                              </a>
                              <button
                                type="button"
                                onClick={() =>
                                  post.share_url ? copyShareUrl(post.share_url) : null
                                }
                                className="rounded border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                              >
                                Copy Link
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </section>

              <div className="space-y-5">
                <section className="rounded border border-neutral-200 bg-neutral-50 p-4">
                  <h3 className="text-lg font-black">Find Collectors</h3>
                  <div className="mt-4 space-y-2">
                    {collectors.length === 0 ? (
                      <p className="text-sm text-neutral-500">
                        No public collector profiles found yet.
                      </p>
                    ) : (
                      collectors.slice(0, 8).map((collector) => (
                        <SocialCollectorRow
                          key={collector.account_id}
                          profile={collector}
                          relationship={collector.relationship || ""}
                          isSaving={isSavingSocial}
                          onFollow={() =>
                            saveSocialAction({
                              action: "follow",
                              targetAccountId: collector.account_id,
                            })
                          }
                          onFriend={() =>
                            saveSocialAction({
                              action: "friend_request",
                              targetAccountId: collector.account_id,
                            })
                          }
                        />
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded border border-neutral-200 bg-neutral-50 p-4">
                  <h3 className="text-lg font-black">Friends</h3>
                  <div className="mt-4 space-y-2">
                    {incomingFriendRequests.map((connection) => (
                      <SocialConnectionRow
                        key={connection.id}
                        connection={connection}
                        actionLabel="Accept"
                        isSaving={isSavingSocial}
                        onAction={() =>
                          saveSocialAction({
                            action: "accept_friend",
                            connectionId: connection.id,
                          })
                        }
                        onRemove={() =>
                          removeSocialConnection(
                            connection.otherAccountId,
                            "friend",
                          )
                        }
                      />
                    ))}

                    {friends.length === 0 && incomingFriendRequests.length === 0 ? (
                      <p className="text-sm text-neutral-500">
                        No friends connected yet.
                      </p>
                    ) : null}

                    {friends.map((connection) => (
                      <SocialConnectionRow
                        key={connection.id}
                        connection={connection}
                        actionLabel="Message Later"
                        isSaving={isSavingSocial}
                        onAction={undefined}
                        onRemove={() =>
                          removeSocialConnection(
                            connection.otherAccountId,
                            "friend",
                          )
                        }
                      />
                    ))}
                  </div>
                </section>

                <section className="rounded border border-neutral-200 bg-neutral-50 p-4">
                  <h3 className="text-lg font-black">Following</h3>
                  <div className="mt-4 space-y-2">
                    {following.length === 0 ? (
                      <p className="text-sm text-neutral-500">
                        Not following anyone yet.
                      </p>
                    ) : (
                      following.map((connection) => (
                        <SocialConnectionRow
                          key={connection.id}
                          connection={connection}
                          actionLabel="Following"
                          isSaving={isSavingSocial}
                          onAction={undefined}
                          onRemove={() =>
                            removeSocialConnection(
                              connection.otherAccountId,
                              "follow",
                            )
                          }
                        />
                      ))
                    )}
                  </div>

                  {outgoingFriendRequests.length > 0 ? (
                    <div className="mt-5 border-t border-neutral-200 pt-4">
                      <p className="text-xs font-bold uppercase text-neutral-500">
                        Pending Friend Requests
                      </p>
                      <div className="mt-3 space-y-2">
                        {outgoingFriendRequests.map((connection) => (
                          <SocialConnectionRow
                            key={connection.id}
                            connection={connection}
                            actionLabel="Pending"
                            isSaving={isSavingSocial}
                            onAction={undefined}
                            onRemove={() =>
                              removeSocialConnection(
                                connection.otherAccountId,
                                "friend",
                              )
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
              <div>
                <h2 className="text-2xl font-black">Collector Core</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Your owned collection and the items you are hunting.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadCollectionExport("csv")}
                  disabled={isExportingCollection}
                  className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:text-neutral-400"
                >
                  Download CSV
                </button>
                <button
                  type="button"
                  onClick={() => downloadCollectionExport("catalog_json")}
                  disabled={isExportingCollection}
                  className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:text-neutral-400"
                >
                  Download Catalog
                </button>
                {isLoadingCollector ? (
                  <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-600">
                    Loading
                  </span>
                ) : null}
              </div>
            </div>

            {collectorError ? (
              <p className="mb-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {collectorError}
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section className="rounded border border-neutral-200 bg-neutral-50 p-4">
                <h3 className="text-lg font-black">Collection Shelf</h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    importCollectionCsv();
                  }}
                  className="mt-4 rounded border border-neutral-200 bg-white p-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
                    <label className="text-sm font-bold text-neutral-700">
                      Source
                      <select
                        value={collectionImportSource}
                        onChange={(event) =>
                          setCollectionImportSource(event.target.value)
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                      >
                        <option value="csv_upload">CSV Upload</option>
                        <option value="ebay">eBay</option>
                        <option value="comc">COMC</option>
                        <option value="collx">CollX</option>
                        <option value="sportlots">Sportlots</option>
                        <option value="whatnot">Whatnot</option>
                        <option value="shopify">Shopify</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      CSV File
                      <input
                        key={collectionImportFile?.name || "empty-import-file"}
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) =>
                          setCollectionImportFile(event.target.files?.[0] || null)
                        }
                        className="mt-1 w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={isImportingCollection || !collectionImportFile}
                        className="w-full rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-500"
                      >
                        {isImportingCollection ? "Importing" : "Import CSV"}
                      </button>
                    </div>
                  </div>

                  {collectionImportSummary ? (
                    <div className="mt-3 rounded bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-700">
                      Imported {collectionImportSummary.imported} of{" "}
                      {collectionImportSummary.rows} rows. Skipped{" "}
                      {collectionImportSummary.skipped}. Errors{" "}
                      {collectionImportSummary.errors}.
                    </div>
                  ) : null}

                  {collectionImportDetails.length > 0 ? (
                    <div className="mt-2 max-h-28 overflow-auto rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      {collectionImportDetails.slice(0, 8).map((detail) => (
                        <p key={detail}>{detail}</p>
                      ))}
                    </div>
                  ) : null}
                </form>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveCollectorItem({
                      kind: "collection_item",
                      title: collectionTitle,
                      category: collectionCategory,
                      condition: collectionCondition,
                      gradeCompany: collectionGradeCompany,
                      gradeValue: collectionGradeValue,
                      estimatedValue: collectionEstimatedValue,
                      notes: collectionNotes,
                    });
                  }}
                  className="mt-4 grid grid-cols-1 gap-3"
                >
                  <label className="text-sm font-bold text-neutral-700">
                    Item
                    <input
                      value={collectionTitle}
                      onChange={(event) => setCollectionTitle(event.target.value)}
                      className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                      placeholder="2023 Topps Chrome..."
                      required
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-neutral-700">
                      Category
                      <input
                        value={collectionCategory}
                        onChange={(event) =>
                          setCollectionCategory(event.target.value)
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="cards"
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Condition
                      <input
                        value={collectionCondition}
                        onChange={(event) =>
                          setCollectionCondition(event.target.value)
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="raw nm, slabbed, sealed"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="text-sm font-bold text-neutral-700">
                      Grader
                      <input
                        value={collectionGradeCompany}
                        onChange={(event) =>
                          setCollectionGradeCompany(event.target.value)
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="PSA"
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Grade
                      <input
                        value={collectionGradeValue}
                        onChange={(event) =>
                          setCollectionGradeValue(event.target.value)
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="10"
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Value
                      <input
                        type="number"
                        step="0.01"
                        value={collectionEstimatedValue}
                        onChange={(event) =>
                          setCollectionEstimatedValue(event.target.value)
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="125"
                      />
                    </label>
                  </div>
                  <label className="text-sm font-bold text-neutral-700">
                    Notes
                    <input
                      value={collectionNotes}
                      onChange={(event) => setCollectionNotes(event.target.value)}
                      className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                      placeholder="Where you got it, story, defects, plans..."
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isSavingCollector}
                    className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-500"
                  >
                    Add To Collection
                  </button>
                </form>

                <div className="mt-5 space-y-2">
                  {collectionItems.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      No collection items saved.
                    </p>
                  ) : (
                    collectionItems.map((item) => (
                      <WatchlistRow
                        key={item.id}
                        title={item.title}
                        detail={`${item.category || "collectable"}${
                          item.grade_company || item.grade_value
                            ? ` / ${item.grade_company || ""} ${item.grade_value || ""}`
                            : ""
                        }`}
                        badges={[
                          item.condition || "",
                          item.estimated_value
                            ? formatCurrency(item.estimated_value)
                            : "",
                          item.is_favorite ? "Favorite" : "",
                        ]}
                        onRemove={() =>
                          removeCollectorItem("collection_item", item.id)
                        }
                      />
                    ))
                  )}
                </div>
              </section>

              <section className="rounded border border-neutral-200 bg-neutral-50 p-4">
                <h3 className="text-lg font-black">The Shelf And Want Ads</h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveCollectorItem({
                      kind: "wish_list_item",
                      wishType,
                      title: wishTitle,
                      category: wishCategory,
                      playerName: wishPlayerName,
                      teamName: wishTeamName,
                      brand: wishBrand,
                      setName: wishSetName,
                      budgetMax: wishBudgetMax,
                      priority: wishPriority,
                    });
                  }}
                  className="mt-4 grid grid-cols-1 gap-3"
                >
                  <label className="text-sm font-bold text-neutral-700">
                    Target Item
                    <input
                      value={wishTitle}
                      onChange={(event) => setWishTitle(event.target.value)}
                      className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                      placeholder="Shohei Ohtani rookie auto"
                      required
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="text-sm font-bold text-neutral-700">
                      Type
                      <select
                        value={wishType}
                        onChange={(event) => setWishType(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                      >
                        <option value="wish_list">The Shelf</option>
                        <option value="want_ad">Want Ad</option>
                        <option value="set_need">Set Need</option>
                        <option value="trade_target">Trade Target</option>
                      </select>
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Category
                      <input
                        value={wishCategory}
                        onChange={(event) => setWishCategory(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="cards"
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Priority
                      <select
                        value={wishPriority}
                        onChange={(event) => setWishPriority(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="grail">Grail</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-neutral-700">
                      Player / Character
                      <input
                        value={wishPlayerName}
                        onChange={(event) => setWishPlayerName(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="Shohei Ohtani"
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Team / Franchise
                      <input
                        value={wishTeamName}
                        onChange={(event) => setWishTeamName(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="Dodgers"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="text-sm font-bold text-neutral-700">
                      Brand
                      <input
                        value={wishBrand}
                        onChange={(event) => setWishBrand(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="Topps"
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Set
                      <input
                        value={wishSetName}
                        onChange={(event) => setWishSetName(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="Chrome"
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Max Budget
                      <input
                        type="number"
                        step="0.01"
                        value={wishBudgetMax}
                        onChange={(event) => setWishBudgetMax(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="500"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={isSavingCollector}
                    className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-500"
                  >
                    Add Target
                  </button>
                </form>

                <div className="mt-5 space-y-2">
                  {wishListItems.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      Nothing on The Shelf yet.
                    </p>
                  ) : (
                    wishListItems.map((item) => (
                      <WatchlistRow
                        key={item.id}
                        title={item.title}
                        detail={`${shelfItemTypeLabel(item.wish_type)} / ${
                          item.category || "collectable"
                        }`}
                        badges={[
                          item.priority,
                          item.budget_max
                            ? `Up to ${formatCurrency(item.budget_max)}`
                            : "",
                          item.expires_at
                            ? `Expires ${formatDate(item.expires_at)}`
                            : "",
                        ]}
                        onRemove={() =>
                          removeCollectorItem("wish_list_item", item.id)
                        }
                      />
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
              <div>
                <h2 className="text-2xl font-black">Dashboard Watchlist</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Teams, markets, and collector signals saved to this account.
                </p>
              </div>
              {isLoadingDashboard ? (
                <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-600">
                  Loading
                </span>
              ) : null}
            </div>

            {dashboardError ? (
              <p className="mt-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                {dashboardError}
              </p>
            ) : null}

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section className="rounded border border-neutral-200 bg-neutral-50 p-4">
                <h3 className="text-lg font-black">Favorite Teams</h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveDashboardPreference({
                      kind: "sports_favorite",
                      sportKey,
                      leagueKey,
                      teamName,
                      teamAbbreviation,
                      includeOdds,
                    });
                  }}
                  className="mt-4 grid grid-cols-1 gap-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-neutral-700">
                      Sport
                      <input
                        value={sportKey}
                        onChange={(event) => setSportKey(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="football"
                        required
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      League
                      <input
                        value={leagueKey}
                        onChange={(event) => setLeagueKey(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="nfl"
                        required
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px]">
                    <label className="text-sm font-bold text-neutral-700">
                      Team
                      <input
                        value={teamName}
                        onChange={(event) => setTeamName(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="Denver Broncos"
                        required
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Code
                      <input
                        value={teamAbbreviation}
                        onChange={(event) =>
                          setTeamAbbreviation(event.target.value.toUpperCase())
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="DEN"
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
                    <input
                      type="checkbox"
                      checked={includeOdds}
                      onChange={(event) => setIncludeOdds(event.target.checked)}
                    />
                    Include odds when legal/provider data is enabled
                  </label>
                  <button
                    type="submit"
                    disabled={isSavingPreference}
                    className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-500"
                  >
                    Add Team
                  </button>
                </form>

                <div className="mt-5 space-y-2">
                  {sportsFavorites.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      No favorite teams saved.
                    </p>
                  ) : (
                    sportsFavorites.map((favorite) => (
                      <WatchlistRow
                        key={favorite.id}
                        title={favorite.team_name}
                        detail={`${favorite.league_key.toUpperCase()} / ${favorite.sport_key}`}
                        badges={[
                          favorite.include_news ? "News" : "",
                          favorite.include_scores ? "Scores" : "",
                          favorite.include_schedule ? "Schedule" : "",
                          favorite.include_odds ? "Odds" : "",
                        ]}
                        onRemove={() =>
                          removeDashboardPreference(
                            "sports_favorite",
                            favorite.id,
                          )
                        }
                      />
                    ))
                  )}
                </div>
              </section>

              <section className="rounded border border-neutral-200 bg-neutral-50 p-4">
                <h3 className="text-lg font-black">Market Watchlist</h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveDashboardPreference({
                      kind: "market_watchlist",
                      assetType,
                      symbol,
                      displayName: assetName,
                      exchangeKey,
                    });
                  }}
                  className="mt-4 grid grid-cols-1 gap-3"
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-neutral-700">
                      Type
                      <select
                        value={assetType}
                        onChange={(event) => setAssetType(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                      >
                        <option value="stock">Stock</option>
                        <option value="etf">ETF</option>
                        <option value="index">Index</option>
                        <option value="crypto">Crypto</option>
                        <option value="nft">NFT</option>
                        <option value="commodity">Commodity</option>
                        <option value="collectable_index">Collectable Index</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Symbol
                      <input
                        value={symbol}
                        onChange={(event) =>
                          setSymbol(event.target.value.toUpperCase())
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="AAPL, BTC, ETH"
                        required
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-neutral-700">
                      Name
                      <input
                        value={assetName}
                        onChange={(event) => setAssetName(event.target.value)}
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="Apple"
                      />
                    </label>
                    <label className="text-sm font-bold text-neutral-700">
                      Exchange
                      <input
                        value={exchangeKey}
                        onChange={(event) =>
                          setExchangeKey(event.target.value.toUpperCase())
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-3 py-2"
                        placeholder="NASDAQ"
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={isSavingPreference}
                    className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-500"
                  >
                    Add Asset
                  </button>
                </form>

                <div className="mt-5 space-y-2">
                  {marketWatchlist.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      No market assets saved.
                    </p>
                  ) : (
                    marketWatchlist.map((item) => (
                      <WatchlistRow
                        key={item.id}
                        title={item.display_name || item.symbol}
                        detail={`${item.asset_type.toUpperCase()} / ${item.symbol}${
                          item.exchange_key ? ` / ${item.exchange_key}` : ""
                        }`}
                        badges={[
                          item.include_price ? "Price" : "",
                          item.include_news ? "News" : "",
                          item.include_alerts ? "Alerts" : "",
                        ]}
                        onRemove={() =>
                          removeDashboardPreference(
                            "market_watchlist",
                            item.id,
                          )
                        }
                      />
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>

          <div className="rounded-md border border-neutral-200 bg-white p-6 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">Order History</h2>
                <p className="mt-1 text-sm text-neutral-600">
                  Purchases made while logged in will appear here.
                </p>
              </div>
              {isLoadingOrders ? (
                <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-600">
                  Loading
                </span>
              ) : null}
            </div>

            {ordersError ? (
              <p className="mt-5 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {ordersError}
              </p>
            ) : null}

            {!isLoadingOrders && !ordersError && orders.length === 0 ? (
              <div className="mt-5 rounded border border-dashed border-neutral-300 bg-neutral-50 p-5">
                <p className="text-sm font-semibold text-neutral-700">
                  No linked orders yet.
                </p>
                <p className="mt-1 text-sm text-neutral-500">
                  Guest checkout still works, but logged-in checkout links
                  future purchases to this account.
                </p>
              </div>
            ) : null}

            {orders.length > 0 ? (
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                    <tr>
                      <th className="py-3 pr-4">Order</th>
                      <th className="py-3 pr-4">Date</th>
                      <th className="py-3 pr-4">Items</th>
                      <th className="py-3 pr-4">Total</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3 pr-4">Tracking</th>
                      <th className="py-3 pr-4">Brag</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td className="py-3 pr-4 font-bold text-neutral-950">
                          #{order.id}
                        </td>
                        <td className="py-3 pr-4 text-neutral-600">
                          {formatDate(order.created_at)}
                        </td>
                        <td className="py-3 pr-4 text-neutral-600">
                          {order.item_count ?? 0}
                        </td>
                        <td className="py-3 pr-4 font-semibold text-neutral-950">
                          {formatCurrency(order.total)}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="rounded bg-neutral-100 px-2 py-1 text-xs font-bold uppercase text-neutral-700">
                            {order.fulfillment_status || order.status || "new"}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-neutral-600">
                          {order.tracking_number ? (
                            <span>
                              {order.carrier ? `${order.carrier} ` : ""}
                              {order.tracking_number}
                            </span>
                          ) : (
                            <span className="text-neutral-400">Pending</span>
                          )}
                        </td>
                        <td className="min-w-[260px] py-3 pr-4">
                          {bragOrderId === order.id ? (
                            <form
                              onSubmit={(event) => {
                                event.preventDefault();
                                postOrderBrag(order);
                              }}
                              className="grid gap-2"
                            >
                              <input
                                value={bragTitle}
                                onChange={(event) =>
                                  setBragTitle(event.target.value)
                                }
                                className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                                placeholder={`Made it mine from order #${order.id}`}
                              />
                              <input
                                value={bragBody}
                                onChange={(event) =>
                                  setBragBody(event.target.value)
                                }
                                className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                                placeholder="Why this pickup belongs in the collection"
                              />
                              <div className="flex flex-wrap gap-2">
                                <select
                                  value={bragVisibility}
                                  onChange={(event) =>
                                    setBragVisibility(event.target.value)
                                  }
                                  className="rounded border border-neutral-300 px-2 py-1 text-xs font-semibold"
                                >
                                  <option value="friends">Friends</option>
                                  <option value="followers">Followers</option>
                                  <option value="community">Community</option>
                                  <option value="private">Private</option>
                                </select>
                                <button
                                  type="submit"
                                  disabled={isSavingSocial}
                                  className="rounded bg-neutral-950 px-3 py-1 text-xs font-bold text-white disabled:bg-neutral-500"
                                >
                                  Post
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setBragOrderId("")}
                                  className="rounded border border-neutral-300 px-3 py-1 text-xs font-bold"
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => postOrderBrag(order)}
                                disabled={isSavingSocial}
                                className="rounded bg-neutral-950 px-3 py-2 text-xs font-bold text-white disabled:bg-neutral-500"
                              >
                                Brag Now
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setBragOrderId(order.id);
                                  setBragTitle(
                                    `Made it mine from order #${order.id}`,
                                  );
                                  setBragBody("");
                                }}
                                className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                              >
                                Customize
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </section>
      )}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3">
      <dt className="font-bold text-neutral-500">{label}</dt>
      <dd className="break-words font-semibold text-neutral-950">{value}</dd>
    </div>
  );
}

function SellerProtectionCard({
  summary,
  title,
  detail,
  compact,
}: {
  summary: SellerProtectionSummary;
  title: string;
  detail?: string;
  compact?: boolean;
}) {
  return (
    <section
      className={`mt-4 rounded border p-3 ${sellerProtectionTone(summary.status)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] opacity-70">
            {title}
          </p>
          <h4 className="mt-1 font-black">{summary.label}</h4>
        </div>
        <span className="rounded border border-current/20 px-2 py-1 text-[11px] font-black">
          2% reserve / $20 max / shipping excluded
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Info label="Reserve" value={formatCurrency(summary.reserveAmount)} />
        <Info
          label="Covered"
          value={formatCurrency(summary.reimbursableItemAmount)}
        />
        <Info
          label="Excluded"
          value={formatCurrency(summary.shippingExcludedAmount)}
        />
        <Info
          label="Rows"
          value={`${summary.protectedRowCount} / ${summary.unprotectedRowCount}`}
        />
      </dl>
      {!compact ? (
        <>
          <p className="mt-3 text-xs leading-5 opacity-85">
            {detail || summary.detail}
          </p>
          <p className="mt-2 text-xs font-semibold opacity-80">
            {summary.sellerResponsibility}
          </p>
        </>
      ) : null}
    </section>
  );
}

function SocialCollectorRow({
  profile,
  relationship,
  isSaving,
  onFollow,
  onFriend,
}: {
  profile: CollectorSocialProfile;
  relationship: string;
  isSaving: boolean;
  onFollow: () => void;
  onFriend: () => void;
}) {
  const isFollowing = relationship.startsWith("follow:active");
  const isFriend =
    relationship.startsWith("friend:accepted") ||
    relationship.startsWith("friend:pending");

  return (
    <div className="rounded border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-black">
            {profile.collector_handle || "Collector"}
          </p>
          <p className="mt-1 text-xs font-semibold uppercase text-neutral-500">
            {profile.location_label || profile.visibility}
          </p>
          {profile.collecting_focus ? (
            <p className="mt-2 text-sm text-neutral-600">
              {profile.collecting_focus}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onFollow}
            disabled={isSaving || isFollowing}
            className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:text-neutral-400"
          >
            {isFollowing ? "Following" : "Follow"}
          </button>
          <button
            type="button"
            onClick={onFriend}
            disabled={isSaving || isFriend}
            className="rounded bg-neutral-950 px-3 py-2 text-xs font-bold text-white disabled:bg-neutral-500"
          >
            {relationship.startsWith("friend:accepted")
              ? "Friends"
              : relationship.startsWith("friend:pending")
                ? "Pending"
                : "Add Friend"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SocialConnectionRow({
  connection,
  actionLabel,
  isSaving,
  onAction,
  onRemove,
}: {
  connection: CollectorSocialConnection;
  actionLabel: string;
  isSaving: boolean;
  onAction?: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-200 bg-white p-3">
      <div className="min-w-0">
        <p className="break-words font-black">
          {connection.profile?.collector_handle || "Collector"}
        </p>
        <p className="mt-1 text-xs font-semibold uppercase text-neutral-500">
          {connection.type} / {connection.status} / {connection.direction}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {onAction ? (
          <button
            type="button"
            onClick={onAction}
            disabled={isSaving}
            className="rounded bg-neutral-950 px-3 py-2 text-xs font-bold text-white disabled:bg-neutral-500"
          >
            {actionLabel}
          </button>
        ) : (
          <span className="rounded bg-neutral-100 px-3 py-2 text-xs font-bold uppercase text-neutral-600">
            {actionLabel}
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={isSaving}
          className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:text-neutral-400"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function WatchlistRow({
  title,
  detail,
  badges,
  onRemove,
}: {
  title: string;
  detail: string;
  badges: string[];
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-200 bg-white p-3">
      <div className="min-w-0">
        <p className="break-words font-black">{title}</p>
        <p className="mt-1 text-xs font-semibold uppercase text-neutral-500">
          {detail}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.filter(Boolean).map((badge) => (
            <span
              key={badge}
              className="rounded bg-neutral-100 px-2 py-1 text-[11px] font-bold uppercase text-neutral-600"
            >
              {badge}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="rounded border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
      >
        Remove
      </button>
    </div>
  );
}

function shelfItemTypeLabel(value: string) {
  if (value === "wish_list") {
    return "The Shelf";
  }

  return value.replaceAll("_", " ");
}

function formatDate(value: string | null) {
  if (!value) return "Pending";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatCurrency(value: number | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function sellerProtectionTone(
  status: SellerProtectionSummary["status"] | undefined,
) {
  if (status === "protected") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  if (status === "mixed") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  if (status === "unprotected") {
    return "border-rose-200 bg-rose-50 text-rose-950";
  }

  return "border-neutral-200 bg-neutral-50 text-neutral-800";
}

function sellerPayoutLabel(value: string) {
  return value.replaceAll("_", " ").toUpperCase();
}

function holdContextAnchor(orderId: number) {
  return `seller-hold-order-${orderId}`;
}

function withShareSource(shareUrl: string, source: string) {
  try {
    const url = new URL(shareUrl);
    url.searchParams.set("src", source);
    return url.toString();
  } catch {
    const separator = shareUrl.includes("?") ? "&" : "?";
    return `${shareUrl}${separator}src=${encodeURIComponent(source)}`;
  }
}
