# Fetch actual Hostinger VPS live performance metrics
Param (
    [string]$VpsIp = "187.127.145.253"
)

Write-Host "Connecting to Hostinger VPS ($VpsIp)..." -ForegroundColor Cyan

ssh root@$VpsIp "
echo '=== 🐧 HOSTINGER VPS REAL-TIME TELEMETRY ==='
echo '1. SYSTEM UPTIME:'
uptime
echo ''
echo '2. MEMORY USAGE (RAM):'
free -h
echo ''
echo '3. DISK STORAGE:'
df -h /
echo ''
echo '4. NETWORK TRAFFIC:'
cat /proc/net/dev | grep -E 'eth0|enp|ens' || cat /proc/net/dev | head -n 6
echo ''
echo '5. TOP PROCESSES BY CPU:'
ps aux --sort=-%cpu | head -n 6
"
