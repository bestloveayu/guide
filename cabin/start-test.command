#!/bin/bash
cd "$(dirname "$0")"
(sleep 1; open http://localhost:3013/cabin/) &
node server/test-server.js
