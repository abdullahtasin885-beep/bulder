/**
 * 𝐀𝐔𝐑𝐀 𝐋𝐄𝐀𝐕𝐄 𝐁𝐀𝐍 (@AuraLeaveBanBot)
 * Telegram Channel Leave -> Auto Ban Bot (বাংলা সংস্করণ)
 * Deployable on Render with Node.js & Firebase Realtime Database
 */

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { initializeApp } = require('firebase/app');
const {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove
} = require('firebase/database');

// ==========================================
// কনফিগারেশন এবং কনস্ট্যান্ট
// ==========================================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('[FATAL] BOT_TOKEN environment variable is missing.');
  process.exit(1);
}

const MAIN_ADMIN_ID = 8045367594;
const PORT = parseInt(process.env.PORT, 10) || 3000;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ফায়ারবেস ক্লায়েন্ট কনফিগারেশন
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyBq8MGSAiYUmgRYzg0APJlzbwuVnp-y66U",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "bkas-45e17.firebaseapp.com",
  databaseURL: process.env.FIREBASE_DATABASE_URL || "https://bkas-45e17-default-rtdb.firebaseio.com/",
  projectId: process.env.FIREBASE_PROJECT_ID || "bkas-45e17",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "bkas-45e17.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "719898964458",
  appId: process.env.FIREBASE_APP_ID || "1:719898964458:web:c859177fc305ed0fbd0293",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-E971R1F9K9"
};

// ফায়ারবেস ইনিশিয়ালাইজেশন
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
console.log('[INFO] Firebase Realtime Database সংযুক্ত হয়েছে।');

// ইউজার স্টেট মেশিন
const userStates = new Map();
let BOT_USER_ID = null;

