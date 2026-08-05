#!/usr/bin/env bash
# Fetch actual Hostinger VPS live hardware metrics

VPS_IP="${1:-187.127.145.253}"

echo "Connecting to Hostinger VPS ($VPS_IP)..."
ssh root@"$VPS_IP" '
  echo "=== 🐧 HOSTINGER VPS REAL-TIME TELEMETRY ==="
  echo "1. SYSTEM UPTIME:"
  uptime
  echo ""
  echo "2. MEMORY USAGE (RAM):"
  free -h
  echo ""
  echo "3. DISK STORAGE:"
  df -h /
  echo ""
  echo "4. NETWORK TRAFFIC (/proc/net/dev):"
  cat /proc/net/dev | grep -E "eth0|enp|ens" || cat /proc/net/dev | head -n 6
  echo ""
  echo "5. TOP PROCESSES BY CPU:"
  ps aux --sort=-%cpu | head -n 6
'
