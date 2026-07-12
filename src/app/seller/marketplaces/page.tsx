import Link from "next/link";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { getStoreSettings } from "../../../lib/store-settings";
import { getActiveStoreId } from "../../../lib/stores";
import SellerConnectionsPanel from "./SellerConnectionsPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Connector = {
  name: string;
  status: "active_foundation" | "next_to_connect" | "planned";
  description: string;
  href?: string;
  actionLabel: string;
};

type BuildQueueStep = {
  name: string;
  status: "completed" | "current" | "planned";
  detail: string;
};

type CountResult = {
  count: number | null;
  error?: { message?: string } | null;
};

function buildConnectors(storeDisplayName: string): Connector[] {
  return [
    {
      name: "Store #1 eBay Engine",
      status: "active_foundation",
      description:
        `Store #1 eBay import, reconciliation, post-sale quantity sync, and sync policy controls are already live for ${storeDisplayName}.`,
      href: "/admin/ebay",
      actionLabel: "Open eBay Health",
    },
    {
      name: "Seller eBay Connection",
      status: "active_foundation",
      description:
        "Seller-safe eBay OAuth, encrypted token storage, and connection health refresh are live for seller accounts on the active store.",
      actionLabel: "Open Seller Connections",
    },
    {
      name: "Seller eBay Importer",
      status: "active_foundation",
      description:
        "Seller-scoped eBay preview, staging, duplicate review, bulk cleanup, promotion into draft inventory, and import-run visibility are live on the active store.",
      actionLabel: "Open Seller Connections",
    },
    {
      name: "Shopify",
      status: "planned",
      description:
        "Future connector for syncing TCOS master inventory into seller Shopify storefronts.",
      actionLabel: "Planned",
    },
    {
      name: "Whatnot",
      status: "planned",
      description:
        "Future connector for live selling, show inventory, and collectible marketplace imports.",
      actionLabel: "Planned",
    },
    {
      name: "Etsy",
      status: "planned",
      description:
        "Future connector for vintage, collectible, handmade, and specialty inventory.",
      actionLabel: "Planned",
    },
    {
      name: "Mercari",
      status: "planned",
      description:
        "Future connector for additional collectible marketplace reach.",
      actionLabel: "Planned",
    },
  ];
}