// ==========================================
// টেলিগ্রাম এপিআই হেল্পার ফাংশনসমূহ
// ==========================================
async function callTelegram(method, payload = {}) {
  const url = `${TELEGRAM_API_URL}/${method}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!data.ok) {
      if (data.error_code === 429) {
        const retryAfter = (data.parameters && data.parameters.retry_after) || 1;
        console.warn(`[WARN] 429 Rate limit. Waiting ${retryAfter}s on ${method}...`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return callTelegram(method, payload);
      }
      console.warn(`[WARN] Telegram API error (${method}): ${data.description}`);
    }
    return data;
  } catch (err) {
    console.error(`[ERROR] Telegram API network error (${method}): ${err.message}`);
    return { ok: false, description: err.message };
  }
}

async function sendMessage(chatId, text, options = {}) {
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text: text,
    parse_mode: options.parse_mode !== undefined ? options.parse_mode : 'HTML',
    reply_markup: options.reply_markup || undefined,
    disable_web_page_preview: true
  });
}

async function editMessage(chatId, messageId, text, options = {}) {
  return callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: options.parse_mode !== undefined ? options.parse_mode : 'HTML',
    reply_markup: options.reply_markup || undefined,
    disable_web_page_preview: true
  });
}

async function answerCallbackQuery(callbackQueryId, text = null, showAlert = false) {
  const payload = { callback_query_id: callbackQueryId };
  if (text) {
    payload.text = text;
    payload.show_alert = showAlert;
  }
  return callTelegram('answerCallbackQuery', payload);
}

async function getChat(chatId) {
  const res = await callTelegram('getChat', { chat_id: chatId });
  return res.ok ? res.result : null;
}

async function getChatMember(chatId, userId) {
  const res = await callTelegram('getChatMember', {
    chat_id: chatId,
    user_id: userId
  });
  return res.ok ? res.result : null;
}

async function banChatMember(chatId, userId) {
  return callTelegram('banChatMember', {
    chat_id: chatId,
    user_id: userId
  });
}

async function unbanChatMember(chatId, userId) {
  return callTelegram('unbanChatMember', {
    chat_id: chatId,
    user_id: userId,
    only_if_banned: true
  });
}

async function copyMessage(chatId, fromChatId, messageId) {
  return callTelegram('copyMessage', {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId
  });
}

// ==========================================
// ডাটাবেস অপারেশনসমূহ
// ==========================================
async function saveUser(from) {
  if (!from || !from.id) return;
  const userId = String(from.id);
  const userRef = ref(db, `users/${userId}`);

  try {
    const snap = await get(userRef);
    const now = Date.now();
    if (!snap.exists()) {
      await update(userRef, {
        id: from.id,
        firstName: from.first_name || '',
        lastName: from.last_name || '',
        username: from.username ? `@${from.username}` : '',
        languageCode: from.language_code || 'bn',
        createdAt: now,
        lastActiveAt: now
      });
    } else {
      await update(userRef, {
        firstName: from.first_name || '',
        lastName: from.last_name || '',
        username: from.username ? `@${from.username}` : '',
        lastActiveAt: now
      });
    }
  } catch (err) {
    console.error(`[ERROR] DB saveUser error: ${err.message}`);
  }
}

async function getChannel(channelId) {
  try {
    const snap = await get(ref(db, `channels/${channelId}`));
    return snap.exists() ? snap.val() : null;
  } catch (err) {
    console.error(`[ERROR] DB getChannel error: ${err.message}`);
    return null;
  }
}

async function registerChannel(channelData) {
  const { channelId, ownerId, title, username, botStatus, protectionEnabled } = channelData;
  const now = Date.now();

  const updates = {};
  updates[`channels/${channelId}`] = {
    channelId,
    title,
    username: username || '',
    ownerId,
    addedAt: now,
    botStatus: botStatus || 'administrator',
    protectionEnabled: protectionEnabled !== undefined ? protectionEnabled : true,
    notifications: {
      channel: true,
      owner: true
    },
    statistics: {
      totalAutoBans: 0,
      totalUnbans: 0
    }
  };

  updates[`users/${ownerId}/channels/${channelId}`] = {
    channelId,
    title,
    username: username || '',
    role: 'owner',
    addedAt: now,
    protectionEnabled: true,
    botStatus: botStatus || 'administrator'
  };

  await update(ref(db), updates);
  console.log(`[CHANNEL] Connected: ${title} (${channelId}) by Owner ${ownerId}`);
}

async function removeChannel(channelId, ownerId) {
  const updates = {};
  updates[`channels/${channelId}`] = null;
  updates[`users/${ownerId}/channels/${channelId}`] = null;
  await update(ref(db), updates);
  console.log(`[CHANNEL] Removed: ${channelId} by Owner ${ownerId}`);
}

async function getUserChannels(userId) {
  try {
    const snap = await get(ref(db, `users/${userId}/channels`));
    if (!snap.exists()) return [];
    const val = snap.val();
    return Object.keys(val).map((k) => ({ channelId: k, ...val[k] }));
  } catch (err) {
    console.error(`[ERROR] DB getUserChannels error: ${err.message}`);
    return [];
  }
}

async function updateChannelField(channelId, ownerId, path, value) {
  const updates = {};
  updates[`channels/${channelId}/${path}`] = value;
  if (path === 'protectionEnabled' || path === 'botStatus') {
    updates[`users/${ownerId}/channels/${channelId}/${path}`] = value;
  }
  await update(ref(db), updates);
}

async function saveBanRecord(channelId, user) {
  const now = Date.now();
  const banRef = ref(db, `channels/${channelId}/bannedUsers/${user.id}`);
  await set(banRef, {
    userId: user.id,
    firstName: user.first_name || 'Member',
    username: user.username ? `@${user.username}` : '',
    bannedAt: now,
    reason: 'চ্যানেল থেকে লিভ নিয়েছে',
    status: 'banned'
  });

  const statsRef = ref(db, `channels/${channelId}/statistics/totalAutoBans`);
  const snap = await get(statsRef);
  const currentCount = snap.exists() ? snap.val() : 0;
  await set(statsRef, currentCount + 1);
}

async function recordUnban(channelId, userId) {
  const banRef = ref(db, `channels/${channelId}/bannedUsers/${userId}`);
  await remove(banRef);

  const statsRef = ref(db, `channels/${channelId}/statistics/totalUnbans`);
  const snap = await get(statsRef);
  const currentCount = snap.exists() ? snap.val() : 0;
  await set(statsRef, currentCount + 1);
}

async function logEvent(type, payload) {
  try {
    const logId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    await set(ref(db, `logs/${logId}`), {
      type,
      ...payload,
      timestamp: Date.now()
    });
  } catch (err) {
    // Non-blocking
  }
}

// ==========================================
// কীবোর্ড এবং ইউজার ইন্টারফেস (বাংলা)
// ==========================================
function getMainMenuKeyboard(userId) {
  const keyboard = [
    [{ text: '➕ চ্যানেল যোগ করুন' }, { text: '📂 আমার চ্যানেল' }],
    [{ text: '📖 কিভাবে কাজ করে' }]
  ];
  if (Number(userId) === MAIN_ADMIN_ID) {
    keyboard.push([{ text: '👑 এডমিন প্যানেল' }]);
  }
  return {
    keyboard: keyboard,
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

function getCancelKeyboard() {
  return {
    keyboard: [[{ text: '❌ বাতিল করুন' }]],
    resize_keyboard: true
  };
}

function getAdminPanelKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '👥 ইউজার তালিকা', callback_data: 'admin_users' },
        { text: '📢 চ্যানেলসমূহ', callback_data: 'admin_channels' }
      ],
      [
        { text: '📊 পরিসংখ্যান', callback_data: 'admin_stats' },
        { text: '📣 ব্রডকাস্ট (মেসেজ পাঠান)', callback_data: 'admin_broadcast' }
      ],
      [
        { text: '🔍 ইউজার খুঁজুন', callback_data: 'admin_user_search' }
      ],
      [
        { text: '🔙 বন্ধ করুন', callback_data: 'admin_close' }
      ]
    ]
  };
}

// ==========================================
// পারমিশন যাচাইকরণ
// ==========================================
async function checkBotPermissions(channelId) {
  const member = await getChatMember(channelId, BOT_USER_ID);
  if (!member) {
    return { isBotAdmin: false, canBan: false, raw: null };
  }
  const isBotAdmin = member.status === 'administrator';
  const canBan = isBotAdmin && (member.can_restrict_members === true || member.status === 'creator');
  return { isBotAdmin, canBan, status: member.status, raw: member };
}

async function verifyChannelOwnerOrAdmin(channelId, userId) {
  const member = await getChatMember(channelId, userId);
  if (!member) return false;
  return member.status === 'creator' || member.status === 'administrator';
}

// ==========================================
// কমান্ড ও মেনু হ্যান্ডলারসমূহ
// ==========================================
async function handleStart(chatId, from) {
  userStates.delete(from.id);
  await saveUser(from);

  const text =
    `🔥 <b>স্বাগতম 𝐀𝐔𝐑𝐀 𝐋𝐄𝐀𝐕𝐄 𝐁𝐀𝐍 বোটে!</b>\n\n` +
    `🤖 <b>আপনার চ্যানেল সুরক্ষা সহকারী!</b>\n\n` +
    `এই বটটি আপনার টেলিগ্রাম চ্যানেল থেকে কোনো সদস্য বের হয়ে গেলে (Leave নিলে) সাথে সাথে তাকে স্বয়ংক্রিয়ভাবে ব্যান (Auto Ban) করে দেয়।\n\n` +
    `🚫 <b>চ্যানেল লিভ নিলেই</b>\n` +
    `➡️ <b>অটোমেটিক ব্যান</b>\n\n` +
    `🔐 <i>সুরক্ষা সক্রিয় করতে আপনার চ্যানেলটি যুক্ত করুন এবং বটকে অ্যাডমিন বানান।</i>\n\n` +
    `নিচের বাটনগুলো ব্যবহার করুন 👇`;

  await sendMessage(chatId, text, {
    reply_markup: getMainMenuKeyboard(from.id)
  });
}

async function handleHowItWorks(chatId, from) {
  const text =
    `📖 <b>কিভাবে কাজ করে?</b>\n\n` +
    `1️⃣ বটটিকে আপনার চ্যানেলে অ্যাড করুন।\n` +
    `2️⃣ বটকে অ্যাডমিনিস্ট্রেটর (Admin) বানান।\n` +
    `3️⃣ Ban Users এবং Manage Members পারমিশন দিন।\n` +
    `4️⃣ বটের সাথে চ্যানেলটি যুক্ত (Connect) করুন।\n` +
    `5️⃣ Protection চালু করুন।\n\n` +
    `<b>এরপর:</b>\n` +
    `👤 কেউ জয়েন করলে\n` +
    `➡️ সবকিছু স্বাভাবিক থাকবে\n\n` +
    `👤 কেউ লিভ (Leave) নিলে\n` +
    `➡️ বট সাথে সাথে তা শনাক্ত করবে\n` +
    `➡️ বট স্বয়ংক্রিয়ভাবে তাকে চ্যানেল থেকে ব্যান করে দেবে\n\n` +
    `🔐 <i>আনব্যান না করা পর্যন্ত সে আর চ্যানেলে জয়েন হতে পারবে না।</i>`;

  await sendMessage(chatId, text, {
    reply_markup: getMainMenuKeyboard(from.id)
  });
}

async function handleAddChannelPrompt(chatId, from) {
  userStates.set(from.id, { step: 'waiting_channel_input' });

  const text =
    `➕ <b>নতুন চ্যানেল যোগ করুন</b>\n\n` +
    `⚠️ <b>গুরুত্বপূর্ণ:</b> চ্যানেল যোগ করার আগে অবশ্যই এই বটকে (<b>@AuraLeaveBanBot</b>) আপনার চ্যানেলে <b>ADMINISTRATOR</b> হিসেবে যোগ করতে হবে।\n\n` +
    `বটের যেসব পারমিশন প্রয়োজন:\n` +
    `✅ <b>Ban Users</b>\n` +
    `✅ <b>Manage Members</b>\n\n` +
    `বটকে অ্যাডমিন করার পর নিচের যেকোনো একটি পাঠান:\n` +
    `১. চ্যানেলের ইউজারনেম (যেমন: <code>@MyChannel</code>)\n` +
    `২. চ্যানেলের লিংক (যেমন: <code>https://t.me/MyChannel</code>)\n` +
    `৩. চ্যানেল আইডি (যেমন: <code>-1003725269802</code>)\n` +
    `৪. অথবা আপনার চ্যানেল থেকে যেকোনো একটি পোস্ট এখানে <b>Forward</b> করে দিন।`;

  await sendMessage(chatId, text, { reply_markup: getCancelKeyboard() });
}

// চ্যানেল ইনপুট প্রসেসিং
async function handleChannelInput(chatId, from, rawInput) {
  let input = (rawInput || '').trim();

  // ১. প্রাইভেট ইনভাইট লিংক ডিটেকশন (+ বা joinchat)
  if (input.includes('t.me/+') || input.includes('t.me/joinchat/')) {
    const text =
      `⚠️ <b>আগে বটকে চ্যানেলে অ্যাডমিন করুন!</b>\n\n` +
      `প্রাইভেট চ্যানেলের ইনভাইট লিংক দিয়ে বট সরাসরি তথ্য পড়তে পারে না।\n\n` +
      `📌 <b>করণীয়:</b>\n` +
      `১. প্রথমে <b>@AuraLeaveBanBot</b> কে আপনার চ্যানেলে <b>ADMINISTRATOR</b> হিসেবে যোগ করুন।\n` +
      `২. এরপর চ্যানেলের <b>চ্যানেল আইডি</b> (যেমন: <code>-100xxxxxxxxxx</code>) পাঠান অথবা চ্যানেল থেকে একটি পোস্ট এখানে <b>Forward</b> করুন।`;
    await sendMessage(chatId, text, { reply_markup: getCancelKeyboard() });
    return;
  }

  // ২. সাধারণ টেলিগ্রাম লিংক ফিল্টার (e.g. https://t.me/ChannelName)
  if (input.includes('t.me/')) {
    input = input.split('t.me/')[1].split('/')[0].split('?')[0];
  } else if (input.includes('telegram.me/')) {
    input = input.split('telegram.me/')[1].split('/')[0].split('?')[0];
  }

  const formattedTarget = (!input.startsWith('@') && !input.startsWith('-') && !/^\d+$/.test(input))
    ? `@${input}`
    : input;

  const chat = await getChat(formattedTarget);

  // ৩. যদি getChat ব্যর্থ হয় (টেলিগ্রামের নিয়মে বট অ্যাডমিন না থাকলে প্রাইভেট চ্যানেল বা আইডি পাওয়া যায় না)
  if (!chat) {
    const text =
      `⚠️ <b>আগে বটকে চ্যানেলে অ্যাডমিন করুন!</b>\n\n` +
      `আমি আপনার চ্যানেলটি খুঁজে পাচ্ছি না।\n\n` +
      `📌 <b>কারণ:</b> টেলিগ্রামের সুরক্ষা নিয়মানুযায়ী, কোনো চ্যানেল (বিশেষ করে প্রাইভেট চ্যানেল বা আইডি)-তে বটকে আগে থেকে <b>ADMINISTRATOR</b> না বানালে বট ওই চ্যানেলে ঢুকতে পারে না।\n\n` +
      `✅ <b>সহজ সমাধান:</b>\n` +
      `১. আপনার চ্যানেলে যান ➔ <b>Channel Settings</b> ➔ <b>Administrators</b>\n` +
      `২. <b>Add Administrator</b> এ ক্লিক করে <b>@AuraLeaveBanBot</b> কে অ্যাডমিন বানান।\n` +
      `৩. অবশ্যই <b>Ban Users</b> পারমিশনটি অন রাখুন।\n\n` +
      `অ্যাডমিন বানানো শেষ হলে পুনরায় আপনার চ্যানেলের আইডি (<code>${input}</code>) বা ইউজারনেমটি এখানে পাঠান:`;
    await sendMessage(chatId, text, { reply_markup: getCancelKeyboard() });
    return;
  }

  if (chat.type !== 'channel') {
    const text =
      `❌ <b>ভুল চ্যাট টাইপ!</b>\n\n` +
      `দয়া করে একটি টেলিগ্রাম চ্যানেল পাঠান। গ্রুপ বা সুপারগ্রুপ গ্রহণযোগ্য নয়।`;
    await sendMessage(chatId, text, { reply_markup: getCancelKeyboard() });
    return;
  }

  const channelId = String(chat.id);

  // ৪. ডুপ্লিকেট চ্যানেল চেক
  const existingChannel = await getChannel(channelId);
  if (existingChannel) {
    userStates.delete(from.id);
    if (String(existingChannel.ownerId) === String(from.id)) {
      await sendMessage(
        chatId,
        `ℹ️ <b>চ্যানেলটি ইতিমধ্যে যুক্ত রয়েছে!</b>\n\nএই চ্যানেলটি আগেই আপনার একাউন্টে সংযুক্ত করা হয়েছে।`,
        { reply_markup: getMainMenuKeyboard(from.id) }
      );
    } else {
      await sendMessage(
        chatId,
        `⚠️ <b>চ্যানেলটি ইতিমধ্যে সুরক্ষিত!</b>\n\nএই চ্যানেলটি অন্য একটি একাউন্টে যুক্ত রয়েছে। কেবল মূল মালিক এটি পরিচালনা করতে পারবেন।`,
        { reply_markup: getMainMenuKeyboard(from.id) }
      );
    }
    return;
  }

  // ৫. যে চ্যানেল অ্যাড করছে সে ক্রিয়েটর বা অ্যাডমিন কিনা চেক
  const isSenderPrivileged = await verifyChannelOwnerOrAdmin(channelId, from.id);
  if (!isSenderPrivileged && Number(from.id) !== MAIN_ADMIN_ID) {
    userStates.delete(from.id);
    await sendMessage(
      chatId,
      `⚠️ <b>অননুমোদিত!</b>\n\nবটে চ্যানেল যুক্ত করার জন্য আপনাকে সেই চ্যানেলের ক্রিয়েটর বা অ্যাডমিন হতে হবে।`,
      { reply_markup: getMainMenuKeyboard(from.id) }
    );
    return;
  }

  // ৬. বট নিজে অ্যাডমিন ও ব্যান পারমিশন প্রাপ্ত কিনা চেক
  const botPerms = await checkBotPermissions(channelId);
  if (!botPerms.isBotAdmin || !botPerms.canBan) {
    userStates.set(from.id, {
      step: 'awaiting_admin_promo',
      channelId: channelId,
      chatTitle: chat.title,
      chatUsername: chat.username ? `@${chat.username}` : ''
    });

    const text =
      `⚠️ <b>আগে বটকে চ্যানেলে অ্যাডমিন করুন!</b>\n\n` +
      `আমি আপনার চ্যানেল (<b>${chat.title}</b>) খুঁজে পেয়েছি, কিন্তু বট সেখানে অ্যাডমিন নয় অথবা ব্যান করার পারমিশন নেই।\n\n` +
      `অনুগ্রহ করে আমাকে অ্যাডমিন বানিয়ে নিচের পারমিশনগুলো দিন:\n` +
      `✅ <b>Ban Users</b>\n` +
      `✅ <b>Manage Members</b>\n\n` +
      `পারমিশন দেওয়া শেষ হলে নিচের <b>🔄 পুনরায় যাচাই করুন</b> বাটনে চাপুন: 👇`;

    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: '🔄 পুনরায় যাচাই করুন', callback_data: `recheck_${channelId}` }],
        [{ text: '❌ বাতিল করুন', callback_data: 'cancel_action' }]
      ]
    };

    await sendMessage(chatId, text, { reply_markup: inlineKeyboard });
    return;
  }

  // ৭. সফল রেজিস্ট্রেশন
  await registerChannel({
    channelId,
    ownerId: from.id,
    title: chat.title,
    username: chat.username ? `@${chat.username}` : '',
    botStatus: 'administrator',
    protectionEnabled: true
  });

  userStates.delete(from.id);

  const text =
    `✅ <b>চ্যানেল সফলভাবে যুক্ত হয়েছে!</b>\n\n` +
    `📢 <b>চ্যানেল:</b>\n${chat.username ? `@${chat.username}` : chat.title}\n\n` +
    `🆔 <b>চ্যানেল আইডি:</b>\n<code>${channelId}</code>\n\n` +
    `🤖 <b>বট স্ট্যাটাস:</b>\n✅ অ্যাডমিনিস্ট্রেটর\n\n` +
    `🔨 <b>ব্যান পারমিশন:</b>\n✅ চালু রয়েছে\n\n` +
    `🛡 <b>সুরক্ষা (Protection):</b>\n🟢 সক্রিয় (ACTIVE)\n\n` +
    `<i>এখন থেকে এই চ্যানেল থেকে কেউ লিভ নিলে সাথে সাথে ব্যান হয়ে যাবে।</i>`;

  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '📂 আমার চ্যানেলসমূহ', callback_data: 'nav_my_channels' }],
      [{ text: '⚙️ চ্যানেল পরিচালনা', callback_data: `manage_${channelId}` }]
    ]
  };

  await sendMessage(chatId, text, { reply_markup: inlineKeyboard });
  await sendMessage(chatId, `👇 মূল মেনু:`, {
    reply_markup: getMainMenuKeyboard(from.id)
  });
}

