export type TcosMarketplaceChannelId =
  | "website"
  | "ebay"
  | "whatnot"
  | "comc"
  | "fanatics_collect"
  | "collx"
  | "facebook";

export type TcosMarketplaceChannel = {
  id: TcosMarketplaceChannelId;
  label: string;
  shortLabel: string;
  description: string;
  enabled: boolean;
  phase: "live" | "connector_slot";
};

export const TCOS_MARKETPLACE_CHANNELS: TcosMarketplaceChannel[] = [
  {
    id: "website",
    label: "Truely Collectables",
    shortLabel: "Website",
    description: "Publish to the Truely Collectables storefront.",
    enabled: true,
    phase: "live",
  },
  {
    id: "ebay",
    label: "eBay",
    shortLabel: "eBay",
    description: "Publish the same TCOS inventory item to eBay.",
    enabled: true,
    phase: "live",
  },
  {
    id: "whatnot",
    label: "Whatnot",
    shortLabel: "Whatnot",
    description: "Reserved TCOS connector slot.",
    enabled: false,
    phase: "connector_slot",
  },
  {
    id: "comc",
    label: "COMC",
    shortLabel: "COMC",
    description: "Reserved TCOS connector slot.",
    enabled: false,
    phase: "connector_slot",
  },
  {
    id: "fanatics_collect",
    label: "Fanatics Collect",
    shortLabel: "Fanatics",
    description: "Reserved TCOS connector slot.",
    enabled: false,
    phase: "connector_slot",
  },
  {
    id: "collx",
    label: "CollX",
    shortLabel: "CollX",
    description: "Reserved TCOS connector slot.",
    enabled: false,
    phase: "connector_slot",
  },
  {
    id: "facebook",
    label: "Facebook Marketplace",
    shortLabel: "Facebook",
    description: "Reserved TCOS connector slot.",
    enabled: false,
    phase: "connector_slot",
  },
];
