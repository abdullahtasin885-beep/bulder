/*
|--------------------------------------------------------------------------
| TELEGRAM MULTI-BOT BUILDER PLATFORM (FULL RESTORED SUITE)
| - Builder Token: 8950164597:AAHjXI-LuvxBINicm85BwSe_-KV-k5PuLFo
| - Builder Username: @AuraBuilderProBot
| - Builder Super Admin: 8045367594
| - Complete Child Bot Engine: All Admin Tools + Dynamic Payment Methods
| - Multi-Tenant Firebase Storage: /bots/{botId}/...
|--------------------------------------------------------------------------
*/

const express = require('express');

// ==========================================
// 1. SYSTEM CONFIGURATION
// ==========================================
const BUILDER_BOT_TOKEN = process.env.BUILDER_BOT_TOKEN || '8950164597:AAHjXI-LuvxBINicm85BwSe_-KV-k5PuLFo';
const BUILDER_BOT_USERNAME = 'AuraBuilderProBot';
const BUILDER_SUPER_ADMIN_ID = '8045367594';
const APP_URL = process.env.APP_URL || 'https://bulder.onrender.com';
const FIREBASE_DB_URL = 'https://bkas-45e17-default-rtdb.firebaseio.com';

const builderMemory = {
    states: new Map(),
    bots: new Map(),
    settings: {
        bkash: '01XXXXXXXXX',
        nagad: '01XXXXXXXXX',
        rocket: '01XXXXXXXXX',
        upgrade_fee: '150 BDT',
        support_url: 'https://t.me/AuraSupportsBot'
    }
};

const childCaches = new Map();

/*
|--------------------------------------------------------------------------
| 2. HELPERS & FORMATTERS
|--------------------------------------------------------------------------
*/
function escapeHtml(text) {
    if (typeof text !== 'string') text = String(text ?? '');
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cleanText(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/[\uFE00-\uFE0F\u200B-\u200D\uFEFF]/g, '').trim();
}

function formatNumber(num) {
    num = Number(num);
    if (isNaN(num) || !isFinite(num)) return '0';
    return Math.abs(num - Math.round(num)) < 0.005 ? Math.round(num).toString() : (Math.round(num * 100) / 100).toString();
}

function formatTimestamp(sec) {
    if (!sec) return 'N/A';
    return new Date(Number(sec) * 1000).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
}

function getCancelKeyboard() {
    return { keyboard: [[{ text: '❌ Cancel' }]], resize_keyboard: true, one_time_keyboard: true };
}

function getCommand(rawText) {
    const s = cleanText(rawText).toLowerCase();
    if (s.startsWith('/start')) return 'start';
    if (s === '❌ cancel' || s === '/cancel') return 'cancel';
    if (s.includes('my account') || s.includes('account')) return 'account';
    if (s.includes('referral')) return 'referral';
    if (s.includes('withdraw')) return 'withdraw';
    if (s.includes('history')) return 'history';
    if (s.includes('system status') || s.includes('status')) return 'status';
    if (s.includes('admin panel')) return 'admin_panel';
    if (s.includes('back to user panel')) return 'back_user';
    if (s.includes('central settings')) return 'central_settings';
    if (s.includes('user & balance')) return 'user_balance';
    if (s.includes('channel broadcast')) return 'channel_broadcast';
    if (s.includes('users broadcast')) return 'users_broadcast';
    if (s.includes('security')) return 'security';
    if (s.includes('force channels')) return 'force_channels';
    if (s.includes('payouts done')) return 'payouts_done';
    if (s.includes('payment methods')) return 'payment_methods';
    if (s.includes('source settings')) return 'source_settings';
    if (s.includes('এডমিন ম্যানেজমেন্ট') || s.includes('admin management')) return 'admin_management';
    if (s.includes('active (on)') || s.includes('bot: off') || s.includes('maintenance')) return 'bot_power';
    return 'text';
}

async function firebaseRequest(path, method = 'GET', data = null) {
    path = path.replace(/^\/+|\/+$/g, '');
    const url = `${FIREBASE_DB_URL}/${path}.json`;
    const options = {
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' }
    };
    if (data !== null) options.body = JSON.stringify(data);

    try {
        const res = await fetch(url, options);
        if (!res.ok) return null;
        const text = await res.text();
        return (text === 'null' || !text) ? null : JSON.parse(text);
    } catch (e) {
        console.error(`Firebase Error [${path}]:`, e.message);
        return null;
    }
}

async function telegramApi(token, method, params = {}) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        return await res.json();
    } catch (e) {
        return { ok: false, description: e.message };
    }
}

async function sendMsg(token, cid, txt, rm = null) {
    let res = await telegramApi(token, 'sendMessage', {
        chat_id: cid, text: txt, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: rm
    });
    // Fallback in case HTML tags are slightly malformed
    if (!res?.ok && res?.description && res.description.includes('can\'t parse entities')) {
        res = await telegramApi(token, 'sendMessage', {
            chat_id: cid, text: txt.replace(/<[^>]*>?/gm, ''), disable_web_page_preview: true, reply_markup: rm
        });
    }
    return res;
}

async function editMsg(token, cid, mid, txt, rm = null) {
    return await telegramApi(token, 'editMessageText', {
        chat_id: cid, message_id: mid, text: txt, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: rm
    });
}

async function copyMsg(token, toChatId, fromChatId, messageId, rm = null) {
    return await telegramApi(token, 'copyMessage', {
        chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId, reply_markup: rm
    });
}

/*
|--------------------------------------------------------------------------
| 3. BUILDER BOT CONTROLLER
|--------------------------------------------------------------------------
*/
function getBuilderMenu(userId) {
    const isOwner = String(userId) === BUILDER_SUPER_ADMIN_ID;
    const keyboard = [
        [{ text: 'Create Bot' }, { text: 'Bot List' }],
        [{ text: 'Upgrade Branding' }, { text: 'Support' }]
    ];
    if (isOwner) {
        keyboard.push([{ text: '👑 Admin Control' }]);
    }
    return { keyboard, resize_keyboard: true };
}