const buildQueue: BuildQueueStep[] = [
  {
    name: "Seller marketplace packet intake guidance",
    status: "completed",
    detail: "Seller Connections now explains that Seller Inventory marketplace packets are prep-only JSON/CSV handoffs with no external publishing, no postage purchase, and no Coverage policy creation until platform-specific connectors are approved.",
  },
  {
    name: "Shipping provider setup go/no-go",
    status: "completed",
    detail: "Admin Shipping now exposes a no-secret provider setup checklist, JSON/CSV setup packet, and go/no-go verdict for Standard Envelope, Ground Advantage/Priority, and Coverage before any live adapter work can proceed.",
  },
  {
    name: "Seller inventory shipping handoff",
    status: "completed",
    detail: "Seller Inventory now shows the default Standard Envelope or Ground Advantage plan, estimated postage, Coverage requirement, and Coverage type, and ready-row marketplace packets carry those shipping fields for external storefront prep.",
  },
  {
    name: "Seller marketplace ready-row label alignment",
    status: "completed",
    detail: "Seller marketplace handoff buttons now use Open Ready Rows and Search Ready Rows wording instead of the older Ready Stage labels, so ready-state marketplace jumps match the rest of the import-run controls.",
  },
  {
    name: "Seller marketplace review-row label alignment",
    status: "completed",
    detail: "Seller marketplace handoff buttons now use Open Review Rows, Search Review Rows, and Search Marketplace Rows wording, so review-stage jumps match the marketplace row language already used by import-run controls and cross-workspace links.",
  },
  {
    name: "Seller marketplace heading alignment",
    status: "completed",
    detail: "The seller marketplace page now titles the surface Seller Connections instead of Marketplace Connections, so the page heading matches the Open Seller Connections wording already used across seller shortcuts and connector cards.",
  },
  {
    name: "Seller home order payout metric wording",
    status: "completed",
    detail: "Seller home action-order cards now label order-linked cash-out counts as Open Payouts instead of Open Claims, so those order pressure summaries match the payout wording used across the rest of the seller workspace.",
  },
  {
    name: "Seller order detail cash-out section alignment",
    status: "completed",
    detail: "The seller order detail cash-out section now uses Cash-Out Payouts wording in both its section title and empty state, so that order-detail surface matches the payout language already used across the seller workspace.",
  },
  {
    name: "Seller order cash-out section label alignment",
    status: "completed",
    detail: "The seller order workspace now labels per-order cash-out sections as Cash-Out Payouts, so order-list payout panels match the payout wording already used across seller order detail and the seller payout workspace.",
  },
  {
    name: "Seller order detail payout card wording",
    status: "completed",
    detail: "The seller order detail payout action card now uses Cash-Out Payouts wording, so that order-level handoff matches the payout language already used across seller home, orders, and the payout workspace.",
  },
  {
    name: "Seller order payout metric label alignment",
    status: "completed",
    detail: "The seller order workspace summary now uses Open Payouts for its cash-out pressure metric, so order-level payout totals match the payout wording already used on seller home and the payout workspace.",
  },
  {
    name: "Seller home payout metric label alignment",
    status: "completed",
    detail: "The seller home payout-pressure card now uses Open Payouts, Blocked Payouts, and Paid Payouts summary labels so its at-a-glance totals match the rest of the seller payout workspace wording.",
  },
  {
    name: "Seller payout shortcut label alignment",
    status: "completed",
    detail: "Seller payout shortcut buttons and request-view labels now use Blocked Payouts, Cash-Out Payouts, Attention Payouts, and Paid Payouts wording so the payout workspace stops mixing request-era labels into the same seller flow.",
  },
  {
    name: "Seller cash-out payout label alignment",
    status: "completed",
    detail: "Seller home payout signal buttons and seller payout shortcut actions now use Open Cash-Out Payouts wording instead of mixing request-based labels into the same payout workspace handoff.",
  },
  {
    name: "Account marketplace label alignment",
    status: "completed",
    detail: "Account-level seller marketplace shortcuts now use Blocked Marketplace Rows, Ready Marketplace Rows, Mapped Marketplace Rows, and Marketplace Rows wording so account handoffs match the seller marketplace workspace language.",
  },
  {
    name: "Account payout shortcut label alignment",
    status: "completed",
    detail: "Account-level seller payout shortcuts now use Seller Payout Setup, Open Cash-Out Payouts, and Open Seller Payouts wording so account dashboard handoffs match the seller workspace language exactly.",
  },
  {
    name: "Seller return-view label alignment",
    status: "completed",
    detail: "Seller order detail links now use Return To order and payout view wording, and shared seller workspace headers preserve that return-view prefix instead of falling back to older back-navigation labels.",
  },
  {
    name: "Seller eBay auth route",
    status: "completed",
    detail: "Seller accounts can start eBay OAuth without touching the Store #1 token.",
  },
  {
    name: "Seller token storage",
    status: "completed",
    detail: "Seller marketplace tokens are encrypted and stored separately from global eBay sync credentials.",
  },
  {
    name: "Seller connection health refresh",
    status: "completed",
    detail: "Connected seller accounts can refresh token health and expiry status from the marketplace page.",
  },
  {
    name: "Seller import preview",
    status: "completed",
    detail: "Connected sellers can now preview live eBay inventory samples without writing into shared store inventory.",
  },
  {
    name: "Seller staging workspace",
    status: "completed",
    detail: "Seller-private staging now captures remote eBay listings for review without touching shared store inventory.",
  },
  {
    name: "Inventory ownership mapping",
    status: "completed",
    detail: "Products and inventory items now support optional seller ownership without breaking store-owned inventory.",
  },
  {
    name: "Seller draft promotion",
    status: "completed",
    detail: "Reviewed staged seller listings can now be promoted into seller-owned draft inventory instead of going live immediately.",
  },
  {
    name: "Seller inventory workspace",
    status: "completed",
    detail: "Sellers now have a dedicated inventory page with readiness filters, blocker rollups, and links back to marketplace review.",
  },
  {
    name: "Seller payout workspace",
    status: "completed",
    detail: "Sellers now have a dedicated payout page for Stripe verification, cash-out requests, blocked hold context, and payout request history.",
  },
  {
    name: "Seller activation controls",
    status: "completed",
    detail: "Ready seller drafts can now be activated from the seller inventory workspace after payout verification and readiness checks pass.",
  },
  {
    name: "Seller inventory lifecycle controls",
    status: "completed",
    detail: "Sellers can now pause live listings, archive drafts, and reactivate archived listings from the inventory workspace.",
  },
  {
    name: "Seller listing editor",
    status: "completed",
    detail: "Sellers can now edit title, price, quantity, and description, plus regenerate or AI-write descriptions from the inventory workspace.",
  },
  {
    name: "Seller inventory bulk controls",
    status: "completed",
    detail: "Sellers can now batch-select filtered inventory, bulk activate ready listings, and bulk archive selected listings from the inventory workspace.",
  },
  {
    name: "Seller command center",
    status: "completed",
    detail: "The seller home route now acts as a dashboard for inventory readiness, payout pressure, and recent routed-order signals.",
  },
  {
    name: "Seller order and payout routing",
    status: "completed",
    detail: "Seller order activity and cash-out history now share linked order context, payout routing summaries, hold pressure, and direct seller-side deep links.",
  },
  {
    name: "Conflict review dashboard",
    status: "completed",
    detail: "Blocked seller staging rows now surface grouped conflict reasons, quick review actions, and direct admin jump links for duplicate and already-promoted listings.",
  },
  {
    name: "Seller import run history",
    status: "completed",
    detail: "Seller marketplace staging now surfaces recent import job history with row, staged, skipped, and error counts so sync runs can be audited without admin access.",
  },
  {
    name: "Import diagnostics",
    status: "completed",
    detail: "Recent seller import jobs now capture skip reasons, quality signals, and eBay snapshot totals so cleanup pressure is visible without drilling into raw rows.",
  },
  {
    name: "Import-run row focus",
    status: "completed",
    detail: "Sellers can now focus the staging table to a specific import run directly from diagnostics or run history, then clear back to all runs when review is done.",
  },
  {
    name: "API-backed run review",
    status: "completed",
    detail: "Focused import-run review now reloads staged rows from the API by import job ID so large runs do not disappear outside the default staged-item window.",
  },
  {
    name: "Run outcome snapshots",
    status: "completed",
    detail: "Recent seller import runs now show current ready, review, blocked, mapped, promoted, and skipped counts so sellers can see how each run is resolving after cleanup starts.",
  },
  {
    name: "Run cleanup shortcuts",
    status: "completed",
    detail: "Import diagnostics and history cards now jump directly into ready, review, blocked, or mapped views for that exact run instead of making the seller stack filters manually.",
  },
  {
    name: "Run view preselection",
    status: "completed",
    detail: "Run view shortcuts now also preselect the matching staged rows for that import job so bulk review, skip, and promote actions can start immediately.",
  },
  {
    name: "Run cleanup progress",
    status: "completed",
    detail: "Import run outcome cards now show cleanup state and resolved progress so sellers can scan which batches are complete, active, or untouched.",
  },
  {
    name: "Remaining-work selection",
    status: "completed",
    detail: "Import run controls can now preselect all unresolved rows for a run in one click so bulk review and cleanup can start from the live work selection.",
  },
  {
    name: "Bulk selection summary",
    status: "completed",
    detail: "The staged-row bulk bar now shows how the current selection splits across ready, review, blocked, mapped, and skipped rows before any bulk action is applied.",
  },
  {
    name: "Bulk action guidance",
    status: "completed",
    detail: "The staged-row bulk bar now also explains the safest next action for the current selection so mixed selections are easier to clean up without accidental bulk moves.",
  },
  {
    name: "Selection cleanup actions",
    status: "completed",
    detail: "Mixed bulk selections can now be trimmed down to just ready, review, or blocked rows in one click directly from the guidance panel.",
  },
  {
    name: "Active-vs-complete cleanup",
    status: "completed",
    detail: "Mixed selections that include completed rows can now be reduced to just active work or just completed rows without rebuilding the selection manually.",
  },
  {
    name: "Count-aware bulk actions",
    status: "completed",
    detail: "Bulk action buttons now show exact affected-row counts and skip no-op status changes instead of pretending the whole selection needs the same move.",
  },
  {
    name: "Partial promotion retention",
    status: "completed",
    detail: "Bulk promotion now removes only the rows that actually promoted, leaving failed or unresolved rows selected for the next cleanup pass.",
  },
  {
    name: "Promotion failure follow-up",
    status: "completed",
    detail: "Bulk promotion failures now surface a seller-side follow-up panel with row-level error snippets and a one-click action to keep only the failed rows selected.",
  },
  {
    name: "Failed-to-review handoff",
    status: "completed",
    detail: "The bulk promotion follow-up panel can now send failed rows straight into needs-review status so sellers can park problem rows without rebuilding a selection first.",
  },
  {
    name: "Failure conflict links",
    status: "completed",
    detail: "Promotion failure follow-up now shows conflict reasons and direct admin product links when a failed row is colliding with an existing SKU or eBay listing.",
  },
  {
    name: "Failure breakdown filters",
    status: "completed",
    detail: "Promotion failure follow-up now summarizes failed rows by conflict/review/ready state and can isolate just the conflict failures for focused cleanup.",
  },
  {
    name: "Conflict-view handoff",
    status: "completed",
    detail: "Conflict failures can now jump straight into the blocked staging view with those rows preselected, so duplicate cleanup starts from the exact failing selection.",
  },
  {
    name: "Failure view handoffs",
    status: "completed",
    detail: "Promotion failure follow-up can now open ready-retry, review, or blocked views directly from the failed subset, keeping the seller inside the right cleanup workflow.",
  },
  {
    name: "Failed-ready retry",
    status: "completed",
    detail: "Promotion failure follow-up can now retry only the still-ready failed rows directly from the panel without making the seller reopen and re-run the general bulk promote action.",
  },
  {
    name: "Failed-selection reopen",
    status: "completed",
    detail: "The promotion follow-up panel can now reopen the full failed subset in the staged workspace before the seller narrows it into ready, review, or conflict groups.",
  },
  {
    name: "Post-import action board",
    status: "completed",
    detail: "Seller marketplace staging now highlights ready rows, review rows, blocked conflicts, and promoted draft output with one-click focus actions after each import run.",
  },
  {
    name: "Promotion success follow-up",
    status: "completed",
    detail: "Successful promotions now surface a seller-side results panel with draft links, mapped-row handoff, and a direct jump into the seller inventory workspace.",
  },
  {
    name: "Seller inventory bulk follow-up",
    status: "completed",
    detail: "Bulk activate/archive actions now keep failed rows selected, surface row-level failure details, and hand the seller straight into active, archived, needs-work, or payout follow-up work.",
  },
  {
    name: "Seller inventory selection guidance",
    status: "completed",
    detail: "The seller inventory workspace now summarizes mixed selections, trims them down to ready, needs-work, draft, active, or archived rows, and only sends eligible listings into bulk actions.",
  },
  {
    name: "Seller order workspace shortcuts",
    status: "completed",
    detail: "The seller order workspace now includes pressure cards and recent-signal focus actions so sellers can jump straight into action, shipping, cash-out, or completed order views.",
  },
  {
    name: "Seller payout workspace shortcuts",
    status: "completed",
    detail: "The seller payout workspace now includes request-view shortcut cards, stronger empty-state recovery, and blocked hold-context focus actions for order-linked payout cleanup.",
  },
  {
    name: "Seller dashboard workspace handoff",
    status: "completed",
    detail: "The seller command center now deep-links each workspace card, pressure panel, and recent signal into the exact needs-work, blocked, action, shipping, or signal-focused view when a smarter handoff exists.",
  },
  {
    name: "Seller deep-link filter hydration",
    status: "completed",
    detail: "Seller inventory, orders, and payout pages now honor incoming URL view and search parameters so dashboard and workspace handoffs land in the exact requested view.",
  },
  {
    name: "Seller workspace URL sync",
    status: "completed",
    detail: "Seller inventory, order, and payout filters now keep the browser URL in sync so views are refresh-safe, bookmarkable, and shareable after the seller changes filters.",
  },
  {
    name: "Seller order detail return context",
    status: "completed",
    detail: "Order detail links now preserve the originating seller order or payout context, and the detail page returns sellers to the right view instead of dropping them back into the generic order list.",
  },
  {
    name: "Seller order detail action board",
    status: "completed",
    detail: "Seller order detail now includes direct order and payout action cards plus timeline handoffs so one order can launch the seller back into the exact workflow view that needs attention.",
  },
  {
    name: "Order detail row handoffs",
    status: "completed",
    detail: "Seller order detail payout rows and review cases now each expose contextual order or payout links so the seller can jump straight from a specific issue into the matching workflow view.",
  },
  {
    name: "Order-to-payout request targeting",
    status: "completed",
    detail: "Seller order cash-out request links now open the payout workspace in the correct request view with the specific request pre-searched instead of relying on a loose anchor jump.",
  },
  {
    name: "Payout-to-order return context",
    status: "completed",
    detail: "Seller payout links into order detail now preserve the originating payout view, and order detail can return the seller back to that payout workspace instead of only the generic order list.",
  },
  {
    name: "Inventory workflow handoffs",
    status: "completed",
    detail: "Seller inventory buttons now route into action-order, shipping, or blocked-payout views when listing state or bulk failures make a smarter seller handoff possible.",
  },
  {
    name: "Payout workflow handoffs",
    status: "completed",
    detail: "Seller payout navigation and empty-state recovery now route into action-order, cash-out, or completed order views based on the active payout request view.",
  },
  {
    name: "Order workflow handoffs",
    status: "completed",
    detail: "Seller order navigation and empty-state recovery now route into blocked, attention, open, or paid payout views based on the active order workspace.",
  },
  {
    name: "Dashboard workflow nav",
    status: "completed",
    detail: "The seller command-center header now routes Inventory, Payouts, and Orders into the hottest needs-work, blocked, open, action, or shipping view instead of generic workspace roots.",
  },
  {
    name: "Inventory workflow nav",
    status: "completed",
    detail: "The seller inventory header now routes Orders and Payouts into shipping, action, blocked, or open views based on active listing focus, draft cleanup pressure, and payout-verification fallout.",
  },
  {
    name: "Order detail payout nav",
    status: "completed",
    detail: "The seller order-detail header now routes Payouts into blocked, attention, open, paid, or general payout views based on the live payout pressure tied to that routed order.",
  },
  {
    name: "Dashboard detail handoffs",
    status: "completed",
    detail: "Blocked cash-out order chips and action-order cards on the seller command center now jump straight into seller order detail with the right order or payout return context.",
  },
  {
    name: "Dashboard signal payout handoffs",
    status: "completed",
    detail: "Payout-related seller signals on the command center now open the matching payout view directly, and their order-detail links return sellers back to blocked or open payout work instead of only the order workspace.",
  },
  {
    name: "Order workspace payout jumps",
    status: "completed",
    detail: "Seller order workspace shortcut cards now include direct jumps into their matching blocked, attention, open, or paid payout view instead of making the seller open orders first and payouts second.",
  },
  {
    name: "Payout workspace order jumps",
    status: "completed",
    detail: "Seller payout workspace shortcut cards now include direct jumps into their matching action-order, cash-out, or completed order view so sellers can pivot across workspace states without resetting context.",
  },
  {
    name: "Payout request order routing",
    status: "completed",
    detail: "Seller payout request cards and blocked-hold summaries now route directly into the matching action, shipping, cash-out, or completed order view based on the request's real order pressure instead of only linking into order detail.",
  },
  {
    name: "Order detail cash-out routing",
    status: "completed",
    detail: "Seller order detail now routes cash-out claims into action, shipping, cash-out, or completed order views based on live request pressure, and seller-facing payout actions now use cleaner cash-out wording.",
  },
  {
    name: "Dashboard blocked payout jumps",
    status: "completed",
    detail: "Seller home blocked cash-out cards now include direct jumps into action-order and blocked-payout request views, and payout summary labels now use clearer cash-out wording.",
  },
  {
    name: "Order workspace claim jumps",
    status: "completed",
    detail: "Seller order workspace cash-out request cards now include direct jumps into action, shipping, cash-out, or completed order views based on live request pressure, and seller home payout summary labels stay aligned with the cash-out wording.",
  },
  {
    name: "Signal payout labels",
    status: "completed",
    detail: "Seller signal cards on the command center and seller order detail now label payout actions with the actual blocked or cash-out view they open instead of using generic payout wording.",
  },
  {
    name: "Marketplace draft workspace handoffs",
    status: "completed",
    detail: "Seller marketplace import draft-output links now open the seller draft inventory workspace directly, and draft-output guidance now calls that handoff by name instead of sending sellers to a generic inventory root.",
  },
  {
    name: "Marketplace draft workspace routing",
    status: "completed",
    detail: "Seller marketplace draft-output links now choose the most useful draft view, and recent promoted inventory cards can jump straight into the matching seller inventory workspace for that item.",
  },
  {
    name: "Dashboard draft workspace jumps",
    status: "completed",
    detail: "Seller home draft blockers now include direct seller-workspace jumps for each item, and seller-home inventory or order recovery buttons now name the exact needs-work or action view they open.",
  },
  {
    name: "Order card signal actions",
    status: "completed",
    detail: "Seller order cards now turn recent signal rows into direct order, payout, and seller-detail actions so sellers can react from the order list instead of opening the detail page first.",
  },
  {
    name: "Order signal payout actions",
    status: "completed",
    detail: "Top-level seller order signals now include direct blocked-payout or cash-out-payout actions when the signal is payout-related, and their seller-detail label now matches the rest of the workspace.",
  },
  {
    name: "Order request payout labels",
    status: "completed",
    detail: "Seller cash-out request buttons inside order list and order detail now name the exact payout view they open, including blocked, cash-out, paid, or attention views.",
  },
  {
    name: "Signal action labels",
    status: "completed",
    detail: "Seller home and top-level seller order signals now label action jumps with the exact action, shipping, cash-out, completed, or seller-order view they open, and seller-home signal detail links now use the same seller-detail wording as the rest of the workspace.",
  },
  {
    name: "Inventory order search handoffs",
    status: "completed",
    detail: "Seller inventory order buttons now carry the current listing title into the target seller order workspace so shipping, action, or seller-order jumps land on the relevant collectible instead of a broad search.",
  },
  {
    name: "Cash-out payout naming",
    status: "completed",
    detail: "Remaining seller views that route into the open payout-request view now call it the cash-out payout view instead of the older generic open-payout wording.",
  },
  {
    name: "Inventory marketplace search handoffs",
    status: "completed",
    detail: "Seller inventory can now open marketplace review with staged-row search context from the current listing, and the marketplace workspace can initialize its filter/search state from those incoming query parameters.",
  },
  {
    name: "Inventory marketplace view handoffs",
    status: "completed",
    detail: "Seller inventory summary and toolbar marketplace shortcuts now carry readiness or search context into seller marketplace review so needs-work, ready-stage, and item-search jumps land in the right staged view.",
  },
  {
    name: "Seller home marketplace routing",
    status: "completed",
    detail: "The seller command center now reads the latest staged import summary and turns its marketplace card and header shortcut into direct blocked, needs-review, ready, mapped, or general marketplace links based on live sync pressure.",
  },
  {
    name: "Draft output workspace labeling",
    status: "completed",
    detail: "Seller marketplace draft-output links now reuse the smart seller draft workspace target, and promotion-result controls now distinguish between showing promoted rows inside marketplace review versus opening the seller draft inventory workspace.",
  },
  {
    name: "Promoted row seller workspace links",
    status: "completed",
    detail: "Promotion-result rows now include direct seller draft-workspace links using the promoted title or SKU, so sellers can open the matching seller-owned inventory record without detouring through admin first.",
  },
  {
    name: "Conflict match seller routing",
    status: "completed",
    detail: "Blocked, failed, and already-promoted marketplace conflict matches now expose seller-workspace links whenever the duplicate belongs to the same seller or store-owned inventory, while keeping the admin product links for deeper review.",
  },
  {
    name: "Inventory follow-up seller routing",
    status: "completed",
    detail: "Seller inventory bulk success and failure follow-up cards now include direct seller-workspace links for the affected listing, and remaining admin product links use the same open-in-admin wording as the rest of the seller workspace.",
  },
  {
    name: "Inventory header marketplace routing",
    status: "completed",
    detail: "The seller inventory header marketplace shortcut now carries the current inventory search and readiness context into seller marketplace review, and marketplace admin-only exits now consistently use the same open-in-admin wording as the rest of the seller workspace.",
  },
  {
    name: "Orders and payouts inventory header routing",
    status: "completed",
    detail: "Seller orders and seller payouts now turn their inventory header shortcuts into context-aware seller inventory links, using the current order or payout filter plus usable search text to land on needs-work drafts, active inventory, or a focused seller inventory search.",
  },
  {
    name: "Order detail inventory header routing",
    status: "completed",
    detail: "The seller order detail header now routes its inventory shortcut into active or general seller inventory with single-item search context when available, instead of always dropping sellers at the inventory root.",
  },
  {
    name: "Orders and payouts marketplace header routing",
    status: "completed",
    detail: "Seller orders, seller payouts, and seller order detail now turn their marketplace header shortcuts into search-aware seller marketplace links, carrying usable listing text or single-item context instead of always opening the generic marketplace root.",
  },
  {
    name: "Order detail login return routing",
    status: "completed",
    detail: "The seller order detail login gate now preserves the page's return order or payout context instead of always sending logged-out sellers back to the generic seller orders root.",
  },
  {
    name: "Command center workspace fallbacks",
    status: "completed",
    detail: "Seller command center action cards now reuse the same smart workspace routing as the header shortcuts, so idle states fall back to seller inventory, seller payouts, or seller orders instead of forcing empty ready, shipping, or cash-out views.",
  },
  {
    name: "Marketplace page workspace shortcuts",
    status: "completed",
    detail: "The seller marketplace page now uses its live store counts to steer inventory and payout shortcuts toward active inventory, seller drafts, or payout setup instead of treating every workspace jump as a generic root link.",
  },
  {
    name: "Account page seller handoffs",
    status: "completed",
    detail: "The account page now routes seller payout entry points into blocked or cash-out payout views when pressure exists, and hold-context shortcuts now open the seller action-order workspace instead of the generic seller order root.",
  },
  {
    name: "Account page payout detail returns",
    status: "completed",
    detail: "Blocked payout request chips and hold-context cards on the account page now open seller order detail with the blocked-payout return view preserved, so the seller can inspect an order and still jump back into the right payout workspace.",
  },
  {
    name: "Account page payout request shortcuts",
    status: "completed",
    detail: "Seller payout request cards on the account page now include direct jumps into the matching blocked, cash-out, paid, or general payout view plus the corresponding seller order view, instead of only showing request status in place.",
  },
  {
    name: "Account page marketplace shortcuts",
    status: "completed",
    detail: "The account page seller-verification card now reads the latest staged import summary and routes its marketplace button into blocked, needs-review, ready, mapped, or general seller marketplace review instead of always opening the generic marketplace root.",
  },
  {
    name: "Orders and payouts marketplace view routing",
    status: "completed",
    detail: "Seller orders and seller payouts now steer their marketplace header shortcut into needs-review marketplace cleanup when the seller is already working blocked or attention-heavy views, while clean views keep the broader marketplace search handoff.",
  },
  {
    name: "Order detail marketplace view routing",
    status: "completed",
    detail: "Seller order detail now uses live blocked payout and review pressure to send its marketplace shortcut into needs-review cleanup when that order is under active hold pressure, while clean order detail pages keep the broader marketplace search handoff.",
  },
  {
    name: "Command center empty-state fallbacks",
    status: "completed",
    detail: "Seller command-center empty-state buttons for draft blockers, blocked cash-outs, and action orders now reuse the same smart workspace fallbacks as the header and action cards, instead of dropping sellers into views that may already be empty.",
  },
  {
    name: "Account page payout setup shortcut",
    status: "completed",
    detail: "The account page seller payout shortcut now shows payout setup when seller verification is still incomplete, while still routing straight into blocked or cash-out payout views when live request pressure exists.",
  },
  {
    name: "Command center draft marketplace links",
    status: "completed",
    detail: "Draft blockers on the seller command center now include direct needs-review marketplace search links for the affected collectible, so sellers can pivot from a blocked draft into marketplace cleanup without first opening seller inventory.",
  },
  {
    name: "Order detail item workspace links",
    status: "completed",
    detail: "Seller order detail item rows now include direct seller inventory and marketplace search links for each collectible, and blocked orders steer those marketplace item links into needs-review cleanup instead of a broad marketplace search.",
  },
  {
    name: "Order workspace item links",
    status: "completed",
    detail: "Seller order workspace item rows now include direct seller inventory and marketplace search links for each collectible, and review-heavy orders steer those marketplace item links into needs-review cleanup instead of a broad marketplace search.",
  },
  {
    name: "Order detail payout-row workspace links",
    status: "completed",
    detail: "Seller order detail payout rows now include direct seller inventory and marketplace search links for the affected collectible, and blocked orders steer those marketplace row links into needs-review cleanup instead of a broad marketplace search.",
  },
  {
    name: "Marketplace inventory backtrack links",
    status: "completed",
    detail: "Recent seller inventory cards on the marketplace page now include direct marketplace-row search links using eBay item ID, SKU, or title, with blocked drafts steering into needs-review cleanup, ready drafts steering into the ready stage, and non-draft items keeping the broader marketplace search handoff.",
  },
  {
    name: "Inventory follow-up marketplace links",
    status: "completed",
    detail: "Seller inventory bulk success and failure follow-up cards now include direct marketplace review links for the affected listing, and draft items with blockers steer those links into needs-review cleanup instead of a broad marketplace search.",
  },
  {
    name: "Inventory row marketplace view routing",
    status: "completed",
    detail: "Main seller inventory row actions now reuse the same smart marketplace routing as the follow-up cards, so blocked drafts open needs-review cleanup, ready drafts open the ready stage, and non-draft listings keep the broader marketplace search handoff.",
  },
  {
    name: "Payout linked-order workspace links",
    status: "completed",
    detail: "Seller payout linked-order cards now include direct workspace handoffs for the specific order, steering into action, shipping, cash-out, completed, or general seller-order views based on the live payout and fulfillment pressure already shown on the card.",
  },
  {
    name: "Order workspace review-case workflow links",
    status: "completed",
    detail: "Review pressure cards on the seller order workspace now include direct action, blocked-payout, and order-detail handoffs, so case pressure on an order can launch the seller straight into the right workflow without opening the order first.",
  },
  {
    name: "Seller home action-order workflow links",
    status: "completed",
    detail: "Action-order cards on the seller command center now include direct order-view, payout-view, and order-detail buttons, so homepage pressure can jump straight into action, shipping, cash-out, blocked payout, or order detail without forcing a single generic click path.",
  },
  {
    name: "Blocked payout affected-order handoffs",
    status: "completed",
    detail: "Blocked seller payout request cards now turn their affected-order list into direct action-order and order-detail handoffs, preserving blocked payout return context instead of treating those orders as detail-only chips.",
  },
  {
    name: "Seller home blocked payout order handoffs",
    status: "completed",
    detail: "Blocked cash-out cards on the seller command center now turn their linked-order list into direct action-order and order-detail handoffs, so homepage payout pressure can jump straight into the right order workflow without a generic detour.",
  },
  {
    name: "Blocked hold payout view links",
    status: "completed",
    detail: "Blocked hold-context cards on the seller payout page now include direct blocked-payout view links with the specific order search context preserved, so held cash-out pressure can reopen the exact payout workspace instead of only relying on local focus state.",
  },
  {
    name: "Inventory blocker focus controls",
    status: "completed",
    detail: "Top blocker rows on the seller inventory page now act as direct focus controls, jumping sellers into draft needs-work inventory with the affected listings preselected instead of leaving blocker counts as passive summary text.",
  },
  {
    name: "Inventory row payout workspace links",
    status: "completed",
    detail: "Seller inventory item cards now include direct payout workspace handoffs, sending active listings into cash-out payouts and other listings into seller payouts with item search context preserved.",
  },
  {
    name: "Marketplace inventory order and payout links",
    status: "completed",
    detail: "Recent seller inventory cards on the marketplace page now also include direct seller-order and seller-payout workspace handoffs, so imported listings can pivot into shipping, action, seller orders, cash-out payouts, or seller payouts without leaving the marketplace workspace first.",
  },
  {
    name: "Order detail timeline action labels",
    status: "completed",
    detail: "Recent activity cards on seller order detail now name the exact order view they open, so shipment, cash-out, completed, and action signals match the explicit order wording already used on seller home and the order workspace.",
  },
  {
    name: "Seller home payout card routing",
    status: "completed",
    detail: "The seller home payout-pressure card now reuses the same live payout workspace shortcut logic as the rest of the dashboard, so its CTA opens blocked payouts, cash-out payouts, or the general seller payout workspace based on real request pressure instead of a stale two-branch shortcut.",
  },
  {
    name: "Seller home inventory card routing",
    status: "completed",
    detail: "The seller home inventory-pulse card now reuses the same live inventory workspace shortcut logic as the rest of the dashboard, so its CTA opens needs-work drafts, ready drafts, or the general seller inventory workspace based on real listing pressure instead of a stale two-branch shortcut.",
  },
  {
    name: "Seller detail wording alignment",
    status: "completed",
    detail: "Seller home and seller order signal cards now consistently label their drilldowns as order detail links, matching the rest of the seller workspace instead of mixing in older seller-detail wording.",
  },
  {
    name: "Seller home draft order links",
    status: "completed",
    detail: "Draft blocker cards on the seller command center now also include direct action-order handoffs scoped by listing title, so seller cleanup can pivot from a blocked draft into the surrounding order view without stopping at inventory first.",
  },
  {
    name: "Shortcut label alignment",
    status: "completed",
    detail: "Seller order and seller payout shortcut cards now label their primary buttons with the exact order or payout view they open instead of generic shortcut wording, matching the explicit handoff style used everywhere else in the seller workspace.",
  },
  {
    name: "Blocked hold detail wording alignment",
    status: "completed",
    detail: "Blocked hold-context cards on the seller payout page now use the same Open Order Detail wording as the rest of the seller workspace instead of keeping a shorter one-off order label.",
  },
  {
    name: "Inventory bulk workspace wording",
    status: "completed",
    detail: "Seller inventory bulk follow-up controls now use explicit inventory workspace labels such as Open Seller Inventory instead of vaguer fallback wording, keeping bulk recovery actions aligned with the naming used across the seller workspace.",
  },
  {
    name: "Seller home footer label alignment",
    status: "completed",
    detail: "Seller home section footer links now use the same Open wording as the rest of the seller workspace, replacing older Review labels on needs-work drafts, blocked payouts, and action orders.",
  },
  {
    name: "Failure follow-up wording alignment",
    status: "completed",
    detail: "Seller inventory and seller marketplace cleanup panels now name their failed follow-up actions directly as failed inventory or failed promotions instead of sharing vague fallback wording.",
  },
  {
    name: "Marketplace view button wording",
    status: "completed",
    detail: "Marketplace diagnostics now label their view buttons with explicit Open wording, so ready, review, blocked, and mapped jump actions match the rest of the seller workspace instead of using shorter stage-only labels.",
  },
  {
    name: "Payout request wording alignment",
    status: "completed",
    detail: "Seller payout filters and empty-state recovery buttons now refer to blocked, cash-out, paid, and attention requests directly instead of calling those request views generic buckets.",
  },
  {
    name: "Blocked hold focus wording",
    status: "completed",
    detail: "Blocked hold-context cards on the seller payout page now refer to focusing blocked requests in the plural, matching the summary card's multi-request hold context instead of implying only one blocked request exists.",
  },
  {
    name: "Seller home inventory label alignment",
    status: "completed",
    detail: "The seller home inventory workspace shortcut now uses the fuller Needs Work Drafts label, so dashboard calls-to-action match the rest of the seller inventory language instead of shortening that workspace name.",
  },
  {
    name: "Inventory sidebar footer wording",
    status: "completed",
    detail: "The seller inventory sidebar now uses Open Action Orders alongside its other explicit footer actions, instead of leaving the order handoff as the shorter Action Orders label.",
  },
  {
    name: "Promotion view wording alignment",
    status: "completed",
    detail: "Failed-promotion cleanup controls now use ready, review, and conflict view wording directly, so marketplace recovery buttons match the same language used by the rest of the staging diagnostics.",
  },
  {
    name: "Seller action button wording",
    status: "completed",
    detail: "Seller home and payout action buttons now render with explicit Open wording for order and payout handoffs, so direct workspace jumps read like actions instead of unlabeled stage names.",
  },
  {
    name: "Seller order wording alignment",
    status: "completed",
    detail: "Seller order list and detail actions now use Action Orders, Shipping Orders, Cash-Out Orders, and Completed Orders wording instead of the older workflow phrasing, so order handoffs read the same way as the rest of the seller workspace.",
  },
  {
    name: "Inventory item handoff wording",
    status: "completed",
    detail: "Seller inventory item cards now use explicit Open Shipping Orders, Open Action Orders, Open Seller Orders, and payout handoff wording, so item-level jumps match the action language used throughout the rest of the seller workspace.",
  },
  {
    name: "Seller header shortcut wording",
    status: "completed",
    detail: "Seller workspace header shortcuts now render inventory, payout, order, and marketplace destinations with explicit Open wording unless they are already search or return actions, so the top navigation chips read like actions across the whole seller surface.",
  },
  {
    name: "Cross-workspace button wording",
    status: "completed",
    detail: "Seller orders, payouts, and marketplace header handoffs now also prefix their remaining workspace jump buttons with Open wording, removing the last raw Seller Orders and payout workspace labels from visible seller controls.",
  },
  {
    name: "Marketplace preview handoff wording",
    status: "completed",
    detail: "Seller marketplace inventory preview cards now use explicit Open Shipping Orders, Open Action Orders, Open Seller Orders, and Open Seller Payouts wording, so preview-card jumps match the rest of the seller workspace action language.",
  },
  {
    name: "Inventory and admin link wording",
    status: "completed",
    detail: "Seller inventory and marketplace cards now use Open Seller Inventory and Open Admin Product wording for product-level handoffs, so item drilldowns read more clearly than the older Open In Seller Workspace and Open In Admin labels.",
  },
  {
    name: "Marketplace rows wording",
    status: "completed",
    detail: "Generic seller marketplace jumps now use Marketplace Rows wording across seller home, inventory, orders, payout, and order-detail surfaces, so the unscoped marketplace destination keeps one clear name while stage-specific review and ready labels stay intact.",
  },
  {
    name: "Seller payout setup wording",
    status: "completed",
    detail: "The marketplace dashboard seller payout fallback now uses Seller Payout Setup wording, so the header shortcut reads like a real seller workspace destination instead of the shorter Open Payout Setup phrasing.",
  },
  {
    name: "Workspace heading wording",
    status: "completed",
    detail: "Seller inventory and marketplace section headings now use Seller Inventory Workspace and Seller-Safe Build Progress wording, so those surface titles match the rest of the seller UI instead of keeping older workflow phrasing.",
  },
  {
    name: "Marketplace stage wording",
    status: "completed",
    detail: "Seller home marketplace workspace labels now use Blocked Marketplace Rows, Ready Marketplace Rows, and Mapped Marketplace Rows, so the stage-specific seller-home chips stay aligned with the broader Marketplace Rows naming.",
  },
  {
    name: "Seller workspace wording cleanup",
    status: "completed",
    detail: "Seller order headings, signal chips, payout shortcuts, marketplace connector actions, and Shopify request labels now use workspace, order, request, and connection wording instead of leftover older phrasing.",
  },
  {
    name: "Failure handoff wording cleanup",
    status: "completed",
    detail: "Seller inventory and marketplace failure follow-up controls now use Open Active Inventory, Open Archived Inventory, Open Seller Inventory, Open Failed Inventory, and Open Failed Promotions wording so recovery actions match the rest of the seller workspace language.",
  },
  {
    name: "Signal and order-detail wording cleanup",
    status: "completed",
    detail: "Seller signal blurbs now refer to the seller workspace instead of older seller-workflow wording, and seller order detail action cards now use Return View, Shipping Orders, and Cash-Out Payouts wording to match the rest of the seller-facing UI.",
  },
  {
    name: "Bulk guidance wording cleanup",
    status: "completed",
    detail: "Seller inventory and marketplace bulk guidance now refer to cleanup work, selections, draft inventory views, and ready, review, or conflict rows instead of older workflow-and-stage phrasing.",
  },
  {
    name: "Import-run button wording cleanup",
    status: "completed",
    detail: "Marketplace import-run controls now use Open Ready Rows, Open Review Rows, Open Blocked Rows, and Open Mapped Rows wording so staged-item follow-up buttons match the rest of the seller cleanup language.",
  },
  {
    name: "Payout CTA wording cleanup",
    status: "completed",
    detail: "Seller signal, cash-out request, and fallback order or payout buttons now use full Open Seller Payouts, Open Blocked Payouts, Open Cash-Out Payouts, Open Paid Payouts, Open Attention Payouts, and Open Seller Orders wording instead of shorter raw labels.",
  },
  {
    name: "Order-detail CTA wording cleanup",
    status: "completed",
    detail: "Blocked-payout order cards on seller home and seller payouts now also use Open Order Detail wording, removing the last shorter order-detail CTA labels from the seller-facing UI.",
  },
  {
    name: "Direct shortcut CTA wording cleanup",
    status: "completed",
    detail: "Seller-home signal buttons plus seller order and payout shortcut cards now use full Open Shipping Orders, Open Action Orders, Open Cash-Out Orders, Open Completed Orders, Open Seller Orders, Open Attention Payouts, Open Blocked Payouts, Open Cash-Out Payouts, Open Paid Payouts, and Open Seller Payouts wording when those helper labels render directly.",
  },
];

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function countLabel(value: number | null) {
  return value === null ? "Review" : value.toLocaleString();
}

