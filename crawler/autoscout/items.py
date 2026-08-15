from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Self


def parse_iso_datetime(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


@dataclass
class SellerItem:
    id: str
    type: str
    name: str
    address: str | None
    zip_code: str | None
    city: str | None

    def __repr__(self) -> str:
        return repr({'id': self.id, 'name': self.name})

    @classmethod
    def from_listing(cls, json_response: dict[str, Any]) -> Self:
        return cls(
            id=str(json_response['id']),
            type=json_response['type'],
            name=json_response['name'] or 'Unknown seller',
            address=json_response['address'],
            zip_code=json_response['zipCode'],
            city=json_response['city'])


@dataclass
class CarItem:
    search_id: int
    url: str
    json_data: dict[str, Any]

    title: str
    subtitle: str | None
    description: str | None

    vehicle_id: str
    seller_vehicle_id: str | None
    certification_number: str | None

    price: int | None
    body_type: str | None
    color: str | None
    mileage: int | None
    has_additional_set_of_tires: bool | None
    had_accident: bool | None

    fuel_type: str | None
    kilo_watts: int | None
    cm3: int | None
    cylinders: int | None
    cylinder_layout: str | None
    avg_consumption: float | None
    co2_emission: int | None

    warranty: bool
    leasing: bool

    created_date: datetime | None
    last_modified_date: datetime | None
    first_registration_date: datetime | None
    last_inspection_date: datetime | None

    seller_id: str
    screenshot: bytes | None = field(default=None, repr=False)
    screenshot_id: int | None = None
    search_run_id: int | None = None
    image_keys: list[str] = field(default_factory=list)
    photo_refs: list[tuple[int, int]] = field(default_factory=list)

    def __repr__(self) -> str:
        return repr({'vehicle_id': self.vehicle_id, 'title': self.title})

    @classmethod
    def from_listing(cls, search_id: int, url: str, screenshot: bytes | None, json_response: dict[str, Any]) -> Self:
        listing = json_response['listing']
        return cls(
            search_id=search_id,
            url=url,
            json_data=json_response,
            title=json_response['pageViewTracking']['listing_typename'],
            subtitle=listing['teaser'],
            description=listing['description'],
            vehicle_id=str(listing['id']),
            seller_vehicle_id=listing['sellerVehicleId'],
            certification_number=listing['certificationNumber'],
            price=listing['price'],
            body_type=listing['bodyType'],
            color=listing['bodyColor'],
            mileage=listing['mileage'],
            has_additional_set_of_tires=listing['hasAdditionalSetOfTires'],
            had_accident=listing['hadAccident'],
            fuel_type=listing['fuelType'],
            kilo_watts=listing['kiloWatts'],
            cm3=listing['cubicCapacity'],
            cylinders=listing['cylinders'],
            cylinder_layout=listing['cylinderArrangement'],
            avg_consumption=listing['consumption']['combined'],
            co2_emission=listing['co2Emission'],
            warranty=listing['warranty']['type'] != 'none',
            leasing=listing['leasing'] is not None,
            created_date=parse_iso_datetime(listing['createdDate']),
            last_modified_date=parse_iso_datetime(listing['lastModifiedDate']),
            first_registration_date=parse_iso_datetime(listing['firstRegistrationDate']),
            last_inspection_date=parse_iso_datetime(listing['lastInspectionDate']),
            seller_id=str(json_response['seller']['id']),
            screenshot=screenshot,
            image_keys=[img['key'] for img in listing.get('images', []) if 'key' in img])