// ==========================================
// চ্যানেল ম্যানেজমেন্ট
// ==========================================
async function handleMyChannels(chatId, from, messageId = null) {
  const channels = await getUserChannels(from.id);

  if (channels.length === 0) {
    const text =
      `📂 <b>আপনার চ্যানেলসমূহ</b>\n\n` +
      `আপনি এখনো কোনো চ্যানেল যোগ করেননি।\n` +
      `চ্যানেল যোগ করতে <b>➕ চ্যানেল যোগ করুন</b> বাটনে চাপুন!`;

    if (messageId) {
      await editMessage(chatId, messageId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: '➕ চ্যানেল যোগ করুন', callback_data: 'nav_add_channel' }]]
        }
      });
    } else {
      await sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: '➕ চ্যানেল যোগ করুন', callback_data: 'nav_add_channel' }]]
        }
      });
    }
    return;
  }

  let text = `📂 <b>আপনার চ্যানেলসমূহ</b>\n\n`;
  const inlineKeyboard = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    let statusIcon = '🟢';
    let statusText = 'সুরক্ষা সক্রিয়';

    if (ch.botStatus === 'admin_removed') {
      statusIcon = '🟡';
      statusText = 'বট অ্যাডমিন সরানো হয়েছে';
    } else if (!ch.protectionEnabled) {
      statusIcon = '🔴';
      statusText = 'সুরক্ষা বন্ধ';
    }

    const titleDisplay = ch.username || ch.title || ch.channelId;
    text += `${i + 1}️⃣ <b>${titleDisplay}</b>\n${statusIcon} ${statusText}\n\n`;

    inlineKeyboard.push([
      {
        text: `📢 ${titleDisplay} ⚙️ পরিচালনা`,
        callback_data: `manage_${ch.channelId}`
      }
    ]);
  }

  if (messageId) {
    await editMessage(chatId, messageId, text, {
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  } else {
    await sendMessage(chatId, text, {
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  }
}

async function handleManageChannel(chatId, messageId, from, channelId) {
  const channel = await getChannel(channelId);
  if (!channel) {
    await editMessage(chatId, messageId, `❌ চ্যানেল রেকর্ড পাওয়া যায়নি।`);
    return;
  }

  if (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID) {
    await answerCallbackQuery(messageId, 'অননুমোদিত এক্সেস!', true);
    return;
  }

  const botPerms = await checkBotPermissions(channelId);
  const currentBotStatus = botPerms.isBotAdmin ? 'administrator' : 'admin_removed';
  if (currentBotStatus !== channel.botStatus) {
    await updateChannelField(channelId, channel.ownerId, 'botStatus', currentBotStatus);
    if (!botPerms.isBotAdmin) {
      await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', false);
      channel.protectionEnabled = false;
    }
    channel.botStatus = currentBotStatus;
  }

  const isProtectionActive = channel.protectionEnabled && channel.botStatus === 'administrator';
  const botStatusText = channel.botStatus === 'administrator' ? '✅ অ্যাডমিনিস্ট্রেটর' : '⚠️ অ্যাডমিন অপসারিত';
  const protectionText = isProtectionActive ? '🟢 সক্রিয় (ACTIVE)' : '🔴 বন্ধ (DISABLED)';

  const text =
    `📢 <b>চ্যানেল:</b>\n${channel.username || channel.title}\n\n` +
    `🆔 <b>আইডি:</b>\n<code>${channelId}</code>\n\n` +
    `🤖 <b>বট:</b>\n${botStatusText}\n\n` +
    `🛡 <b>সুরক্ষা:</b>\n${protectionText}\n\n` +
    `একটি অপশন বেছে নিন:`;

  const keyboard = [
    [
      channel.protectionEnabled
        ? { text: '🔴 সুরক্ষা বন্ধ করুন', callback_data: `prot_off_${channelId}` }
        : { text: '🟢 সুরক্ষা চালু করুন', callback_data: `prot_on_${channelId}` }
    ],
    [
      { text: '🔔 নোটিফিকেশন সেটিংস', callback_data: `notif_${channelId}` },
      { text: '👤 ব্যান হওয়া ইউজার', callback_data: `banned_${channelId}` }
    ],
    [
      { text: '🔄 বট স্ট্যাটাস যাচাই', callback_data: `check_${channelId}` },
      { text: '🗑 চ্যানেল রিমুভ করুন', callback_data: `delconf_${channelId}` }
    ],
    [{ text: '🔙 ফিরে যান', callback_data: 'nav_my_channels' }]
  ];

  await editMessage(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ==========================================
// নোটিফিকেশন এবং আনব্যান
// ==========================================
async function handleNotificationSettings(chatId, messageId, from, channelId) {
  const channel = await getChannel(channelId);
  if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) {
    return;
  }

  const notifs = channel.notifications || { channel: true, owner: true };
  const chText = notifs.channel ? '🟢 চালু' : '🔴 বন্ধ';
  const owText = notifs.owner ? '🟢 চালু' : '🔴 বন্ধ';

  const text =
    `🔔 <b>নোটিফিকেশন সেটিংস</b>\n\n` +
    `📢 <b>চ্যানেলে মেসেজ:</b> ${chText}\n` +
    `👤 <b>মালিককে ইনবক্সে মেসেজ:</b> ${owText}\n\n` +
    `নোটিফিকেশন অন/অফ করতে নিচের বাটনে চাপুন:`;

  const keyboard = [
    [
      { text: `📢 চ্যানেলে: ${chText}`, callback_data: `togglenotif_ch_${channelId}` },
      { text: `👤 মালিককে: ${owText}`, callback_data: `togglenotif_ow_${channelId}` }
    ],
    [{ text: '🔙 ব্যাক', callback_data: `manage_${channelId}` }]
  ];

  await editMessage(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function handleBannedUsersList(chatId, messageId, from, channelId) {
  const channel = await getChannel(channelId);
  if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) {
    return;
  }

  const bannedUsers = channel.bannedUsers || {};
  const userKeys = Object.keys(bannedUsers);

  if (userKeys.length === 0) {
    const text =
      `🔨 <b>ব্যান হওয়া ইউজারদের তালিকা</b>\n\n` +
      `এই চ্যানেলে এখনো কোনো ইউজারকে ব্যান করা হয়নি।`;
    const keyboard = [[{ text: '🔙 ব্যাক', callback_data: `manage_${channelId}` }]];
    await editMessage(chatId, messageId, text, {
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  let text = `🔨 <b>ব্যান হওয়া ইউজারদের তালিকা (${userKeys.length})</b>\n\n`;
  const keyboard = [];

  const listToDisplay = userKeys.slice(0, 8);
  for (const uid of listToDisplay) {
    const u = bannedUsers[uid];
    const name = u.firstName || 'User';
    const tag = u.username ? ` (${u.username})` : '';
    text += `👤 <b>${name}</b>${tag}\n🆔 <code>${uid}</code>\n\n`;
    keyboard.push([
      {
        text: `♻️ আনব্যান করুন (${name})`,
        callback_data: `unban_${channelId}_${uid}`
      }
    ]);
  }

  keyboard.push([{ text: '🔙 ব্যাক', callback_data: `manage_${channelId}` }]);

  await editMessage(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ==========================================
// এডমিন প্যানেল
// ==========================================
async function showAdminPanel(chatId, messageId = null) {
  const text =
    `👑 <b>এডমিন প্যানেল</b>\n\n` +
    `স্বাগতম এডমিন!\n` +
    `নিচের যেকোনো একটি অপশন বেছে নিন:`;

  if (messageId) {
    await editMessage(chatId, messageId, text, { reply_markup: getAdminPanelKeyboard() });
  } else {
    await sendMessage(chatId, text, { reply_markup: getAdminPanelKeyboard() });
  }
}

async function showAdminUsers(chatId, messageId) {
  const usersSnap = await get(ref(db, 'users'));
  const channelsSnap = await get(ref(db, 'channels'));

  const users = usersSnap.exists() ? usersSnap.val() : {};
  const channels = channelsSnap.exists() ? channelsSnap.val() : {};

  const totalUsers = Object.keys(users).length;
  const channelList = Object.values(channels);
  const totalChannels = channelList.length;

  let activeCount = 0;
  let disabledCount = 0;
  let removedCount = 0;

  for (const c of channelList) {
    if (c.botStatus === 'admin_removed') {
      removedCount++;
    } else if (c.protectionEnabled) {
      activeCount++;
    } else {
      disabledCount++;
    }
  }

  const text =
    `👥 <b>ইউজার ও চ্যানেল পরিসংখ্যান</b>\n\n` +
    `<b>মোট ইউজার:</b> ${totalUsers} জন\n` +
    `<b>মোট চ্যানেল:</b> ${totalChannels} টি\n` +
    `<b>সক্রিয় সুরক্ষিত চ্যানেল:</b> ${activeCount} টি\n` +
    `<b>সুরক্ষা বন্ধ চ্যানেল:</b> ${disabledCount} টি\n` +
    `<b>বট অ্যাডমিন সরানো হয়েছে:</b> ${removedCount} টি`;

  const keyboard = {
    inline_keyboard: [[{ text: '🔙 ব্যাক', callback_data: 'admin_back' }]]
  };

  await editMessage(chatId, messageId, text, { reply_markup: keyboard });
}

async function showAdminChannels(chatId, messageId) {
  const channelsSnap = await get(ref(db, 'channels'));
  if (!channelsSnap.exists()) {
    await editMessage(chatId, messageId, `📢 কোনো চ্যানেল পাওয়া যায়নি।`, {
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 ব্যাক', callback_data: 'admin_back' }]]
      }
    });
    return;
  }

  const channels = channelsSnap.val();
  const keys = Object.keys(channels);
  let text = `📢 <b>যুক্ত হওয়া চ্যানেলসমূহ (${keys.length})</b>\n\n`;

  const displayKeys = keys.slice(0, 6);
  for (const k of displayKeys) {
    const ch = channels[k];
    const status = ch.botStatus === 'administrator' ? 'অ্যাডমিন' : 'অ্যাডমিন অপসারিত';
    const prot = ch.protectionEnabled ? 'সক্রিয়' : 'বন্ধ';

    text +=
      `📢 <b>চ্যানেল:</b> ${ch.username || ch.title}\n` +
      `🆔 <b>আইডি:</b> <code>${ch.channelId}</code>\n` +
      `👤 <b>মালিকের আইডি:</b> <code>${ch.ownerId}</code>\n` +
      `🤖 <b>বট স্ট্যাটাস:</b> ${status}\n` +
      `🛡 <b>সুরক্ষা:</b> ${prot}\n\n`;
  }

  const keyboard = {
    inline_keyboard: [[{ text: '🔙 ব্যাক', callback_data: 'admin_back' }]]
  };

  await editMessage(chatId, messageId, text, { reply_markup: keyboard });
}

async function showAdminStats(chatId, messageId) {
  const usersSnap = await get(ref(db, 'users'));
  const channelsSnap = await get(ref(db, 'channels'));

  const usersCount = usersSnap.exists() ? Object.keys(usersSnap.val()).length : 0;
  const channels = channelsSnap.exists() ? Object.values(channelsSnap.val()) : [];

  let protectedCount = 0;
  let disabledCount = 0;
  let removedCount = 0;
  let totalBans = 0;
  let totalUnbans = 0;

  for (const c of channels) {
    if (c.botStatus === 'admin_removed') {
      removedCount++;
    } else if (c.protectionEnabled) {
      protectedCount++;
    } else {
      disabledCount++;
    }

    if (c.statistics) {
      totalBans += c.statistics.totalAutoBans || 0;
      totalUnbans += c.statistics.totalUnbans || 0;
    }
  }

  const text =
    `📊 <b>সার্বিক পরিসংখ্যান</b>\n\n` +
    `👥 <b>মোট ইউজার:</b> ${usersCount} জন\n` +
    `📢 <b>মোট চ্যানেল:</b> ${channels.length} টি\n` +
    `🟢 <b>সুরক্ষিত চ্যানেল:</b> ${protectedCount} টি\n` +
    `⏸ <b>সুরক্ষা বন্ধ চ্যানেল:</b> ${disabledCount} টি\n` +
    `⚠️ <b>বট অ্যাডমিন সরানো হয়েছে:</b> ${removedCount} টি\n` +
    `🔨 <b>মোট অটো ব্যান:</b> ${totalBans} বার\n` +
    `♻️ <b>মোট আনব্যান:</b> ${totalUnbans} বার`;

  const keyboard = {
    inline_keyboard: [[{ text: '🔙 ব্যাক', callback_data: 'admin_back' }]]
  };

  await editMessage(chatId, messageId, text, { reply_markup: keyboard });
}

async function handleAdminUserSearch(chatId, queryId) {
  const targetUserId = queryId.trim();
  const userSnap = await get(ref(db, `users/${targetUserId}`));

  if (!userSnap.exists()) {
    await sendMessage(chatId, `❌ <code>${targetUserId}</code> আইডির কোনো ইউজার পাওয়া যায়নি।`);
    return;
  }

  const u = userSnap.val();
  const userChannels = u.channels ? Object.values(u.channels) : [];

  let text =
    `👤 <b>ইউজার বিবরণ</b>\n\n` +
    `<b>নাম:</b> ${u.firstName || ''} ${u.lastName || ''}\n` +
    `<b>ইউজারনেম:</b> ${u.username || 'নেই'}\n` +
    `<b>ইউজার আইডি:</b> <code>${u.id}</code>\n` +
    `<b>যুক্ত চ্যানেল সংখ্যা:</b> ${userChannels.length}\n\n`;

  if (userChannels.length > 0) {
    text += `<b>চ্যানেলের তালিকা:</b>\n`;
    for (const ch of userChannels) {
      const adminIcon = ch.botStatus === 'administrator' ? '✅' : '❌';
      const protStatus = ch.protectionEnabled ? 'অন' : 'অফ';
      text += `📢 ${ch.username || ch.title}\n🤖 বট অ্যাডমিন: ${adminIcon}\n🛡 সুরক্ষা: ${protStatus}\n\n`;
    }
  }

  await sendMessage(chatId, text, {
    reply_markup: getMainMenuKeyboard(chatId)
  });
}

// ব্রডকাস্ট প্রসেসর
async function executeBroadcast(adminChatId, broadcastData) {
  const usersSnap = await get(ref(db, 'users'));
  if (!usersSnap.exists()) {
    await sendMessage(adminChatId, `❌ ব্রডকাস্ট করার মতো কোনো ইউজার পাওয়া যায়নি।`);
    return;
  }

  const users = usersSnap.val();
  const userIds = Object.keys(users);
  const total = userIds.length;

  await sendMessage(adminChatId, `⏳ <b>${total}</b> জন ইউজারের কাছে ব্রডকাস্ট শুরু হচ্ছে...`);

  let success = 0;
  let failed = 0;

  for (const uid of userIds) {
    try {
      let res;
      if (broadcastData.type === 'forward') {
        res = await copyMessage(uid, broadcastData.fromChatId, broadcastData.messageId);
      } else {
        res = await sendMessage(uid, broadcastData.text);
      }

      if (res && res.ok) {
        success++;
      } else {
        failed++;
      }
    } catch (e) {
      failed++;
    }

    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  const broadcastId = `bc_${Date.now()}`;
  await set(ref(db, `broadcasts/${broadcastId}`), {
    createdAt: Date.now(),
    adminId: MAIN_ADMIN_ID,
    total,
    success,
    failed
  });

  const reportText =
    `📣 <b>ব্রডকাস্ট সম্পন্ন হয়েছে!</b>\n\n` +
    `✅ <b>সফলভাবে পাঠানো হয়েছে:</b> ${success}\n` +
    `❌ <b>ব্যর্থ হয়েছে:</b> ${failed}\n` +
    `👥 <b>সর্বমোট:</b> ${total}`;

  await sendMessage(adminChatId, reportText, {
    reply_markup: getMainMenuKeyboard(adminChatId)
  });
}

// ==========================================
// কোর অটো-ব্যান ইঞ্জিন (লিভ ডিটেকশন)
// ==========================================
async function handleChatMemberUpdated(updateData) {
  try {
    const { chat, from, old_chat_member, new_chat_member } = updateData;
    if (!chat || chat.type !== 'channel') return;

    const channelId = String(chat.id);
    const channel = await getChannel(channelId);
    if (!channel) return;

    const targetUser = new_chat_member.user;
    if (!targetUser) return;

    if (targetUser.id === BOT_USER_ID) {
      if (new_chat_member.status === 'left' || new_chat_member.status === 'kicked') {
        await updateChannelField(channelId, channel.ownerId, 'botStatus', 'admin_removed');
        await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', false);

        await sendMessage(
          channel.ownerId,
          `⚠️ <b>সুরক্ষা স্থগিত করা হয়েছে!</b>\n\n` +
          `📢 <b>${channel.username || channel.title}</b>\n\n` +
          `আমাকে চ্যানেল থেকে অ্যাডমিন হিসেবে অপসারিত করা হয়েছে।\n` +
          `সুরক্ষা চালু রাখতে অনুগ্রহ করে পুনরায় আমাকে অ্যাডমিন বানান।`
        );
      }
      return;
    }

    if (!channel.protectionEnabled || channel.botStatus !== 'administrator') {
      return;
    }

    const oldStatus = old_chat_member ? old_chat_member.status : 'unknown';
    const newStatus = new_chat_member.status;

    if (oldStatus === 'creator' || oldStatus === 'administrator' ||
        newStatus === 'creator' || newStatus === 'administrator') {
      return;
    }

    const isVoluntaryLeave = (newStatus === 'left') &&
      (!from || from.id === targetUser.id || oldStatus === 'member');

    if (!isVoluntaryLeave) {
      return;
    }

    console.log(`[LEAVE DETECTED] ইউজার ${targetUser.id} চ্যানেল ${channelId} থেকে বের হয়ে গেছে।`);

    if (Number(targetUser.id) === Number(channel.ownerId) || Number(targetUser.id) === MAIN_ADMIN_ID) {
      return;
    }

    const botPerms = await checkBotPermissions(channelId);
    if (!botPerms.canBan) {
      console.warn(`[WARN] বটের ${channelId} চ্যানেলে ব্যান পারমিশন নেই`);
      return;
    }

    const banResult = await banChatMember(channelId, targetUser.id);
    if (!banResult.ok) {
      console.error(`[ERROR] banChatMember ব্যর্থ হয়েছে: ${banResult.description}`);
      return;
    }

    console.log(`[BAN EXECUTED] ইউজার ${targetUser.id} সফলভাবে ব্যান করা হয়েছে।`);

    await saveBanRecord(channelId, targetUser);
    await logEvent('AUTO_BAN', { channelId, userId: targetUser.id });

    const notifications = channel.notifications || { channel: true, owner: true };
    const userName = targetUser.first_name || 'Member';
    const userDisplay = targetUser.username ? `@${targetUser.username}` : userName;

    if (notifications.channel) {
      const chMsg =
        `🚫 <b>অটো ব্যান (AUTO BAN)</b>\n\n` +
        `👤 <b>ইউজার:</b> ${userName}\n` +
        `🆔 <b>আইডি:</b> <code>${targetUser.id}</code>\n` +
        `📢 <b>চ্যানেল:</b> ${chat.title || 'এই চ্যানেল'}\n` +
        `⚡ <b>কারণ:</b> চ্যানেল থেকে লিভ নিয়েছে।\n` +
        `🔨 <b>স্ট্যাটাস:</b> ব্যান করা হয়েছে (BANNED)`;

      await sendMessage(channelId, chMsg);
    }

    if (notifications.owner && channel.ownerId) {
      const nowStr = new Date().toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
      const ownerMsg =
        `🚫 <b>অটো ব্যান কার্যকর হয়েছে!</b>\n\n` +
        `📢 <b>চ্যানেল:</b> ${channel.username || channel.title}\n` +
        `👤 <b>ইউজার:</b> ${userDisplay}\n` +
        `🆔 <b>ইউজার আইডি:</b> <code>${targetUser.id}</code>\n` +
        `⚡ <b>কারণ:</b> চ্যানেল থেকে লিভ নিয়েছে\n` +
        `🔨 <b>পদক্ষেপ:</b> অটো ব্যান কার্যকর করা হয়েছে\n` +
        `🕒 <b>সময়:</b> ${nowStr}`;

      await sendMessage(channel.ownerId, ownerMsg);
    }
  } catch (err) {
    console.error(`[ERROR] handleChatMemberUpdated এ ত্রুটি: ${err.message}`);
  }
}

async function handleMyChatMemberUpdated(updateData) {
  try {
    const { chat, new_chat_member } = updateData;
    if (!chat || chat.type !== 'channel') return;

    const channelId = String(chat.id);
    const channel = await getChannel(channelId);
    if (!channel) return;

    const status = new_chat_member.status;

    if (status === 'administrator') {
      await updateChannelField(channelId, channel.ownerId, 'botStatus', 'administrator');
      console.log(`[STATUS] বটের অ্যাডমিন ক্ষমতা ফিরিয়ে দেওয়া হয়েছে ${channelId} চ্যানেলে`);
    } else {
      await updateChannelField(channelId, channel.ownerId, 'botStatus', 'admin_removed');
      await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', false);

      await sendMessage(
        channel.ownerId,
        `⚠️ <b>সুরক্ষা স্থগিত করা হয়েছে!</b>\n\n` +
        `📢 <b>${channel.username || channel.title}</b>\n\n` +
        `আমাকে চ্যানেল থেকে অ্যাডমিন হিসেবে অপসারিত করা হয়েছে।\n` +
        `সুরক্ষা চালু রাখতে অনুগ্রহ করে পুনরায় আমাকে অ্যাডমিন বানান।`
      );
    }
  } catch (err) {
    console.error(`[ERROR] handleMyChatMemberUpdated এ ত্রুটি: ${err.message}`);
  }
}

// ==========================================
// কলব্যাক কুয়েরি রাউটার
// ==========================================
async function handleCallbackQuery(callbackQuery) {
  const { id, from, message, data } = callbackQuery;
  const chatId = message ? message.chat.id : from.id;
  const messageId = message ? (message.messageId || message.message_id) : null;

  try {
    await answerCallbackQuery(id);

    if (data === 'cancel_action') {
      userStates.delete(from.id);
      await editMessage(chatId, messageId, `❌ বাতিল করা হয়েছে।`);
      await sendMessage(chatId, `মূল মেনু:`, {
        reply_markup: getMainMenuKeyboard(from.id)
      });
      return;
    }

    if (data === 'nav_my_channels') {
      await handleMyChannels(chatId, from, messageId);
      return;
    }

    if (data === 'nav_add_channel') {
      await handleAddChannelPrompt(chatId, from);
      return;
    }

    if (data.startsWith('admin_')) {
      if (Number(from.id) !== MAIN_ADMIN_ID) return;

      if (data === 'admin_back') {
        await showAdminPanel(chatId, messageId);
        return;
      }
      if (data === 'admin_close') {
        await editMessage(chatId, messageId, `👑 এডমিন প্যানেল বন্ধ করা হয়েছে।`);
        return;
      }
      if (data === 'admin_users') {
        await showAdminUsers(chatId, messageId);
        return;
      }
      if (data === 'admin_channels') {
        await showAdminChannels(chatId, messageId);
        return;
      }
      if (data === 'admin_stats') {
        await showAdminStats(chatId, messageId);
        return;
      }
      if (data === 'admin_broadcast') {
        userStates.set(from.id, { step: 'broadcast_waiting' });
        await sendMessage(
          chatId,
          `📣 <b>ব্রডকাস্ট</b>\n\n` +
          `সকল ইউজারের কাছে যে বার্তাটি পাঠাতে চান তা লিখে পাঠান।\n` +
          `মেসেজ বা ফরোয়ার্ডকৃত পোস্ট পাঠাতে পারেন।`,
          { reply_markup: getCancelKeyboard() }
        );
        return;
      }
      if (data === 'admin_user_search') {
        userStates.set(from.id, { step: 'user_search_waiting' });
        await sendMessage(
          chatId,
          `🔍 <b>ইউজার খুঁজুন</b>\n\nযে ইউজারের তথ্য দেখতে চান তার টেলিগ্রাম আইডি পাঠান:\nউদাহরণ: <code>8045367594</code>`,
          { reply_markup: getCancelKeyboard() }
        );
        return;
      }
      return;
    }

    if (data === 'broadcast_confirm') {
      if (Number(from.id) !== MAIN_ADMIN_ID) return;
      const state = userStates.get(from.id);
      if (!state || !state.broadcastPayload) {
        await editMessage(chatId, messageId, `❌ ব্রডকাস্টের তথ্য আর নেই।`);
        return;
      }
      userStates.delete(from.id);
      await editMessage(chatId, messageId, `🚀 ব্রডকাস্ট পাঠানো শুরু হয়েছে...`);
      await executeBroadcast(chatId, state.broadcastPayload);
      return;
    }

    if (data === 'broadcast_cancel') {
      userStates.delete(from.id);
      await editMessage(chatId, messageId, `❌ ব্রডকাস্ট বাতিল করা হয়েছে।`);
      return;
    }

    if (data.startsWith('recheck_')) {
      const channelId = data.replace('recheck_', '');
      const botPerms = await checkBotPermissions(channelId);
      if (!botPerms.isBotAdmin || !botPerms.canBan) {
        await answerCallbackQuery(
          id,
          '⚠️ এখনও অ্যাডমিন বানাননি বা ব্যান পারমিশন দেননি। অনুগ্রহ করে ঠিক করুন।',
          true
        );
        return;
      }

      const chat = await getChat(channelId);
      await registerChannel({
        channelId,
        ownerId: from.id,
        title: chat ? chat.title : 'Channel',
        username: chat && chat.username ? `@${chat.username}` : '',
        botStatus: 'administrator',
        protectionEnabled: true
      });

      userStates.delete(from.id);
      await editMessage(
        chatId,
        messageId,
        `✅ <b>চ্যানেল সফলভাবে যুক্ত হয়েছে!</b>\n\nসুরক্ষা এখন 🟢 সক্রিয়।`
      );
      await sendMessage(chatId, `মূল মেনু:`, {
        reply_markup: getMainMenuKeyboard(from.id)
      });
      return;
    }

    if (data.startsWith('manage_')) {
      const channelId = data.replace('manage_', '');
      await handleManageChannel(chatId, messageId, from, channelId);
      return;
    }

    if (data.startsWith('prot_on_') || data.startsWith('prot_off_')) {
      const isEnable = data.startsWith('prot_on_');
      const channelId = data.replace(isEnable ? 'prot_on_' : 'prot_off_', '');
      const channel = await getChannel(channelId);

      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) {
        await answerCallbackQuery(id, 'অননুমোদিত!', true);
        return;
      }

      if (isEnable) {
        const botPerms = await checkBotPermissions(channelId);
        if (!botPerms.canBan) {
          await answerCallbackQuery(
            id,
            '⚠️ সুরক্ষা চালু করতে বটকে অ্যাডমিন ও ব্যান পারমিশন থাকতে হবে।',
            true
          );
          return;
        }
      }

      await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', isEnable);
      await answerCallbackQuery(id, isEnable ? '🛡 সুরক্ষা চালু করা হয়েছে' : '⏸ সুরক্ষা বন্ধ করা হয়েছে');
      await handleManageChannel(chatId, messageId, from, channelId);
      return;
    }

    if (data.startsWith('check_')) {
      const channelId = data.replace('check_', '');
      const channel = await getChannel(channelId);
      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) {
        return;
      }

      const perms = await checkBotPermissions(channelId);
      const newStatus = perms.isBotAdmin ? 'administrator' : 'admin_removed';
      await updateChannelField(channelId, channel.ownerId, 'botStatus', newStatus);

      if (!perms.isBotAdmin) {
        await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', false);
        await answerCallbackQuery(id, '⚠️ বট এই চ্যানেলে অ্যাডমিন নেই!', true);
      } else {
        await answerCallbackQuery(id, '✅ বট সম্পূর্ণ পারমিশনসহ অ্যাডমিন আছে।', true);
      }
      await handleManageChannel(chatId, messageId, from, channelId);
      return;
    }

    if (data.startsWith('notif_')) {
      const channelId = data.replace('notif_', '');
      await handleNotificationSettings(chatId, messageId, from, channelId);
      return;
    }

    if (data.startsWith('togglenotif_ch_')) {
      const channelId = data.replace('togglenotif_ch_', '');
      const channel = await getChannel(channelId);
      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) return;

      const current = (channel.notifications && channel.notifications.channel) !== false;
      await updateChannelField(channelId, channel.ownerId, 'notifications/channel', !current);
      await handleNotificationSettings(chatId, messageId, from, channelId);
      return;
    }

    if (data.startsWith('togglenotif_ow_')) {
      const channelId = data.replace('togglenotif_ow_', '');
      const channel = await getChannel(channelId);
      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) return;

      const current = (channel.notifications && channel.notifications.owner) !== false;
      await updateChannelField(channelId, channel.ownerId, 'notifications/owner', !current);
      await handleNotificationSettings(chatId, messageId, from, channelId);
      return;
    }

    if (data.startsWith('banned_')) {
      const channelId = data.replace('banned_', '');
      await handleBannedUsersList(chatId, messageId, from, channelId);
      return;
    }

    if (data.startsWith('unban_')) {
      const parts = data.split('_');
      const channelId = parts[1];
      const targetUid = parts[2];
      const channel = await getChannel(channelId);

      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) {
        await answerCallbackQuery(id, 'অননুমোদিত!', true);
        return;
      }

      const unbanRes = await unbanChatMember(channelId, targetUid);
      if (unbanRes.ok) {
        await recordUnban(channelId, targetUid);
        await answerCallbackQuery(id, '♻️ ইউজার আনব্যান হয়েছে! সে পুনরায় জয়েন করতে পারবে।', true);
      } else {
        await answerCallbackQuery(id, `❌ আনব্যান ব্যর্থ: ${unbanRes.description}`, true);
      }

      await handleBannedUsersList(chatId, messageId, from, channelId);
      return;
    }

    if (data.startsWith('delconf_')) {
      const channelId = data.replace('delconf_', '');
      const channel = await getChannel(channelId);
      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) return;

      const text =
        `⚠️ <b>চ্যানেল ডিলিট করবেন?</b>\n\n` +
        `আপনি কি নিশ্চিত যে আপনি আপনার তালিকা থেকে:\n<b>${channel.username || channel.title}</b> চ্যানেলটি বাদ দিতে চান?`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '✅ হ্যাঁ, ডিলিট করুন', callback_data: `delyes_${channelId}` }],
          [{ text: '❌ বাতিল', callback_data: `manage_${channelId}` }]
        ]
      };

      await editMessage(chatId, messageId, text, { reply_markup: keyboard });
      return;
    }

    if (data.startsWith('delyes_')) {
      const channelId = data.replace('delyes_', '');
      const channel = await getChannel(channelId);
      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) return;

      await removeChannel(channelId, channel.ownerId);

      await editMessage(
        chatId,
        messageId,
        `✅ <b>চ্যানেল রিমুভ করা হয়েছে!</b>\n\nএই চ্যানেলটি আর বটের সুরক্ষায় থাকবে না।`
      );
      await sendMessage(chatId, `মূল মেনু:`, {
        reply_markup: getMainMenuKeyboard(from.id)
      });
      return;
    }
  } catch (err) {
    console.error(`[ERROR] handleCallbackQuery এ ত্রুটি: ${err.message}`);
  }
}

