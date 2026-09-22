#!/usr/bin/env bash
# Fails if anything that looks like a real credential is committed.
# Patterns match *literal* values only — code that builds a URL from a
# template (tapo://admin:${hash}@${host}) is not a secret.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
flag() { printf '::error file=%s::%s\n' "${1%%:*}" "$2"; printf '  %s\n' "$1"; fail=1; }

scan() { # name, regex
  while IFS= read -r hit; do flag "$hit" "$1"; done < <(
    grep -rInE "$2" . \
      --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
      --exclude-dir=.github --exclude='*.lock' --exclude='package-lock.json' 2>/dev/null
  )
}

# literal camera / service credentials in a URL (username:secret@host)
scan "Literal credentials in a URL"            '(tapo|rtsp|rtsps|http|https)://[A-Za-z0-9_.-]+:[A-Za-z0-9_.+/=-]{8,}@'
# provider key formats
scan "Scryer API key"                          'ska[_-][A-Za-z0-9]{20,}'
scan "GitHub token"                            'gh[pousr]_[A-Za-z0-9]{30,}'
scan "Plex token"                              'X-Plex-Token=[A-Za-z0-9_-]{15,}'
scan "Tailscale key"                           'tskey-[a-z]+-[A-Za-z0-9-]{10,}'
scan "Private key block"                       'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
# a bare 64-char hex string is almost certainly a hashed password / secret
scan "Possible secret hash"                    '\b[A-F0-9]{64}\b'

if [ -f .env ]; then flag ".env" ".env must not be committed"; fi
if git ls-files --error-unmatch data/config.json >/dev/null 2>&1; then flag "data/config.json" "dashboard config holds API keys"; fi

[ $fail -eq 0 ] && echo "No secrets found."
exit $fail