async function handleBuilderUpdate(update) {
    if (update.callback_query) {
        const cq = update.callback_query;
        const fromId = String(cq.from.id);
        const data = cq.data || '';

        if (data.startsWith('builder_upgrade_')) {
            const botId = data.replace('builder_upgrade_', '');
            builderMemory.states.set(fromId, { step: 'awaiting_payment_trx', botId });
            await telegramApi(BUILDER_BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id });

            const payText = 
                `💎 <b>Upgrade Custom Branding</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `বটের সিস্টেম স্ট্যাটাসে আপনার নিজস্ব নাম ও লিংক বসাতে আপগ্রেড করুন।\n\n` +
                `💵 <b>চার্জ:</b> ${builderMemory.settings.upgrade_fee}\n` +
                `📱 <b>বিকাশ (Personal):</b> <code>${builderMemory.settings.bkash}</code>\n` +
                `📱 <b>নগদ (Personal):</b> <code>${builderMemory.settings.nagad}</code>\n` +
                `📱 <b>রকেট (Personal):</b> <code>${builderMemory.settings.rocket}</code>\n\n` +
                `টাকা পাঠিয়ে আপনার <b>TrxID</b> এবং নাম্বারটি লিখে পাঠান:`;
            
            await sendMsg(BUILDER_BOT_TOKEN, fromId, payText, getCancelKeyboard());
            return;
        }

        if (data.startsWith('adm_approve_upg_') && fromId === BUILDER_SUPER_ADMIN_ID) {
            const botId = data.replace('adm_approve_upg_', '');
            await firebaseRequest(`builder/bots/${botId}`, 'PATCH', { is_upgraded: true });
            
            const b = builderMemory.bots.get(botId);
            if (b) b.is_upgraded = true;

            await telegramApi(BUILDER_BOT_TOKEN, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Approved!' });
            await sendMsg(BUILDER_BOT_TOKEN, cq.message.chat.id, `✅ <b>Bot (${botId}) Branding Approved!</b>`);

            const botData = await firebaseRequest(`builder/bots/${botId}`);
            if (botData?.creator_id) {
                await sendMsg(BUILDER_BOT_TOKEN, botData.creator_id, `🎉 <b>অভিনন্দন!</b> আপনার বট <b>@${botData.bot_username}</b> এর কাস্টম ব্র্যান্ডিং অনুমোদন করা হয়েছে!\nএখন বটের এডমিন প্যানেল থেকে নিজের সোর্স ও লিংক সেট করতে পারবেন।`);
            }
            return;
        }
    }

    if (!update.message) return;
    const msg = update.message;
    const fromId = String(msg.from.id);
    const text = cleanText(msg.text || '');

    if (text === '❌ Cancel' || text === '/cancel') {
        builderMemory.states.delete(fromId);
        await sendMsg(BUILDER_BOT_TOKEN, fromId, '❌ Cancelled.', getBuilderMenu(fromId));
        return;
    }

    const curState = builderMemory.states.get(fromId);

    if (text === '👑 Admin Control' && fromId === BUILDER_SUPER_ADMIN_ID) {
        const allBots = await firebaseRequest('builder/bots') || {};
        const count = Object.keys(allBots).length;
        let listStr = `👑 <b>BUILDER SUPER ADMIN PANEL</b>\n━━━━━━━━━━━━━━━━━━━━\nমোট সক্রিয় বট: <b>${count}</b> টি\n\n`;
        for (const [bid, b] of Object.entries(allBots)) {
            listStr += `🤖 @${escapeHtml(b.bot_username)} | ওনার: <code>${b.creator_id}</code> | আপগ্রেড: ${b.is_upgraded ? '✅' : '❌'}\n`;
        }
        await sendMsg(BUILDER_BOT_TOKEN, fromId, listStr);
        return;
    }

    if (text === 'Support') {
        await sendMsg(BUILDER_BOT_TOKEN, fromId, `🎧 <b>Support Team:</b>\n${builderMemory.settings.support_url}`);
        return;
    }

    if (text === 'Upgrade Branding') {
        const allBots = await firebaseRequest('builder/bots') || {};
        const userBots = Object.values(allBots).filter(b => String(b.creator_id) === String(fromId));
        if (!userBots.length) {
            await sendMsg(BUILDER_BOT_TOKEN, fromId, '⚠️ আপনার তৈরি কোনো বট পাওয়া যায়নি। প্রথমে বট তৈরি করুন!', getBuilderMenu(fromId));
            return;
        }

        const buttons = userBots.map(b => [{
            text: `Upgrade @${b.bot_username} ${b.is_upgraded ? '(Active ✅)' : ''}`,
            callback_data: `builder_upgrade_${b.bot_id}`
        }]);

        await sendMsg(BUILDER_BOT_TOKEN, fromId, '💎 <b>কোন বটের কাস্টম ব্র্যান্ডিং আপগ্রেড করতে চান? নির্বাচন করুন:</b>', { inline_keyboard: buttons });
        return;
    }

    if (curState?.step === 'awaiting_payment_trx') {
        builderMemory.states.delete(fromId);
        await sendMsg(BUILDER_BOT_TOKEN, fromId, '✅ আপনার পেমেন্ট রিকোয়েস্ট জমা হয়েছে! এডমিন যাচাই করে একটিভ করে দিবে।', getBuilderMenu(fromId));

        const targetBot = await firebaseRequest(`builder/bots/${curState.botId}`);
        const alertAdmin = 
            `🔔 <b>নতুন ব্র্যান্ডিং আপগ্রেড পেমেন্ট!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 ইউজার: <code>${fromId}</code>\n` +
            `🤖 বট: @${escapeHtml(targetBot?.bot_username || curState.botId)}\n` +
            `📝 তথ্য: <code>${escapeHtml(text)}</code>`;
        
        await sendMsg(BUILDER_BOT_TOKEN, BUILDER_SUPER_ADMIN_ID, alertAdmin, {
            inline_keyboard: [[{ text: '✅ Approve Upgrade', callback_data: `adm_approve_upg_${curState.botId}` }]]
        });
        return;
    }

    if (text === 'Bot List') {
        const allBots = await firebaseRequest('builder/bots') || {};
        const userBots = Object.values(allBots).filter(b => String(b.creator_id) === String(fromId));
        if (!userBots.length) {
            await sendMsg(BUILDER_BOT_TOKEN, fromId, '📭 আপনি এখনো কোনো বট বানাননি। নিচের <b>Create Bot</b> বাটনে চাপ দিন।', getBuilderMenu(fromId));
            return;
        }

        let out = `📋 <b>আপনার বট তালিকা:</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const b of userBots) {
            out += `🤖 <b>বট:</b> @${escapeHtml(b.bot_username)}\n` +
                   `🆔 <b>ID:</b> <code>${b.bot_id}</code>\n` +
                   `👑 <b>Admin:</b> <code>${b.super_admin_id}</code>\n` +
                   `💎 <b>Branding:</b> ${b.is_upgraded ? 'কাস্টম ব্র্যান্ডিং অন ✅' : 'বিল্ডার ব্র্যান্ডিং 🔒'}\n\n`;
        }

        await sendMsg(BUILDER_BOT_TOKEN, fromId, out, getBuilderMenu(fromId));
        return;
    }

    if (text === 'Create Bot') {
        builderMemory.states.set(fromId, { step: 'awaiting_token' });
        await sendMsg(BUILDER_BOT_TOKEN, fromId, `🤖 <b>আপনার বট টোকেন দিন:</b>\n\n(@BotFather থেকে পাওয়া API Token পাঠান)`, getCancelKeyboard());
        return;
    }

    if (curState?.step === 'awaiting_token') {
        const token = text.trim();
        if (!/^\d{8,11}:[A-Za-z0-9_-]{35}$/.test(token)) {
            await sendMsg(BUILDER_BOT_TOKEN, fromId, '❌ ভুল টোকেন! সঠিক Bot Token পাঠান:', getCancelKeyboard());
            return;
        }

        const me = await telegramApi(token, 'getMe');
        if (!me.ok) {
            await sendMsg(BUILDER_BOT_TOKEN, fromId, `❌ টোকেন কাজ করছে না! Telegram: <i>${escapeHtml(me.description)}</i>\nসঠিক টোকেন পাঠান:`, getCancelKeyboard());
            return;
        }

        builderMemory.states.set(fromId, {
            step: 'awaiting_username',
            token: token,
            realUsername: me.result.username,
            botId: String(me.result.id)
        });

        await sendMsg(BUILDER_BOT_TOKEN, fromId, `✅ টোকেন ভেরিফাইড (বট: <b>@${me.result.username}</b>)!\n\nএখন বটের <b>ইউজারনেম</b> টি দিন:`, getCancelKeyboard());
        return;
    }

    if (curState?.step === 'awaiting_username') {
        const uName = text.replace('@', '').trim();
        builderMemory.states.set(fromId, {
            ...curState,
            step: 'awaiting_admin_id',
            botUsername: uName
        });

        await sendMsg(BUILDER_BOT_TOKEN, fromId, `✅ ইউজারনেম গ্রহণ করা হয়েছে।\n\nএবার আপনার বটের <b>সুপার এডমিন আইডি (Numeric ID)</b> দিন:`, getCancelKeyboard());
        return;
    }

    if (curState?.step === 'awaiting_admin_id') {
        if (!/^\d+$/.test(text)) {
            await sendMsg(BUILDER_BOT_TOKEN, fromId, '❌ সুপার এডমিন আইডি অবশ্যই সংখ্যা (Numeric) হতে হবে। আবার দিন:', getCancelKeyboard());
            return;
        }

        const superAdminId = text;
        const botId = curState.botId;
        const childWebhookUrl = `${APP_URL}/webhook/child/${botId}`;

        const whRes = await telegramApi(curState.token, 'setWebhook', {
            url: childWebhookUrl,
            drop_pending_updates: true
        });

        if (!whRes.ok) {
            await sendMsg(BUILDER_BOT_TOKEN, fromId, `❌ বট তৈরিতে সমস্যা: <code>${escapeHtml(whRes.description)}</code>`, getBuilderMenu(fromId));
            builderMemory.states.delete(fromId);
            return;
        }

        const newBotRecord = {
            bot_id: botId,
            token: curState.token,
            bot_username: curState.botUsername,
            super_admin_id: superAdminId,
            creator_id: fromId,
            is_upgraded: false,
            created_at: Math.floor(Date.now() / 1000)
        };

        await firebaseRequest(`builder/bots/${botId}`, 'PUT', newBotRecord);
        builderMemory.bots.set(botId, newBotRecord);
        builderMemory.states.delete(fromId);

        // Standard Default Setup
        await firebaseRequest(`bots/${botId}/settings`, 'PUT', {
            coin_name: 'STAR',
            min_withdraw: 2,
            referral_bonus: 1,
            welcome_bonus: 0,
            withdraw_fee_percent: 0,
            first_withdraw_refs: 0,
            bot_power_status: 'on',
            whitelist_only_mode: 'off',
            payment_methods: ['bKash', 'Nagad', 'Rocket']
        });

        const successMsg = 
            `🎉 <b>আপনার বট সফলভাবে তৈরি হয়েছে!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `🤖 <b>বট:</b> @${escapeHtml(curState.botUsername)}\n` +
            `👑 <b>সুপার এডমিন:</b> <code>${superAdminId}</code>\n` +
            `🔗 <b>লিংক:</b> https://t.me/${curState.botUsername}\n\n` +
            `<i>আপনার বটে গিয়ে /start দিন এবং সম্পুর্ণ বট পরিচালনা করুন!</i>`;

        await sendMsg(BUILDER_BOT_TOKEN, fromId, successMsg, getBuilderMenu(fromId));
        return;
    }

    await sendMsg(BUILDER_BOT_TOKEN, fromId, `🌟 <b>Welcome to ${escapeHtml(BUILDER_BOT_USERNAME)}!</b>\n\nনিচের বাটনগুলো ব্যবহার করুন:`, getBuilderMenu(fromId));
}

