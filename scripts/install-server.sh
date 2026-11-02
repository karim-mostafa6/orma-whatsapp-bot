#!/usr/bin/env bash
# =============================================================================
#  تسطيب بوت ORMA على سيرفر Ubuntu (مثلاً Oracle Cloud Always Free)
#
#  الاستخدام (كـ root):
#    curl -fsSL https://raw.githubusercontent.com/karim-mostafa6/orma-whatsapp-bot/main/scripts/install-server.sh | ADMIN_PASSWORD='باسورد قوي' bash
#
#  المتغيرات (كلها اختيارية):
#    ADMIN_PASSWORD  باسورد صفحة التحكم (لو مش موجود بيتعمل واحد عشوائي)
#    DOMAIN          دومين بتاعك (مثلاً bot.orma.com). لو مش موجود: <IP>.sslip.io
#    ORMA_BRANCH     البرانش (افتراضي main)
#
#  الأمر ده ممكن يتعاد أكتر من مرة بأمان: بيحدّث الكود ويسيب البيانات والجلسة والباسورد زي ما هم.
# =============================================================================
set -euo pipefail

REPO_URL="https://github.com/karim-mostafa6/orma-whatsapp-bot.git"
BRANCH="${ORMA_BRANCH:-main}"
APP_DIR="/opt/orma-bot"
APP_USER="orma"
PORT=3000

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mXX  %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "شغّل الأمر ده كـ root (حط sudo قبله)."
command -v apt-get >/dev/null || die "السكريبت ده معمول لـ Ubuntu/Debian بس."
export DEBIAN_FRONTEND=noninteractive
export HOME="${HOME:-/root}" # أول تشغيل للسيرفر (cloud-init) ممكن ما يبقاش فيه HOME
# أول ما السيرفر يقوم، Ubuntu بيعمل تحديثات أوتوماتيك وبيقفل apt — نستنى لحد 10 دقايق بدل ما نفشل
APT=(apt-get -o DPkg::Lock::Timeout=600 -y -q)

# ---------------------------------------------------------------------------
log "1/8 تحديث النظام وتسطيب الأدوات الأساسية"
"${APT[@]}" update
"${APT[@]}" install curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https openssl iptables

# ---------------------------------------------------------------------------
# السيرفرات الصغيرة (1 جيجا رام) محتاجة swap عشان تبني صفحة التحكم من غير ما تقع
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$mem_kb" -lt 2000000 ] && ! swapon --show | grep -q .; then
  log "2/8 الرامات قليلة ($((mem_kb / 1024)) ميجا) — بنعمل swap 2 جيجا"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
else
  log "2/8 الرامات كفاية"
fi

# ---------------------------------------------------------------------------
log "3/8 تسطيب Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  "${APT[@]}" install nodejs
fi
node -v
NODE_BIN=$(readlink -f "$(command -v node)") # المسار الحقيقي (مش دايماً /usr/bin/node)

# ---------------------------------------------------------------------------
log "4/8 تسطيب Caddy (HTTPS تلقائي)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  "${APT[@]}" update
  "${APT[@]}" install caddy
fi
caddy version

