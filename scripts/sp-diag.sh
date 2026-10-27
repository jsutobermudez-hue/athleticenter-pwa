#!/bin/bash
# Diagnóstico del gateway WhatsApp en São Paulo
cd /home/jsutobermudez/app/whatsapp
echo "=== PM2 ==="
pm2 describe whatsapp 2>/dev/null | grep -E "status|script path|restarts|uptime" | head -6
echo "=== OUT (últimas 12) ==="
tail -n 12 ~/.pm2/logs/whatsapp-out.log
echo "=== ERR (últimas 8) ==="
tail -n 8 ~/.pm2/logs/whatsapp-error.log
echo "=== STATUS ==="
curl -s -m 5 localhost:3001/api/status; echo
echo "=== DISCO ==="
df -h / | tail -1