/*
|--------------------------------------------------------------------------
| 4. COMPLETE CHILD BOT ENGINE (ALL ORIGINAL ADMIN FEATURES RESTORED)
|--------------------------------------------------------------------------
*/
function getChildCache(botId) {
    if (!childCaches.has(botId)) {
        childCaches.set(botId, {
            users: new Map(),
            settings: new Map(),
            userChannels: new Map(),
            forceChannels: {},
            admins: {},
            blacklist: {},
            whitelist: {},
            paymentMethods: ['bKash', 'Nagad', 'Rocket'],
            botActive: true,
            whitelistOnly: false,
            adminStates: new Map(),
            userStates: new Map(),
            _loaded: false
        });
    }
    return childCaches.get(botId);
}

async function childDb(botId, path, method = 'GET', data = null) {
    return await firebaseRequest(`bots/${botId}/${path}`, method, data);
}

// Preload child bot cache on startup
async function ensureChildCacheLoaded(botId, cache) {
    if (cache._loaded) return;
    try {
        const [settings, admins, forceCh, bl, wl, methods] = await Promise.all([
            childDb(botId, 'settings'),
            childDb(botId, 'admins'),
            childDb(botId, 'force_channels'),
            childDb(botId, 'security/blacklist'),
            childDb(botId, 'security/whitelist'),
            childDb(botId, 'settings/payment_methods')
        ]);

        if (settings && typeof settings === 'object') {
            for (const [k, v] of Object.entries(settings)) cache.settings.set(k, v);
            cache.botActive = settings.bot_power_status !== 'off';
            cache.whitelistOnly = settings.whitelist_only_mode === 'on';
        }
        if (admins && typeof admins === 'object') cache.admins = admins;
        if (forceCh && typeof forceCh === 'object') cache.forceChannels = forceCh;
        if (bl && typeof bl === 'object') cache.blacklist = bl;
        if (wl && typeof wl === 'object') cache.whitelist = wl;
        if (Array.isArray(methods) && methods.length > 0) cache.paymentMethods = methods;
        cache._loaded = true;
    } catch (e) {
        console.error(`Cache Warmup Error [${botId}]:`, e.message);
    }
}

async function verifyChannelAndBotAdmin(botToken, targetInput) {
    let normalized = cleanText(targetInput);
    if (!normalized) return { ok: false, error: "❌ সঠিক Channel ID বা Username দিন।" };
    if (!normalized.startsWith('-100') && !normalized.startsWith('@')) {
        const linkMatch = normalized.match(/(?:https?:\/\/)?(?:www\.)?t\.me\/([A-Za-z0-9_]{4,32})/i);
        if (linkMatch) normalized = '@' + linkMatch[1];
        else if (/^[A-Za-z0-9_]{4,32}$/.test(normalized)) normalized = '@' + normalized;
    }

    const chatRes = await telegramApi(botToken, 'getChat', { chat_id: normalized });
    if (!chatRes?.ok || !chatRes.result) {
        return { ok: false, error: "❌ চ্যানেলটি পাওয়া যায়নি! ইউজারনেম সঠিক কিনা এবং বট চ্যানেলে যুক্ত আছে কিনা নিশ্চিত করুন।" };
    }

    const chat = chatRes.result;
    const botId = botToken.split(':')[0];
    const memberRes = await telegramApi(botToken, 'getChatMember', { chat_id: chat.id, user_id: botId });

    if (!memberRes?.ok || !['administrator', 'creator'].includes(memberRes.result?.status)) {
        return { ok: false, error: `❌ বট <b>${escapeHtml(chat.title || 'Channel')}</b> চ্যানেলে এডমিন নয়! দয়া করে এডমিন পারমিশন দিন।` };
    }

    return {
        ok: true,
        channel_id: String(chat.id),
        channel_title: chat.title || 'Channel',
        channel_link: chat.username ? `https://t.me/${chat.username}` : (chat.invite_link || `https://t.me/${chat.id}`)
    };
}

// Keyboards & Menus
function getUserMenu(isAdmin) {
    const kb = [
        [{ text: '👤 My Account' }, { text: '📮 Referral' }],
        [{ text: '💸 Withdraw' }, { text: '📜 History' }],
        [{ text: '📊 System Status' }]
    ];
    if (isAdmin) kb.push([{ text: '🛠 Admin Panel' }]);
    return { keyboard: kb, resize_keyboard: true, is_persistent: true };
}

function getFullAdminMenu(botActive, wlMode, isSuperAdmin) {
    const kb = [
        [
            { text: botActive ? '🟢 Bot: Active (ON)' : '🔴 Bot: OFF (Maintenance)' },
            { text: '⚙️ Central Settings' }
        ],
        [
            { text: '👥 User & Balance' },
            { text: '📢 Channel Broadcast' }
        ],
        [
            { text: '📢 Users Broadcast' },
            { text: `🛡️ Security (${wlMode ? 'Whitelist' : 'Standard'})` }
        ],
        [
            { text: '📢 Force Channels' },
            { text: '⭐ সেট Payouts Done' }
        ],
        [
            { text: '💳 Payment Methods' },
            { text: '🔧 Source Settings' }
        ]
    ];
    if (isSuperAdmin) {
        kb.push([{ text: '👮 এডমিন ম্যানেজমেন্ট' }]);
    }
    kb.push([{ text: '🔙 Back to User Panel' }]);
    return { keyboard: kb, resize_keyboard: true, is_persistent: true };
}

function centralSettingsKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🚀 জয়েন বট লিংক', callback_data: 'cfg_join_bot' }, { text: '🎧 Support Bot Link', callback_data: 'cfg_support' }],
            [{ text: '💳 Payment Channel', callback_data: 'cfg_pay_channel' }, { text: '🪙 Coin Name', callback_data: 'cfg_coin' }],
            [{ text: '👥 Referral Reward', callback_data: 'cfg_referral' }, { text: '💰 Fixed Withdraw', callback_data: 'cfg_withdraw' }],
            [{ text: '🎯 1st Withdraw Refs', callback_data: 'cfg_first_refs' }, { text: '🎁 Welcome Bonus', callback_data: 'cfg_welcome' }],
            [{ text: '📊 Withdraw Fee (%)', callback_data: 'cfg_fee' }]
        ]
    };
}

function securityKeyboard(wlMode) {
    return {
        inline_keyboard: [
            [{ text: wlMode ? '🔒 Mode: Whitelist Only' : '🔓 Mode: Standard (All allowed)', callback_data: 'sec_toggle_wl' }],
            [{ text: '🚫 Add Blacklist', callback_data: 'sec_add_bl' }, { text: '✅ Add Whitelist', callback_data: 'sec_add_wl' }],
            [{ text: '❌ Remove Blacklist', callback_data: 'sec_rem_bl' }, { text: '❌ Remove Whitelist', callback_data: 'sec_rem_wl' }],
            [{ text: '📋 Blacklist Users', callback_data: 'sec_list_bl' }, { text: '📋 Whitelist Users', callback_data: 'sec_list_wl' }]
        ]
    };
}

