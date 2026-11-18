"""Hubs and drop points in Sabah, Malaysia (data only)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Hub:
    name: str
    lat: float
    lon: float


@dataclass(frozen=True)
class DropPoint:
    name: str
    lat: float
    lon: float
    hub: str
    water: bool = False  # river or coastal stilt village: the amphibious landing is on the water


HUBS: tuple[Hub, ...] = (
    Hub("Kota Kinabalu", 5.9804, 116.0735),
    Hub("Papar", 5.7346, 115.9302),
    Hub("Beaufort", 5.3473, 115.7455),
    Hub("Keningau", 5.3378, 116.1602),
    Hub("Kota Belud", 6.3510, 116.4305),
    Hub("Ranau", 5.9538, 116.6640),
)

# shortcut: coordinates are hand-placed to about 1 km, enough for a demo; snap them to a land-cover layer before
# using the fleet sim for anything that depends on the exact landing spot.
DROP_POINTS: tuple[DropPoint, ...] = (
    DropPoint("Tanjung Aru", 5.9400, 116.0500, "Kota Kinabalu"),
    DropPoint("Putatan", 5.8820, 116.0450, "Kota Kinabalu"),
    DropPoint("Penampang", 5.9150, 116.1000, "Kota Kinabalu"),
    DropPoint("Inanam", 6.0310, 116.1030, "Kota Kinabalu"),
    DropPoint("Menggatal", 6.0200, 116.1700, "Kota Kinabalu"),
    DropPoint("Kampung Kinarut", 5.8950, 116.0300, "Kota Kinabalu", water=True),
    DropPoint("Kampung Benoni", 5.6800, 115.9600, "Papar"),
    DropPoint("Limbahau", 5.7700, 116.0000, "Papar"),
    DropPoint("Kawang", 5.7400, 116.0300, "Papar"),
    DropPoint("Kampung Pengalat Besar", 5.7100, 115.9100, "Papar", water=True),
    DropPoint("Kampung Kelanahan", 5.7150, 115.9650, "Papar"),
    DropPoint("Kampung Langkuas", 5.6900, 115.9100, "Papar", water=True),
    DropPoint("Kampung Gadong", 5.4200, 115.7800, "Beaufort"),
    DropPoint("Lumadan", 5.2900, 115.8300, "Beaufort"),
    DropPoint("Kampung Padas Damit", 5.3100, 115.7200, "Beaufort", water=True),
    DropPoint("Weston", 5.2700, 115.6500, "Beaufort", water=True),
    DropPoint("Kampung Kebatu", 5.4500, 115.7300, "Beaufort"),
    DropPoint("Kampung Mawao", 5.3800, 115.8200, "Beaufort"),
    DropPoint("Bingkor", 5.2900, 116.2500, "Keningau"),
    DropPoint("Apin-Apin", 5.3300, 116.1000, "Keningau"),
    DropPoint("Kampung Liawan", 5.4000, 116.2000, "Keningau"),
    DropPoint("Tulid", 5.2800, 116.1600, "Keningau"),
    DropPoint("Pandewan", 5.4300, 116.2000, "Keningau"),
    DropPoint("Kampung Mamaitom", 5.3200, 116.0800, "Keningau"),
    DropPoint("Kampung Taun Gusi", 6.3300, 116.3500, "Kota Belud"),
    DropPoint("Kampung Pandasan", 6.3000, 116.4000, "Kota Belud"),
    DropPoint("Kampung Tempasuk", 6.4200, 116.3400, "Kota Belud", water=True),
    DropPoint("Kadamaian", 6.2800, 116.5300, "Kota Belud"),
    DropPoint("Kampung Taginambur", 6.3300, 116.4800, "Kota Belud"),
    DropPoint("Kampung Sembirai", 6.4000, 116.4200, "Kota Belud"),
    DropPoint("Kundasang", 6.0100, 116.5800, "Ranau"),
    DropPoint("Poring", 6.0400, 116.7000, "Ranau"),
    DropPoint("Kampung Nalapak", 5.9900, 116.6200, "Ranau"),
    DropPoint("Kampung Luanti", 5.9300, 116.7100, "Ranau"),
    DropPoint("Bundu Tuhan", 5.9900, 116.5700, "Ranau"),
    DropPoint("Kampung Marakau", 5.9100, 116.6100, "Ranau"),
)

DRONES_PER_HUB = 4
