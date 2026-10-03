#!/usr/bin/env bash
set -euo pipefail
umask 077

# Use the existing separate Oracle data filesystem, not the nearly full root disk.
data=/var/oled/papzii-routing/south-africa
test "$(curl -fsS -H 'Authorization: Bearer Oracle' http://169.254.169.254/opc/v2/instance/ | python3 -c 'import sys,json; print(json.load(sys.stdin)["compartmentId"])')" = 'ocid1.tenancy.oc1..aaaaaaaabs56xuwbrgbc6almcvkshzkmb4arpw5rytwglbumfobw3bjsbuba'
test "$(df --output=avail -k /var/oled | tail -1)" -gt 12000000 || { echo 'At least 12 GB free data space is required'; exit 1; }
mkdir -p "$data"
image=ghcr.io/project-osrm/osrm-backend:v6.0.0
docker pull "$image"
digest=$(docker image inspect "$image" --format '{{index .RepoDigests 0}}')
printf '%s\n' "$digest" > "$data/image-digest.txt"
if [ ! -f "$data/south-africa.osm.pbf" ]; then
    curl -fSL --retry 3 https://download.geofabrik.de/africa/south-africa-latest.osm.pbf -o "$data/south-africa.osm.pbf.part"
    curl -fSL --retry 3 https://download.geofabrik.de/africa/south-africa-latest.osm.pbf.md5 -o "$data/source.md5"
    expected=$(awk '{print $1}' "$data/source.md5")
    actual=$(md5sum "$data/south-africa.osm.pbf.part" | awk '{print $1}')
    test "$expected" = "$actual" || { echo 'Map extract checksum failed'; exit 1; }
    mv "$data/south-africa.osm.pbf.part" "$data/south-africa.osm.pbf"
fi
if [ ! -f "$data/preprocessed.ok" ]; then
    docker run --rm --memory=7g --memory-swap=9g --cpus=1.5 -v "$data:/data" "$digest" osrm-extract --threads 2 -p /opt/car.lua /data/south-africa.osm.pbf
    docker run --rm --memory=7g --memory-swap=9g --cpus=1.5 -v "$data:/data" "$digest" osrm-partition --threads 2 /data/south-africa.osrm
    docker run --rm --memory=7g --memory-swap=9g --cpus=1.5 -v "$data:/data" "$digest" osrm-customize --threads 2 /data/south-africa.osrm
    date -u +%FT%TZ > "$data/preprocessed.ok"
fi
if ! docker container inspect papzii-osrm >/dev/null 2>&1; then
    docker run -d --name papzii-osrm --restart unless-stopped --network papzii_default --memory=3g --cpus=1 \
        -v "$data:/data:ro" "$digest" osrm-routed --algorithm mld --threads 2 --max-table-size 100 /data/south-africa.osrm
fi
echo 'Routing server started privately on http://papzii-osrm:5000; validate API gateway routes before release.'