// ==========================================
// সাধারণ মেসেজ হ্যান্ডলার
// ==========================================
async function handleMessage(message) {
  const chatId = message.chat.id;
  const from = message.from;
  const text = (message.text || '').trim();

  if (!from) return;
  await saveUser(from);

  const state = userStates.get(from.id);

  // বাতিল কমান্ড
  if (text === '❌ বাতিল করুন' || text === '❌ Cancel' || text === '/cancel') {
    userStates.delete(from.id);
    await sendMessage(chatId, `❌ অপারেশন বাতিল করা হয়েছে।`, {
      reply_markup: getMainMenuKeyboard(from.id)
    });
    return;
  }

  // ব্রডকাস্ট স্টেট
  if (state && state.step === 'broadcast_waiting') {
    if (Number(from.id) !== MAIN_ADMIN_ID) {
      userStates.delete(from.id);
      return;
    }

    const snap = await get(ref(db, 'users'));
    const totalCount = snap.exists() ? Object.keys(snap.val()).length : 0;

    userStates.set(from.id, {
      step: 'broadcast_confirmation',
      broadcastPayload: {
        type: 'forward',
        fromChatId: chatId,
        messageId: message.message_id
      }
    });

    const confirmText =
      `⚠️ <b>ব্রডকাস্ট কনফার্মেশন</b>\n\n` +
      `আপনি বার্তাটি মোট <b>${totalCount}</b> জন ইউজারের কাছে পাঠাতে যাচ্ছেন।\n\n` +
      `আপনি কি নিশ্চিত?`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ হ্যাঁ, পাঠিয়ে দিন', callback_data: 'broadcast_confirm' }],
        [{ text: '❌ বাতিল করুন', callback_data: 'broadcast_cancel' }]
      ]
    };

    await sendMessage(chatId, confirmText, { reply_markup: keyboard });
    return;
  }

  // ইউজার সার্চ স্টেট
  if (state && state.step === 'user_search_waiting') {
    if (Number(from.id) !== MAIN_ADMIN_ID) {
      userStates.delete(from.id);
      return;
    }
    userStates.delete(from.id);
    await handleAdminUserSearch(chatId, text);
    return;
  }

  // চ্যানেল ইনপুট স্টেট (টেক্সট অথবা ফরোয়ার্ডকৃত মেসেজ গ্রহণ করবে)
  if (state && state.step === 'waiting_channel_input') {
    if (message.forward_from_chat && message.forward_from_chat.type === 'channel') {
      await handleChannelInput(chatId, from, String(message.forward_from_chat.id));
      return;
    }
    await handleChannelInput(chatId, from, text);
    return;
  }

  // মেনু বাটন হ্যান্ডলিং
  if (text === '/start') {
    await handleStart(chatId, from);
    return;
  }

  if (text === '📖 কিভাবে কাজ করে' || text === '📖 How It Works' || text === '/help') {
    await handleHowItWorks(chatId, from);
    return;
  }

  if (text === '➕ চ্যানেল যোগ করুন' || text === '➕ Add Channel') {
    await handleAddChannelPrompt(chatId, from);
    return;
  }

  if (text === '📂 আমার চ্যানেল' || text === '📂 My Channels') {
    await handleMyChannels(chatId, from);
    return;
  }

  if (text === '👑 এডমিন প্যানেল' || text === '👑 Admin Panel' || text === '/admin') {
    if (Number(from.id) === MAIN_ADMIN_ID) {
      await showAdminPanel(chatId);
    }
    return;
  }

  if (message.chat.type === 'private') {
    await sendMessage(
      chatId,
      `🤖 পরিচালনা করতে অনুগ্রহ করে নিচের বাটনগুলো ব্যবহার করুন।`,
      { reply_markup: getMainMenuKeyboard(from.id) }
    );
  }
}

