from __future__ import annotations

from app.deal_hunter import normalize_candidate
from app.deal_hunter_runtime_guard import (
    is_real_signed_baseball_candidate,
    preferred_distinct_images,
)


def test_stale_feed_images_are_upgraded_and_resized_duplicates_removed():
    images = preferred_distinct_images(
        [
            "https://i.ebayimg.com/images/g/AAA/s-l225.jpg",
            "https://i.ebayimg.com/images/g/AAA/s-l1600.jpg",
            "https://i.ebayimg.com/images/g/BBB/s-l300.jpg",
        ]
    )
    assert images == [
        "https://i.ebayimg.com/images/g/AAA/s-l1600.jpg",
        "https://i.ebayimg.com/images/g/BBB/s-l1600.jpg",
    ]


def test_installed_normalizer_protects_mac_from_stale_feed_ordering():
    normalized = normalize_candidate(
        {
            "listingItemId": "123",
            "listingUrl": "https://www.ebay.com/itm/123",
            "title": "Test card",
            "imageUrls": [
                "https://i.ebayimg.com/images/g/AAA/s-l225.jpg",
                "https://i.ebayimg.com/images/g/AAA/s-l1600.jpg",
                "https://i.ebayimg.com/images/g/BBB/s-l225.jpg",
            ],
        }
    )
    assert normalized["image_urls"] == [
        "https://i.ebayimg.com/images/g/AAA/s-l1600.jpg",
        "https://i.ebayimg.com/images/g/BBB/s-l1600.jpg",
    ]


def test_signed_baseball_lane_rejects_signed_bowman_card():
    assert not is_real_signed_baseball_candidate(
        {
            "lane": "signed_prospect_baseball",
            "title": "2025 Bowman Chrome Brandon Compton 1st Bowman Auto Card",
        }
    )


def test_signed_baseball_lane_keeps_real_signed_ball():
    assert is_real_signed_baseball_candidate(
        {
            "lane": "signed_prospect_baseball_mislist_rescue",
            "title": "Brandon Compton Signed Official MLB Baseball JSA COA",
        }
    )


def test_installed_normalizer_drops_card_from_signed_ball_lane():
    normalized = normalize_candidate(
        {
            "listingItemId": "456",
            "listingUrl": "https://www.ebay.com/itm/456",
            "title": "Brandon Compton Bowman Chrome Autograph Card",
            "lane": "signed_prospect_baseball",
            "imageUrls": ["https://i.ebayimg.com/images/g/CCC/s-l225.jpg"],
        }
    )
    assert normalized["listing_url"] == ""
    assert "signed_baseball_lane_non_ball_rejected" in normalized["preliminary_risks"]
