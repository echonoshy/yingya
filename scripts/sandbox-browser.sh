#!/bin/sh
# Chromium does not inherit HTTP_PROXY; route browser egress through the same user gateway.
exec "$YINGYA_BROWSER_BINARY" --proxy-server=http://127.0.0.1:18888 '--proxy-bypass-list=localhost;127.0.0.1' "$@"