function statusLabel(status: Connector["status"]) {
  if (status === "active_foundation") return "Active foundation";
  if (status === "next_to_connect") return "Next to connect";
  return "Planned";
}

function statusTone(status: Connector["status"]) {
  if (status === "active_foundation") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "next_to_connect") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function queueTone(status: BuildQueueStep["status"]) {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "current") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function queueLabel(status: BuildQueueStep["status"]) {
  if (status === "completed") return "Completed";
  if (status === "current") return "Current";
  return "Planned";
}

function sellerInventoryWorkspaceLink(counts: {
  productCount: number | null;
  activeProductCount: number | null;
}) {
  if ((counts.activeProductCount || 0) > 0) {
    return {
      href: "/seller/inventory?status=active",
      label: "Active Inventory",
    };
  }

  if ((counts.productCount || 0) > 0) {
    return {
      href: "/seller/inventory?status=draft",
      label: "Seller Drafts",
    };
  }

  return {
    href: "/seller/inventory",
    label: "Seller Inventory",
  };
}

function sellerPayoutWorkspaceLink(sellerPayoutCount: number | null) {
  if ((sellerPayoutCount || 0) > 0) {
    return {
      href: "/seller/payouts",
      label: "Seller Payouts",
    };
  }

  return {
    href: "/seller/payouts",
    label: "Seller Payout Setup",
  };
}

