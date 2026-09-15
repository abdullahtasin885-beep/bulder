/**
 * 𝐀𝐔𝐑𝐀 𝐋𝐄𝐀𝐕𝐄 𝐁𝐀𝐍 (@AuraLeaveBanBot)
 * Production Telegram Channel Leave -> Auto Ban Bot
 * Short & Professional Bangla UI
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
// কনফিগারেশন
// ==========================================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('[FATAL] BOT_TOKEN missing.');
  process.exit(1);
}

const MAIN_ADMIN_ID = 8045367594;
const PORT = parseInt(process.env.PORT, 10) || 3000;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

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

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
console.log('[INFO] Database connected.');

const userStates = new Map();
let BOT_USER_ID = null;

// ==========================================
// টেলিগ্রাম এপিআই
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
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        return callTelegram(method, payload);
      }
      console.warn(`[WARN] Telegram (${method}): ${data.description}`);
    }
    return data;
  } catch (err) {
    console.error(`[ERROR] Network (${method}): ${err.message}`);
    return { ok: false, description: err.message };
  }
}

async function sendMessage(chatId, text, options = {}) {
  return callTelegram('sendMessage', {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    reply_markup: options.reply_markup || undefined,
    disable_web_page_preview: true
  });
}

async function editMessage(chatId, messageId, text, options = {}) {
  return callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML',
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
  return callTelegram('banChatMember', { chat_id: chatId, user_id: userId });
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
// ডাটাবেস অপারেশন
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
        username: from.username ? `@${from.username}` : '',
        createdAt: now,
        lastActiveAt: now
      });
    } else {
      await update(userRef, {
        firstName: from.first_name || '',
        username: from.username ? `@${from.username}` : '',
        lastActiveAt: now
      });
    }
  } catch (err) {
    console.error(`[DB ERROR] saveUser: ${err.message}`);
  }
}

async function getChannel(channelId) {
  try {
    const snap = await get(ref(db, `channels/${channelId}`));
    return snap.exists() ? snap.val() : null;
  } catch (err) {
    return null;
  }
}

async function registerChannel(data) {
  const { channelId, ownerId, title, username } = data;
  const now = Date.now();

  const updates = {};
  updates[`channels/${channelId}`] = {
    channelId,
    title,
    username: username || '',
    ownerId,
    addedAt: now,
    botStatus: 'administrator',
    protectionEnabled: true,
    notifications: { channel: true, owner: true },
    statistics: { totalAutoBans: 0, totalUnbans: 0 }
  };

  updates[`users/${ownerId}/channels/${channelId}`] = {
    channelId,
    title,
    username: username || '',
    role: 'owner',
    addedAt: now,
    protectionEnabled: true,
    botStatus: 'administrator'
  };

  await update(ref(db), updates);
}

async function removeChannel(channelId, ownerId) {
  const updates = {};
  updates[`channels/${channelId}`] = null;
  updates[`users/${ownerId}/channels/${channelId}`] = null;
  await update(ref(db), updates);
}

async function getUserChannels(userId) {
  try {
    const snap = await get(ref(db, `users/${userId}/channels`));
    if (!snap.exists()) return [];
    const val = snap.val();
    return Object.keys(val).map((k) => ({ channelId: k, ...val[k] }));
  } catch (err) {
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
  const banRef = ref(db, `channels/${channelId}/bannedUsers/${user.id}`);
  await set(banRef, {
    userId: user.id,
    firstName: user.first_name || 'Member',
    username: user.username ? `@${user.username}` : '',
    bannedAt: Date.now()
  });

  const statsRef = ref(db, `channels/${channelId}/statistics/totalAutoBans`);
  const snap = await get(statsRef);
  await set(statsRef, (snap.exists() ? snap.val() : 0) + 1);
}

async function recordUnban(channelId, userId) {
  await remove(ref(db, `channels/${channelId}/bannedUsers/${userId}`));
  const statsRef = ref(db, `channels/${channelId}/statistics/totalUnbans`);
  const snap = await get(statsRef);
  await set(statsRef, (snap.exists() ? snap.val() : 0) + 1);
}

// ==========================================
// কীবোর্ড
// ==========================================
function getMainMenuKeyboard(userId) {
  const keyboard = [
    [{ text: '➕ চ্যানেল যোগ করুন' }, { text: '📂 আমার চ্যানেল' }],
    [{ text: '📖 কিভাবে কাজ করে' }]
  ];
  if (Number(userId) === MAIN_ADMIN_ID) {
    keyboard.push([{ text: '👑 এডমিন প্যানেল' }]);
  }
  return { keyboard, resize_keyboard: true };
}

function getCancelKeyboard() {
  return {
    keyboard: [[{ text: '❌ বাতিল' }]],
    resize_keyboard: true
  };
}

// ==========================================
// পারমিশন যাচাই
// ==========================================
async function checkBotPermissions(channelId) {
  const member = await getChatMember(channelId, BOT_USER_ID);
  if (!member) return { isBotAdmin: false, canBan: false };
  const isBotAdmin = member.status === 'administrator';
  const canBan = isBotAdmin && (member.can_restrict_members === true || member.status === 'creator');
  return { isBotAdmin, canBan };
}

async function verifyChannelOwnerOrAdmin(channelId, userId) {
  const member = await getChatMember(channelId, userId);
  return member && (member.status === 'creator' || member.status === 'administrator');
}

// ==========================================
// শর্ট ও প্রফেশনাল হ্যান্ডলার
// ==========================================
async function handleStart(chatId, from) {
  userStates.delete(from.id);
  await saveUser(from);

  const text =
    `🔥 <b>𝐀𝐔𝐑𝐀 𝐋𝐄𝐀𝐕𝐄 𝐁𝐀𝐍</b>\n\n` +
    `চ্যানেল থেকে মেম্বার লিভ নিলেই সাথে সাথে অটোমেটিক ব্যান হবে।\n\n` +
    `চ্যানেল যুক্ত করতে নিচের বাটনে চাপুন 👇`;

  await sendMessage(chatId, text, { reply_markup: getMainMenuKeyboard(from.id) });
}

async function handleHowItWorks(chatId, from) {
  const text =
    `📖 <b>ব্যবহার বিধি:</b>\n\n` +
    `১. বটকে চ্যানেলে <b>Admin</b> বানান (Ban Members পারমিশন দিন)।\n` +
    `২. <b>➕ চ্যানেল যোগ করুন</b> বাটনে চেপে চ্যানেল আইডি বা লিংক দিন।\n\n` +
    `⚡ কেউ চ্যানেল লিভ নিলেই স্বয়ংক্রিয়ভাবে ব্যান হয়ে যাবে।`;

  await sendMessage(chatId, text, { reply_markup: getMainMenuKeyboard(from.id) });
}

async function handleAddChannelPrompt(chatId, from) {
  userStates.set(from.id, { step: 'waiting_channel_input' });

  const text =
    `➕ <b>চ্যানেল যোগ করুন</b>\n\n` +
    `আগে বটকে চ্যানেলে <b>Admin</b> (Ban Members পারমিশন সহ) বানিয়ে চ্যানেলের <b>Username</b>, <b>ID</b> অথবা একটি পোস্ট <b>Forward</b> করুন।\n\n` +
    `<i>উদাহরণ: @MyChannel বা -100xxxxxxxxxx</i>`;

  await sendMessage(chatId, text, { reply_markup: getCancelKeyboard() });
}

async function handleChannelInput(chatId, from, rawInput) {
  let input = (rawInput || '').trim();

  if (input.includes('t.me/+') || input.includes('t.me/joinchat/')) {
    await sendMessage(
      chatId,
      `⚠️ <b>ইনভাইট লিংক গ্রহণযোগ্য নয়!</b>\n\nবটকে অ্যাডমিন বানিয়ে চ্যানেলের <b>ID</b> (<code>-100...</code>) অথবা চ্যানেল থেকে যেকোনো পোস্ট <b>Forward</b> করুন।`,
      { reply_markup: getCancelKeyboard() }
    );
    return;
  }

  if (input.includes('t.me/')) {
    input = input.split('t.me/')[1].split('/')[0].split('?')[0];
  }

  const formattedTarget = (!input.startsWith('@') && !input.startsWith('-') && !/^\d+$/.test(input))
    ? `@${input}`
    : input;

  const chat = await getChat(formattedTarget);

  if (!chat) {
    await sendMessage(
      chatId,
      `⚠️ <b>আগে বটকে চ্যানেলে অ্যাডমিন করুন!</b>\n\nচ্যানেলে <b>@AuraLeaveBanBot</b> কে <b>Admin</b> (Ban Members পারমিশন সহ) বানিয়ে পুনরায় পাঠান।`,
      { reply_markup: getCancelKeyboard() }
    );
    return;
  }

  if (chat.type !== 'channel') {
    await sendMessage(chatId, `❌ শুধুমাত্র চ্যানেল সাপোর্ট করে।`, { reply_markup: getCancelKeyboard() });
    return;
  }

  const channelId = String(chat.id);
  const existingChannel = await getChannel(channelId);

  if (existingChannel) {
    userStates.delete(from.id);
    const msg = String(existingChannel.ownerId) === String(from.id)
      ? `ℹ️ চ্যানেলটি ইতিমধ্যে আপনার তালিকায় রয়েছে।`
      : `⚠️ চ্যানেলটি অন্য একাউন্টে যুক্ত আছে।`;
    await sendMessage(chatId, msg, { reply_markup: getMainMenuKeyboard(from.id) });
    return;
  }

  const isPrivileged = await verifyChannelOwnerOrAdmin(channelId, from.id);
  if (!isPrivileged && Number(from.id) !== MAIN_ADMIN_ID) {
    userStates.delete(from.id);
    await sendMessage(chatId, `⚠️ আপনি এই চ্যানেলের অ্যাডমিন নন।`, { reply_markup: getMainMenuKeyboard(from.id) });
    return;
  }

  const botPerms = await checkBotPermissions(channelId);
  if (!botPerms.isBotAdmin || !botPerms.canBan) {
    userStates.set(from.id, { step: 'awaiting_promo', channelId });

    await sendMessage(
      chatId,
      `⚠️ <b>বট অ্যাডমিন পারমিশন নেই!</b>\n\nবটকে <b>Ban Members</b> পারমিশন দিয়ে অ্যাডমিন বানিয়ে নিচের বাটনে চাপুন।`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 চেক করুন', callback_data: `recheck_${channelId}` }],
            [{ text: '❌ বাতিল', callback_data: 'cancel_action' }]
          ]
        }
      }
    );
    return;
  }

  await registerChannel({
    channelId,
    ownerId: from.id,
    title: chat.title,
    username: chat.username ? `@${chat.username}` : ''
  });

  userStates.delete(from.id);

  const text =
    `✅ <b>চ্যানেল যুক্ত হয়েছে!</b>\n\n` +
    `📢 <b>${chat.username ? `@${chat.username}` : chat.title}</b>\n` +
    `🆔 <code>${channelId}</code>\n` +
    `🛡 সুরক্ষা: 🟢 সক্রিয়`;

  await sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📂 আমার চ্যানেল', callback_data: 'nav_my_channels' }],
        [{ text: '⚙️ পরিচালনা', callback_data: `manage_${channelId}` }]
      ]
    }
  });

  await sendMessage(chatId, `👇 মেনু:`, { reply_markup: getMainMenuKeyboard(from.id) });
}

// ==========================================
// চ্যানেল ম্যানেজমেন্ট
// ==========================================
async function handleMyChannels(chatId, from, messageId = null) {
  const channels = await getUserChannels(from.id);

  if (channels.length === 0) {
    const text = `📂 কোনো চ্যানেল যুক্ত নেই। যোগ করতে <b>➕ চ্যানেল যোগ করুন</b> চাপুন।`;
    const markup = { inline_keyboard: [[{ text: '➕ চ্যানেল যোগ করুন', callback_data: 'nav_add_channel' }]] };
    if (messageId) await editMessage(chatId, messageId, text, { reply_markup: markup });
    else await sendMessage(chatId, text, { reply_markup: markup });
    return;
  }

  let text = `📂 <b>আপনার চ্যানেলসমূহ:</b>\n\n`;
  const inlineKeyboard = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    let icon = ch.botStatus === 'admin_removed' ? '🟡' : (!ch.protectionEnabled ? '🔴' : '🟢');
    const name = ch.username || ch.title || ch.channelId;
    text += `${i + 1}. ${name} (${icon})\n`;

    inlineKeyboard.push([{
      text: `📢 ${name} ⚙️ পরিচালনা`,
      callback_data: `manage_${ch.channelId}`
    }]);
  }

  if (messageId) await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: inlineKeyboard } });
  else await sendMessage(chatId, text, { reply_markup: { inline_keyboard: inlineKeyboard } });
}

async function handleManageChannel(chatId, messageId, from, channelId) {
  const channel = await getChannel(channelId);
  if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) {
    await answerCallbackQuery(messageId, 'অননুমোদিত!', true);
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
  const text =
    `📢 <b>${channel.username || channel.title}</b>\n` +
    `🆔 <code>${channelId}</code>\n` +
    `🤖 বট: ${channel.botStatus === 'administrator' ? '✅ অ্যাডমিন' : '⚠️ সরানো হয়েছে'}\n` +
    `🛡 সুরক্ষা: ${isProtectionActive ? '🟢 সক্রিয়' : '🔴 বন্ধ'}`;

  const keyboard = [
    [
      channel.protectionEnabled
        ? { text: '🔴 সুরক্ষা বন্ধ করুন', callback_data: `prot_off_${channelId}` }
        : { text: '🟢 সুরক্ষা চালু করুন', callback_data: `prot_on_${channelId}` }
    ],
    [
      { text: '🔔 নোটিফিকেশন', callback_data: `notif_${channelId}` },
      { text: '👤 ব্যান তালিকা', callback_data: `banned_${channelId}` }
    ],
    [
      { text: '🔄 চেক স্ট্যাটাস', callback_data: `check_${channelId}` },
      { text: '🗑 ডিলিট চ্যানেল', callback_data: `delconf_${channelId}` }
    ],
    [{ text: '🔙 ফিরে যান', callback_data: 'nav_my_channels' }]
  ];

  await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function handleNotificationSettings(chatId, messageId, from, channelId) {
  const channel = await getChannel(channelId);
  if (!channel) return;

  const notifs = channel.notifications || { channel: true, owner: true };
  const text =
    `🔔 <b>নোটিফিকেশন সেটিংস</b>\n\n` +
    `📢 চ্যানেল এলার্ট: ${notifs.channel ? '🟢 অন' : '🔴 অফ'}\n` +
    `👤 ইনবক্স এলার্ট: ${notifs.owner ? '🟢 অন' : '🔴 অফ'}`;

  const keyboard = [
    [
      { text: `📢 চ্যানেল: ${notifs.channel ? '🟢' : '🔴'}`, callback_data: `togglenotif_ch_${channelId}` },
      { text: `👤 ইনবক্স: ${notifs.owner ? '🟢' : '🔴'}`, callback_data: `togglenotif_ow_${channelId}` }
    ],
    [{ text: '🔙 ফিরে যান', callback_data: `manage_${channelId}` }]
  ];

  await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
}

async function handleBannedUsersList(chatId, messageId, from, channelId) {
  const channel = await getChannel(channelId);
  if (!channel) return;

  const bannedUsers = channel.bannedUsers || {};
  const userKeys = Object.keys(bannedUsers);

  if (userKeys.length === 0) {
    await editMessage(chatId, messageId, `🔨 কোনো ব্যান ইউজার নেই।`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 ফিরে যান', callback_data: `manage_${channelId}` }]] }
    });
    return;
  }

  let text = `🔨 <b>ব্যান ইউজার তালিকা (${userKeys.length} জন):</b>\n\n`;
  const keyboard = [];

  for (const uid of userKeys.slice(0, 6)) {
    const u = bannedUsers[uid];
    text += `👤 ${u.firstName} (<code>${uid}</code>)\n`;
    keyboard.push([{ text: `♻️ আনব্যান (${u.firstName})`, callback_data: `unban_${channelId}_${uid}` }]);
  }

  keyboard.push([{ text: '🔙 ফিরে যান', callback_data: `manage_${channelId}` }]);
  await editMessage(chatId, messageId, text, { reply_markup: { inline_keyboard: keyboard } });
}

// ==========================================
// এডমিন প্যানেল
// ==========================================
async function showAdminPanel(chatId, messageId = null) {
  const text = `👑 <b>এডমিন প্যানেল</b>\nএকটি অপশন নির্বাচন করুন:`;
  const markup = {
    inline_keyboard: [
      [
        { text: '👥 ইউজার', callback_data: 'admin_users' },
        { text: '📢 চ্যানেল', callback_data: 'admin_channels' }
      ],
      [
        { text: '📊 পরিসংখ্যান', callback_data: 'admin_stats' },
        { text: '📣 ব্রডকাস্ট', callback_data: 'admin_broadcast' }
      ],
      [{ text: '🔍 ইউজার খুঁজুন', callback_data: 'admin_user_search' }],
      [{ text: '🔙 বন্ধ করুন', callback_data: 'admin_close' }]
    ]
  };

  if (messageId) await editMessage(chatId, messageId, text, { reply_markup: markup });
  else await sendMessage(chatId, text, { reply_markup: markup });
}

async function showAdminStats(chatId, messageId) {
  const [usersSnap, channelsSnap] = await Promise.all([
    get(ref(db, 'users')),
    get(ref(db, 'channels'))
  ]);

  const usersCount = usersSnap.exists() ? Object.keys(usersSnap.val()).length : 0;
  const channels = channelsSnap.exists() ? Object.values(channelsSnap.val()) : [];

  let active = 0, totalBans = 0;
  for (const c of channels) {
    if (c.protectionEnabled && c.botStatus === 'administrator') active++;
    if (c.statistics) totalBans += c.statistics.totalAutoBans || 0;
  }

  const text =
    `📊 <b>পরিসংখ্যান</b>\n\n` +
    `👥 মোট ইউজার: <b>${usersCount}</b>\n` +
    `📢 মোট চ্যানেল: <b>${channels.length}</b>\n` +
    `🟢 সক্রিয় চ্যানেল: <b>${active}</b>\n` +
    `🔨 মোট অটো ব্যান: <b>${totalBans}</b>`;

  await editMessage(chatId, messageId, text, {
    reply_markup: { inline_keyboard: [[{ text: '🔙 ফিরে যান', callback_data: 'admin_back' }]] }
  });
}

// ==========================================
// কোর অটো-ব্যান ইঞ্জিন
// ==========================================
async function handleChatMemberUpdated(updateData) {
  try {
    const { chat, from, old_chat_member, new_chat_member } = updateData;
    if (!chat || chat.type !== 'channel') return;

    const channelId = String(chat.id);
    const channel = await getChannel(channelId);
    if (!channel) return;

    const targetUser = new_chat_member.user;
    if (!targetUser || targetUser.id === BOT_USER_ID) return;

    if (!channel.protectionEnabled || channel.botStatus !== 'administrator') return;

    const oldStatus = old_chat_member ? old_chat_member.status : 'unknown';
    const newStatus = new_chat_member.status;

    if (oldStatus === 'creator' || oldStatus === 'administrator' ||
        newStatus === 'creator' || newStatus === 'administrator') {
      return;
    }

    const isVoluntaryLeave = (newStatus === 'left') &&
      (!from || from.id === targetUser.id || oldStatus === 'member');

    if (!isVoluntaryLeave) return;

    if (Number(targetUser.id) === Number(channel.ownerId) || Number(targetUser.id) === MAIN_ADMIN_ID) return;

    const botPerms = await checkBotPermissions(channelId);
    if (!botPerms.canBan) return;

    const banResult = await banChatMember(channelId, targetUser.id);
    if (!banResult.ok) return;

    await saveBanRecord(channelId, targetUser);

    const notifications = channel.notifications || { channel: true, owner: true };
    const userName = targetUser.first_name || 'Member';

    // ১. চ্যানেলে শর্ট এলার্ট
    if (notifications.channel) {
      await sendMessage(
        channelId,
        `🚫 <b>AUTO BAN</b>\n\n👤 ${userName} (<code>${targetUser.id}</code>)\n⚡ লিভ নেওয়ায় ব্যান করা হয়েছে।`
      );
    }

    // ২. ওনার ইনবক্সে শর্ট এলার্ট
    if (notifications.owner && channel.ownerId) {
      await sendMessage(
        channel.ownerId,
        `🚫 <b>অটো ব্যান এলার্ট</b>\n\n📢 ${channel.username || channel.title}\n👤 ${userName} (<code>${targetUser.id}</code>)\n⚡ চ্যানেল লিভ নিয়েছে।`
      );
    }
  } catch (err) {
    console.error(`[LEAVE ERROR] ${err.message}`);
  }
}

async function handleMyChatMemberUpdated(updateData) {
  try {
    const { chat, new_chat_member } = updateData;
    if (!chat || chat.type !== 'channel') return;

    const channelId = String(chat.id);
    const channel = await getChannel(channelId);
    if (!channel) return;

    if (new_chat_member.status === 'administrator') {
      await updateChannelField(channelId, channel.ownerId, 'botStatus', 'administrator');
    } else {
      await updateChannelField(channelId, channel.ownerId, 'botStatus', 'admin_removed');
      await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', false);
      await sendMessage(channel.ownerId, `⚠️ <b>${channel.username || channel.title}</b> চ্যানেলে বট অ্যাডমিন সরানো হয়েছে! সুরক্ষা স্থগিত।`);
    }
  } catch (err) {}
}

// ==========================================
// কলব্যাক রাউটার
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
      return;
    }

    if (data === 'nav_my_channels') return handleMyChannels(chatId, from, messageId);
    if (data === 'nav_add_channel') return handleAddChannelPrompt(chatId, from);

    // অ্যাডমিন কলব্যাক
    if (data.startsWith('admin_')) {
      if (Number(from.id) !== MAIN_ADMIN_ID) return;
      if (data === 'admin_back') return showAdminPanel(chatId, messageId);
      if (data === 'admin_close') return editMessage(chatId, messageId, `👑 প্যানেল বন্ধ।`);
      if (data === 'admin_stats') return showAdminStats(chatId, messageId);
      if (data === 'admin_users') {
        const snap = await get(ref(db, 'users'));
        const count = snap.exists() ? Object.keys(snap.val()).length : 0;
        return editMessage(chatId, messageId, `👥 মোট ইউজার: <b>${count}</b> জন`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 ফিরে যান', callback_data: 'admin_back' }]] }
        });
      }
      if (data === 'admin_channels') {
        const snap = await get(ref(db, 'channels'));
        const count = snap.exists() ? Object.keys(snap.val()).length : 0;
        return editMessage(chatId, messageId, `📢 মোট চ্যানেল: <b>${count}</b> টি`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 ফিরে যান', callback_data: 'admin_back' }]] }
        });
      }
      if (data === 'admin_broadcast') {
        userStates.set(from.id, { step: 'broadcast_waiting' });
        return sendMessage(chatId, `📣 ব্রডকাস্ট মেসেজটি লিখে পাঠান:`, { reply_markup: getCancelKeyboard() });
      }
      if (data === 'admin_user_search') {
        userStates.set(from.id, { step: 'user_search_waiting' });
        return sendMessage(chatId, `🔍 ইউজারের টেলিগ্রাম আইডি পাঠান:`, { reply_markup: getCancelKeyboard() });
      }
      return;
    }

    // ব্রডকাস্ট কনফার্ম
    if (data === 'broadcast_confirm') {
      if (Number(from.id) !== MAIN_ADMIN_ID) return;
      const state = userStates.get(from.id);
      if (!state || !state.broadcastPayload) return editMessage(chatId, messageId, `❌ মেয়াদোত্তীর্ণ।`);
      userStates.delete(from.id);
      await editMessage(chatId, messageId, `🚀 ব্রডকাস্ট শুরু হচ্ছে...`);

      const snap = await get(ref(db, 'users'));
      if (snap.exists()) {
        const users = Object.keys(snap.val());
        let s = 0, f = 0;
        for (const uid of users) {
          const res = state.broadcastPayload.type === 'forward'
            ? await copyMessage(uid, state.broadcastPayload.fromChatId, state.broadcastPayload.messageId)
            : await sendMessage(uid, state.broadcastPayload.text);
          res.ok ? s++ : f++;
          await new Promise(r => setTimeout(r, 40));
        }
        await sendMessage(chatId, `📣 <b>ব্রডকাস্ট সম্পন্ন</b>\n✅ সফল: ${s}\n❌ ব্যর্থ: ${f}`);
      }
      return;
    }

    if (data.startsWith('recheck_')) {
      const channelId = data.replace('recheck_', '');
      const botPerms = await checkBotPermissions(channelId);
      if (!botPerms.isBotAdmin || !botPerms.canBan) {
        return answerCallbackQuery(id, '⚠️ এখনও ব্যান পারমিশনসহ অ্যাডমিন বানাননি!', true);
      }
      const chat = await getChat(channelId);
      await registerChannel({
        channelId,
        ownerId: from.id,
        title: chat ? chat.title : 'Channel',
        username: chat && chat.username ? `@${chat.username}` : ''
      });
      userStates.delete(from.id);
      await editMessage(chatId, messageId, `✅ <b>চ্যানেল যুক্ত হয়েছে!</b>`);
      await sendMessage(chatId, `👇 মেনু:`, { reply_markup: getMainMenuKeyboard(from.id) });
      return;
    }

    if (data.startsWith('manage_')) return handleManageChannel(chatId, messageId, from, data.replace('manage_', ''));

    if (data.startsWith('prot_on_') || data.startsWith('prot_off_')) {
      const isEnable = data.startsWith('prot_on_');
      const channelId = data.replace(isEnable ? 'prot_on_' : 'prot_off_', '');
      const channel = await getChannel(channelId);
      if (!channel) return;

      if (isEnable) {
        const perms = await checkBotPermissions(channelId);
        if (!perms.canBan) return answerCallbackQuery(id, '⚠️ বটকে আগে Ban পারমিশন দিন!', true);
      }
      await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', isEnable);
      await answerCallbackQuery(id, isEnable ? '🟢 সুরক্ষা চালু' : '🔴 সুরক্ষা বন্ধ');
      return handleManageChannel(chatId, messageId, from, channelId);
    }

    if (data.startsWith('check_')) {
      const channelId = data.replace('check_', '');
      const channel = await getChannel(channelId);
      if (!channel) return;
      const perms = await checkBotPermissions(channelId);
      await updateChannelField(channelId, channel.ownerId, 'botStatus', perms.isBotAdmin ? 'administrator' : 'admin_removed');
      if (!perms.isBotAdmin) await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', false);
      await answerCallbackQuery(id, perms.isBotAdmin ? '✅ বট সম্পূর্ণ অ্যাডমিন আছে' : '⚠️ বট অ্যাডমিন নেই', true);
      return handleManageChannel(chatId, messageId, from, channelId);
    }

    if (data.startsWith('notif_')) return handleNotificationSettings(chatId, messageId, from, data.replace('notif_', ''));

    if (data.startsWith('togglenotif_ch_')) {
      const channelId = data.replace('togglenotif_ch_', '');
      const channel = await getChannel(channelId);
      if (!channel) return;
      const current = (channel.notifications && channel.notifications.channel) !== false;
      await updateChannelField(channelId, channel.ownerId, 'notifications/channel', !current);
      return handleNotificationSettings(chatId, messageId, from, channelId);
    }

    if (data.startsWith('togglenotif_ow_')) {
      const channelId = data.replace('togglenotif_ow_', '');
      const channel = await getChannel(channelId);
      if (!channel) return;
      const current = (channel.notifications && channel.notifications.owner) !== false;
      await updateChannelField(channelId, channel.ownerId, 'notifications/owner', !current);
      return handleNotificationSettings(chatId, messageId, from, channelId);
    }

    if (data.startsWith('banned_')) return handleBannedUsersList(chatId, messageId, from, data.replace('banned_', ''));

    if (data.startsWith('unban_')) {
      const [, channelId, targetUid] = data.split('_');
      const unbanRes = await unbanChatMember(channelId, targetUid);
      if (unbanRes.ok) {
        await recordUnban(channelId, targetUid);
        await answerCallbackQuery(id, '♻️ আনব্যান সফল!', true);
      } else {
        await answerCallbackQuery(id, '❌ ব্যর্থ!', true);
      }
      return handleBannedUsersList(chatId, messageId, from, channelId);
    }

    if (data.startsWith('delconf_')) {
      const channelId = data.replace('delconf_', '');
      const channel = await getChannel(channelId);
      if (!channel) return;
      return editMessage(chatId, messageId, `⚠️ <b>${channel.username || channel.title}</b> চ্যানেলটি ডিলিট করতে চান?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ ডিলিট', callback_data: `delyes_${channelId}` }],
            [{ text: '❌ বাতিল', callback_data: `manage_${channelId}` }]
          ]
        }
      });
    }

    if (data.startsWith('delyes_')) {
      const channelId = data.replace('delyes_', '');
      const channel = await getChannel(channelId);
      if (!channel) return;
      await removeChannel(channelId, channel.ownerId);
      await editMessage(chatId, messageId, `✅ চ্যানেল রিমুভ করা হয়েছে।`);
      return sendMessage(chatId, `👇 মেনু:`, { reply_markup: getMainMenuKeyboard(from.id) });
    }
  } catch (err) {
    console.error(`[CALLBACK ERROR] ${err.message}`);
  }
}

// ==========================================
// মেসেজ রাউটার
// ==========================================
async function handleMessage(message) {
  const chatId = message.chat.id;
  const from = message.from;
  const text = (message.text || '').trim();

  if (!from) return;
  await saveUser(from);

  const state = userStates.get(from.id);

  if (text === '❌ বাতিল' || text === '❌ Cancel' || text === '/cancel') {
    userStates.delete(from.id);
    await sendMessage(chatId, `❌ বাতিল করা হয়েছে।`, { reply_markup: getMainMenuKeyboard(from.id) });
    return;
  }

  if (state && state.step === 'broadcast_waiting') {
    if (Number(from.id) !== MAIN_ADMIN_ID) return userStates.delete(from.id);
    const snap = await get(ref(db, 'users'));
    const total = snap.exists() ? Object.keys(snap.val()).length : 0;

    userStates.set(from.id, {
      step: 'broadcast_confirm',
      broadcastPayload: { type: 'forward', fromChatId: chatId, messageId: message.message_id }
    });

    await sendMessage(chatId, `⚠️ মোট <b>${total}</b> জন ইউজারের কাছে পাঠানো হবে। নিশ্চিত?`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ হ্যাঁ, পাঠান', callback_data: 'broadcast_confirm' }],
          [{ text: '❌ বাতিল', callback_data: 'cancel_action' }]
        ]
      }
    });
    return;
  }

  if (state && state.step === 'user_search_waiting') {
    userStates.delete(from.id);
    const snap = await get(ref(db, `users/${text}`));
    if (!snap.exists()) return sendMessage(chatId, `❌ ইউজার পাওয়া যায়নি।`);
    const u = snap.val();
    const count = u.channels ? Object.keys(u.channels).length : 0;
    await sendMessage(chatId, `👤 <b>${u.firstName}</b> (<code>${u.id}</code>)\n📢 চ্যানেল: ${count} টি`);
    return;
  }

  if (state && state.step === 'waiting_channel_input') {
    if (message.forward_from_chat && message.forward_from_chat.type === 'channel') {
      return handleChannelInput(chatId, from, String(message.forward_from_chat.id));
    }
    return handleChannelInput(chatId, from, text);
  }

  if (text === '/start') return handleStart(chatId, from);
  if (text === '📖 কিভাবে কাজ করে' || text === '/help') return handleHowItWorks(chatId, from);
  if (text === '➕ চ্যানেল যোগ করুন') return handleAddChannelPrompt(chatId, from);
  if (text === '📂 আমার চ্যানেল') return handleMyChannels(chatId, from);
  if ((text === '👑 এডমিন প্যানেল' || text === '/admin') && Number(from.id) === MAIN_ADMIN_ID) {
    return showAdminPanel(chatId);
  }
}

// ==========================================
// সার্ভার ইনিট
// ==========================================
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.status(200).send('Active'));

app.post('/api/webhook', (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  if (update.message) handleMessage(update.message);
  else if (update.callback_query) handleCallbackQuery(update.callback_query);
  else if (update.chat_member) handleChatMemberUpdated(update.chat_member);
  else if (update.my_chat_member) handleMyChatMemberUpdated(update.my_chat_member);
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[INFO] Port: ${PORT}`);

  const me = await callTelegram('getMe');
  if (me.ok) BOT_USER_ID = me.result.id;

  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
  const allowedUpdates = ['message', 'callback_query', 'chat_member', 'my_chat_member'];

  if (externalUrl) {
    await callTelegram('setWebhook', {
      url: `${externalUrl.replace(/\/$/, '')}/api/webhook`,
      allowed_updates: allowedUpdates
    });
  } else {
    await callTelegram('deleteWebhook');
    let offset = 0;
    while (true) {
      try {
        const res = await fetch(`${TELEGRAM_API_URL}/getUpdates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset, timeout: 30, allowed_updates: allowedUpdates })
        });
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const upd of data.result) {
            offset = upd.update_id + 1;
            if (upd.message) handleMessage(upd.message);
            else if (upd.callback_query) handleCallbackQuery(upd.callback_query);
            else if (upd.chat_member) handleChatMemberUpdated(upd.chat_member);
            else if (upd.my_chat_member) handleMyChatMemberUpdated(upd.my_chat_member);
          }
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
});
