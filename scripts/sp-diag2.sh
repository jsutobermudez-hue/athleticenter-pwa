#!/bin/bash
cd /home/jsutobermudez/app/whatsapp
echo "=== CABECERA DEL SCRIPT ==="; head -c 300 baileys-server.js; echo
echo "=== PUERTO 3001 ==="; ss -ltnp 2>/dev/null | grep 3001
echo "=== PROCESOS NODE ==="; ps aux | grep -E "baileys|whatsapp-server" | grep -v grep | awk '{print $2, $9, $11, $12, $13}'
echo "=== CURL VERBOSE ==="; curl -s -m 5 -o /dev/null -w "%{http_code}\n" localhost:3001/api/status
echo "=== LOG COMPLETO ULTIMOS 3 MIN ==="; pm2 logs whatsapp --lines 30 --nostream 2>&1 | tail -n 30
