#!/usr/bin/env bash
# Starts only Pulso's existing review server. Does not publish or rotate any port/link.
set -euo pipefail
pulso_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if systemctl --user is-active --quiet pulso-web-iphone-review.service; then
  printf '%s\n' 'Pulso review server already active.'
  exit 0
fi
if systemctl --user cat pulso-web-iphone-review.service >/dev/null 2>&1; then
  systemctl --user restart pulso-web-iphone-review.service
else
  systemd-run --user --unit=pulso-web-iphone-review \
    --property=Restart=on-failure --property=RestartSec=2 \
    --property="WorkingDirectory=$pulso_root" \
    /usr/bin/python3 "$pulso_root/scripts/serve_review.py" --catalog-relay
fi