# ---------------------------------------------------------------------------
log "5/8 تنزيل البوت في $APP_DIR"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  git config --global --add safe.directory "$APP_DIR"
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  mkdir -p "$APP_DIR"
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR.tmp"
  shopt -s dotglob
  mv "$APP_DIR.tmp"/* "$APP_DIR"/
  rmdir "$APP_DIR.tmp"
fi
mkdir -p "$APP_DIR/data" "$APP_DIR/auth" "$APP_DIR/.npm-cache"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "     تسطيب المكتبات وبناء صفحة التحكم (ممكن ياخد كام دقيقة)"
sudo -u "$APP_USER" env HOME="$APP_DIR" npm_config_cache="$APP_DIR/.npm-cache" bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent"

# ---------------------------------------------------------------------------
log "6/8 الإعدادات (.env)"
ENV_FILE="$APP_DIR/.env"
touch "$ENV_FILE"
get_env() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
set_env() {
  if grep -qE "^$1=" "$ENV_FILE"; then
    local tmp; tmp=$(mktemp)
    grep -vE "^$1=" "$ENV_FILE" >"$tmp"; cat "$tmp" >"$ENV_FILE"; rm -f "$tmp"
  fi
  printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE"
}

if [ -n "${DOMAIN:-}" ]; then
  HOST="$DOMAIN"
elif [ -n "$(get_env PUBLIC_HOST)" ]; then
  HOST="$(get_env PUBLIC_HOST)"
else
  IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || curl -fsS4 --max-time 10 https://ifconfig.me || true)
  [ -n "$IP" ] || die "ما قدرتش أعرف الـ IP بتاع السيرفر. شغّل الأمر تاني ومعاه DOMAIN=..."
  HOST="${IP//./-}.sslip.io"
fi
HOST=$(echo "$HOST" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*$##')

PASSWORD="${ADMIN_PASSWORD:-$(get_env ADMIN_PASSWORD)}"
NEW_PASSWORD=0
if [ -z "$PASSWORD" ]; then
  PASSWORD=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 14)
  NEW_PASSWORD=1
fi
[ "${#PASSWORD}" -ge 8 ] || die "الباسورد لازم يكون 8 حروف على الأقل."

set_env PUBLIC_HOST "$HOST"
set_env ADMIN_PASSWORD "$PASSWORD"
set_env BIND_HOST 127.0.0.1
set_env DASHBOARD_PORT "$PORT"
set_env OPEN_BROWSER false
set_env TRUST_PROXY true
set_env SELF_UPDATE true
set_env UPDATE_BRANCH "$BRANCH"
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ---------------------------------------------------------------------------
log "7/8 تشغيل البوت كخدمة (بيقوم لوحده لو وقع أو السيرفر عمل restart)"
cat >/etc/systemd/system/orma-bot.service <<EOF
[Unit]
Description=ORMA WhatsApp customer-service bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PATH=$(dirname "$NODE_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=HOME=$APP_DIR
Environment=npm_config_cache=$APP_DIR/.npm-cache
ExecStart=$NODE_BIN src/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/caddy/Caddyfile <<EOF
# بيتعمل تلقائي من scripts/install-server.sh
$HOST {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF

systemctl daemon-reload
systemctl enable -q orma-bot caddy
systemctl restart orma-bot
systemctl restart caddy

# ---------------------------------------------------------------------------
log "8/8 فتح البورتات 80 و 443 في الـ firewall بتاع السيرفر"
# صور Ubuntu بتاعة Oracle فيها قاعدة REJECT في iptables بتقفل كل حاجة غير SSH
for p in 443 80; do
  if ! iptables -C INPUT -p tcp --dport "$p" -m state --state NEW -j ACCEPT 2>/dev/null; then
    pos=$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT" {print $1; exit}')
    if [ -n "$pos" ]; then
      iptables -I INPUT "$pos" -p tcp --dport "$p" -m state --state NEW -j ACCEPT
    fi
  fi
done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi

# ---------------------------------------------------------------------------
sleep 3
systemctl is-active -q orma-bot || { journalctl -u orma-bot -n 40 --no-pager; die "البوت ما اشتغلش. ابعت الكلام اللي فوق ده."; }

INFO_FILE=/root/orma-bot-login.txt
{
  echo "لينك صفحة التحكم: https://$HOST"
  echo "الباسورد: $PASSWORD"
} >"$INFO_FILE"
chmod 600 "$INFO_FILE"

cat <<EOF

=====================================================================
  ✅  البوت اتسطّب وشغال!

  افتح صفحة التحكم:   https://$HOST
  الباسورد:           $( [ "$NEW_PASSWORD" = 1 ] && echo "$PASSWORD  (اتعمل عشوائي — احفظه!)" || echo "اللي إنت اخترته" )

  • أول مرة الـ HTTPS ممكن ياخد دقيقة أو اتنين.
  • لو الصفحة ما فتحتش: اتأكد إنك فتحت البورتات 80 و 443
    في Oracle (Security List ← Ingress Rules).
  • اللينك والباسورد متسجلين كمان في: $INFO_FILE

  أوامر مفيدة:
    حالة البوت:   systemctl status orma-bot
    اللوج:        journalctl -u orma-bot -f
    تحديث:        نفس أمر التسطيب تاني، أو زرار «تحديث» في صفحة الإعدادات
=====================================================================
EOF