// ==========================================
// টেলিগ্রাম আপডেট ডিসপ্যাচার
// ==========================================
async function processUpdate(update) {
  try {
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.chat_member) {
      await handleChatMemberUpdated(update.chat_member);
    } else if (update.my_chat_member) {
      await handleMyChatMemberUpdated(update.my_chat_member);
    }
  } catch (err) {
    console.error(`[ERROR] প্রসেসিং ত্রুটি: ${err.message}`);
  }
}

// ==========================================
// এক্সপ্রেস সার্ভার ও ওয়েবহুক / পোলিং সেটআপ
// ==========================================
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('𝐀𝐔𝐑𝐀 𝐋𝐄𝐀𝐕𝐄 𝐁𝐀𝐍 Bot চালু আছে।');
});

const WEBHOOK_PATH = `/api/webhook`;
app.post(WEBHOOK_PATH, (req, res) => {
  res.sendStatus(200);
  processUpdate(req.body);
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[INFO] Server running on 0.0.0.0:${PORT}`);

  const me = await callTelegram('getMe');
  if (me.ok) {
    BOT_USER_ID = me.result.id;
    console.log(`[INFO] Bot connected: @${me.result.username} (${BOT_USER_ID})`);
  } else {
    console.error(`[ERROR] Telegram BOT_TOKEN অকার্যকর!`);
  }

  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
  const allowedUpdates = ['message', 'callback_query', 'chat_member', 'my_chat_member'];

  if (externalUrl) {
    const fullWebhookUrl = `${externalUrl.replace(/\/$/, '')}${WEBHOOK_PATH}`;
    const webhookRes = await callTelegram('setWebhook', {
      url: fullWebhookUrl,
      allowed_updates: allowedUpdates,
      drop_pending_updates: false
    });
    console.log(`[INFO] Webhook সেটআপ (${fullWebhookUrl}): ${webhookRes.ok ? 'সফল' : webhookRes.description}`);
  } else {
    console.log('[INFO] লং-পোলিং ব্যাকআপ চালু হচ্ছে...');
    await callTelegram('deleteWebhook', { drop_pending_updates: false });
    startLongPolling(allowedUpdates);
  }
});

async function startLongPolling(allowedUpdates) {
  let offset = 0;
  while (true) {
    try {
      const res = await fetch(`${TELEGRAM_API_URL}/getUpdates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset: offset,
          timeout: 30,
          allowed_updates: allowedUpdates
        })
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          processUpdate(update);
        }
      }
    } catch (err) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