async function safeCount(query: PromiseLike<CountResult>) {
  const result = await query;
  return result.error ? null : result.count ?? 0;
}

export default async function SellerMarketplacesPage() {
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase, storeId);
  const connectors = buildConnectors(storeSettings.displayName);

  const [productCount, ebayLinkedCount, activeProductCount, sellerPayoutCount] =
    await Promise.all([
      safeCount(
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId),
      ),
      safeCount(
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .not("ebay_item_id", "is", null),
      ),
      safeCount(
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .gt("quantity", 0),
      ),
      safeCount(
        supabase
          .from("seller_payout_accounts")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId),
      ),
    ]);
  const inventoryWorkspaceLink = sellerInventoryWorkspaceLink({
    productCount,
    activeProductCount,
  });
  const payoutWorkspaceLink = sellerPayoutWorkspaceLink(sellerPayoutCount);

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              TCOS Seller Sync
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Seller Connections
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Seller-facing control center for marketplace import and sync
              connections. The current live foundation is Store #1 scoped so
              {storeSettings.displayName} keeps working while seller-specific
              connectors are built around it.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/seller" label="Seller Home" />
            <CommandLink href="/account" label="Account" />
            <CommandLink
              href={inventoryWorkspaceLink.href}
              label={workspaceHeaderLabel(inventoryWorkspaceLink.label)}
            />
            <CommandLink
              href={payoutWorkspaceLink.href}
              label={workspaceHeaderLabel(payoutWorkspaceLink.label)}
            />
            <CommandLink href="/seller/orders" label="Open Seller Orders" />
            <CommandLink href="/seller-terms" label="Seller Terms" />
            <CommandLink href="/admin/ebay" label="eBay Health" primary />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Store Inventory" value={countLabel(productCount)} />
          <Metric label="Active Products" value={countLabel(activeProductCount)} />
          <Metric label="eBay Linked" value={countLabel(ebayLinkedCount)} />
          <Metric label="Seller Payout Profiles" value={countLabel(sellerPayoutCount)} />
        </section>

        <section className="rounded-md border border-neutral-200 bg-white p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Info label="Store" value={storeSettings.displayName} />
            <Info label="Store Status" value={label(storeSettings.status)} />
            <Info
              label="eBay Sync"
              value={storeSettings.ebaySyncEnabled ? "Enabled" : "Disabled"}
            />
            <Info
              label="Commission"
              value={`${(storeSettings.sellerCommissionRate * 100).toFixed(2)}%`}
            />
          </div>
        </section>

        <section
          className={`rounded-md border p-5 ${
            storeSettings.ebaySyncEnabled
              ? "border-emerald-200 bg-emerald-50"
              : "border-rose-200 bg-rose-50"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em] text-neutral-700">
                Store Sync Guardrail
              </p>
              <h2 className="mt-2 text-2xl font-black">
                {storeSettings.ebaySyncEnabled
                  ? "Seller eBay connections are enabled for this store."
                  : "Seller eBay connections are blocked because store sync is off."}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-700">
                {storeSettings.ebaySyncEnabled
                  ? "Sellers can connect eBay, refresh token health, and prepare for seller-scoped imports while the live Store #1 sync remains protected."
                  : "The seller OAuth route follows the same store sync policy as the live eBay engine. A store admin must enable eBay sync before sellers can connect marketplace accounts."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <CommandLink href="/admin/settings" label="Store Settings" primary />
              <CommandLink href="/admin/ebay" label="Sync Rules" />
            </div>
          </div>
        </section>

        <section className="rounded-md border border-sky-200 bg-sky-50 p-5 text-sky-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em]">
                Marketplace Packet Intake
              </p>
              <h2 className="mt-2 text-2xl font-black">
                Seller Inventory exports are prep files, not live publishing.
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6">
                Use `Copy Marketplace Packet`, `Download Marketplace Packet`, or
                `Download Marketplace CSV` from Seller Inventory after rows are
                activation-ready. Those files carry TCOS row IDs, pricing,
                shipping-plan estimates, Coverage fields, readiness evidence, and
                export context for outside-storefront prep.
                JSON packets also carry an operator checklist and
                prohibited-action manifest so downloaded files stay clearly
                separated from publishing, postage, Coverage, payout, or order
                fulfillment approval.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded border border-sky-300 bg-white px-2 py-1 text-[11px] font-black uppercase">
                  Cross-list prep only
                </span>
                <span className="rounded border border-sky-300 bg-white px-2 py-1 text-[11px] font-black uppercase">
                  No external publishing
                </span>
                <span className="rounded border border-sky-300 bg-white px-2 py-1 text-[11px] font-black uppercase">
                  No postage purchase
                </span>
                <span className="rounded border border-sky-300 bg-white px-2 py-1 text-[11px] font-black uppercase">
                  No Coverage policy creation
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <CommandLink
                href="/seller/inventory?status=draft&readiness=ready"
                label="Open Ready Inventory"
                primary
              />
              <CommandLink
                href="/seller/inventory?status=draft&readiness=needs_work"
                label="Open Needs-Work Inventory"
              />
            </div>
          </div>
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 p-5">
            <div>
              <h2 className="text-2xl font-black">Available Connectors</h2>
              <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                eBay stays first because the active TCOS inventory engine,
                reconciliation board, and quantity-sync safety controls already
                run through the Store #1 marketplace foundation.
              </p>
            </div>
            <span className="rounded border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700">
              Store {storeId.slice(-4)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {connectors.map((connector) => (
              <ConnectorCard key={connector.name} connector={connector} />
            ))}
          </div>
        </section>

        <SellerConnectionsPanel ebaySyncEnabled={storeSettings.ebaySyncEnabled} />

        <section className="rounded-md border border-neutral-200 bg-white p-5">
          <h2 className="text-2xl font-black">Seller-Safe Build Progress</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {buildQueue.map((step, index) => (
              <div
                key={step.name}
                className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-black uppercase text-neutral-500">
                    Step {index + 1}
                  </p>
                  <span
                    className={`rounded border px-2 py-1 text-[11px] font-black uppercase ${queueTone(
                      step.status,
                    )}`}
                  >
                    {queueLabel(step.status)}
                  </span>
                </div>
                <p className="mt-2 font-bold">{step.name}</p>
                <p className="mt-2 text-sm leading-6 text-neutral-600">
                  {step.detail}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ConnectorCard({ connector }: { connector: Connector }) {
  const buttonClass = connector.href
    ? "bg-neutral-950 text-white hover:bg-neutral-800"
    : "cursor-not-allowed bg-neutral-200 text-neutral-500";

  return (
    <article className="flex min-h-[230px] flex-col rounded-md border border-neutral-200 bg-neutral-50 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xl font-black">{connector.name}</h3>
        <span
          className={`shrink-0 rounded border px-2 py-1 text-[11px] font-black ${statusTone(
            connector.status,
          )}`}
        >
          {statusLabel(connector.status)}
        </span>
      </div>

      <p className="mt-3 flex-1 text-sm leading-6 text-neutral-600">
        {connector.description}
      </p>

      {connector.href ? (
        <Link
          href={connector.href}
          className={`mt-5 rounded-md px-4 py-2 text-center text-sm font-bold ${buttonClass}`}
        >
          {connector.actionLabel}
        </Link>
      ) : (
        <button
          className={`mt-5 rounded-md px-4 py-2 text-sm font-bold ${buttonClass}`}
          disabled
          type="button"
        >
          {connector.actionLabel}
        </button>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
      <dt className="text-xs font-bold uppercase text-neutral-500">{label}</dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}

function CommandLink({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  const className = primary
    ? "bg-amber-300 text-neutral-950 hover:bg-amber-200"
    : "border border-white/20 text-white hover:bg-white/10";

  return (
    <Link
      href={href}
      className={`rounded-md px-4 py-2 text-sm font-bold ${className}`}
    >
      {label}
    </Link>
  );
}

function workspaceHeaderLabel(label: string) {
  if (
    label.startsWith("Open ") ||
    label.startsWith("Search ") ||
    label.startsWith("Back To ") ||
    label.startsWith("Return To ")
  ) {
    return label;
  }

  return `Open ${label}`;
}
