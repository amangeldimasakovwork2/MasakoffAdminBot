// main.ts
// 🤖 Happ Seller Bot for VPN Subscriptions
// 📱 Provides VPN subscriptions for Happ app
// 💾 Uses Deno KV
// 🔔 Trial on /start
// ⚠️ Channel username bug FIXED (HTML parse mode)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// -------------------- Telegram Setup --------------------
const TOKEN = Deno.env.get("BOT_TOKEN");
if (!TOKEN) throw new Error("BOT_TOKEN not set");
const API = `https://api.telegram.org/bot${TOKEN}`;

// -------------------- Happ API --------------------
const HAPP_API_URL = "https://crypto.happ.su/api.php";

// -------------------- Deno KV --------------------
const kv = await Deno.openKv();

// -------------------- Constants --------------------
const PLAN = { traffic_gb: 100 };
const DEFAULT_MARZBAN_URL = "http://89.23.97.127:3286";
const DEFAULT_ADMIN_USER = "05";
const DEFAULT_ADMIN_PASS = "05";
const DEFAULT_CHANNELS = ["@HappService", "@MasakoffVpns"];

// -------------------- Utils --------------------
function escapeHTML(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// -------------------- Config --------------------
async function getConfig(key: string, def: string) {
  const v = await kv.get(["config", key]);
  if (!v.value) {
    await kv.set(["config", key], def);
    return def;
  }
  return v.value;
}

async function getChannels(): Promise<string[]> {
  const v = await kv.get(["channels"]);
  if (!v.value) {
    await kv.set(["channels"], DEFAULT_CHANNELS);
    return DEFAULT_CHANNELS;
  }
  return v.value;
}

// -------------------- Telegram API --------------------
async function sendMessage(
  chatId: string,
  text: string,
  parseMode: "Markdown" | "HTML" = "Markdown",
  replyMarkup: any = null,
) {
  const body: any = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return data.ok ? data.result : null;
}

async function answerCallbackQuery(id: string, text?: string) {
  await fetch(`${API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text }),
  });
}

// -------------------- Marzban --------------------
async function getMarzbanToken() {
  const url = await getConfig("marzban_url", DEFAULT_MARZBAN_URL);
  const user = await getConfig("admin_user", DEFAULT_ADMIN_USER);
  const pass = await getConfig("admin_pass", DEFAULT_ADMIN_PASS);

  const res = await fetch(`${url}/api/admin/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: user, password: pass }),
  });

  if (!res.ok) return null;
  return (await res.json()).access_token;
}

async function removeMarzbanUser(username: string) {
  const token = await getMarzbanToken();
  if (!token) return;

  const url = await getConfig("marzban_url", DEFAULT_MARZBAN_URL);
  await fetch(`${url}/api/user/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function createMarzbanUser(username: string) {
  const token = await getMarzbanToken();
  if (!token) return null;

  const url = await getConfig("marzban_url", DEFAULT_MARZBAN_URL);
  const payload = {
    username,
    data_limit: PLAN.traffic_gb * 1024 ** 3,
    status: "active",
    proxies: {
      shadowsocks: {
        method: "aes-256-gcm",
        password: `ss_${username}_${Date.now()}`,
      },
    },
    "profile-title": `base64:${encodeBase64(username)}`,
  };

  const res = await fetch(`${url}/api/user`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok && res.status !== 409) return null;

  const data = await res.json();
  return new URL(data.subscription_url, url).toString();
}

// -------------------- Happ --------------------
async function convertToHappCode(url: string) {
  const r = await fetch(HAPP_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const j = await r.json();
  return j.encrypted_link || url;
}

// -------------------- Webhook --------------------
serve(async (req) => {
  if (req.method !== "POST") return new Response("OK");

  const update = await req.json();
  const msg = update.message;
  if (!msg) return new Response("OK");

  const chatId = String(msg.chat.id);
  const isPrivate = msg.chat.type === "private";

  if (msg.text !== "/start") return new Response("OK");

  if (isPrivate) {
    await sendMessage(chatId, "⏳ Creating subscription...");
  }

  const username = "Kanallar";
  await removeMarzbanUser(username);

  const subUrl = await createMarzbanUser(username);
  if (!subUrl) {
    await sendMessage(chatId, "❌ Error");
    return new Response("OK");
  }

  const happCode = await convertToHappCode(subUrl);

  if (isPrivate) {
    await sendMessage(
      chatId,
      `✅ Subscription ready\n\n<pre>${escapeHTML(happCode)}</pre>`,
      "HTML",
    );
  }

  // -------- SEND TO CHANNELS (FIXED) --------
  const channels = await getChannels();
  for (const channel of channels) {
    const message = `
<pre>${escapeHTML(happCode)}</pre>

<b>😎 Happ VPN</b>
<b>💻 Device:</b> Android 📱 | iOS 🌟
<b>☄️ Ping:</b> 100–300 ms

<pre>Спасибо ❤️
Поделитесь кодом с друзьями 👑</pre>

<b>✈️ ${escapeHTML(channel)}</b>
`;
    await sendMessage(channel, message, "HTML");
  }

  return new Response("OK");
});
