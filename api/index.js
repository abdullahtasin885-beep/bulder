/**
 * 𝐀𝐔𝐑𝐀 𝐋𝐄𝐀𝐕𝐄 𝐁𝐀𝐍 (@AuraLeaveBanBot)
 * Telegram Channel Leave -> Auto Ban Bot
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
// CONFIGURATION & CONSTANTS
// ==========================================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('[FATAL] BOT_TOKEN environment variable is missing.');
  process.exit(1);
}

const MAIN_ADMIN_ID = 8045367594;
const PORT = parseInt(process.env.PORT, 10) || 3000;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Firebase Client Configuration
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

// Initialize Firebase Realtime Database
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
console.log('[INFO] Firebase Realtime Database connected.');

// In-Memory User State Map (per-user independent session flow)
const userStates = new Map();

// Cached Bot ID
let BOT_USER_ID = null;

// ==========================================
// TELEGRAM API CLIENT HELPERS
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
        console.warn(`[WARN] 429 Rate limited. Waiting ${retryAfter}s on ${method}...`);
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
// FIREBASE DATABASE LAYER
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
        languageCode: from.language_code || 'en',
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
    reason: 'Left the channel',
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
    // Non-blocking log
  }
}

// ==========================================
// UI KEYBOARDS & NAVIGATION
// ==========================================
function getMainMenuKeyboard(userId) {
  const keyboard = [
    [{ text: '➕ Add Channel' }, { text: '📂 My Channels' }],
    [{ text: '📖 How It Works' }, { text: '⚙️ Settings' }]
  ];
  if (Number(userId) === MAIN_ADMIN_ID) {
    keyboard.push([{ text: '👑 Admin Panel' }]);
  }
  return {
    keyboard: keyboard,
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

function getCancelKeyboard() {
  return {
    keyboard: [[{ text: '❌ Cancel' }]],
    resize_keyboard: true
  };
}

function getAdminPanelKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '👥 Users', callback_data: 'admin_users' },
        { text: '📢 Channels', callback_data: 'admin_channels' }
      ],
      [
        { text: '📊 Statistics', callback_data: 'admin_stats' },
        { text: '📣 Broadcast', callback_data: 'admin_broadcast' }
      ],
      [
        { text: '🔍 User Search', callback_data: 'admin_user_search' }
      ],
      [
        { text: '🔙 Main Menu', callback_data: 'admin_close' }
      ]
    ]
  };
}

// ==========================================
// PERMISSION CHECKS
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
// COMMAND & ACTION HANDLERS
// ==========================================
async function handleStart(chatId, from) {
  userStates.delete(from.id);
  await saveUser(from);

  const text =
    `🔥 <b>Welcome to 𝐀𝐔𝐑𝐀 𝐋𝐄𝐀𝐕𝐄 𝐁𝐀𝐍</b>\n\n` +
    `🤖 <b>Your channel protection assistant!</b>\n\n` +
    `This bot automatically bans users who leave your protected Telegram channel.\n\n` +
    `🚫 <b>Leave the channel</b>\n` +
    `➡️ <b>Automatically Ban</b>\n\n` +
    `🔐 <i>Add your channel and make the bot an administrator to activate protection.</i>\n\n` +
    `Use the buttons below 👇`;

  await sendMessage(chatId, text, {
    reply_markup: getMainMenuKeyboard(from.id)
  });
}

async function handleHowItWorks(chatId, from) {
  const text =
    `📖 <b>How It Works</b>\n\n` +
    `1️⃣ Add the bot to your channel.\n` +
    `2️⃣ Make the bot an administrator.\n` +
    `3️⃣ Give permission to ban/manage members.\n` +
    `4️⃣ Connect the channel with the bot.\n` +
    `5️⃣ Turn Protection ON.\n\n` +
    `<b>Now:</b>\n` +
    `👤 User joins\n` +
    `➡️ Everything normal\n\n` +
    `👤 User leaves\n` +
    `➡️ Bot detects the leave\n` +
    `➡️ Bot automatically bans the user\n\n` +
    `🔐 <i>The user cannot rejoin until unbanned.</i>`;

  await sendMessage(chatId, text, {
    reply_markup: getMainMenuKeyboard(from.id)
  });
}

async function handleSettingsMenu(chatId, from) {
  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '👤 My Account', callback_data: 'settings_account' }],
      [{ text: '📂 My Channels', callback_data: 'settings_channels' }],
      [{ text: '📖 How It Works', callback_data: 'settings_how' }]
    ]
  };

  const text =
    `⚙️ <b>Settings</b>\n\n` +
    `Configure your bot preferences and account settings:`;

  await sendMessage(chatId, text, { reply_markup: inlineKeyboard });
}

async function handleMyAccount(chatId, from, messageId = null) {
  const channels = await getUserChannels(from.id);
  const text =
    `👤 <b>My Account</b>\n\n` +
    `<b>Name:</b> ${from.first_name || 'User'}\n` +
    `<b>Username:</b> ${from.username ? `@${from.username}` : 'None'}\n` +
    `<b>Telegram ID:</b> <code>${from.id}</code>\n` +
    `<b>Connected Channels:</b> ${channels.length}`;

  const keyboard = {
    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'settings_main' }]]
  };

  if (messageId) {
    await editMessage(chatId, messageId, text, { reply_markup: keyboard });
  } else {
    await sendMessage(chatId, text, { reply_markup: keyboard });
  }
}

async function handleAddChannelPrompt(chatId, from) {
  userStates.set(from.id, { step: 'waiting_channel_input' });

  const text =
    `➕ <b>Add New Channel</b>\n\n` +
    `First, add this bot (<b>@AuraLeaveBanBot</b>) as an <b>ADMINISTRATOR</b> to your Telegram channel.\n\n` +
    `The bot needs permission to:\n` +
    `✅ <b>Ban Users</b>\n` +
    `✅ <b>Manage Members</b>\n\n` +
    `After adding the bot as administrator, send me your channel username or channel ID.\n\n` +
    `Example:\n` +
    `<code>@MyChannel</code>\n` +
    `or\n` +
    `<code>-1001234567890</code>`;

  await sendMessage(chatId, text, { reply_markup: getCancelKeyboard() });
}

async function handleChannelInput(chatId, from, rawInput) {
  const input = rawInput.trim();
  const formattedTarget = (!input.startsWith('@') && !input.startsWith('-') && !/^\d+$/.test(input))
    ? `@${input}`
    : input;

  const chat = await getChat(formattedTarget);
  if (!chat) {
    const text =
      `❌ <b>I couldn't find this channel.</b>\n\n` +
      `Please make sure the username/ID is correct and try again.`;
    await sendMessage(chatId, text, { reply_markup: getCancelKeyboard() });
    return;
  }

  if (chat.type !== 'channel') {
    const text =
      `❌ <b>Invalid Chat Type</b>\n\n` +
      `Please send a Telegram channel. Groups or supergroups are not supported.`;
    await sendMessage(chatId, text, { reply_markup: getCancelKeyboard() });
    return;
  }

  const channelId = String(chat.id);

  // Check duplicate channel registration
  const existingChannel = await getChannel(channelId);
  if (existingChannel) {
    userStates.delete(from.id);
    if (String(existingChannel.ownerId) === String(from.id)) {
      await sendMessage(
        chatId,
        `ℹ️ <b>Channel Already Added</b>\n\nThis channel is already connected to your account.`,
        { reply_markup: getMainMenuKeyboard(from.id) }
      );
    } else {
      await sendMessage(
        chatId,
        `⚠️ <b>Channel Already Protected</b>\n\nThis channel is already connected to another account.\nOnly the registered owner can manage it.`,
        { reply_markup: getMainMenuKeyboard(from.id) }
      );
    }
    return;
  }

  // Validate requester is channel owner/admin
  const isSenderPrivileged = await verifyChannelOwnerOrAdmin(channelId, from.id);
  if (!isSenderPrivileged && Number(from.id) !== MAIN_ADMIN_ID) {
    userStates.delete(from.id);
    await sendMessage(
      chatId,
      `⚠️ <b>Unauthorized</b>\n\nYou must be the Creator or an Administrator of this channel to register it with the bot.`,
      { reply_markup: getMainMenuKeyboard(from.id) }
    );
    return;
  }

  // Check bot administrator and ban status
  const botPerms = await checkBotPermissions(channelId);
  if (!botPerms.isBotAdmin || !botPerms.canBan) {
    userStates.set(from.id, {
      step: 'awaiting_admin_promo',
      channelId: channelId,
      chatTitle: chat.title,
      chatUsername: chat.username ? `@${chat.username}` : ''
    });

    const text =
      `⚠️ <b>Bot Administrator Required</b>\n\n` +
      `I found your channel, but I'm not an administrator there.\n\n` +
      `Please add me as an administrator with permission to:\n` +
      `✅ <b>Ban Users</b>\n` +
      `✅ <b>Manage Members</b>\n\n` +
      `Then press: <b>🔄 Check Again</b>`;

    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: '🔄 Check Again', callback_data: `recheck_${channelId}` }],
        [{ text: '❌ Cancel', callback_data: 'cancel_action' }]
      ]
    };

    await sendMessage(chatId, text, { reply_markup: inlineKeyboard });
    return;
  }

  // Register channel
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
    `✅ <b>Channel Connected Successfully!</b>\n\n` +
    `📢 <b>Channel:</b>\n${chat.username ? `@${chat.username}` : chat.title}\n\n` +
    `🆔 <b>Channel ID:</b>\n<code>${channelId}</code>\n\n` +
    `🤖 <b>Bot Status:</b>\n✅ Administrator\n\n` +
    `🔨 <b>Ban Permission:</b>\n✅ Enabled\n\n` +
    `🛡 <b>Protection:</b>\n🟢 ACTIVE\n\n` +
    `<i>From now on, users who leave this channel will automatically be banned.</i>`;

  const inlineKeyboard = {
    inline_keyboard: [
      [{ text: '📂 My Channels', callback_data: 'nav_my_channels' }],
      [{ text: '⚙️ Channel Settings', callback_data: `manage_${channelId}` }]
    ]
  };

  await sendMessage(chatId, text, { reply_markup: inlineKeyboard });
  await sendMessage(chatId, `👇 Main Navigation:`, {
    reply_markup: getMainMenuKeyboard(from.id)
  });
}

// ==========================================
// MY CHANNELS & CHANNEL MANAGEMENT
// ==========================================
async function handleMyChannels(chatId, from, messageId = null) {
  const channels = await getUserChannels(from.id);

  if (channels.length === 0) {
    const text =
      `📂 <b>Your Channels</b>\n\n` +
      `You have not added any channels yet.\n` +
      `Press <b>➕ Add Channel</b> to get started!`;

    if (messageId) {
      await editMessage(chatId, messageId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: '➕ Add Channel', callback_data: 'nav_add_channel' }]]
        }
      });
    } else {
      await sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: '➕ Add Channel', callback_data: 'nav_add_channel' }]]
        }
      });
    }
    return;
  }

  let text = `📂 <b>Your Channels</b>\n\n`;
  const inlineKeyboard = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    let statusIcon = '🟢';
    let statusText = 'Protection Active';

    if (ch.botStatus === 'admin_removed') {
      statusIcon = '🟡';
      statusText = 'Bot Admin Removed';
    } else if (!ch.protectionEnabled) {
      statusIcon = '🔴';
      statusText = 'Protection Disabled';
    }

    const titleDisplay = ch.username || ch.title || ch.channelId;
    text += `${i + 1}️⃣ <b>${titleDisplay}</b>\n${statusIcon} ${statusText}\n\n`;

    inlineKeyboard.push([
      {
        text: `📢 ${titleDisplay} ⚙️ Manage`,
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
    await editMessage(chatId, messageId, `❌ Channel record not found.`);
    return;
  }

  // Security authorization verification
  if (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID) {
    await answerCallbackQuery(messageId, 'Unauthorized access.', true);
    return;
  }

  // Live status verification
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
  const botStatusText = channel.botStatus === 'administrator' ? '✅ Administrator' : '⚠️ Admin Removed';
  const protectionText = isProtectionActive ? '🟢 ACTIVE' : '🔴 DISABLED';

  const text =
    `📢 <b>Channel:</b>\n${channel.username || channel.title}\n\n` +
    `🆔 <b>ID:</b>\n<code>${channelId}</code>\n\n` +
    `🤖 <b>Bot:</b>\n${botStatusText}\n\n` +
    `🛡 <b>Protection:</b>\n${protectionText}\n\n` +
    `Choose an option:`;

  const keyboard = [
    [
      channel.protectionEnabled
        ? { text: '🔴 Disable Protection', callback_data: `prot_off_${channelId}` }
        : { text: '🟢 Enable Protection', callback_data: `prot_on_${channelId}` }
    ],
    [
      { text: '🔔 Notification Settings', callback_data: `notif_${channelId}` },
      { text: '👤 Banned Users', callback_data: `banned_${channelId}` }
    ],
    [
      { text: '🔄 Check Bot Status', callback_data: `check_${channelId}` },
      { text: '🗑 Remove Channel', callback_data: `delconf_${channelId}` }
    ],
    [{ text: '🔙 Back', callback_data: 'nav_my_channels' }]
  ];

  await editMessage(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ==========================================
// NOTIFICATIONS & UNBAN MANAGEMENT
// ==========================================
async function handleNotificationSettings(chatId, messageId, from, channelId) {
  const channel = await getChannel(channelId);
  if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) {
    return;
  }

  const notifs = channel.notifications || { channel: true, owner: true };
  const chText = notifs.channel ? '🟢 ON' : '🔴 OFF';
  const owText = notifs.owner ? '🟢 ON' : '🔴 OFF';

  const text =
    `🔔 <b>Notification Settings</b>\n\n` +
    `📢 <b>Channel Alerts:</b> ${chText}\n` +
    `👤 <b>Owner Alerts:</b> ${owText}\n\n` +
    `Toggle notification destinations below:`;

  const keyboard = [
    [
      { text: `📢 Channel: ${chText}`, callback_data: `togglenotif_ch_${channelId}` },
      { text: `👤 Owner: ${owText}`, callback_data: `togglenotif_ow_${channelId}` }
    ],
    [{ text: '🔙 Back', callback_data: `manage_${channelId}` }]
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
      `🔨 <b>Banned Users</b>\n\n` +
      `No users have been banned in this channel yet.`;
    const keyboard = [[{ text: '🔙 Back', callback_data: `manage_${channelId}` }]];
    await editMessage(chatId, messageId, text, {
      reply_markup: { inline_keyboard: keyboard }
    });
    return;
  }

  let text = `🔨 <b>Banned Users (${userKeys.length})</b>\n\n`;
  const keyboard = [];

  const listToDisplay = userKeys.slice(0, 8);
  for (const uid of listToDisplay) {
    const u = bannedUsers[uid];
    const name = u.firstName || 'User';
    const tag = u.username ? ` (${u.username})` : '';
    text += `👤 <b>${name}</b>${tag}\n🆔 <code>${uid}</code>\n\n`;
    keyboard.push([
      {
        text: `♻️ Unban ${name}`,
        callback_data: `unban_${channelId}_${uid}`
      }
    ]);
  }

  keyboard.push([{ text: '🔙 Back', callback_data: `manage_${channelId}` }]);

  await editMessage(chatId, messageId, text, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ==========================================
// ADMIN PANEL (USER ID: 8045367594 ONLY)
// ==========================================
async function showAdminPanel(chatId, messageId = null) {
  const text =
    `👑 <b>Admin Panel</b>\n\n` +
    `Welcome to <b>𝐀𝐔𝐑𝐀 𝐋𝐄𝐀𝐕𝐄 𝐁𝐀𝐍</b> System Administration.\n` +
    `Select a module below:`;

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
    `👥 <b>Users & Channel Overview</b>\n\n` +
    `<b>Total Users:</b> ${totalUsers}\n` +
    `<b>Total Channels:</b> ${totalChannels}\n` +
    `<b>Active Protected Channels:</b> ${activeCount}\n` +
    `<b>Disabled Channels:</b> ${disabledCount}\n` +
    `<b>Admin Removed Channels:</b> ${removedCount}`;

  const keyboard = {
    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_back' }]]
  };

  await editMessage(chatId, messageId, text, { reply_markup: keyboard });
}

async function showAdminChannels(chatId, messageId) {
  const channelsSnap = await get(ref(db, 'channels'));
  if (!channelsSnap.exists()) {
    await editMessage(chatId, messageId, `📢 No registered channels found.`, {
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_back' }]]
      }
    });
    return;
  }

  const channels = channelsSnap.val();
  const keys = Object.keys(channels);
  let text = `📢 <b>Registered Channels (${keys.length})</b>\n\n`;

  const displayKeys = keys.slice(0, 6);
  for (const k of displayKeys) {
    const ch = channels[k];
    const status = ch.botStatus === 'administrator' ? 'Administrator' : 'Admin Removed';
    const prot = ch.protectionEnabled ? 'Enabled' : 'Disabled';

    text +=
      `📢 <b>Channel:</b> ${ch.username || ch.title}\n` +
      `🆔 <b>ID:</b> <code>${ch.channelId}</code>\n` +
      `👤 <b>Owner ID:</b> <code>${ch.ownerId}</code>\n` +
      `🤖 <b>Bot Status:</b> ${status}\n` +
      `🛡 <b>Protection:</b> ${prot}\n\n`;
  }

  const keyboard = {
    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_back' }]]
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
    `📊 <b>System Statistics</b>\n\n` +
    `👥 <b>Total Users:</b> ${usersCount}\n` +
    `📢 <b>Total Channels:</b> ${channels.length}\n` +
    `🟢 <b>Protected Channels:</b> ${protectedCount}\n` +
    `⏸ <b>Disabled Channels:</b> ${disabledCount}\n` +
    `⚠️ <b>Admin Removed:</b> ${removedCount}\n` +
    `🔨 <b>Total Auto Bans:</b> ${totalBans}\n` +
    `♻️ <b>Total Unbans:</b> ${totalUnbans}`;

  const keyboard = {
    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_back' }]]
  };

  await editMessage(chatId, messageId, text, { reply_markup: keyboard });
}

async function handleAdminUserSearch(chatId, queryId) {
  const targetUserId = queryId.trim();
  const userSnap = await get(ref(db, `users/${targetUserId}`));

  if (!userSnap.exists()) {
    await sendMessage(chatId, `❌ User with ID <code>${targetUserId}</code> not found in database.`);
    return;
  }

  const u = userSnap.val();
  const userChannels = u.channels ? Object.values(u.channels) : [];

  let text =
    `👤 <b>User Information</b>\n\n` +
    `<b>Name:</b> ${u.firstName || ''} ${u.lastName || ''}\n` +
    `<b>Username:</b> ${u.username || 'None'}\n` +
    `<b>User ID:</b> <code>${u.id}</code>\n` +
    `<b>Connected Channels:</b> ${userChannels.length}\n\n`;

  if (userChannels.length > 0) {
    text += `<b>Channels List:</b>\n`;
    for (const ch of userChannels) {
      const adminIcon = ch.botStatus === 'administrator' ? '✅' : '❌';
      const protStatus = ch.protectionEnabled ? 'ON' : 'OFF';
      text += `📢 ${ch.username || ch.title}\n🤖 Bot Admin: ${adminIcon}\n🛡 Protection: ${protStatus}\n\n`;
    }
  }

  await sendMessage(chatId, text, {
    reply_markup: getMainMenuKeyboard(chatId)
  });
}

// Broadcast Processing
async function executeBroadcast(adminChatId, broadcastData) {
  const usersSnap = await get(ref(db, 'users'));
  if (!usersSnap.exists()) {
    await sendMessage(adminChatId, `❌ No registered users to broadcast to.`);
    return;
  }

  const users = usersSnap.val();
  const userIds = Object.keys(users);
  const total = userIds.length;

  await sendMessage(adminChatId, `⏳ Starting broadcast to <b>${total}</b> users...`);

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

    // Respect rate limits (~25 requests/sec)
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
    `📣 <b>Broadcast Completed</b>\n\n` +
    `✅ <b>Sent:</b> ${success}\n` +
    `❌ <b>Failed:</b> ${failed}\n` +
    `👥 <b>Total:</b> ${total}`;

  await sendMessage(adminChatId, reportText, {
    reply_markup: getMainMenuKeyboard(adminChatId)
  });
}

// ==========================================
// CORE AUTO-BAN ENGINE (LEAVE DETECTION)
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

    // Safety: Never ban bot itself
    if (targetUser.id === BOT_USER_ID) {
      if (new_chat_member.status === 'left' || new_chat_member.status === 'kicked') {
        await updateChannelField(channelId, channel.ownerId, 'botStatus', 'admin_removed');
        await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', false);

        await sendMessage(
          channel.ownerId,
          `⚠️ <b>Protection Paused</b>\n\n` +
          `📢 <b>${channel.username || channel.title}</b>\n\n` +
          `I am no longer an administrator of this channel.\n` +
          `Please make me administrator again to continue protection.`
        );
      }
      return;
    }

    // Verify protection state
    if (!channel.protectionEnabled || channel.botStatus !== 'administrator') {
      return;
    }

    const oldStatus = old_chat_member ? old_chat_member.status : 'unknown';
    const newStatus = new_chat_member.status;

    // Safety: Never ban channel administrators or owners
    if (oldStatus === 'creator' || oldStatus === 'administrator' ||
        newStatus === 'creator' || newStatus === 'administrator') {
      return;
    }

    // Voluntary leave detection: status transitions to 'left'
    const isVoluntaryLeave = (newStatus === 'left') &&
      (!from || from.id === targetUser.id || oldStatus === 'member');

    if (!isVoluntaryLeave) {
      return;
    }

    console.log(`[LEAVE DETECTED] User ${targetUser.id} left channel ${channelId}`);

    // Check target is not bot owner or channel owner
    if (Number(targetUser.id) === Number(channel.ownerId) || Number(targetUser.id) === MAIN_ADMIN_ID) {
      return;
    }

    // Ensure bot has live ban permission
    const botPerms = await checkBotPermissions(channelId);
    if (!botPerms.canBan) {
      console.warn(`[WARN] Bot lacks ban permissions in ${channelId}`);
      return;
    }

    // Execute ban
    const banResult = await banChatMember(channelId, targetUser.id);
    if (!banResult.ok) {
      console.error(`[ERROR] banChatMember failed: ${banResult.description}`);
      return;
    }

    console.log(`[BAN EXECUTED] User ${targetUser.id} banned from ${channelId}`);

    // Store record in Firebase
    await saveBanRecord(channelId, targetUser);
    await logEvent('AUTO_BAN', { channelId, userId: targetUser.id });

    const notifications = channel.notifications || { channel: true, owner: true };
    const userName = targetUser.first_name || 'Member';
    const userDisplay = targetUser.username ? `@${targetUser.username}` : userName;

    // 1. Channel Notification
    if (notifications.channel) {
      const chMsg =
        `🚫 <b>AUTO BAN</b>\n\n` +
        `👤 <b>User:</b> ${userName}\n` +
        `🆔 <b>ID:</b> <code>${targetUser.id}</code>\n` +
        `📢 <b>Channel:</b> ${chat.title || 'This Channel'}\n` +
        `⚡ <b>Reason:</b> User left the channel.\n` +
        `🔨 <b>Status:</b> BANNED`;

      await sendMessage(channelId, chMsg);
    }

    // 2. Private Notification to Channel Owner
    if (notifications.owner && channel.ownerId) {
      const nowStr = new Date().toUTCString();
      const ownerMsg =
        `🚫 <b>Auto Ban Triggered</b>\n\n` +
        `📢 <b>Channel:</b> ${channel.username || channel.title}\n` +
        `👤 <b>User:</b> ${userDisplay}\n` +
        `🆔 <b>User ID:</b> <code>${targetUser.id}</code>\n` +
        `⚡ <b>Reason:</b> Left the channel\n` +
        `🔨 <b>Action:</b> Automatically Banned\n` +
        `🕒 <b>Time:</b> ${nowStr}`;

      await sendMessage(channel.ownerId, ownerMsg);
    }
  } catch (err) {
    console.error(`[ERROR] handleChatMemberUpdated exception: ${err.message}`);
  }
}

// Bot Self Status Monitoring
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
      console.log(`[STATUS] Bot admin restored in channel ${channelId}`);
    } else {
      await updateChannelField(channelId, channel.ownerId, 'botStatus', 'admin_removed');
      await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', false);

      await sendMessage(
        channel.ownerId,
        `⚠️ <b>Protection Paused</b>\n\n` +
        `📢 <b>${channel.username || channel.title}</b>\n\n` +
        `I am no longer an administrator of this channel.\n` +
        `Please make me administrator again to continue protection.`
      );
    }
  } catch (err) {
    console.error(`[ERROR] handleMyChatMemberUpdated exception: ${err.message}`);
  }
}

// ==========================================
// CALLBACK QUERY ROUTER
// ==========================================
async function handleCallbackQuery(callbackQuery) {
  const { id, from, message, data } = callbackQuery;
  const chatId = message ? message.chat.id : from.id;
  const messageId = message ? (message.messageId || message.message_id) : null;

  try {
    await answerCallbackQuery(id);

    if (data === 'cancel_action') {
      userStates.delete(from.id);
      await editMessage(chatId, messageId, `❌ Action cancelled.`);
      await sendMessage(chatId, `Main Menu:`, {
        reply_markup: getMainMenuKeyboard(from.id)
      });
      return;
    }

    if (data === 'nav_my_channels' || data === 'settings_channels') {
      await handleMyChannels(chatId, from, messageId);
      return;
    }

    if (data === 'nav_add_channel') {
      await handleAddChannelPrompt(chatId, from);
      return;
    }

    if (data === 'settings_main') {
      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: '👤 My Account', callback_data: 'settings_account' }],
          [{ text: '📂 My Channels', callback_data: 'settings_channels' }],
          [{ text: '📖 How It Works', callback_data: 'settings_how' }]
        ]
      };
      await editMessage(chatId, messageId, `⚙️ <b>Settings</b>\n\nChoose an option:`, {
        reply_markup: inlineKeyboard
      });
      return;
    }

    if (data === 'settings_account') {
      await handleMyAccount(chatId, from, messageId);
      return;
    }

    if (data === 'settings_how') {
      await handleHowItWorks(chatId, from);
      return;
    }

    // Admin Panel Actions
    if (data.startsWith('admin_')) {
      if (Number(from.id) !== MAIN_ADMIN_ID) return;

      if (data === 'admin_back') {
        await showAdminPanel(chatId, messageId);
        return;
      }
      if (data === 'admin_close') {
        await editMessage(chatId, messageId, `👑 Admin Panel closed.`);
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
          `📣 <b>Broadcast</b>\n\n` +
          `Send the message you want to broadcast to all bot users.\n` +
          `You can send text or forward a message.`,
          { reply_markup: getCancelKeyboard() }
        );
        return;
      }
      if (data === 'admin_user_search') {
        userStates.set(from.id, { step: 'user_search_waiting' });
        await sendMessage(
          chatId,
          `🔍 <b>User Search</b>\n\nSend the Telegram User ID to look up:\nExample: <code>8045367594</code>`,
          { reply_markup: getCancelKeyboard() }
        );
        return;
      }
      return;
    }

    // Broadcast Confirm/Cancel
    if (data === 'broadcast_confirm') {
      if (Number(from.id) !== MAIN_ADMIN_ID) return;
      const state = userStates.get(from.id);
      if (!state || !state.broadcastPayload) {
        await editMessage(chatId, messageId, `❌ Broadcast expired or not found.`);
        return;
      }
      userStates.delete(from.id);
      await editMessage(chatId, messageId, `🚀 Broadcast confirmed. Broadcasting...`);
      await executeBroadcast(chatId, state.broadcastPayload);
      return;
    }

    if (data === 'broadcast_cancel') {
      userStates.delete(from.id);
      await editMessage(chatId, messageId, `❌ Broadcast cancelled.`);
      return;
    }

    // Recheck Channel Promotion
    if (data.startsWith('recheck_')) {
      const channelId = data.replace('recheck_', '');
      const botPerms = await checkBotPermissions(channelId);
      if (!botPerms.isBotAdmin || !botPerms.canBan) {
        await answerCallbackQuery(
          id,
          '⚠️ Still not administrator with ban permission. Please grant permissions and check again.',
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
        `✅ <b>Channel Connected Successfully!</b>\n\nProtection is now 🟢 ACTIVE.`
      );
      await sendMessage(chatId, `Main Menu:`, {
        reply_markup: getMainMenuKeyboard(from.id)
      });
      return;
    }

    // Manage Specific Channel
    if (data.startsWith('manage_')) {
      const channelId = data.replace('manage_', '');
      await handleManageChannel(chatId, messageId, from, channelId);
      return;
    }

    // Toggle Protection
    if (data.startsWith('prot_on_') || data.startsWith('prot_off_')) {
      const isEnable = data.startsWith('prot_on_');
      const channelId = data.replace(isEnable ? 'prot_on_' : 'prot_off_', '');
      const channel = await getChannel(channelId);

      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) {
        await answerCallbackQuery(id, 'Unauthorized.', true);
        return;
      }

      if (isEnable) {
        const botPerms = await checkBotPermissions(channelId);
        if (!botPerms.canBan) {
          await answerCallbackQuery(
            id,
            '⚠️ Bot must be an Administrator with Ban permissions before enabling protection.',
            true
          );
          return;
        }
      }

      await updateChannelField(channelId, channel.ownerId, 'protectionEnabled', isEnable);
      await answerCallbackQuery(id, isEnable ? '🛡 Protection Enabled' : '⏸ Protection Disabled');
      await handleManageChannel(chatId, messageId, from, channelId);
      return;
    }

    // Live Admin Check
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
        await answerCallbackQuery(id, '⚠️ Bot is NOT an administrator in this channel.', true);
      } else {
        await answerCallbackQuery(id, '✅ Bot is administrator with required permissions.', true);
      }
      await handleManageChannel(chatId, messageId, from, channelId);
      return;
    }

    // Notifications Menu
    if (data.startsWith('notif_')) {
      const channelId = data.replace('notif_', '');
      await handleNotificationSettings(chatId, messageId, from, channelId);
      return;
    }

    // Toggle Notifications
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

    // Banned Users List
    if (data.startsWith('banned_')) {
      const channelId = data.replace('banned_', '');
      await handleBannedUsersList(chatId, messageId, from, channelId);
      return;
    }

    // Execute Manual Unban
    if (data.startsWith('unban_')) {
      const parts = data.split('_');
      const channelId = parts[1];
      const targetUid = parts[2];
      const channel = await getChannel(channelId);

      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) {
        await answerCallbackQuery(id, 'Unauthorized.', true);
        return;
      }

      const unbanRes = await unbanChatMember(channelId, targetUid);
      if (unbanRes.ok) {
        await recordUnban(channelId, targetUid);
        await answerCallbackQuery(id, '♻️ User unbanned! They can now rejoin.', true);
      } else {
        await answerCallbackQuery(id, `❌ Unban failed: ${unbanRes.description}`, true);
      }

      await handleBannedUsersList(chatId, messageId, from, channelId);
      return;
    }

    // Removal Confirmation Prompts
    if (data.startsWith('delconf_')) {
      const channelId = data.replace('delconf_', '');
      const channel = await getChannel(channelId);
      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) return;

      const text =
        `⚠️ <b>Remove Channel?</b>\n\n` +
        `Are you sure you want to remove:\n<b>${channel.username || channel.title}</b>\nfrom your protected channels?`;

      const keyboard = {
        inline_keyboard: [
          [{ text: '✅ Yes, Remove', callback_data: `delyes_${channelId}` }],
          [{ text: '❌ Cancel', callback_data: `manage_${channelId}` }]
        ]
      };

      await editMessage(chatId, messageId, text, { reply_markup: keyboard });
      return;
    }

    // Confirm Removal
    if (data.startsWith('delyes_')) {
      const channelId = data.replace('delyes_', '');
      const channel = await getChannel(channelId);
      if (!channel || (String(channel.ownerId) !== String(from.id) && Number(from.id) !== MAIN_ADMIN_ID)) return;

      await removeChannel(channelId, channel.ownerId);

      await editMessage(
        chatId,
        messageId,
        `✅ <b>Channel Removed</b>\n\nThis channel is no longer protected by your bot.`
      );
      await sendMessage(chatId, `Main Menu:`, {
        reply_markup: getMainMenuKeyboard(from.id)
      });
      return;
    }
  } catch (err) {
    console.error(`[ERROR] handleCallbackQuery exception: ${err.message}`);
  }
}

// ==========================================
// MESSAGE ROUTER
// ==========================================
async function handleMessage(message) {
  const chatId = message.chat.id;
  const from = message.from;
  const text = (message.text || '').trim();

  if (!from) return;
  await saveUser(from);

  const state = userStates.get(from.id);

  // Global Cancel
  if (text === '❌ Cancel' || text === '/cancel') {
    userStates.delete(from.id);
    await sendMessage(chatId, `❌ Cancelled. Returned to Main Menu.`, {
      reply_markup: getMainMenuKeyboard(from.id)
    });
    return;
  }

  // Handle waiting state: Broadcast input
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
      `⚠️ <b>Confirm Broadcast</b>\n\n` +
      `You are about to send this message to:\n<b>${totalCount}</b> registered users.\n\n` +
      `Do you want to proceed?`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '✅ Confirm', callback_data: 'broadcast_confirm' }],
        [{ text: '❌ Cancel', callback_data: 'broadcast_cancel' }]
      ]
    };

    await sendMessage(chatId, confirmText, { reply_markup: keyboard });
    return;
  }

  // Handle waiting state: User Search input
  if (state && state.step === 'user_search_waiting') {
    if (Number(from.id) !== MAIN_ADMIN_ID) {
      userStates.delete(from.id);
      return;
    }
    userStates.delete(from.id);
    await handleAdminUserSearch(chatId, text);
    return;
  }

  // Handle waiting state: Channel Input
  if (state && state.step === 'waiting_channel_input') {
    await handleChannelInput(chatId, from, text);
    return;
  }

  // Command & Main Menu Routing
  if (text === '/start') {
    await handleStart(chatId, from);
    return;
  }

  if (text === '📖 How It Works' || text === '/help') {
    await handleHowItWorks(chatId, from);
    return;
  }

  if (text === '➕ Add Channel') {
    await handleAddChannelPrompt(chatId, from);
    return;
  }

  if (text === '📂 My Channels') {
    await handleMyChannels(chatId, from);
    return;
  }

  if (text === '⚙️ Settings') {
    await handleSettingsMenu(chatId, from);
    return;
  }

  if (text === '👑 Admin Panel' || text === '/admin') {
    if (Number(from.id) === MAIN_ADMIN_ID) {
      await showAdminPanel(chatId);
    }
    // Strict requirement: Non-admins receive zero response
    return;
  }

  // Default fallback for private chat messages
  if (message.chat.type === 'private') {
    await sendMessage(
      chatId,
      `🤖 Please use the buttons below to manage your channels.`,
      { reply_markup: getMainMenuKeyboard(from.id) }
    );
  }
}

// ==========================================
// CENTRAL TELEGRAM UPDATE DISPATCHER
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
    console.error(`[ERROR] Unhandled update error: ${err.message}`);
  }
}

// ==========================================
// RENDER SERVER & WEBHOOK / POLLING SETUP
// ==========================================
const app = express();
app.use(express.json());

// Render Health Check Endpoint
app.get('/', (req, res) => {
  res.status(200).send('𝐀𝐔𝐑𝐀 𝐋𝐄𝐀𝐕𝐄 𝐁𝐀𝐍 is running.');
});

// Telegram Webhook Endpoint
const WEBHOOK_PATH = `/api/webhook`;
app.post(WEBHOOK_PATH, (req, res) => {
  res.sendStatus(200);
  processUpdate(req.body);
});

// Start Express Server
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[INFO] Server running on 0.0.0.0:${PORT}`);

  // Fetch bot details
  const me = await callTelegram('getMe');
  if (me.ok) {
    BOT_USER_ID = me.result.id;
    console.log(`[INFO] Bot connected: @${me.result.username} (${BOT_USER_ID})`);
  } else {
    console.error(`[ERROR] Unable to authenticate BOT_TOKEN with Telegram.`);
  }

  // Webhook Registration on Render
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
  const allowedUpdates = ['message', 'callback_query', 'chat_member', 'my_chat_member'];

  if (externalUrl) {
    const fullWebhookUrl = `${externalUrl.replace(/\/$/, '')}${WEBHOOK_PATH}`;
    const webhookRes = await callTelegram('setWebhook', {
      url: fullWebhookUrl,
      allowed_updates: allowedUpdates,
      drop_pending_updates: false
    });
    console.log(`[INFO] Webhook setup (${fullWebhookUrl}): ${webhookRes.ok ? 'SUCCESS' : webhookRes.description}`);
  } else {
    console.log('[INFO] No external URL detected. Starting Long-Polling fallback...');
    await callTelegram('deleteWebhook', { drop_pending_updates: false });
    startLongPolling(allowedUpdates);
  }
});

// Long polling fallback for development
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
