#!/usr/bin/env bash
# Run on Oracle through SSH; only this fixture's loopback port is published.
set +x
set -euo pipefail
umask 077

image='livekit/livekit-server:v1.13.7@sha256:6fd3b7088874c4d119160dd688798dfec852bc014786d392caad15f6f63912a3'
digest=${image##*@}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
protocol=$(realpath -e -- "${1:-$script_dir/../backend/api/tests/livekit_protocol.py}")
test -s "$protocol"
command -v python3 >/dev/null
command -v openssl >/dev/null
if docker info >/dev/null 2>&1; then
    docker=(docker)
else
    sudo -n docker info >/dev/null
    docker=(sudo -n docker)
fi

root_uid=$(id -u)
temp_parent=$(realpath -e -- "${HOME:?}")
[[ "$(stat -c %u -- "$temp_parent")" == "$root_uid" ]]
root=$(mktemp -d "$temp_parent/papzii-livekit-qa.XXXXXXXX")
run_id=${root##*.}
run_id=${run_id,,}
container="papzii-livekit-control-qa-$run_id"

cleanup() {
    status=$?
    set +e
    trap - EXIT INT TERM HUP
    docker_available=1
    if ! "${docker[@]}" info >/dev/null 2>&1; then
        docker_available=0
        printf '%s\n' 'Docker is unavailable; container removal cannot be confirmed.' >&2
        status=1
    elif "${docker[@]}" container inspect "$container" >/dev/null 2>&1; then
        owner=$("${docker[@]}" container inspect "$container" --format '{{index .Config.Labels "papzii.qa.livekit.run"}}')
        if [[ "$owner" == "$run_id" ]]; then
            "${docker[@]}" container rm -f "$container" >/dev/null || status=1
        else
            printf '%s\n' 'Refusing to remove a container not owned by this fixture.' >&2
            status=1
        fi
    fi
    if [[ "${root%/*}" == "$temp_parent" && "${root##*/}" =~ ^papzii-livekit-qa\.[[:alnum:]]{8}$ && ! -L "$root" &&
          "$(realpath -- "$root")" == "$root" && "$(stat -c %u -- "$root")" == "$root_uid" ]]; then
        rm -rf -- "$root"
    else
        printf '%s\n' 'Refusing cleanup outside the exact owned temporary directory.' >&2
        status=1
    fi
    if [[ "$docker_available" != 1 ]] || "${docker[@]}" container inspect "$container" >/dev/null 2>&1 || [[ -e "$root" ]]; then
        printf '%s\n' 'Fixture cleanup verification failed.' >&2
        status=1
    else
        printf '%s\n' 'Owned LiveKit QA container and temporary files removed; application services were not changed.'
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if ! "${docker[@]}" image inspect "$image" >/dev/null 2>&1; then
    "${docker[@]}" pull --quiet "$image"
fi
resolved=$("${docker[@]}" image inspect "$image" --format '{{index .RepoDigests 0}}')
[[ "${resolved##*@}" == "$digest" ]]
if "${docker[@]}" container inspect "$container" >/dev/null 2>&1; then
    printf '%s\n' 'Unique fixture container name already exists; refusing reuse.' >&2
    exit 1
fi

api_key="qa-$run_id-$(openssl rand -hex 12)"
api_secret=$(openssl rand -hex 32)
printf 'port: 7880\nbind_addresses: ["0.0.0.0"]\nrtc:\n  node_ip: 127.0.0.1\n  use_external_ip: false\n  tcp_port: 7881\n  udp_port: 7882\nkeys:\n  "%s": "%s"\n' "$api_key" "$api_secret" > "$root/livekit.yaml"
chmod 600 "$root/livekit.yaml"
[[ "$(stat -c %a -- "$root/livekit.yaml")" == '600' ]]
"${docker[@]}" run -d --name "$container" --label "papzii.qa.livekit.run=$run_id" \
    --restart=no --read-only --security-opt no-new-privileges --cap-drop ALL \
    --user "$(id -u):$(id -g)" --cpus=0.5 --memory=256m --pids-limit=128 \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --publish 127.0.0.1::7880/tcp \
    --volume "$root/livekit.yaml:/etc/livekit.yaml:ro,Z" \
    "$image" --config /etc/livekit.yaml >/dev/null
binding=$("${docker[@]}" port "$container" 7880/tcp)
[[ "$binding" =~ ^127\.0\.0\.1:([0-9]+)$ ]]
version=$("${docker[@]}" exec "$container" /livekit-server --version)
[[ "$version" =~ 1\.13\.7($|[[:space:]]) ]]
printf 'Isolated LiveKit %s, pinned %s, loopback API %s; no RTC ports published.\n' '1.13.7' "$digest" "$binding"

python3 -m venv "$root/venv"
"$root/venv/bin/python" -m pip --isolated --disable-pip-version-check install --quiet \
    --index-url https://pypi.org/simple 'livekit-api==1.2.1'
export QA_LIVEKIT_ISOLATED=1 QA_LIVEKIT_RUN_ID="$run_id" QA_LIVEKIT_URL="http://$binding"
export QA_LIVEKIT_API_KEY="$api_key" QA_LIVEKIT_API_SECRET="$api_secret"
export QA_LIVEKIT_IMAGE_DIGEST="$digest" QA_LIVEKIT_SERVER_VERSION=1.13.7
"$root/venv/bin/python" "$protocol"
