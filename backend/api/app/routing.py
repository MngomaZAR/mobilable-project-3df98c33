from typing import Annotated
import math

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from .config import Settings, get_settings


router = APIRouter(tags=["routing"])


@router.get("/routing/route")
async def road_route(settings: Annotated[Settings, Depends(get_settings)],
                     start_lat: float = Query(ge=-35, le=-22), start_lng: float = Query(ge=16, le=33),
                     end_lat: float = Query(ge=-35, le=-22), end_lng: float = Query(ge=16, le=33)):
    if not (-35 <= start_lat <= -22 and -35 <= end_lat <= -22 and 16 <= start_lng <= 33 and 16 <= end_lng <= 33):
        raise HTTPException(status_code=422, detail='Road navigation is available only within the South Africa service region.')
    if not settings.osrm_base_url:
        raise HTTPException(status_code=503, detail="Road routing is not yet configured. No navigation estimate is available.")
    url = f"{settings.osrm_base_url.rstrip('/')}/route/v1/driving/{start_lng},{start_lat};{end_lng},{end_lat}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(url, params={"overview": "full", "geometries": "geojson", "steps": "true", "radiuses": "1000;1000"})
        response.raise_for_status()
        body = response.json()
        route = body.get("routes", [])[0] if body.get("routes") else None
        if body.get("code") != "Ok" or not route or len(route.get("geometry", {}).get("coordinates", [])) < 2:
            raise HTTPException(status_code=404, detail="No drivable route was found for these locations.")
        waypoints = body.get('waypoints', [])
        if len(waypoints) != 2 or any(not math.isfinite(float(point['distance'])) or not 0 <= float(point['distance']) <= 1000 for point in waypoints):
            raise HTTPException(status_code=404, detail='No road was found within 1 km of both selected locations.')
        coordinates = route['geometry']['coordinates']
        if any(len(point) != 2 or not all(math.isfinite(float(value)) for value in point)
               or not -35 <= float(point[1]) <= -22 or not 16 <= float(point[0]) <= 33 for point in coordinates):
            raise ValueError('Invalid road geometry')
        if not all(math.isfinite(float(route[key])) and float(route[key]) >= 0 for key in ('distance', 'duration')):
            raise ValueError('Invalid road estimate')
        return {"coordinates": route["geometry"]["coordinates"], "distance": route["distance"] / 1000,
                "duration": route["duration"], "legs": route.get("legs", []), "source": "osrm"}
    except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError, IndexError) as error:
        raise HTTPException(status_code=503, detail="Road routing is temporarily unavailable.") from error