async function handleChildUpdate(botRecord, update) {
    const botToken = botRecord.token;
    const botId = botRecord.bot_id;
    const botUsername = botRecord.bot_username;
    const superAdminId = String(botRecord.super_admin_id);
    const cache = getChildCache(botId);
    await ensureChildCacheLoaded(botId, cache);

    const isChildAdmin = (uid) => String(uid) === superAdminId || Boolean(cache.admins[String(uid)]?.active);
    const isSuperAdmin = (uid) => String(uid) === superAdminId;

    const getSetting = (k, def = '') => cache.settings.has(k) ? cache.settings.get(k) : def;
    const setSetting = (k, v) => {
        cache.settings.set(k, v);
        if (k === 'bot_power_status') cache.botActive = v !== 'off';
        if (k === 'whitelist_only_mode') cache.whitelistOnly = v === 'on';
        childDb(botId, `settings/${k}`, 'PUT', v);
    };

    const getUser = async (uid) => {
        const uKey = String(uid);
        if (cache.users.has(uKey)) return cache.users.get(uKey);
        const res = await childDb(botId, `users/${uKey}`);
        if (res) cache.users.set(uKey, res);
        return res;
    };

    const updateUser = (uid, data) => {
        const uKey = String(uid);
        const cur = cache.users.get(uKey) || {};
        const up = { ...cur, ...data };
        cache.users.set(uKey, up);
        childDb(botId, `users/${uKey}`, 'PATCH', data);
    };

    const isJoined = async (chId, uid) => {
        const res = await telegramApi(botToken, 'getChatMember', { chat_id: chId, user_id: uid });
        return res?.ok && ['creator', 'administrator', 'member', 'restricted'].includes(res.result?.status);
    };

    const isAllJoined = async (uid) => {
        const channels = Object.values(cache.forceChannels).filter(c => c && c.channel_id);
        if (!channels.length) return true;
        const res = await Promise.all(channels.map(c => isJoined(c.channel_id, uid)));
        return res.every(Boolean);
    };

    // -------------------------------------------------------------
    // CALLBACK QUERIES
    // -------------------------------------------------------------
    if (update.callback_query) {
        const cq = update.callback_query;
        const fromId = String(cq.from.id);
        const data = cq.data || '';
        const cid = cq.message?.chat?.id;
        const mid = cq.message?.message_id;

        // Force Join Verify
        if (data === 'verify_join') {
            await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
            const ok = await isAllJoined(fromId);
            if (!ok) {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text: '⚠️ আপনি সব চ্যানেলে জয়েন করেননি!', show_alert: true });
                return;
            }

            updateUser(fromId, { is_verified: true, verification_status: 'verified' });
            let u = await getUser(fromId);

            if (u?.referred_by && !u.referral_rewarded) {
                const refUser = await getUser(u.referred_by);
                if (refUser) {
                    const rBonus = Number(getSetting('referral_bonus', 1));
                    updateUser(u.referred_by, {
                        balance: Number(refUser.balance || 0) + rBonus,
                        total_referrals: Number(refUser.total_referrals || 0) + 1
                    });
                    updateUser(fromId, { referral_rewarded: true });
                    sendMsg(botToken, u.referred_by, `🎉 <b>New Referral Verified!</b>\nBonus: <b>+${rBonus} ${getSetting('coin_name', 'STAR')}</b>`);
                }
            }

            if (mid) await telegramApi(botToken, 'deleteMessage', { chat_id: cid, message_id: mid });
            await sendMsg(botToken, fromId, `✅ <b>Verification Successful!</b>\nWelcome to @${botUsername}!`, getUserMenu(isChildAdmin(fromId)));
            return;
        }

        // USER: Select Payment Method for withdrawal
        if (data.startsWith('w_method_')) {
            await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
            const selectedMethod = data.replace('w_method_', '');
            cache.userStates.set(fromId, { action: 'withdraw_address', method: selectedMethod });

            const coin = getSetting('coin_name', 'STAR');
            const fixedAmt = Number(getSetting('min_withdraw', 2));

            await sendMsg(botToken, fromId, 
                `💸 <b>Withdrawing via ${escapeHtml(selectedMethod)}</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `💰 পরিমাণ: <b>${fixedAmt} ${escapeHtml(coin)}</b>\n\n` +
                `আপনার <b>${escapeHtml(selectedMethod)}</b> নাম্বার বা ওয়ালেট এড্রেসটি লিখে পাঠান:`, 
                getCancelKeyboard()
            );
            return;
        }

        // ADMIN: Withdraw Approvals
        if (data.startsWith('c_w_app_') || data.startsWith('c_w_rej_')) {
            await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
            if (!isChildAdmin(fromId)) return;

            const isApprove = data.startsWith('c_w_app_');
            const wId = data.replace(isApprove ? 'c_w_app_' : 'c_w_rej_', '');
            const wReq = await childDb(botId, `withdrawals/${wId}`);

            if (!wReq || wReq.status !== 'pending') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text: '⚠️ Already processed!', show_alert: true });
                return;
            }

            const now = Math.floor(Date.now() / 1000);
            if (isApprove) {
                await childDb(botId, `withdrawals/${wId}`, 'PATCH', { status: 'approved', processed_at: now });
                updateUser(wReq.user_id, { has_withdrawn: true });
                sendMsg(botToken, wReq.user_id, `🎉 <b>Withdrawal Approved!</b>\n💰 Method: <b>${escapeHtml(wReq.method || 'General')}</b>\nAmount: <b>${wReq.after_fee} ${getSetting('coin_name', 'STAR')}</b>`);
                if (mid) editMsg(botToken, cid, mid, `✅ <b>Approved!</b>\nMethod: ${wReq.method || 'N/A'} | User: <code>${wReq.user_id}</code> | Amount: <b>${wReq.amount}</b>`);
            } else {
                const targetU = await getUser(wReq.user_id);
                updateUser(wReq.user_id, { balance: Number(targetU?.balance || 0) + Number(wReq.amount || 0) });
                await childDb(botId, `withdrawals/${wId}`, 'PATCH', { status: 'rejected', processed_at: now });
                sendMsg(botToken, wReq.user_id, `❌ <b>Withdrawal Rejected!</b>\n${wReq.amount} refunded.`);
                if (mid) editMsg(botToken, cid, mid, `❌ <b>Rejected!</b>\nUser: <code>${wReq.user_id}</code>`);
            }
            return;
        }

        // ADMIN: Central Settings Callbacks
        if (isChildAdmin(fromId)) {
            if (data === 'cfg_join_bot') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_join_bot' });
                await sendMsg(botToken, fromId, `🚀 <b>জয়েন বট লিংক</b>\nনতুন লিংক লিখে পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_support') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_support' });
                await sendMsg(botToken, fromId, `🎧 <b>Support Bot Link</b>\nনতুন লিংক বা ইউজারনেম পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_pay_channel') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_pay_channel' });
                await sendMsg(botToken, fromId, `💳 <b>Payment Request Channel</b>\nচ্যানেল আইডি (যেমন: <code>-100...</code>) বা ইউজারনেম পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_coin') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_coin' });
                await sendMsg(botToken, fromId, `🪙 <b>Coin / Currency Name</b>\nবর্তমান নাম: <b>${getSetting('coin_name', 'STAR')}</b>\nনতুন নাম পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_referral') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_referral' });
                await sendMsg(botToken, fromId, `👥 <b>Referral Bonus</b>\nনতুন রিওয়ার্ডের পরিমাণ পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_withdraw') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_withdraw' });
                await sendMsg(botToken, fromId, `💰 <b>Fixed Minimum Withdraw</b>\nনতুন পরিমাণ পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_first_refs') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_first_refs' });
                await sendMsg(botToken, fromId, `🎯 <b>1st Withdraw Referral Requirement</b>\nপ্রথম উইথড্রতে কয়টি রেফার প্রয়োজন? সংখ্যা পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_welcome') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_welcome' });
                await sendMsg(botToken, fromId, `🎁 <b>Welcome Bonus</b>\nনতুন পরিমাণ পাঠান:`, getCancelKeyboard());
                return;
            }
            if (data === 'cfg_fee') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'cfg_fee' });
                await sendMsg(botToken, fromId, `📊 <b>Withdraw Fee (%)</b>\nনতুন পার্সেন্টেজ লিখুন (0-100):`, getCancelKeyboard());
                return;
            }

            // Payment Methods Callbacks
            if (data === 'pm_add') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'pm_add' });
                await sendMsg(botToken, fromId, `➕ <b>নতুন পেমেন্ট মেথড যোগ:</b>\nমেথডের নাম লিখে পাঠান (যেমন: bKash, Nagad, Rocket, Binance, TRC20):`, getCancelKeyboard());
                return;
            }
            if (data === 'pm_remove') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                const methods = cache.paymentMethods || [];
                if (!methods.length) {
                    await sendMsg(botToken, fromId, '⚠️ কোনো মেথড নেই!');
                    return;
                }
                const delButtons = methods.map(m => [{ text: `❌ Delete ${m}`, callback_data: `pm_del_${m}` }]);
                await sendMsg(botToken, fromId, '🗑 <b>কোন মেথডটি রিমুভ করতে চান? ক্লিক করুন:</b>', { inline_keyboard: delButtons });
                return;
            }
            if (data.startsWith('pm_del_')) {
                const targetMethod = data.replace('pm_del_', '');
                let methods = (cache.paymentMethods || []).filter(m => m !== targetMethod);
                cache.paymentMethods = methods;
                await childDb(botId, 'settings/payment_methods', 'PUT', methods);
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Removed!' });
                await sendMsg(botToken, fromId, `✅ <b>${escapeHtml(targetMethod)}</b> রিমুভ করা হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuperAdmin(fromId)));
                return;
            }

            // Security Callbacks
            if (data === 'sec_toggle_wl') {
                const newMode = cache.whitelistOnly ? 'off' : 'on';
                setSetting('whitelist_only_mode', newMode);
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text: `Mode: ${newMode.toUpperCase()}` });
                if (mid) editMsg(botToken, cid, mid, "🛡️ <b>Security Management</b>", securityKeyboard(newMode === 'on'));
                return;
            }
            if (data === 'sec_add_bl') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'sec_add_bl' });
                await sendMsg(botToken, fromId, "🚫 <b>Add to Blacklist</b>\nইউজারের Numeric Telegram ID পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'sec_add_wl') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'sec_add_wl' });
                await sendMsg(botToken, fromId, "✅ <b>Add to Whitelist</b>\nইউজারের Numeric Telegram ID পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'sec_rem_bl') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'sec_rem_bl' });
                await sendMsg(botToken, fromId, "❌ <b>Remove Blacklist</b>\nTelegram User ID পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'sec_rem_wl') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'sec_rem_wl' });
                await sendMsg(botToken, fromId, "❌ <b>Remove Whitelist</b>\nTelegram User ID পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'sec_list_bl') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                const ids = Object.keys(cache.blacklist || {});
                await sendMsg(botToken, fromId, `🚫 <b>Blacklist (${ids.length}):</b>\n` + (ids.length ? ids.map(id => `• <code>${id}</code>`).join('\n') : 'তালিকা খালি।'));
                return;
            }
            if (data === 'sec_list_wl') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                const ids = Object.keys(cache.whitelist || {});
                await sendMsg(botToken, fromId, `✅ <b>Whitelist (${ids.length}):</b>\n` + (ids.length ? ids.map(id => `• <code>${id}</code>`).join('\n') : 'তালিকা খালি।'));
                return;
            }

            // Force Channels Callbacks
            if (data === 'fc_add') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'fc_add' });
                await sendMsg(botToken, fromId, "➕ <b>ফোর্স চ্যানেল যোগ:</b>\nচ্যানেল আইডি (<code>-100...</code>) বা ইউজারনেম পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'fc_remove') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                const entries = Object.entries(cache.forceChannels || {});
                if (!entries.length) {
                    await sendMsg(botToken, fromId, "⚠️ কোনো চ্যানেল তালিকায় নেই!");
                    return;
                }
                const kb = entries.map(([k, c]) => [{ text: `❌ ${c.channel_name || 'Channel'}`, callback_data: `fc_del_${k}` }]);
                await sendMsg(botToken, fromId, "📢 <b>রিমুভ করতে চ্যানেল নির্বাচন করুন:</b>", { inline_keyboard: kb });
                return;
            }
            if (data.startsWith('fc_del_')) {
                const k = data.replace('fc_del_', '');
                delete cache.forceChannels[k];
                await childDb(botId, `force_channels/${k}`, 'DELETE');
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Deleted!' });
                await sendMsg(botToken, fromId, "✅ চ্যানেল সফলভাবে রিমুভ হয়েছে!", getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuperAdmin(fromId)));
                return;
            }
            if (data === 'fc_list') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                const channels = Object.values(cache.forceChannels || {});
                let list = `📢 <b>ফোর্স চ্যানেল তালিকা (${channels.length})</b>\n━━━━━━━━━━━━━━━━━━\n`;
                if (!channels.length) list += "\nকোনো Force Join Channel নেই।";
                else {
                    for (const c of channels) {
                        list += `\n🔹 <b>${escapeHtml(c.channel_name || '')}</b>\n🆔 <code>${c.channel_id}</code>\n🔗 ${c.channel_link}\n`;
                    }
                }
                await sendMsg(botToken, fromId, list);
                return;
            }

            // Balance Callbacks
            if (data === 'bal_add') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'bal_add_user' });
                await sendMsg(botToken, fromId, "➕ <b>ব্যালেন্স যোগ:</b>\nইউজারের Telegram User ID পাঠান:", getCancelKeyboard());
                return;
            }
            if (data === 'bal_cut') {
                await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                cache.adminStates.set(fromId, { action: 'bal_cut_user' });
                await sendMsg(botToken, fromId, "➖ <b>ব্যালেন্স কাটুন:</b>\nইউজারের Telegram User ID পাঠান:", getCancelKeyboard());
                return;
            }

            // Super Admin Management Callbacks
            if (isSuperAdmin(fromId)) {
                if (data === 'adm_add') {
                    await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                    cache.adminStates.set(fromId, { action: 'adm_add' });
                    await sendMsg(botToken, fromId, "➕ <b>নতুন এডমিন যোগ:</b>\nTelegram User ID পাঠান:", getCancelKeyboard());
                    return;
                }
                if (data === 'adm_rem') {
                    await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                    cache.adminStates.set(fromId, { action: 'adm_rem' });
                    await sendMsg(botToken, fromId, "➖ <b>এডমিন রিমুভ:</b>\nTelegram User ID পাঠান:", getCancelKeyboard());
                    return;
                }
                if (data === 'adm_list') {
                    await telegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cq.id });
                    let list = `👮 <b>এডমিন তালিকা</b>\n━━━━━━━━━━━━━━━━━━\n👑 Super Admin: <code>${superAdminId}</code>\n\n`;
                    for (const [aId, a] of Object.entries(cache.admins || {})) {
                        if (a?.active) list += `• <code>${aId}</code>\n`;
                    }
                    await sendMsg(botToken, fromId, list);
                    return;
                }
            }
        }
    }

    // -------------------------------------------------------------
    // MESSAGES
    // -------------------------------------------------------------
    if (!update.message) return;
    const msg = update.message;
    const fromId = String(msg.from.id);
    const chatId = String(msg.chat.id);
    const rawText = msg.text || '';
    const text = cleanText(rawText);
    const cmd = getCommand(rawText);
    const isAdm = isChildAdmin(fromId);
    const isSuper = isSuperAdmin(fromId);

    // Initial Registration
    let u = await getUser(fromId);
    if (!u) {
        let refBy = null;
        const match = text.match(/^\/start\s+(\d+)$/i);
        if (match && match[1] !== fromId) refBy = match[1];

        u = {
            telegram_id: fromId,
            first_name: msg.from.first_name || 'User',
            username: msg.from.username || '',
            balance: 0,
            total_referrals: 0,
            referred_by: refBy,
            referral_rewarded: false,
            is_verified: isAdm,
            created_at: Math.floor(Date.now() / 1000)
        };
        updateUser(fromId, u);
    }

    // Cancel Action
    if (cmd === 'cancel') {
        cache.adminStates.delete(fromId);
        cache.userStates.delete(fromId);
        await sendMsg(botToken, chatId, '❌ Cancelled.', isAdm ? getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper) : getUserMenu(isAdm));
        return;
    }

    // If any menu button was pressed, auto-clear pending inputs
    if (cmd !== 'text') {
        cache.adminStates.delete(fromId);
        cache.userStates.delete(fromId);
    }

    // Security Gate Check (Blacklist & Whitelist)
    if (!isAdm) {
        if (cache.blacklist && cache.blacklist[fromId]) {
            await sendMsg(botToken, chatId, "⛔ <b>Access Blocked!</b>\nYour account has been restricted.");
            return;
        }
        if (cache.whitelistOnly && (!cache.whitelist || !cache.whitelist[fromId])) {
            await sendMsg(botToken, chatId, "⛔ <b>Whitelist Only Mode Active!</b>\nAccess is currently restricted.");
            return;
        }
        if (!cache.botActive) {
            await sendMsg(botToken, chatId, "⛔ <b>Bot currently off for maintenance!</b>");
            return;
        }
    }

    // Strict Force Join Check (Except /start)
    if (!isAdm && cmd !== 'start') {
        const joined = await isAllJoined(fromId);
        if (!joined) {
            const channels = Object.values(cache.forceChannels || {}).filter(c => c && c.channel_link);
            const kb = channels.map(c => [{ text: c.channel_name || 'Join Channel', url: c.channel_link }]);
            kb.push([{ text: 'Claim / Verify ✅', callback_data: 'verify_join' }]);
            await sendMsg(botToken, chatId, `👋 <b>Hello ${escapeHtml(msg.from.first_name)}!</b>\n\nবট ব্যবহার করতে নিচের সকল চ্যানেলে জয়েন করুন:`, { inline_keyboard: kb });
            return;
        }
    }

    // -------------------------------------------------------------
    // ADMIN STATE PROCESSING
    // -------------------------------------------------------------
    if (isAdm && cache.adminStates.has(fromId)) {
        const aState = cache.adminStates.get(fromId);

        if (aState.action === 'cfg_join_bot') {
            cache.adminStates.delete(fromId);
            setSetting('join_bot_url', text);
            await sendMsg(botToken, chatId, `✅ জয়েন বট লিংক আপডেট হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'cfg_support') {
            cache.adminStates.delete(fromId);
            setSetting('support_url', text);
            await sendMsg(botToken, chatId, `✅ সাপোর্ট লিংক আপডেট হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'cfg_pay_channel') {
            const check = await verifyChannelAndBotAdmin(botToken, text);
            if (!check.ok) {
                await sendMsg(botToken, chatId, check.error, getCancelKeyboard());
                return;
            }
            cache.adminStates.delete(fromId);
            setSetting('withdraw_request_channel', check.channel_id);
            await sendMsg(botToken, chatId, `✅ Payment Channel Updated: <b>${escapeHtml(check.channel_title)}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'fc_add') {
            const check = await verifyChannelAndBotAdmin(botToken, text);
            if (!check.ok) {
                await sendMsg(botToken, chatId, check.error, getCancelKeyboard());
                return;
            }
            cache.adminStates.set(fromId, { action: 'fc_add_title', channel_id: check.channel_id, channel_link: check.channel_link, channel_title: check.channel_title });
            await sendMsg(botToken, chatId, `✅ চ্যানেল ভেরিফাইড: <b>${escapeHtml(check.channel_title)}</b>\n\nবাটনে কী নাম দেখাতে চান? লিখে পাঠান (যেমন: Join Channel):`, getCancelKeyboard());
            return;
        }
        if (aState.action === 'fc_add_title') {
            const btnTitle = text || aState.channel_title;
            const newKey = `fc_${Date.now()}`;
            const chObj = { channel_id: aState.channel_id, channel_link: aState.channel_link, channel_name: btnTitle };
            cache.forceChannels[newKey] = chObj;
            await childDb(botId, `force_channels/${newKey}`, 'PUT', chObj);
            cache.adminStates.delete(fromId);
            await sendMsg(botToken, chatId, `🎉 <b>Force Join Channel Added:</b> ${escapeHtml(btnTitle)}`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'cfg_coin') {
            cache.adminStates.delete(fromId);
            setSetting('coin_name', text.toUpperCase());
            await sendMsg(botToken, chatId, `✅ Coin নাম পরিবর্তিত হয়েছে: <b>${escapeHtml(text.toUpperCase())}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'cfg_withdraw') {
            const val = Number(text);
            if (!isNaN(val) && val > 0) {
                cache.adminStates.delete(fromId);
                setSetting('min_withdraw', val);
                await sendMsg(botToken, chatId, `✅ ফিক্সড উইথড্র সেট হয়েছে: <b>${val}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(botToken, chatId, '❌ সঠিক সংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'cfg_referral') {
            const val = Number(text);
            if (!isNaN(val) && val >= 0) {
                cache.adminStates.delete(fromId);
                setSetting('referral_bonus', val);
                await sendMsg(botToken, chatId, `✅ রেফার বোনাস সেট হয়েছে: <b>${val}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(botToken, chatId, '❌ সঠিক সংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'cfg_welcome') {
            const val = Number(text);
            if (!isNaN(val) && val >= 0) {
                cache.adminStates.delete(fromId);
                setSetting('welcome_bonus', val);
                await sendMsg(botToken, chatId, `✅ Welcome Bonus সেট হয়েছে: <b>${val}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(botToken, chatId, '❌ সঠিক সংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'cfg_fee') {
            const val = Number(text);
            if (!isNaN(val) && val >= 0 && val <= 100) {
                cache.adminStates.delete(fromId);
                setSetting('withdraw_fee_percent', val);
                await sendMsg(botToken, chatId, `✅ উইথড্র ফি আপডেট হয়েছে: <b>${val}%</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(botToken, chatId, '❌ 0 থেকে 100 এর মধ্যে সংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'cfg_first_refs') {
            if (/^\d+$/.test(text)) {
                cache.adminStates.delete(fromId);
                setSetting('first_withdraw_refs', parseInt(text));
                await sendMsg(botToken, chatId, `✅ প্রথম উইথড্রতে রেফার প্রয়োজন: <b>${text}</b> টি`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(botToken, chatId, '❌ সঠিক পূর্ণসংখ্যা পাঠান:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'pm_add') {
            cache.adminStates.delete(fromId);
            const newMethod = text.trim();
            let methods = cache.paymentMethods || [];
            if (!methods.includes(newMethod)) {
                methods.push(newMethod);
                cache.paymentMethods = methods;
                await childDb(botId, 'settings/payment_methods', 'PUT', methods);
                await sendMsg(botToken, chatId, `✅ <b>${escapeHtml(newMethod)}</b> মেথড যুক্ত হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            } else {
                await sendMsg(botToken, chatId, `⚠️ এই মেথডটি ইতিমধ্যে আছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            }
            return;
        }
        if (aState.action === 'bal_add_user') {
            const target = await getUser(text);
            if (!target) {
                await sendMsg(botToken, chatId, "❌ ইউজার পাওয়া যায়নি!", getCancelKeyboard());
                return;
            }
            cache.adminStates.set(fromId, { action: 'bal_add_amount', target_id: text });
            await sendMsg(botToken, chatId, `👤 <b>${escapeHtml(target.first_name)}</b>\n💰 ব্যালেন্স: ${target.balance || 0}\nকত যোগ করতে চান?`, getCancelKeyboard());
            return;
        }
        if (aState.action === 'bal_add_amount') {
            const val = Number(text);
            if (!isNaN(val) && val > 0) {
                const targetU = await getUser(aState.target_id);
                const newBal = Number(targetU?.balance || 0) + val;
                updateUser(aState.target_id, { balance: newBal });
                cache.adminStates.delete(fromId);
                await sendMsg(botToken, chatId, `✅ <b>Added +${val}</b>\nNew Balance: <b>${newBal}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
                sendMsg(botToken, aState.target_id, `🎁 <b>+${val} ${getSetting('coin_name', 'STAR')} ব্যালেন্সে যোগ করা হয়েছে!</b>`);
            } else {
                await sendMsg(botToken, chatId, '❌ সঠিক সংখ্যা দিন:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'bal_cut_user') {
            const target = await getUser(text);
            if (!target) {
                await sendMsg(botToken, chatId, "❌ ইউজার পাওয়া যায়নি!", getCancelKeyboard());
                return;
            }
            cache.adminStates.set(fromId, { action: 'bal_cut_amount', target_id: text });
            await sendMsg(botToken, chatId, `👤 <b>${escapeHtml(target.first_name)}</b>\n💰 ব্যালেন্স: ${target.balance || 0}\nকত কাটতে চান?`, getCancelKeyboard());
            return;
        }
        if (aState.action === 'bal_cut_amount') {
            const val = Number(text);
            if (!isNaN(val) && val > 0) {
                const targetU = await getUser(aState.target_id);
                const newBal = Math.max(0, Number(targetU?.balance || 0) - val);
                updateUser(aState.target_id, { balance: newBal });
                cache.adminStates.delete(fromId);
                await sendMsg(botToken, chatId, `✅ <b>Deducted -${val}</b>\nNew Balance: <b>${newBal}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
                sendMsg(botToken, aState.target_id, `⚠️ <b>-${val} ${getSetting('coin_name', 'STAR')} ব্যালেন্স থেকে কাটা হয়েছে!</b>`);
            } else {
                await sendMsg(botToken, chatId, '❌ সঠিক সংখ্যা দিন:', getCancelKeyboard());
            }
            return;
        }
        if (aState.action === 'sec_add_bl') {
            cache.blacklist[text] = { added_at: Math.floor(Date.now() / 1000) };
            await childDb(botId, `security/blacklist/${text}`, 'PUT', cache.blacklist[text]);
            cache.adminStates.delete(fromId);
            await sendMsg(botToken, chatId, `🚫 ইউজার ${text} ব্ল্যাকলিস্টে যুক্ত হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'sec_rem_bl') {
            delete cache.blacklist[text];
            await childDb(botId, `security/blacklist/${text}`, 'DELETE');
            cache.adminStates.delete(fromId);
            await sendMsg(botToken, chatId, `✅ ইউজার ${text} ব্ল্যাকলিস্ট থেকে রিমুভ হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'sec_add_wl') {
            cache.whitelist[text] = { added_at: Math.floor(Date.now() / 1000) };
            await childDb(botId, `security/whitelist/${text}`, 'PUT', cache.whitelist[text]);
            cache.adminStates.delete(fromId);
            await sendMsg(botToken, chatId, `✅ ইউজার ${text} হোয়াইটলিস্টে যুক্ত হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'sec_rem_wl') {
            delete cache.whitelist[text];
            await childDb(botId, `security/whitelist/${text}`, 'DELETE');
            cache.adminStates.delete(fromId);
            await sendMsg(botToken, chatId, `❌ ইউজার ${text} হোয়াইটলিস্ট থেকে রিমুভ হয়েছে!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'adm_add' && isSuper) {
            cache.admins[text] = { active: true, added_at: Math.floor(Date.now() / 1000) };
            await childDb(botId, `admins/${text}`, 'PUT', cache.admins[text]);
            cache.adminStates.delete(fromId);
            await sendMsg(botToken, chatId, `🎉 Admin ${text} Added!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, true));
            return;
        }
        if (aState.action === 'adm_rem' && isSuper) {
            delete cache.admins[text];
            await childDb(botId, `admins/${text}`, 'DELETE');
            cache.adminStates.delete(fromId);
            await sendMsg(botToken, chatId, `✅ Admin ${text} Removed!`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, true));
            return;
        }
        if (aState.action === 'set_payouts_done') {
            cache.adminStates.delete(fromId);
            setSetting('custom_payouts_done', text);
            await sendMsg(botToken, chatId, `✅ <b>Payouts Done সেট হয়েছে:</b> <b>${escapeHtml(text)}</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'awaiting_users_bc') {
            cache.adminStates.delete(fromId);
            await sendMsg(botToken, chatId, "🚀 <b>ইউজার ব্রডকাস্ট শুরু হচ্ছে...</b>");
            const allUsers = await childDb(botId, 'users') || {};
            let sCount = 0;
            for (const uid of Object.keys(allUsers)) {
                try {
                    const r = await copyMsg(botToken, uid, chatId, msg.message_id);
                    if (r?.ok) sCount++;
                } catch {}
            }
            await sendMsg(botToken, chatId, `✅ ব্রডকাস্ট সম্পন্ন! মোট পাঠানো হয়েছে: <b>${sCount}</b> জনকে।`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'awaiting_channel_bc') {
            cache.adminStates.delete(fromId);
            const channels = Object.values(cache.forceChannels || {}).filter(c => c && c.channel_id);
            let sCount = 0;
            for (const ch of channels) {
                try {
                    const r = await copyMsg(botToken, ch.channel_id, chatId, msg.message_id);
                    if (r?.ok) sCount++;
                } catch {}
            }
            await sendMsg(botToken, chatId, `📢 চ্যানেল ব্রডকাস্ট সম্পন্ন! সফল: <b>${sCount}</b> টি চ্যানেল।`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (aState.action === 'set_source_info') {
            cache.adminStates.delete(fromId);
            const freshBot = await firebaseRequest(`builder/bots/${botId}`);
            if (!freshBot?.is_upgraded) {
                const upgradeMsg = 
                    `⛔ <b>আপগ্রেড প্রয়োজন!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                    `বটের সোর্স নাম ও লিংক নিজের মতো পরিবর্তন করতে মেইন বিল্ডার বটে গিয়ে <b>Upgrade Branding</b> সম্পন্ন করুন।\n\n` +
                    `📱 <b>বিকাশ:</b> <code>${builderMemory.settings.bkash}</code>\n` +
                    `📱 <b>নগদ:</b> <code>${builderMemory.settings.nagad}</code>\n` +
                    `📱 <b>রকেট:</b> <code>${builderMemory.settings.rocket}</code>`;
                await sendMsg(botToken, chatId, upgradeMsg, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
                return;
            }
            const parts = text.split('|').map(s => s.trim());
            setSetting('custom_source_name', parts[0] || 'Custom Dev');
            setSetting('custom_source_link', parts[1] || `https://t.me/${botUsername}`);
            await sendMsg(botToken, chatId, `✅ <b>কাস্টম সোর্স সফলভাবে আপডেট করা হয়েছে!</b>`, getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
    }

    // -------------------------------------------------------------
    // USER STATE PROCESSING (Withdraw Address)
    // -------------------------------------------------------------
    if (!isAdm && cache.userStates.has(fromId)) {
        const uState = cache.userStates.get(fromId);
        if (uState.action === 'withdraw_address') {
            cache.userStates.delete(fromId);
            const fixedAmt = Number(getSetting('min_withdraw', 2));
            const coin = getSetting('coin_name', 'STAR');
            const curBal = Number(u.balance || 0);

            if (curBal < fixedAmt) {
                await sendMsg(botToken, chatId, `⚠️ অপর্যাপ্ত ব্যালেন্স! প্রয়োজন: <b>${fixedAmt} ${coin}</b>`, getUserMenu(false));
                return;
            }

            const fee = Number(getSetting('withdraw_fee_percent', 0));
            const afterFee = Math.max(0, fixedAmt - (fixedAmt * fee / 100));
            const txId = `${fromId}${Math.floor(Date.now() / 1000)}`;

            const wData = {
                user_id: fromId,
                first_name: msg.from.first_name || 'User',
                amount: fixedAmt,
                fee_percent: fee,
                after_fee: afterFee,
                method: uState.method || 'General',
                withdraw_address: text,
                transaction_id: txId,
                status: 'pending',
                created_at: Math.floor(Date.now() / 1000)
            };

            updateUser(fromId, { balance: curBal - fixedAmt });
            const saved = await childDb(botId, 'withdrawals', 'POST', wData);

            await sendMsg(botToken, chatId, 
                `🔔 <b>Withdrawal Submitted!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                `💳 Method: <b>${escapeHtml(uState.method || 'General')}</b>\n` +
                `💰 Amount: <b>${fixedAmt} ${coin}</b>\n` +
                `💵 After Fee: <b>${afterFee} ${coin}</b>\n` +
                `📬 Address: <code>${escapeHtml(text)}</code>\n` +
                `🧾 ID: <code>${txId}</code>\n` +
                `📌 Status: <b>PENDING ⏳</b>`, 
                getUserMenu(false)
            );

            // Alert to Payment Channel or Super Admin
            const alertCh = getSetting('withdraw_request_channel', superAdminId);
            if (saved?.name) {
                await sendMsg(botToken, alertCh, 
                    `🔔 <b>New Withdrawal Request!</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
                    `👤 User: <b>${escapeHtml(msg.from.first_name)}</b> (<code>${fromId}</code>)\n` +
                    `💳 Method: <b>${escapeHtml(uState.method || 'General')}</b>\n` +
                    `💰 Amount: <b>${fixedAmt} ${coin}</b> (After Fee: <b>${afterFee} ${coin}</b>)\n` +
                    `📬 Send To: <code>${escapeHtml(text)}</code>\n` +
                    `🧾 TrxID: <code>${txId}</code>`, 
                    {
                        inline_keyboard: [
                            [{ text: '✅ Approve', callback_data: `c_w_app_${saved.name}` }, { text: '❌ Reject', callback_data: `c_w_rej_${saved.name}` }]
                        ]
                    }
                );
            }
            return;
        }
    }

    // -------------------------------------------------------------
    // USER COMMANDS (100% INSTANT RESPONSE)
    // -------------------------------------------------------------
    if (cmd === 'start') {
        const welcomeBonus = Number(getSetting('welcome_bonus', 0));
        if (!u.welcome_claimed && welcomeBonus > 0) {
            updateUser(fromId, { balance: Number(u.balance || 0) + welcomeBonus, welcome_claimed: true });
        }
        await sendMsg(botToken, chatId, `🌟 <b>Welcome, ${escapeHtml(msg.from.first_name)}!</b>\n\nEarn rewards easily and withdraw directly.`, getUserMenu(isAdm));
        return;
    }

    if (cmd === 'account') {
        const coin = getSetting('coin_name', 'STAR');
        const supportUrl = getSetting('support_url', 'https://t.me/AuraSupportsBot');
        await sendMsg(botToken, chatId, 
            `👤 <b>MY ACCOUNT</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 Name: <b>${escapeHtml(msg.from.first_name)}</b>\n` +
            `🆔 ID: <code>${fromId}</code>\n` +
            `⭐ Balance: <b>${formatNumber(u.balance || 0)} ${coin}</b>\n` +
            `👥 Referrals: <b>${u.total_referrals || 0}</b>`, 
            {
                inline_keyboard: [[{ text: '🎧 Support', url: supportUrl }]]
            }
        );
        return;
    }

    if (cmd === 'referral') {
        const coin = getSetting('coin_name', 'STAR');
        const refBonus = getSetting('referral_bonus', 1);
        const refLink = `https://t.me/${botUsername}?start=${fromId}`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(`🌟 Join @${botUsername} and earn free ${coin}!`)}`;

        await sendMsg(botToken, chatId, 
            `📮 <b>Referral Program</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
            `👥 Total Referrals: <b>${u.total_referrals || 0}</b>\n` +
            `💰 Per Referral: <b>${refBonus} ${coin}</b>\n\n` +
            `🔗 <b>Your Invite Link:</b>\n<code>${refLink}</code>\n\n` +
            `<i>⚠️ Note: Referrals count only after channels are verified!</i>`, 
            {
                inline_keyboard: [[{ text: '🚀 Share Link', url: shareUrl }]]
            }
        );
        return;
    }

    if (cmd === 'withdraw') {
        const coin = getSetting('coin_name', 'STAR');
        const fixedAmt = Number(getSetting('min_withdraw', 2));
        const curBal = Number(u.balance || 0);

        if (curBal < fixedAmt) {
            await sendMsg(botToken, chatId, `⚠️ <b>অপর্যাপ্ত ব্যালেন্স!</b>\n\nমিনিমাম উইথড্র: <b>${fixedAmt} ${coin}</b>\nআপনার ব্যালেন্স: <b>${formatNumber(curBal)} ${coin}</b>`);
            return;
        }

        const reqRefs = Number(getSetting('first_withdraw_refs', 0));
        const userRefs = Number(u.total_referrals || 0);
        if (!u.has_withdrawn && reqRefs > 0 && userRefs < reqRefs) {
            await sendMsg(botToken, chatId, `⚠️ <b>প্রথম উইথড্র করার জন্য আপনার কমপক্ষে ${reqRefs} টি রেফার প্রয়োজন!</b>\n\nআপনার বর্তমান রেফার: <b>${userRefs}/${reqRefs}</b>`);
            return;
        }

        const methods = cache.paymentMethods || ['bKash', 'Nagad', 'Rocket'];
        const kb = [];
        for (let i = 0; i < methods.length; i += 2) {
            if (i + 1 < methods.length) {
                kb.push([
                    { text: methods[i], callback_data: `w_method_${methods[i]}` },
                    { text: methods[i + 1], callback_data: `w_method_${methods[i + 1]}` }
                ]);
            } else {
                kb.push([{ text: methods[i], callback_data: `w_method_${methods[i]}` }]);
            }
        }

        await sendMsg(botToken, chatId, `💸 <b>উইথড্র করার পেমেন্ট মেথড নির্বাচন করুন:</b>`, { inline_keyboard: kb });
        return;
    }

    if (cmd === 'history') {
        const coin = getSetting('coin_name', 'STAR');
        const allW = await childDb(botId, 'withdrawals') || {};
        const myW = Object.values(allW).filter(w => String(w.user_id) === fromId);
        if (!myW.length) {
            await sendMsg(botToken, chatId, '📜 কোনো উইথড্র রেকর্ড পাওয়া যায়নি।');
            return;
        }
        let out = `📜 <b>YOUR WITHDRAWAL HISTORY:</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        for (const item of myW.slice(-5).reverse()) {
            out += `• <b>${item.status.toUpperCase()}</b> | ${item.amount} ${coin} (${item.method || 'General'})\n  🕒 ${formatTimestamp(item.created_at)}\n`;
        }
        await sendMsg(botToken, chatId, out);
        return;
    }

    if (cmd === 'status') {
        const users = await childDb(botId, 'users') || {};
        const totalCount = Object.keys(users).length;
        const payouts = getSetting('custom_payouts_done', '0');
        const coin = getSetting('coin_name', 'STAR');

        const freshBot = await firebaseRequest(`builder/bots/${botId}`);
        let sourceHtml = '';

        if (freshBot?.is_upgraded) {
            const sName = getSetting('custom_source_name', 'Verified Dev');
            const sLink = getSetting('custom_source_link', `https://t.me/${botUsername}`);
            sourceHtml = `<a href="${escapeHtml(sLink)}">${escapeHtml(sName)}</a>`;
        } else {
            sourceHtml = `<a href="https://t.me/${BUILDER_BOT_USERNAME}">${BUILDER_BOT_USERNAME}</a>`;
        }

        const stText = 
            `📡 <b>SYSTEM STATUS</b>\n━━━━━━━━━━━━━━━━━━\n\n` +
            `👥 <b>Total Users:</b> ${totalCount} Users\n\n` +
            `⭐ <b>Payouts Done:</b> ${escapeHtml(payouts)} ${coin}\n\n` +
            `🔧 <b>Source:</b> ${sourceHtml}`;

        await sendMsg(botToken, chatId, stText);
        return;
    }

    // -------------------------------------------------------------
    // ADMIN PANEL COMMANDS
    // -------------------------------------------------------------
    if (isAdm) {
        if (cmd === 'admin_panel') {
            await sendMsg(botToken, chatId, '🛠 <b>Admin Panel Activated</b>', getFullAdminMenu(cache.botActive, cache.whitelistOnly, isSuper));
            return;
        }
        if (cmd === 'back_user') {
            await sendMsg(botToken, chatId, '👤 <b>User Panel Activated</b>', getUserMenu(true));
            return;
        }
        if (cmd === 'bot_power') {
            const newStatus = cache.botActive ? 'off' : 'on';
            setSetting('bot_power_status', newStatus);
            await sendMsg(botToken, chatId, `🔄 Bot Status: <b>${newStatus === 'on' ? '🟢 ONLINE' : '🔴 OFFLINE'}</b>`, getFullAdminMenu(newStatus === 'on', cache.whitelistOnly, isSuper));
            return;
        }
        if (cmd === 'central_settings') {
            await sendMsg(botToken, chatId, '⚙️ <b>Central Configuration:</b>', centralSettingsKeyboard());
            return;
        }
        if (cmd === 'user_balance') {
            await sendMsg(botToken, chatId, '👥 <b>User & Balance Management:</b>', {
                inline_keyboard: [
                    [{ text: '➕ ব্যালেন্স যোগ করুন', callback_data: 'bal_add' }, { text: '➖ ব্যালেন্স কাটুন', callback_data: 'bal_cut' }]
                ]
            });
            return;
        }
        if (cmd === 'channel_broadcast') {
            cache.adminStates.set(fromId, { action: 'awaiting_channel_bc' });
            await sendMsg(botToken, chatId, "📢 <b>সকল ফোর্স চ্যানেলে ব্রডকাস্ট করার মেসেজটি পাঠান:</b>", getCancelKeyboard());
            return;
        }
        if (cmd === 'users_broadcast') {
            cache.adminStates.set(fromId, { action: 'awaiting_users_bc' });
            await sendMsg(botToken, chatId, "📢 <b>সকল ইউজারের কাছে ব্রডকাস্ট করার মেসেজটি পাঠান:</b>", getCancelKeyboard());
            return;
        }
        if (cmd === 'security') {
            await sendMsg(botToken, chatId, "🛡️ <b>Security Management</b>\nব্লকলিস্ট ও হোয়াইটলিস্ট কন্ট্রোল:", securityKeyboard(cache.whitelistOnly));
            return;
        }
        if (cmd === 'force_channels') {
            const count = Object.keys(cache.forceChannels || {}).length;
            await sendMsg(botToken, chatId, `📢 <b>FORCE JOIN CHANNELS</b>\nমোট চ্যানেল: <b>${count}</b> টি`, {
                inline_keyboard: [
                    [{ text: '➕ চ্যানেল যোগ করুন', callback_data: 'fc_add' }, { text: '➖ চ্যানেল রিমুভ করুন', callback_data: 'fc_remove' }],
                    [{ text: '📋 চ্যানেল তালিকা', callback_data: 'fc_list' }]
                ]
            });
            return;
        }
        if (cmd === 'payment_methods') {
            const methods = cache.paymentMethods || [];
            let mList = methods.map((m, i) => `${i + 1}. <b>${escapeHtml(m)}</b>`).join('\n');
            await sendMsg(botToken, chatId, 
                `💳 <b>PAYMENT METHODS MANAGEMENT</b>\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                `বর্তমান সক্রিয় মেথড:\n${mList || 'কোনো মেথড নেই'}\n\n` +
                `নিচের বাটন দিয়ে পরিচালনা করুন:`,
                {
                    inline_keyboard: [
                        [{ text: '➕ Add Method', callback_data: 'pm_add' }, { text: '➖ Remove Method', callback_data: 'pm_remove' }]
                    ]
                }
            );
            return;
        }
        if (cmd === 'payouts_done') {
            cache.adminStates.set(fromId, { action: 'set_payouts_done' });
            const cur = getSetting('custom_payouts_done', '0');
            await sendMsg(botToken, chatId, `⭐ <b>Payouts Done</b>\nবর্তমান মান: <b>${escapeHtml(cur)}</b>\nনতুন সংখ্যা পাঠান:`, getCancelKeyboard());
            return;
        }
        if (cmd === 'source_settings') {
            cache.adminStates.set(fromId, { action: 'set_source_info' });
            await sendMsg(botToken, chatId, '🔧 <b>সোর্স সেটিংস:</b>\nফরম্যাট: <code>নাম | লিংক</code>\n\n<i>(নোট: পেইড আপগ্রেড থাকলে কার্যকর হবে)</i>', getCancelKeyboard());
            return;
        }
        if (cmd === 'admin_management' && isSuper) {
            await sendMsg(botToken, chatId, "👮 <b>এডমিন ম্যানেজমেন্ট</b>", {
                inline_keyboard: [
                    [{ text: '➕ এডমিন যোগ করুন', callback_data: 'adm_add' }, { text: '➖ এডমিন রিমুভ করুন', callback_data: 'adm_rem' }],
                    [{ text: '👮 এডমিন তালিকা', callback_data: 'adm_list' }]
                ]
            });
            return;
        }
    }

    // Default Fallback
    await sendMsg(botToken, chatId, `🌟 <b>Welcome ${escapeHtml(msg.from.first_name)}!</b>\nEarn rewards easily and withdraw directly.`, getUserMenu(isAdm));
}

/*
|--------------------------------------------------------------------------
| 5. WEB SERVER & ROUTING
|--------------------------------------------------------------------------
*/
const app = express();
app.use(express.json());

app.post('/webhook/builder', async (req, res) => {
    res.sendStatus(200);
    try {
        await handleBuilderUpdate(req.body);
    } catch (e) {
        console.error('Builder Hook Error:', e);
    }
});

app.post('/webhook/child/:botId', async (req, res) => {
    res.sendStatus(200);
    const botId = req.params.botId;
    let botRecord = builderMemory.bots.get(botId);

    if (!botRecord) {
        botRecord = await firebaseRequest(`builder/bots/${botId}`);
        if (botRecord) builderMemory.bots.set(botId, botRecord);
    }

    if (botRecord) {
        try {
            await handleChildUpdate(botRecord, req.body);
        } catch (e) {
            console.error(`Child Bot (${botId}) Error:`, e);
        }
    }
});

app.get('/ping', (req, res) => res.send('Pong 🏓'));
app.get('/', (req, res) => res.send('Aura Multi-Bot Builder Engine is Running Live 🚀'));

setInterval(() => {
    fetch(`${APP_URL}/ping`).catch(() => {});
}, 8 * 60 * 1000);

async function initSystem() {
    console.log('⚡ Initializing Multi-Bot Engine...');
    const allBots = await firebaseRequest('builder/bots') || {};
    for (const [id, b] of Object.entries(allBots)) {
        builderMemory.bots.set(id, b);
    }
    console.log(`✅ Loaded ${builderMemory.bots.size} registered child bots.`);

    const bWh = `${APP_URL}/webhook/builder`;
    const setup = await telegramApi(BUILDER_BOT_TOKEN, 'setWebhook', { url: bWh, drop_pending_updates: true });
    console.log(`🤖 Builder Bot Webhook:`, setup);
}

const PORT = process.env.PORT || 8000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initSystem();
});
